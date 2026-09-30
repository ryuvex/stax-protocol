// Chainlink Data Streams keeper for StreamsRegistryAdapter.
//
// Every STAX_STREAMS_EVERY_SEC (default 300s) it fetches the latest signed report for each
// configured token from Chainlink's Data Streams API and, when the on-chain price is older
// than STAX_STREAMS_MAX_AGE_SEC (default 240s) or the market status changed, calls
// adapter.update(report). The adapter hands the report to Chainlink's verifier, so a report
// this script could not fake is the only thing that ever gets stored.
//
// Usage:
//   node scripts/monitor/streams-keeper.mjs                 loop
//   node scripts/monitor/streams-keeper.mjs --once          one pass, exit
//   node scripts/monitor/streams-keeper.mjs --once NFLX     one token
//   add --dry-run to fetch + verify offline decoding but not send
//
// Env (in stax-protocol/.env):
//   STAX_STREAMS_ADAPTER=0x...             deployed StreamsRegistryAdapter
//   STAX_STREAMS_API_KEY / STAX_STREAMS_API_SECRET   Chainlink Data Streams credentials
//   STAX_STREAMS_API_URL   default https://api.dataengine.chain.link (testnet: https://api.testnet-dataengine.chain.link)
//   STAX_STREAMS_TOKENS    JSON: [{"symbol":"NFLX","token":"0x...","feedId":"0x..."}, ...]
//   STAX_STREAMS_PRIVATE_KEY or key file at ../../../streams-keeper-private-key.txt (outside the repo)
//   STAX_STREAMS_MARKET_HOURS_ONLY=1   skip fetching when the stored status is "closed" and it's a weekend (saves API calls)
import {Contract, JsonRpcProvider, Wallet, AbiCoder, formatUnits} from "ethers";
import {createHmac, createHash} from "node:crypto";
import {readFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import "dotenv/config";

const args = process.argv.slice(2);
const ONCE = args.includes("--once"), DRY = args.includes("--dry-run");
const PICK = args.filter((a) => !a.startsWith("--")).map((s) => s.toUpperCase());
const RPC = process.env.STAX_RPC_URL ?? "https://rpc.mainnet.chain.robinhood.com";
const API = (process.env.STAX_STREAMS_API_URL ?? "https://api.dataengine.chain.link").replace(/\/$/, "");
const EVERY = Math.max(30, Number(process.env.STAX_STREAMS_EVERY_SEC ?? 300)) * 1000;
const MAX_AGE = Number(process.env.STAX_STREAMS_MAX_AGE_SEC ?? 240);
const ADAPTER = process.env.STAX_STREAMS_ADAPTER;
const KEY_ID = process.env.STAX_STREAMS_API_KEY, SECRET = process.env.STAX_STREAMS_API_SECRET;
if (!ADAPTER) throw Error("STAX_STREAMS_ADAPTER not set");
if (!KEY_ID || !SECRET) throw Error("STAX_STREAMS_API_KEY / STAX_STREAMS_API_SECRET not set");
const TOKENS = JSON.parse(process.env.STAX_STREAMS_TOKENS ?? "[]");
if (!TOKENS.length) throw Error("STAX_STREAMS_TOKENS is empty");

const ADAPTER_ABI = [
  "function update(bytes report) payable",
  "function prices(address) view returns (uint192 usd18, uint32 observedAt, uint32 marketStatus)",
  "function configs(address) view returns (bytes32 feedId, address pool, uint8 decimals, uint32 maxAge, uint32 allowedStatusMask)",
  "function isFresh(address) view returns (bool)",
];
const provider = new JsonRpcProvider(RPC, 4663, {staticNetwork: true});
let signer = null;
if (!DRY) {
  const key = (process.env.STAX_STREAMS_PRIVATE_KEY ?? await readFile(process.env.STAX_STREAMS_KEY_FILE ?? fileURLToPath(new URL("../../../streams-keeper-private-key.txt", import.meta.url)), "utf8")).trim();
  signer = new Wallet(key, provider);
  console.log("keeper wallet", signer.address, "ETH", formatUnits(await provider.getBalance(signer.address), 18));
}
const adapter = new Contract(ADAPTER, ADAPTER_ABI, signer ?? provider);

// --- Chainlink Data Streams REST auth: HMAC-SHA256 over "METHOD PATH BODYHASH APIKEY TIMESTAMP_MS"
function authHeaders(method, pathWithQuery, body = "") {
  const ts = Date.now();
  const bodyHash = createHash("sha256").update(body).digest("hex");
  const toSign = `${method} ${pathWithQuery} ${bodyHash} ${KEY_ID} ${ts}`;
  const sig = createHmac("sha256", SECRET).update(toSign).digest("hex");
  return {Authorization: KEY_ID, "X-Authorization-Timestamp": String(ts), "X-Authorization-Signature-SHA256": sig};
}
async function latestReport(feedId) {
  const path = `/api/v1/reports/latest?feedID=${feedId}`;
  const res = await fetch(API + path, {headers: authHeaders("GET", path)});
  if (!res.ok) throw Error(`API ${res.status} ${await res.text()}`);
  const {report} = await res.json();
  return report; // {feedID, validFromTimestamp, observationsTimestamp, fullReport}
}
// offline peek at the report body so logs show what we're about to post (mid price, status)
function peek(fullReport) {
  const [, data] = AbiCoder.defaultAbiCoder().decode(["bytes32[3]", "bytes"], fullReport);
  const version = parseInt(data.slice(2, 6), 16);
  if (version === 8) {
    const r = AbiCoder.defaultAbiCoder().decode(["bytes32", "uint32", "uint32", "uint192", "uint192", "uint32", "uint64", "int192", "uint32"], data);
    return {version, observedAt: Number(r[2]), expiresAt: Number(r[5]), mid: r[7], status: Number(r[8])};
  }
  if (version === 11) {
    const r = AbiCoder.defaultAbiCoder().decode(["bytes32", "uint32", "uint32", "uint192", "uint192", "uint32", "int192", "uint64", "int192", "int192", "int192", "int192", "int192", "uint32"], data);
    return {version, observedAt: Number(r[2]), expiresAt: Number(r[5]), mid: r[6], status: Number(r[13])};
  }
  return {version};
}

async function tick() {
  const now = (await provider.getBlock("latest")).timestamp;
  for (const t of TOKENS) {
    if (PICK.length && !PICK.includes(t.symbol.toUpperCase())) continue;
    try {
      const cfg = await adapter.configs(t.token);
      if (cfg.feedId.toLowerCase() !== t.feedId.toLowerCase()) { console.error(`${t.symbol}: adapter feedId ${cfg.feedId} != env ${t.feedId}, skipping`); continue; }
      const stored = await adapter.prices(t.token);
      const age = now - Number(stored.observedAt);
      const report = await latestReport(t.feedId);
      const p = peek(report.fullReport);
      const changed = Number(stored.marketStatus) !== p.status;
      const due = PICK.length || age > MAX_AGE || changed;
      console.log(`${t.symbol}: stored age ${age}s status ${stored.marketStatus} | api v${p.version} mid ${p.mid !== undefined ? formatUnits(p.mid, 18) : "?"} status ${p.status} observed ${now - p.observedAt}s ago${due ? " -> update" : " (fresh)"}`);
      if (!due) continue;
      if (p.observedAt <= Number(stored.observedAt)) { console.log(`  api report not newer than stored, skip`); continue; }
      if (DRY) { console.log("  dry run"); continue; }
      await adapter.update.staticCall(report.fullReport);
      const tx = await adapter.update(report.fullReport, {gasLimit: 400_000});
      const r = await tx.wait();
      console.log(`  update ${r.hash} (${r.status === 1 ? "ok" : "REVERTED"})`);
    } catch (e) {
      console.error(`${t.symbol}: failed:`, e.shortMessage ?? e.message);
    }
  }
}
if (ONCE) { await tick(); process.exit(0); }
console.log(`streams keeper: every ${EVERY / 1000}s, update when stored price > ${MAX_AGE}s old or market status changes`);
for (;;) { try { await tick(); } catch (e) { console.error(new Date().toISOString(), "tick failed:", e.shortMessage ?? e.message); } await new Promise((r) => setTimeout(r, EVERY)); }
