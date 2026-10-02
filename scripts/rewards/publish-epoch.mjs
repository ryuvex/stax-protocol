// Owner step: publish an epoch file's merkle root on StaxRewardsDistributor.
//   node scripts/rewards/publish-epoch.mjs --epoch 1 [--expires-days 90] [--dry-run]
// Key: STAX_REWARDS_OWNER_PRIVATE_KEY or file at STAX_REWARDS_OWNER_KEY_FILE (default ../deployer-private-key.txt, outside the repo).
// Refuses if the file's total exceeds the distributor's unallocated USDG, or the epoch number
// doesn't match the next on-chain epoch.
import {Contract, JsonRpcProvider, Wallet, formatUnits} from "ethers";
import {readFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import "dotenv/config";
import {verify} from "./merkle.mjs";

const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => a.startsWith("--") ? [a.slice(2), arr[i + 1] ?? true] : []).filter((x) => x.length));
const DRY = "dry-run" in args;
const file = JSON.parse(await readFile(new URL(`../../reports/rewards/epoch-${args.epoch}.json`, import.meta.url), "utf8"));
const p = new JsonRpcProvider(process.env.STAX_RPC_URL ?? "https://rpc.mainnet.chain.robinhood.com", 4663, {staticNetwork: true});
const ABI = ["function unallocated() view returns(uint256)", "function epochCount() view returns(uint256)", "function publishEpoch(bytes32,uint256,uint64) returns(uint256)", "function owner() view returns(address)"];
const addr = process.env.STAX_REWARDS_DISTRIBUTOR; if (!addr) throw new Error("STAX_REWARDS_DISTRIBUTOR not set");
const dist = new Contract(addr, ABI, p);

for (const l of file.leaves) if (!verify(l.proof, file.merkleRoot, l.index, l.account, BigInt(l.amount))) throw new Error(`leaf ${l.index} does not verify against the file's root`);
const sum = file.leaves.reduce((s, l) => s + BigInt(l.amount), 0n);
if (sum !== BigInt(file.distributed)) throw new Error("leaf sum != distributed");
const next = Number(await dist.epochCount()) + 1;
if (next !== Number(file.epoch)) throw new Error(`file is epoch ${file.epoch} but next on-chain epoch is ${next}`);
const avail = await dist.unallocated();
if (sum > avail) throw new Error(`distributed ${formatUnits(sum, 6)} > unallocated ${formatUnits(avail, 6)} USDG`);
const expiresAt = args["expires-days"] ? Math.floor(Date.now() / 1000) + Number(args["expires-days"]) * 86400 : 0;
console.log(`epoch ${file.epoch}: ${file.leaves.length} claims, ${formatUnits(sum, 6)} USDG (unallocated ${formatUnits(avail, 6)}), root ${file.merkleRoot}, expires ${expiresAt ? new Date(expiresAt * 1000).toISOString() : "never"}`);
if (DRY) { console.log("dry run: nothing sent"); process.exit(0); }

const key = (process.env.STAX_REWARDS_OWNER_PRIVATE_KEY ?? await readFile(process.env.STAX_REWARDS_OWNER_KEY_FILE ?? fileURLToPath(new URL("../../../deployer-private-key.txt", import.meta.url)), "utf8")).trim();
const signer = new Wallet(key, p);
if ((await dist.owner()).toLowerCase() !== signer.address.toLowerCase()) throw new Error(`signer ${signer.address} is not the distributor owner`);
const tx = await dist.connect(signer).publishEpoch(file.merkleRoot, sum, expiresAt);
console.log("sent", tx.hash); const r = await tx.wait(); console.log(r.status === 1 ? "published" : "REVERTED");
