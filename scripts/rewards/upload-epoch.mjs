// Upload a published epoch's claim data to Supabase (reward_epochs + reward_claims) so the
// frontend can serve each wallet its (epoch, index, amount, proof).
//   node scripts/rewards/upload-epoch.mjs --epoch 1 --tx 0x<publishEpoch tx hash> [--dry-run]
// Refuses unless the file's root matches the epoch on-chain (so nothing unpublished is ever served).
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (server-side only, never in the frontend), STAX_REWARDS_DISTRIBUTOR.
import {Contract, JsonRpcProvider} from "ethers";
import {readFile} from "node:fs/promises";
import "dotenv/config";

const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => a.startsWith("--") ? [a.slice(2), arr[i + 1] ?? true] : []).filter((x) => x.length));
const DRY = "dry-run" in args;
if (!args.epoch) throw new Error("--epoch required");
const file = JSON.parse(await readFile(new URL(`../../reports/rewards/epoch-${args.epoch}.json`, import.meta.url), "utf8"));
const URL_ = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL, KEY = process.env.SUPABASE_SERVICE_ROLE_KEY, DIST = process.env.STAX_REWARDS_DISTRIBUTOR;
if (!URL_ || !KEY) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set");
if (!DIST) throw new Error("STAX_REWARDS_DISTRIBUTOR not set");
if (!args.tx || !/^0x[0-9a-fA-F]{64}$/.test(String(args.tx))) throw new Error("--tx <publishEpoch tx hash> required");

// on-chain check: the root for this epoch must be exactly the file's root
const p = new JsonRpcProvider(process.env.STAX_RPC_URL ?? "https://rpc.mainnet.chain.robinhood.com", 4663, {staticNetwork: true});
const dist = new Contract(DIST, ["function epochs(uint256) view returns(bytes32 merkleRoot,uint256 total,uint256 claimed,uint64 publishedAt,uint64 expiresAt,bool recovered)"], p);
const e = await dist.epochs(file.epoch);
if (e.merkleRoot.toLowerCase() !== String(file.merkleRoot).toLowerCase()) throw new Error(`on-chain root for epoch ${file.epoch} is ${e.merkleRoot}, file has ${file.merkleRoot}`);
if (e.total.toString() !== String(file.distributed)) throw new Error(`on-chain total ${e.total} != file distributed ${file.distributed}`);

const byAccount = new Map(file.wallets.map((w) => [w.account.toLowerCase(), w]));
const epochRow = {
  epoch: file.epoch, merkle_root: file.merkleRoot, total: file.distributed,
  start_ts: new Date(file.start * 1000).toISOString(), end_ts: new Date(file.end * 1000).toISOString(),
  start_block: file.startBlock, end_block: file.endBlock,
  expires_at: Number(e.expiresAt) ? new Date(Number(e.expiresAt) * 1000).toISOString() : null,
  published_tx: args.tx, published_at: new Date(Number(e.publishedAt) * 1000).toISOString(), params: file.params, distributor: DIST,
};
const claimRows = file.leaves.map((l) => { const w = byAccount.get(l.account.toLowerCase()) ?? {}; return {
  epoch: file.epoch, index: l.index, account: l.account, amount: l.amount, proof: l.proof,
  tvl_tw_usd: w.tvlTwUsd ?? null, stake_tw: w.stakeTw ?? null, multiplier: w.multiplier ?? null,
}; });
console.log(`epoch ${file.epoch}: ${claimRows.length} claims, total ${file.distributed}, root ${file.merkleRoot} (verified on-chain), expires ${epochRow.expires_at ?? "never"}`);
if (DRY) { console.log("dry run: nothing uploaded"); process.exit(0); }

async function upsert(table, rows, onConflict) {
  const res = await fetch(`${URL_.replace(/\/$/, "")}/rest/v1/${table}?on_conflict=${onConflict}`, {
    method: "POST", headers: {apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal"},
    body: JSON.stringify(rows),
  });
  if (!res.ok) throw new Error(`${table}: ${res.status} ${await res.text()}`);
}
await upsert("reward_epochs", [epochRow], "epoch");
for (let i = 0; i < claimRows.length; i += 500) await upsert("reward_claims", claimRows.slice(i, i + 500), "epoch,index");
console.log(`uploaded reward_epochs(1) + reward_claims(${claimRows.length})`);
