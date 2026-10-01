// Read-only: lists Chainlink Data Streams feeds matching the given symbols and pulls one
// latest report per match, decoded offline. Confirms the credentials work and gives the
// feed IDs to configure in the adapter. Usage: node scripts/monitor/streams-feeds.mjs            (all feeds)
//        node scripts/monitor/streams-feeds.mjs 0x0008 0x000b   (feed-id prefix filter; 0x0008 = v8 RWA, 0x000b = v11 RWA)
import {AbiCoder, formatUnits} from "ethers";
import {createHmac, createHash} from "node:crypto";
import "dotenv/config";

const API = (process.env.STAX_STREAMS_API_URL ?? "https://api.dataengine.chain.link").replace(/\/$/, "");
const KEY_ID = process.env.STAX_STREAMS_API_KEY, SECRET = process.env.STAX_STREAMS_API_SECRET;
if (!KEY_ID || !SECRET) throw Error("STAX_STREAMS_API_KEY / STAX_STREAMS_API_SECRET not set in .env");
const WANT = process.argv.slice(2).map((s) => s.toUpperCase());

function headers(method, path, body = "") {
  const ts = Date.now();
  const bodyHash = createHash("sha256").update(body).digest("hex");
  const sig = createHmac("sha256", SECRET).update(`${method} ${path} ${bodyHash} ${KEY_ID} ${ts}`).digest("hex");
  return {Authorization: KEY_ID, "X-Authorization-Timestamp": String(ts), "X-Authorization-Signature-SHA256": sig};
}
async function get(path) {
  const res = await fetch(API + path, {headers: headers("GET", path)});
  const text = await res.text();
  if (!res.ok) throw Error(`${path} -> ${res.status} ${text.slice(0, 200)}`);
  return JSON.parse(text);
}
function peek(fullReport) {
  const [, data] = AbiCoder.defaultAbiCoder().decode(["bytes32[3]", "bytes"], fullReport);
  const v = parseInt(data.slice(2, 6), 16);
  if (v === 8) { const r = AbiCoder.defaultAbiCoder().decode(["bytes32","uint32","uint32","uint192","uint192","uint32","uint64","int192","uint32"], data); return {v, mid: r[7], observed: Number(r[2]), expires: Number(r[5]), status: Number(r[8])}; }
  if (v === 11) { const r = AbiCoder.defaultAbiCoder().decode(["bytes32","uint32","uint32","uint192","uint192","uint32","int192","uint64","int192","int192","int192","int192","int192","uint32"], data); return {v, mid: r[6], observed: Number(r[2]), expires: Number(r[5]), status: Number(r[13])}; }
  if (v === 3) { const r = AbiCoder.defaultAbiCoder().decode(["bytes32","uint32","uint32","uint192","uint192","uint32","int192","int192","int192"], data); return {v, mid: r[6], observed: Number(r[2]), expires: Number(r[5]), status: "n/a"}; }
  return {v};
}

console.log("API", API, "key", KEY_ID.slice(0, 8) + "…");
const feeds = (await get("/api/v1/feeds")).feeds ?? [];
console.log(`feeds available: ${feeds.length}`);
// Discovery returns ids only (no names). Optional args are feed-id prefixes to filter on;
// with no args every feed is listed with its latest decoded report, so RWA streams
// (schema v8/v11, with a market status) stand out from crypto ones (v3).
const now = Math.floor(Date.now() / 1000);
for (const f of feeds.filter((f) => !WANT.length || WANT.some((w) => f.feedID.toUpperCase().startsWith(w)))) {
  try {
    const {report} = await get(`/api/v1/reports/latest?feedID=${f.feedID}`);
    const p = peek(report.fullReport);
    const line = `${f.feedID}  v${p.v}  mid ${p.mid !== undefined ? formatUnits(p.mid, 18) : "?"}  status ${p.status}  observed ${now - p.observed}s ago  expires in ${p.expires - now}s`;
    console.log(line);
  } catch (e) { console.log(`${f.feedID}  ERROR ${e.message.slice(0, 120)}`); }
}
