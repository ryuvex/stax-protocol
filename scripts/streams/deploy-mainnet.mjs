// Robinhood Chain MAINNET: deploy StreamsRegistryAdapter against Chainlink's mainnet Data Streams verifier and map
// the subscribed equity streams onto the live TWAP-priced tickers. Nothing touches the vault: switching a ticker is a
// separate owner call later (vault.setTwapOracle(ticker, adapter, slippage)), after the keeper has posted a first price.
//
//   node scripts/streams/deploy-mainnet.mjs --dry-run            checks + plan, nothing sent
//   node scripts/streams/deploy-mainnet.mjs                      deploy + setToken/addFeed (owner = deployer key)
//   node scripts/streams/deploy-mainnet.mjs --allow-closed       also accept market status "closed" (weekend quoting at
//                                                                last close, like the Chainlink-fed tickers with 96h staleness)
// Key: STAX_PRIVATE_KEY or ../deployer-private-key.txt (vault owner; becomes adapter owner). Gas only.
// Feed ids: confirmed against data.chain.link stream pages 2026-10-24 (regular + extended hours per stock).
import {Contract, ContractFactory, JsonRpcProvider, Wallet, formatUnits, ZeroAddress} from "ethers";
import {readFile, writeFile, mkdir} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import "dotenv/config";

const DRY = process.argv.includes("--dry-run"), ALLOW_CLOSED = process.argv.includes("--allow-closed");
const RPC = process.env.STAX_RPC_URL ?? "https://rpc.mainnet.chain.robinhood.com", CHAIN_ID = 4663;
const VERIFIER = "0xcE73c8ad08CBDEaCa6078BF0627C8fe0a9a536E7"; // Data Streams verifier proxy, Robinhood Chain mainnet (7009 bytes, checked 2026-10)
const VAULT_V2 = "0xAda84161033C0Cc54EF21CEeF913A8fEC4239b33";
const USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
const USDG_USD_MAX_STALENESS = 97_200; // same as the vault's own USDG/USD staleness
const MAX_AGE = 900;                   // seconds a stored report stays quotable
// v11 market status bits: 1 pre, 2 regular, 3 post, 4 overnight, 5 closed
const MASK = (1 << 1) | (1 << 2) | (1 << 3) | (1 << 4) | (ALLOW_CLOSED ? 1 << 5 : 0);
const TOKENS = [
  {symbol: "NFLX", token: "0xE0444EF8BF4eD74f74FD73686e2ddF4C1c5591E8", feedIds: [
    "0x000b826d0a21022b01a51b0b15e3fc173812e78ddc449a5069f13f2c1e652912", // NFLX/USD RegularHoursEquityPrice
    "0x000ba38bc53d30ddf079e88e8302fbe6489c69564fe1c4c537d4c142881149a5"]}, // NFLX/USD ExtendedHoursEquityPrice
  {symbol: "AMC", token: "0x05a3d1Cd21d0C88145E82600E62e7E496e0F222B", feedIds: [
    "0x000bcb04385f07fca93ba82d1a1038a0fa3bee06ff0c78a27149d346fbad97b7", // AMC/USD RegularHoursEquityPrice
    "0x000b70cc5542a211118a0e0904b4afc1bced460659e0340f71511c5f8a85c431"]}, // AMC/USD ExtendedHoursEquityPrice
  {symbol: "LLY", token: "0x8005d266423c7ea827372c9c864491e5786600ea", feedIds: [
    "0x000b55861659dd18041a907c765200e25bd2a4d9213633e2873fec3045d94472", // LLY/USD RegularHoursEquityPrice
    "0x000bf5d9411efd14ede7b03aeb13592f1161bc6f821fe2ce0bcf65b832a505b1"]}, // LLY/USD ExtendedHoursEquityPrice
];

const provider = new JsonRpcProvider(RPC, CHAIN_ID, {staticNetwork: true});
const artifact = async (p) => JSON.parse(await readFile(new URL(`../../artifacts/contracts/${p}.json`, import.meta.url), "utf8"));
const key = (process.env.STAX_PRIVATE_KEY ?? await readFile(fileURLToPath(new URL("../../../deployer-private-key.txt", import.meta.url)), "utf8")).trim();
const wallet = new Wallet(key, provider);
const vault = new Contract(VAULT_V2, ["function owner() view returns(address)", "function usdgUsdFeed() view returns(address)", "function usdg() view returns(address)",
  "function oracleSettings(address) view returns(uint8 oracleType,address registry)"], provider);
const verifier = new Contract(VERIFIER, ["function s_feeManager() view returns(address)"], provider);

// ---- checks (read-only)
const [bal, owner, usdgFeed, vaultUsdg] = await Promise.all([provider.getBalance(wallet.address), vault.owner(), vault.usdgUsdFeed(), vault.usdg()]);
console.log(`deployer ${wallet.address}  balance ${formatUnits(bal, 18)} ETH  chain ${CHAIN_ID}`);
if (owner.toLowerCase() !== wallet.address.toLowerCase()) throw Error(`deployer is not the vault owner (${owner})`);
if (vaultUsdg.toLowerCase() !== USDG.toLowerCase()) throw Error("vault USDG mismatch");
if ((await provider.getCode(VERIFIER)).length <= 2) throw Error("no code at verifier address");
let feeManager = ZeroAddress; try { feeManager = await verifier.s_feeManager(); } catch { console.log("verifier has no s_feeManager() -- treating as fee-free"); }
console.log(`verifier ${VERIFIER}  feeManager ${feeManager}${feeManager === ZeroAddress ? " (no per-report fee)" : "  <-- reports are billed; LINK/native budget needed"}`);
console.log(`usdg/usd feed ${usdgFeed} (from vault)  status mask 0b${MASK.toString(2)}${ALLOW_CLOSED ? " (closed allowed)" : " (24/5, closed rejected)"}  maxAge ${MAX_AGE}s`);
const plan = [];
for (const t of TOKENS) {
  const o = await vault.oracleSettings(t.token);
  if (Number(o.oracleType) !== 2) throw Error(`${t.symbol} is not TWAP-priced on V2 (type ${o.oracleType}); only TWAP tickers can move to Streams`);
  const registry = new Contract(o.registry, ["function poolFor(address) view returns(address)"], provider);
  const pool = await registry.poolFor(t.token);
  if (pool === ZeroAddress) throw Error(`${t.symbol}: registry ${o.registry} has no pool`);
  plan.push({...t, registry: o.registry, pool});
  console.log(`  ${t.symbol} ${t.token}  current registry ${o.registry}  pool ${pool}  streams ${t.feedIds.length}`);
}
if (bal < 2n * 10n ** 15n) throw Error("deployer needs at least 0.002 ETH");
if (DRY) { console.log("\ndry run: would deploy the adapter and configure the 3 tokens above. Nothing sent."); process.exit(0); }

// ---- deploy + configure
const a = await artifact("StreamsRegistryAdapter.sol/StreamsRegistryAdapter");
const adapter = await new ContractFactory(a.abi, a.bytecode, wallet).deploy(VERIFIER, USDG, usdgFeed, USDG_USD_MAX_STALENESS);
await adapter.waitForDeployment();
const adapterAddr = await adapter.getAddress();
console.log(`StreamsRegistryAdapter ${adapterAddr}  tx ${adapter.deploymentTransaction().hash}`);
const txs = [];
for (const t of plan) {
  let tx = await adapter.setToken(t.token, t.feedIds[0], t.pool, MAX_AGE, MASK); await tx.wait(); txs.push({step: `setToken ${t.symbol}`, hash: tx.hash});
  for (const f of t.feedIds.slice(1)) { tx = await adapter.addFeed(t.token, f); await tx.wait(); txs.push({step: `addFeed ${t.symbol}`, hash: tx.hash}); }
  console.log(`  ${t.symbol} configured (${t.feedIds.length} streams)`);
}
const out = {chainId: CHAIN_ID, deployedAt: new Date().toISOString(), verifier: VERIFIER, feeManager, usdg: USDG, usdgUsdFeed: usdgFeed, usdgUsdMaxStaleness: USDG_USD_MAX_STALENESS,
  adapter: adapterAddr, owner: wallet.address, maxAge: MAX_AGE, allowedStatusMask: MASK, deployTx: adapter.deploymentTransaction().hash, txs,
  tokens: plan.map((t) => ({symbol: t.symbol, token: t.token, pool: t.pool, previousRegistry: t.registry, feedIds: t.feedIds}))};
await mkdir(new URL("../../reports/streams-mainnet/", import.meta.url), {recursive: true});
await writeFile(new URL("../../reports/streams-mainnet/deployment.json", import.meta.url), JSON.stringify(out, null, 2));
console.log("\nwritten reports/streams-mainnet/deployment.json");
console.log("\nkeeper env (replace the testnet lines in .env):");
console.log(`STAX_STREAMS_ADAPTER=${adapterAddr}\nSTAX_STREAMS_TOKENS=${JSON.stringify(out.tokens.map((t) => ({symbol: t.symbol, token: t.token, feedIds: t.feedIds})))}`);
