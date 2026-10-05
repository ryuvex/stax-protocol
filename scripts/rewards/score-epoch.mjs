// Scores one reward epoch from chain data and writes reports/rewards/epoch-<n>.json
// (leaves, proofs, merkle root, every input needed to reproduce it). Publishing the root on
// StaxRewardsDistributor is a separate owner step (publish-epoch.mjs).
//
// Usage (read-only, no key):
//   node scripts/rewards/score-epoch.mjs --epoch 1 --start <unix> --end <unix> [--total 123.45]
// Env:
//   STAX_RPC_URL                     default Robinhood mainnet
//   STAX_STAKING                     StaxStaking address (omit -> everyone gets multiplier 1)
//   STAX_REWARDS_DISTRIBUTOR         if set and --total omitted, total = distributor.unallocated()
//   STAX_REWARDS_V1_CLONES           comma list of V1 community basket (clone) addresses; the V1 factory cannot be enumerated
//   STAX_REWARDS_EXTRA_TOKENS        comma list of extra share tokens to count at $1/share (last resort)
//   STAX_REWARDS_EXCLUDE             comma list of addresses whose balances never count (treasury, deployer, ...)
//   STAX_REWARDS_INCLUDE_CONTRACTS   comma list of contract addresses that DO earn (smart wallets like Safe).
//                                    Every other address with code (DEX pools, vaults, routers) is excluded automatically.
//   STAX_REWARDS_PARAMS              JSON overriding scoring params, e.g. {"multiplierCap":3,"minHeldFraction":0.5}
//   STAX_REWARDS_NAV_SAMPLES         NAV samples across the epoch (default 7; needs archive reads, falls back to end-of-epoch NAV)
import {Contract, JsonRpcProvider, formatUnits, getAddress, id as topicId, zeroPadValue} from "ethers";
import {readFile, writeFile, mkdir} from "node:fs/promises";
import "dotenv/config";
import {timeWeightedAverage, computePayouts, DEFAULT_PARAMS, ONE} from "./scoring.mjs";
import {buildTree} from "./merkle.mjs";

const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => a.startsWith("--") ? [a.slice(2), arr[i + 1]] : []).filter((x) => x.length));
const need = (k) => { if (args[k] === undefined) throw new Error(`--${k} required`); return args[k]; };
const EPOCH = Number(need("epoch")), START = Number(need("start")), END = Number(need("end"));
if (!(END > START)) throw new Error("end must be after start");
const RPC = process.env.STAX_RPC_URL ?? "https://rpc.mainnet.chain.robinhood.com";
const p = new JsonRpcProvider(RPC, 4663, {staticNetwork: true});
const PARAMS = {...DEFAULT_PARAMS, ...JSON.parse(process.env.STAX_REWARDS_PARAMS ?? "{}")};
if (typeof PARAMS.stakeForMax === "string" || typeof PARAMS.stakeForMax === "number") PARAMS.stakeForMax = BigInt(PARAMS.stakeForMax) * ONE;
const NAV_SAMPLES = Math.max(1, Number(process.env.STAX_REWARDS_NAV_SAMPLES ?? 7));

const abi = async (f) => { const a = JSON.parse(await readFile(new URL(`../../abi/${f}.json`, import.meta.url), "utf8")); return Array.isArray(a) ? a : a.abi; };
const VAULT = "0xAda84161033C0Cc54EF21CEeF913A8fEC4239b33", FACTORY_V2 = "0x1de6a6bD0C62097A7559A29a76e41985558f9918";
const VAULT_V1 = "0x13045D3Dab253fDB15181C16f135D612fa8546E6"; // legacy vault: Commodities, Retail V1, Mag 7, Mag 7 cap
const vault = new Contract(VAULT, await abi("StaxVaultV2"), p);
const VAULT_MIN_ABI = ["function baskets(uint256) view returns(string name,address token,uint256 depositCapUsd,uint256 maxMintUsd,bool mintPaused,bool exists)", "function getBasketNavUsd(uint256) view returns(uint256)"];
const vaultV1 = new Contract(VAULT_V1, VAULT_MIN_ABI, p);
const CLONE_MIN_ABI = ["function token() view returns(address)", "function getBasketNavUsd() view returns(uint256)"];
const factory = new Contract(FACTORY_V2, await abi("StaxUserBasketFactoryV2"), p);
const cloneAbi = await abi("StaxUserBasketV2");
const ERC20 = ["function balanceOf(address) view returns(uint256)", "function totalSupply() view returns(uint256)", "function symbol() view returns(string)", "function decimals() view returns(uint8)", "event Transfer(address indexed from, address indexed to, uint256 value)"];
const TRANSFER = topicId("Transfer(address,address,uint256)");

// ---------------------------------------------------------------- blocks for timestamps
async function blockAt(ts) { // first block with timestamp >= ts (binary search)
  let lo = 0, hi = await p.getBlockNumber();
  const latest = await p.getBlock(hi); if (latest.timestamp < ts) return hi;
  while (lo < hi) { const mid = (lo + hi) >> 1; const b = await p.getBlock(mid); if (b.timestamp < ts) lo = mid + 1; else hi = mid; }
  return lo;
}
async function getLogsChunked(filter, from, to) {
  const out = []; const STEP = 9_999_999;
  for (let f = from; f <= to; f += STEP) out.push(...await p.getLogs({...filter, fromBlock: f, toBlock: Math.min(f + STEP - 1, to)}));
  return out;
}

// ---------------------------------------------------------------- baskets
console.log(`epoch ${EPOCH}: ${new Date(START * 1000).toISOString()} -> ${new Date(END * 1000).toISOString()}`);
const startBlock = await blockAt(START), endBlock = (await blockAt(END)) - 1;
console.log(`blocks ${startBlock}..${endBlock}`);
const baskets = []; // {kind, id|clone, token, symbol, nav: async(block)=>usd18 per share}
for (const [kind, v] of [["official", vault], ["official-v1", vaultV1]]) {
  for (let i = 1, misses = 0; misses < 5 && i < 200; i++) {
    const b = await v.baskets(i).catch(() => null); if (!b || !b.exists) { misses++; continue; } misses = 0;
    const token = new Contract(b.token, ERC20, p);
    baskets.push({kind, id: i, token: b.token, symbol: await token.symbol(), nav: async (bt) => { const [n, s] = await Promise.all([v.getBasketNavUsd(i, {blockTag: bt}), token.totalSupply({blockTag: bt})]); return s === 0n ? 0n : (n * ONE) / s; }});
  }
}
for (const addr of (process.env.STAX_REWARDS_V1_CLONES ?? "").split(",").map((s) => s.trim()).filter(Boolean)) {
  const c = new Contract(addr, CLONE_MIN_ABI, p); const t = await c.token(); const token = new Contract(t, ERC20, p);
  baskets.push({kind: "clone-v1", clone: addr, token: t, symbol: await token.symbol().catch(() => "?"), nav: async (bt) => { const [nv, s] = await Promise.all([c.getBasketNavUsd({blockTag: bt}), token.totalSupply({blockTag: bt})]); return s === 0n ? 0n : (nv * ONE) / s; }});
}
const n = Number(await factory.basketCount());
for (let i = 0; i < n; i++) {
  const addr = await factory.baskets(i); const c = new Contract(addr, cloneAbi, p); const t = await c.token(); const token = new Contract(t, ERC20, p);
  baskets.push({kind: "clone", clone: addr, token: t, symbol: await token.symbol().catch(() => "?"), nav: async (bt) => { const [nv, s] = await Promise.all([c.getBasketNavUsd({blockTag: bt}), token.totalSupply({blockTag: bt})]); return s === 0n ? 0n : (nv * ONE) / s; }});
}
for (const t of (process.env.STAX_REWARDS_EXTRA_TOKENS ?? "").split(",").map((s) => s.trim()).filter(Boolean)) {
  const token = new Contract(t, ERC20, p);
  baskets.push({kind: "extra", token: t, symbol: await token.symbol().catch(() => "?"), nav: async () => ONE}); // extra tokens valued at $1/share unless a nav source is added
}
const INCLUDE_CONTRACTS = new Set((process.env.STAX_REWARDS_INCLUDE_CONTRACTS ?? "").split(",").map((a) => a.trim().toLowerCase()).filter(Boolean));
const codeCache = new Map();
async function isContract(addr) { const k = addr.toLowerCase(); if (!codeCache.has(k)) codeCache.set(k, (await p.getCode(addr)) !== "0x"); return codeCache.get(k); }
const EXCLUDE = new Set([VAULT, VAULT_V1, FACTORY_V2, "0x0000000000000000000000000000000000000000", ...baskets.map((b) => b.clone).filter(Boolean), ...(process.env.STAX_REWARDS_EXCLUDE ?? "").split(",")].map((a) => a.trim().toLowerCase()).filter(Boolean));
console.log(`baskets: ${baskets.map((b) => b.symbol).join(", ")}`);

// ---------------------------------------------------------------- NAV per share (sampled), with archive fallback
const sampleBlocks = Array.from({length: NAV_SAMPLES}, (_, k) => startBlock + Math.floor(((endBlock - startBlock) * (k + 1)) / NAV_SAMPLES));
let archiveOk = true;
for (const b of baskets) {
  const navs = [];
  for (const bt of sampleBlocks) { try { navs.push(await b.nav(bt)); } catch { archiveOk = false; break; } }
  if (!archiveOk || navs.length !== sampleBlocks.length) { b.navAvg = await b.nav("latest"); b.navNote = "end-of-epoch (archive reads unavailable)"; }
  else { b.navAvg = navs.reduce((s, x) => s + x, 0n) / BigInt(navs.length); b.navNote = `${navs.length} samples`; }
}

// ---------------------------------------------------------------- per-wallet basket value timelines
const value = new Map(); // wallet -> {initial: usd18, changes: [{t, value}]}
for (const b of baskets) {
  const token = new Contract(b.token, ERC20, p);
  const all = await getLogsChunked({address: b.token, topics: [TRANSFER]}, 0, endBlock);
  const holders = new Set(); for (const l of all) { holders.add(getAddress("0x" + l.topics[1].slice(26))); holders.add(getAddress("0x" + l.topics[2].slice(26))); }
  const inEpoch = all.filter((l) => l.blockNumber >= startBlock);
  const blockTs = new Map();
  const tsOf = async (bn) => { if (!blockTs.has(bn)) blockTs.set(bn, (await p.getBlock(bn)).timestamp); return blockTs.get(bn); };
  for (const h of holders) {
    if (EXCLUDE.has(h.toLowerCase())) continue;
    if (!INCLUDE_CONTRACTS.has(h.toLowerCase()) && (await isContract(h))) { EXCLUDE.add(h.toLowerCase()); continue; } // pools, routers, other contracts
    let bal;
    try { bal = await token.balanceOf(h, {blockTag: startBlock - 1}); }
    catch { bal = null; }
    if (bal === null) { // no archive: reconstruct from logs before the epoch
      bal = 0n; for (const l of all) { if (l.blockNumber >= startBlock) break; const v = BigInt(l.data); if (("0x" + l.topics[2].slice(26)).toLowerCase() === h.toLowerCase()) bal += v; if (("0x" + l.topics[1].slice(26)).toLowerCase() === h.toLowerCase()) bal -= v; }
    }
    const changes = []; let running = bal;
    for (const l of inEpoch) {
      const v = BigInt(l.data); const to = ("0x" + l.topics[2].slice(26)).toLowerCase(), from = ("0x" + l.topics[1].slice(26)).toLowerCase();
      if (to !== h.toLowerCase() && from !== h.toLowerCase()) continue;
      if (to === h.toLowerCase()) running += v; if (from === h.toLowerCase()) running -= v;
      changes.push({t: await tsOf(l.blockNumber), value: (running * b.navAvg) / ONE});
    }
    if (bal === 0n && !changes.length) continue;
    const w = value.get(h) ?? {initial: 0n, changes: []};
    // merge: this basket's timeline adds onto the wallet's total; represent as separate series summed later
    w.series = w.series ?? []; w.series.push({initial: (bal * b.navAvg) / ONE, changes});
    value.set(h, w);
  }
}
// sum series per wallet into one step function
function sumSeries(series) {
  const times = [...new Set(series.flatMap((s) => s.changes.map((c) => c.t)))].sort((a, b) => a - b);
  const at = (s, t) => { let v = s.initial; for (const c of s.changes) { if (c.t <= t) v = c.value; else break; } return v; };
  return {initial: series.reduce((a, s) => a + s.initial, 0n), changes: times.map((t) => ({t, value: series.reduce((a, s) => a + at(s, t), 0n)}))};
}

// ---------------------------------------------------------------- staking timelines
const stake = new Map();
if (process.env.STAX_STAKING) {
  const STAKED = topicId("Staked(address,uint256,uint256,uint256)"), WITHDRAWN = topicId("Withdrawn(address,uint256,uint256,uint256)");
  // one topic value per query: the RPC caps multi-value topic filters at 100k blocks
  const logs = [...await getLogsChunked({address: process.env.STAX_STAKING, topics: [STAKED]}, 0, endBlock), ...await getLogsChunked({address: process.env.STAX_STAKING, topics: [WITHDRAWN]}, 0, endBlock)].sort((a, b) => a.blockNumber - b.blockNumber || a.index - b.index);
  for (const l of logs) {
    const user = getAddress("0x" + l.topics[1].slice(26));
    const [, newBalance, timestamp] = [0, BigInt("0x" + l.data.slice(66, 130)), Number(BigInt("0x" + l.data.slice(130, 194)))];
    const s = stake.get(user) ?? {initial: 0n, changes: []};
    if (timestamp < START) s.initial = newBalance; else s.changes.push({t: timestamp, value: newBalance});
    stake.set(user, s);
  }
}

// ---------------------------------------------------------------- score
const wallets = [];
for (const [account, w] of value) {
  const series = sumSeries(w.series);
  const tv = timeWeightedAverage(series.initial, series.changes, START, END);
  const st = stake.get(account); const sv = st ? timeWeightedAverage(st.initial, st.changes, START, END) : {average: 0n};
  wallets.push({account, tvlTw: tv.average, heldFraction: tv.heldFraction, stakeTw: sv.average});
}
let total;
if (args.total !== undefined) total = BigInt(Math.round(Number(args.total) * 1e6));
else if (process.env.STAX_REWARDS_DISTRIBUTOR) total = await new Contract(process.env.STAX_REWARDS_DISTRIBUTOR, ["function unallocated() view returns(uint256)"], p).unallocated();
else throw new Error("--total <usdg> or STAX_REWARDS_DISTRIBUTOR required");
const result = computePayouts(wallets, total, PARAMS);
const paid = result.payouts.filter((r) => r.amount > 0n).sort((a, b) => (b.amount > a.amount ? 1 : -1));
const leaves = paid.map((r, i) => ({index: i, account: r.account, amount: r.amount}));
const tree = leaves.length ? buildTree(leaves) : {root: null, proofs: []};

const out = {
  epoch: EPOCH, start: START, end: END, startBlock, endBlock, rpc: RPC, generatedAt: new Date().toISOString(),
  params: {...PARAMS, stakeForMax: PARAMS.stakeForMax.toString()}, staking: process.env.STAX_STAKING ?? null,
  excluded: [...EXCLUDE], includedContracts: [...INCLUDE_CONTRACTS],
  baskets: baskets.map((b) => ({kind: b.kind, id: b.id, clone: b.clone, token: b.token, symbol: b.symbol, navPerShareUsd: formatUnits(b.navAvg, 18), navNote: b.navNote})),
  total: total.toString(), distributed: result.distributed.toString(), dust: result.dust.toString(), merkleRoot: tree.root,
  wallets: result.payouts.map((r) => ({account: r.account, tvlTwUsd: formatUnits(r.tvlTw, 18), heldFraction: r.heldFraction, stakeTw: formatUnits(r.stakeTw, 18), multiplier: r.multiplier, eligible: r.eligible, amount: r.amount.toString()})),
  leaves: leaves.map((l, i) => ({...l, amount: l.amount.toString(), proof: tree.proofs[i]})),
};
await mkdir(new URL("../../reports/rewards/", import.meta.url), {recursive: true});
const file = new URL(`../../reports/rewards/epoch-${EPOCH}.json`, import.meta.url);
await writeFile(file, JSON.stringify(out, null, 2));
console.log(`\nwallets with basket value: ${wallets.length}, eligible: ${result.payouts.filter((r) => r.eligible).length}, paid: ${paid.length}`);
for (const r of paid.slice(0, 15)) console.log(`  ${r.account}  tvl $${Number(formatUnits(r.tvlTw, 18)).toFixed(2)}  held ${(r.heldFraction * 100).toFixed(0)}%  stake ${formatUnits(r.stakeTw, 18)}  x${r.multiplier.toFixed(3)}  -> ${formatUnits(r.amount, 6)} USDG`);
console.log(`total ${formatUnits(total, 6)} USDG, distributed ${formatUnits(result.distributed, 6)}, dust ${formatUnits(result.dust, 6)}`);
console.log(`merkle root ${tree.root}\nwritten ${file.pathname}`);
