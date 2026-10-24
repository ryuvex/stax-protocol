// Owner step: move a TWAP-priced V2 ticker onto the Data Streams adapter (vault.setTwapOracle(ticker, adapter, slippage)).
//   node scripts/streams/switch-ticker.mjs NFLX AMC --dry-run    show both registries' quotes + basket NAV, send nothing
//   node scripts/streams/switch-ticker.mjs NFLX AMC              switch (keeps each ticker's current slippage bps)
// Refuses when the adapter has no fresh verified price for the ticker (the vault would revert anyway).
// Key: STAX_PRIVATE_KEY or ../deployer-private-key.txt (vault owner).
import {Contract, JsonRpcProvider, Wallet, formatUnits} from "ethers";
import {readFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import "dotenv/config";
const DRY = process.argv.includes("--dry-run"), want = process.argv.slice(2).filter((a) => !a.startsWith("--")).map((s) => s.toUpperCase());
const dep = JSON.parse(await readFile(new URL("../../reports/streams-mainnet/deployment.json", import.meta.url), "utf8"));
const p = new JsonRpcProvider(process.env.STAX_RPC_URL ?? "https://rpc.mainnet.chain.robinhood.com", dep.chainId, {staticNetwork: true});
const key = (process.env.STAX_PRIVATE_KEY ?? await readFile(fileURLToPath(new URL("../../../deployer-private-key.txt", import.meta.url)), "utf8")).trim();
const signer = new Wallet(key, p);
const VAULT = "0xAda84161033C0Cc54EF21CEeF913A8fEC4239b33";
const vault = new Contract(VAULT, ["function owner() view returns(address)", "function oracleSettings(address) view returns(uint8 oracleType,address registry)",
  "function tickerSlippageBps(address) view returns(uint16)", "function setTwapOracle(address,address,uint16)", "function getBasketNavUsd(uint256) view returns(uint256)"], signer);
const REG_ABI = ["function quoteUsdg18(address) view returns(uint256 usdgAmount18,uint128 harmonicLiquidity)", "function poolFor(address) view returns(address)"];
const adapter = new Contract(dep.adapter, REG_ABI, p);
const BASKETS = {NFLX: [3], AMC: [3], LLY: [6]}; // V2 baskets that hold each ticker (3 retailfavoritesv2, 6 healthcare)
if ((await vault.owner()).toLowerCase() !== signer.address.toLowerCase()) throw Error("signer is not the vault owner");
const tokens = dep.tokens.filter((t) => !want.length || want.includes(t.symbol));
if (!tokens.length) throw Error("no matching tickers; choose from " + dep.tokens.map((t) => t.symbol).join(", "));
const q = async (reg, token) => { try { const [u] = await new Contract(reg, REG_ABI, p).quoteUsdg18(token); return `$${Number(formatUnits(u, 18)).toFixed(4)}`; } catch (e) { return `revert (${(e.shortMessage ?? e.message).slice(0, 60)})`; } };
const nav = async (id) => { try { return `$${Number(formatUnits(await vault.getBasketNavUsd(id), 18)).toFixed(2)}`; } catch (e) { return `revert (${(e.shortMessage ?? e.message).slice(0, 50)})`; } };
for (const t of tokens) {
  const o = await vault.oracleSettings(t.token), slip = Number(await vault.tickerSlippageBps(t.token));
  if (Number(o.oracleType) !== 2) throw Error(`${t.symbol}: not TWAP-priced (type ${o.oracleType})`);
  const already = o.registry.toLowerCase() === dep.adapter.toLowerCase();
  console.log(`${t.symbol}: registry ${o.registry}${already ? " (already the adapter)" : ""}  slippage ${slip} bps`);
  console.log(`  current registry quote ${await q(o.registry, t.token)} | streams adapter quote ${await q(dep.adapter, t.token)} | adapter poolFor ${(await adapter.poolFor(t.token)) === t.pool ? "matches" : "MISMATCH"}`);
  for (const id of BASKETS[t.symbol] ?? []) console.log(`  basket ${id} NAV now ${await nav(id)}`);
  if (DRY || already) continue;
  if ((await q(dep.adapter, t.token)).startsWith("revert")) throw Error(`${t.symbol}: adapter has no fresh price; run the keeper first`);
  const tx = await vault.setTwapOracle(t.token, dep.adapter, slip); console.log(`  setTwapOracle -> ${tx.hash}`); await tx.wait();
  const after = await vault.oracleSettings(t.token); console.log(`  now registry ${after.registry}`);
  for (const id of BASKETS[t.symbol] ?? []) console.log(`  basket ${id} NAV after ${await nav(id)}`);
}
console.log(DRY ? "dry run: nothing sent" : "done");
