// Owner step: change which Chainlink market statuses the adapter will quote for every configured token.
//   node scripts/streams/set-status-mask.mjs --allow-closed [--dry-run]    24/5 sessions + closed (weekend quoting at last close)
//   node scripts/streams/set-status-mask.mjs [--dry-run]                   24/5 sessions only
// Re-runs setToken with the same feed/pool/maxAge; extra streams added with addFeed stay mapped.
import {Contract, JsonRpcProvider, Wallet} from "ethers";
import {readFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import "dotenv/config";
const DRY = process.argv.includes("--dry-run"), ALLOW_CLOSED = process.argv.includes("--allow-closed");
const MASK = (1 << 1) | (1 << 2) | (1 << 3) | (1 << 4) | (ALLOW_CLOSED ? 1 << 5 : 0);
const dep = JSON.parse(await readFile(new URL("../../reports/streams-mainnet/deployment.json", import.meta.url), "utf8"));
const p = new JsonRpcProvider(process.env.STAX_RPC_URL ?? "https://rpc.mainnet.chain.robinhood.com", dep.chainId, {staticNetwork: true});
const key = (process.env.STAX_PRIVATE_KEY ?? await readFile(fileURLToPath(new URL("../../../deployer-private-key.txt", import.meta.url)), "utf8")).trim();
const adapter = new Contract(dep.adapter, ["function owner() view returns(address)", "function configs(address) view returns(bytes32 feedId,address pool,uint8 decimals,uint32 maxAge,uint32 allowedStatusMask)",
  "function setToken(address,bytes32,address,uint32,uint32)"], new Wallet(key, p));
if ((await adapter.owner()).toLowerCase() !== adapter.runner.address.toLowerCase()) throw Error("signer is not the adapter owner");
for (const t of dep.tokens) {
  const c = await adapter.configs(t.token);
  console.log(`${t.symbol}: mask 0b${Number(c.allowedStatusMask).toString(2)} -> 0b${MASK.toString(2)}  (feed ${c.feedId.slice(0, 10)}… pool ${c.pool} maxAge ${c.maxAge})`);
  if (DRY || Number(c.allowedStatusMask) === MASK) continue;
  const tx = await adapter.setToken(t.token, c.feedId, c.pool, c.maxAge, MASK); await tx.wait(); console.log(`  ${tx.hash}`);
}
console.log(DRY ? "dry run: nothing sent" : "done");
