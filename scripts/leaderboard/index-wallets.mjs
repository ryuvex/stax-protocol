// Leaderboard / profile indexer (pm2 "stax-indexer"). Dev Brief v2 (2026-10-12): display data only, money is never
// computed here. Each tick (hourly):
//   1. scans new Minted/Redeemed events (both vaults + every community clone) -> volume, average-cost basis, net flows,
//      mint count, first mint, and one lb_activity row per event; distributor Claimed events -> lb_activity "claim" rows
//   2. scans share-token Transfers -> balances, opened_at, holding spans (tenure, all-time and inside the open epoch)
//   3. reads staking balances, current NAV per share -> value, return %; also writes one nav_snapshots row per official
//      basket with supply (hourly price history for the site's charts -- the 6-hourly GitHub cron stays as backup)
//   4. runs score-epoch on the OPEN reward window (--out reports/leaderboard/live.json) -> reward_score, the same number
//      the distributor will pay on when the window closes
//   5. at every epoch boundary (Mon 19:15 UTC anchor, same as the runner) closes an lb_weekly row per wallet -> hot streak
//   6. recomputes ranks and upserts lb_wallets / lb_positions / lb_weekly / lb_state in Supabase (service role)
// First run backfills from the V1 vault's deploy block; after that it continues from lb_state.cursor. Safe to restart.
//   node scripts/leaderboard/index-wallets.mjs            loop (pm2)
//   node scripts/leaderboard/index-wallets.mjs --once     one tick, then exit
//   node scripts/leaderboard/index-wallets.mjs --dry-run  one tick, compute everything, write nothing to Supabase
//   node scripts/leaderboard/index-wallets.mjs --reindex  ignore the stored cursor and wallet rows: replay from the deploy
//                                                         blocks into fresh state and overwrite (after schema additions)
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, STAX_STAKING, STAX_REWARDS_DISTRIBUTOR, STAX_RPC_URL (optional),
//      STAX_REWARDS_V1_CLONES / STAX_REWARDS_INCLUDE_CONTRACTS / STAX_REWARDS_EXCLUDE (same meaning as the scorer),
//      STAX_EPOCH_ANCHOR (default 1791227700 = start of epoch 2), STAX_EPOCH_LENGTH_SEC (604800), STAX_INDEXER_TICK_SEC (3600).
import {Contract, JsonRpcProvider, getAddress, formatUnits, id as topicId} from "ethers";
import {spawn} from "node:child_process";
import {readFile, writeFile, mkdir} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import "dotenv/config";

const ONCE = process.argv.includes("--once"), DRY = process.argv.includes("--dry-run"), REINDEX = process.argv.includes("--reindex");
const RPC = process.env.STAX_RPC_URL ?? "https://rpc.mainnet.chain.robinhood.com";
const p = new JsonRpcProvider(RPC, 4663, {staticNetwork: true});
const SB_URL = (process.env.SUPABASE_URL ?? "").replace(/\/$/, ""), SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!DRY && (!SB_URL || !SB_KEY)) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set");
const DIST = process.env.STAX_REWARDS_DISTRIBUTOR; if (!DIST) throw new Error("STAX_REWARDS_DISTRIBUTOR not set");
const STAKING = process.env.STAX_STAKING; if (!STAKING) throw new Error("STAX_STAKING not set");
const ANCHOR = Number(process.env.STAX_EPOCH_ANCHOR ?? 1791227700), LEN = Number(process.env.STAX_EPOCH_LENGTH_SEC ?? 7 * 86400);
const TICK = Number(process.env.STAX_INDEXER_TICK_SEC ?? 3600);
const CONFIRMATIONS = 5;
const root = new URL("../../", import.meta.url);
const log = (...a) => console.log(new Date().toISOString(), ...a);
const ONE = 10n ** 18n;

// ---------------------------------------------------------------- contracts and basket ids
const VAULTS = [
  {kind: "v1", address: "0x13045D3Dab253fDB15181C16f135D612fa8546E6", fromBlock: 46338037, ids: {1: "commodities", 2: "retailfavorites", 3: "mag7", 4: "mag7cap"}},
  {kind: "v2", address: "0xAda84161033C0Cc54EF21CEeF913A8fEC4239b33", fromBlock: 68883165, ids: {3: "retailfavoritesv2", 4: "indexblend", 5: "semiconductors", 6: "healthcare", 7: "aiinfrastructure"}},
];
const FACTORY_V2 = {address: "0x1de6a6bD0C62097A7559A29a76e41985558f9918", fromBlock: 70863402};
const VAULT_ABI = ["function baskets(uint256) view returns(string name,address token,uint256 depositCapUsd,uint256 maxMintUsd,bool mintPaused,bool exists)", "function getBasketNavUsd(uint256) view returns(uint256)",
  "event Minted(uint256 indexed basketId,address indexed user,uint256 usdgIn,uint256 valueReceivedUsd,uint256 tokensOut)",
  "event Redeemed(uint256 indexed basketId,address indexed user,uint256 tokensIn,uint256 usdgOut,uint256 valueReturnedUsd)"];
const CLONE_ABI = ["function token() view returns(address)", "function getBasketNavUsd() view returns(uint256)",
  "event Minted(address indexed user,uint256 usdgIn,uint256 tokensOut,uint256 valueReceivedUsd)",
  "event Redeemed(address indexed user,uint256 tokensIn,uint256 usdgOut,uint256 valueReturnedUsd)",
  "event RedeemedInKind(address indexed user,address indexed receiver,uint256 tokensIn,address[] tickers,uint256[] amounts)"];
const ERC20 = ["function totalSupply() view returns(uint256)", "function symbol() view returns(string)"];
const FACTORY_ABI = ["function basketCount() view returns(uint256)", "function baskets(uint256) view returns(address)"];
const STAKING_ABI = ["function balanceOf(address) view returns(uint256)"];
const DIST_ABI = ["function epochCount() view returns(uint256)", "function unallocated() view returns(uint256)",
  "event Claimed(uint256 indexed epoch,uint256 index,address account,uint256 amount)"];
const TRANSFER = topicId("Transfer(address,address,uint256)");
const EXCLUDE = new Set(["0x0000000000000000000000000000000000000000", FACTORY_V2.address, STAKING, DIST, ...VAULTS.map((v) => v.address), ...(process.env.STAX_REWARDS_EXCLUDE ?? "").split(",")].map((a) => a.trim().toLowerCase()).filter(Boolean));
const INCLUDE_CONTRACTS = new Set((process.env.STAX_REWARDS_INCLUDE_CONTRACTS ?? "").split(",").map((a) => a.trim().toLowerCase()).filter(Boolean));
const codeCache = new Map();
async function isWallet(addr) { // EOAs and allow-listed smart wallets count; pools, routers, vaults, clones do not
  const k = addr.toLowerCase(); if (EXCLUDE.has(k)) return false; if (INCLUDE_CONTRACTS.has(k)) return true;
  if (!codeCache.has(k)) codeCache.set(k, (await p.getCode(addr)) === "0x"); return codeCache.get(k);
}
const addr = (topic) => getAddress("0x" + topic.slice(26)).toLowerCase();

// ---------------------------------------------------------------- rpc helpers
async function getLogsChunked(filter, from, to) {
  const out = []; let step = 9_999_999;
  for (let f = from; f <= to;) {
    const t = Math.min(f + step - 1, to);
    try { out.push(...await p.getLogs({...filter, fromBlock: f, toBlock: t})); f = t + 1; }
    catch (e) { if (step > 100_000) { step = 100_000; continue; } throw e; }
  }
  return out.sort((a, b) => a.blockNumber - b.blockNumber || a.index - b.index);
}
const blockTs = new Map();
async function tsOf(bn) { if (!blockTs.has(bn)) blockTs.set(bn, (await p.getBlock(bn)).timestamp); return blockTs.get(bn); }
async function sb(method, path, body) {
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, {method, headers: {apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json", Prefer: method === "POST" ? "resolution=merge-duplicates,return=minimal" : "return=minimal"}, body: body ? JSON.stringify(body) : undefined});
  if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
  return method === "GET" ? res.json() : null;
}
async function sbAll(table, select = "*") { // paged select
  const rows = []; for (let from = 0; ; from += 1000) {
    const res = await fetch(`${SB_URL}/rest/v1/${table}?select=${select}`, {headers: {apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, Range: `${from}-${from + 999}`}});
    if (!res.ok) throw new Error(`${table}: ${res.status} ${await res.text()}`);
    const page = await res.json(); rows.push(...page); if (page.length < 1000) return rows;
  }
}
async function upsert(table, rows, onConflict) { for (let i = 0; i < rows.length; i += 500) await sb("POST", `${table}?on_conflict=${onConflict}`, rows.slice(i, i + 500)); }

// ---------------------------------------------------------------- baskets: official (both vaults) + community clones
async function discoverBaskets() {
  const baskets = []; // {basketId, symbol, token, kind, vault?, onchainId?, clone?, fromBlock, nav: async()=>usd18 per share}
  for (const v of VAULTS) {
    const vault = new Contract(v.address, VAULT_ABI, p);
    for (let i = 1, misses = 0; misses < 5 && i < 200; i++) {
      const b = await vault.baskets(i).catch(() => null); if (!b || !b.exists) { misses++; continue; } misses = 0;
      const token = new Contract(b.token, ERC20, p);
      baskets.push({basketId: v.ids[i] ?? `${v.kind}-${i}`, symbol: await token.symbol(), token: b.token.toLowerCase(), kind: `official-${v.kind}`, vault: v.address, onchainId: i, fromBlock: v.fromBlock,
        nav: async () => { const [n, s] = await Promise.all([vault.getBasketNavUsd(i), token.totalSupply()]); return s === 0n ? 0n : (n * ONE) / s; },
        // price-history row, same numbers the snapshot-nav cron records: nav_usd per share, tvl_usd; null when no supply
        snap: async () => { const [n, s] = await Promise.all([vault.getBasketNavUsd(i), token.totalSupply()]); if (s === 0n) return null; const tvl = Number(formatUnits(n, 18)); return {basket_id: v.ids[i] ?? `${v.kind}-${i}`, nav_usd: tvl / Number(formatUnits(s, 18)), tvl_usd: tvl}; }});
    }
  }
  const factory = new Contract(FACTORY_V2.address, FACTORY_ABI, p);
  const n = Number(await factory.basketCount());
  const cloneAddrs = []; for (let i = 0; i < n; i++) cloneAddrs.push(await factory.baskets(i));
  for (const a of (process.env.STAX_REWARDS_V1_CLONES ?? "").split(",").map((s) => s.trim()).filter(Boolean)) cloneAddrs.push(a);
  for (const a of cloneAddrs) {
    const c = new Contract(a, CLONE_ABI, p); const t = (await c.token()).toLowerCase(); const token = new Contract(t, ERC20, p);
    EXCLUDE.add(a.toLowerCase());
    baskets.push({basketId: `clone-${a.toLowerCase()}`, symbol: await token.symbol().catch(() => "?"), token: t, kind: "clone", clone: a, fromBlock: FACTORY_V2.fromBlock,
      nav: async () => { const [nv, s] = await Promise.all([c.getBasketNavUsd(), token.totalSupply()]); return s === 0n ? 0n : (nv * ONE) / s; }});
  }
  return baskets;
}

// ---------------------------------------------------------------- state (loaded from Supabase, mutated in memory, written back)
const num = (x) => Number(x ?? 0);
function emptyWallet(w) { return {wallet: w, first_seen_at: null, holding_since: null, held_seconds: 0, tenure_days: 0, volume_usd: 0, value_usd: 0, cost_basis_usd: 0, return_pct: null, week_flow_usd: 0, week_start_value: 0, hot_streak_weeks: 0, staked_stax: "0", reward_score: 0, reward_eligible: false, rank_reward: null, rank_gains: null, rank_streak: null,
  first_mint_at: null, mint_count: 0, week_volume_usd: 0, week_held_seconds: 0, week_tenure_days: 0, rank_volume: null, rank_tenure: null, rank_week_volume: null, rank_week_tenure: null}; }
async function loadState() {
  if (DRY || REINDEX) return {cursor: null, wallets: new Map(), positions: new Map(), weekly: []}; // dry run / reindex: full backfill into fresh state
  const [stateRows, wallets, positions] = await Promise.all([sbAll("lb_state"), sbAll("lb_wallets"), sbAll("lb_positions")]);
  const cursor = stateRows.find((r) => r.key === "cursor")?.value ?? null;
  return {cursor, wallets: new Map(wallets.map((w) => [w.wallet, w])), positions: new Map(positions.map((r) => [`${r.wallet}|${r.basket_id}`, r])), weekly: []};
}

// ---------------------------------------------------------------- the tick
async function tick() {
  const latest = (await p.getBlockNumber()) - CONFIRMATIONS;
  const state = await loadState();
  const baskets = await discoverBaskets();
  const byToken = new Map(baskets.map((b) => [b.token, b]));
  const W = state.wallets, P = state.positions;
  const wallet = (w) => { if (!W.has(w)) W.set(w, emptyWallet(w)); return W.get(w); };
  const pos = (w, b) => { const k = `${w}|${b.basketId}`; if (!P.has(k)) P.set(k, {wallet: w, basket_id: b.basketId, symbol: b.symbol, token: b.token, balance: "0", avg_cost_per_share: 0, value_usd: 0, opened_at: null}); return P.get(k); };
  const touched = new Set();
  const epochStartNow = ANCHOR + Math.floor((Math.floor(Date.now() / 1000) - ANCHOR) / LEN) * LEN;
  const from = state.cursor ? Number(state.cursor.block) + 1 : Math.min(...baskets.map((b) => b.fromBlock));
  log(`tick: blocks ${from}..${latest} (${latest - from + 1}), ${baskets.length} baskets, ${W.size} wallets known`);
  if (from > latest) { log("nothing new"); }
  else {
    // ---- 1+2. one chronological stream of Minted / Redeemed / Transfer events (block, log index order), so that
    //          average cost, balances and holding spans evolve exactly as they did on-chain.
    const events = []; // {bn, idx, type, ...}
    const activity = []; // lb_activity rows
    for (const v of VAULTS) {
      const vault = new Contract(v.address, VAULT_ABI, p);
      for (const name of ["Minted", "Redeemed"]) for (const l of await getLogsChunked({address: v.address, topics: [vault.interface.getEvent(name).topicHash]}, Math.max(from, v.fromBlock), latest)) {
        const e = vault.interface.parseLog(l); const b = baskets.find((x) => x.vault === v.address && x.onchainId === Number(e.args.basketId)); if (!b) continue;
        events.push({bn: l.blockNumber, idx: l.index, tx: l.transactionHash, type: name, w: e.args.user.toLowerCase(), b, usd: Number(formatUnits(name === "Minted" ? e.args.usdgIn : e.args.usdgOut, 6)), shares: name === "Minted" ? e.args.tokensOut : e.args.tokensIn});
      }
    }
    for (const b of baskets.filter((x) => x.kind === "clone")) {
      const c = new Contract(b.clone, CLONE_ABI, p);
      for (const name of ["Minted", "Redeemed", "RedeemedInKind"]) for (const l of await getLogsChunked({address: b.clone, topics: [c.interface.getEvent(name).topicHash]}, Math.max(from, b.fromBlock), latest)) {
        const e = c.interface.parseLog(l);
        events.push({bn: l.blockNumber, idx: l.index, tx: l.transactionHash, type: name === "RedeemedInKind" ? "Redeemed" : name, inKind: name === "RedeemedInKind", w: e.args.user.toLowerCase(), b,
          usd: name === "Minted" ? Number(formatUnits(e.args.usdgIn, 6)) : name === "Redeemed" ? Number(formatUnits(e.args.usdgOut, 6)) : 0, shares: name === "Minted" ? e.args.tokensOut : e.args.tokensIn});
      }
    }
    for (const b of baskets) for (const l of await getLogsChunked({address: b.token, topics: [TRANSFER]}, Math.max(from, b.fromBlock), latest)) {
      const v = BigInt(l.data); if (v === 0n) continue;
      events.push({bn: l.blockNumber, idx: l.index, type: "Transfer", b, fromA: addr(l.topics[1]), toA: addr(l.topics[2]), v});
    }
    { // rewards claims -> activity rows only (money stays with reward_claims + isClaimed)
      const d = new Contract(DIST, DIST_ABI, p);
      for (const l of await getLogsChunked({address: DIST, topics: [d.interface.getEvent("Claimed").topicHash]}, from, latest)) {
        const e = d.interface.parseLog(l);
        activity.push({tx_hash: l.transactionHash, log_index: l.index, wallet: e.args.account.toLowerCase(), block: l.blockNumber, ts: new Date((await tsOf(l.blockNumber)) * 1000).toISOString(), action: "claim", basket_id: null, symbol: null, amount_usd: +Number(formatUnits(e.args.amount, 6)).toFixed(2), shares: null, epoch: Number(e.args.epoch)});
      }
    }
    events.sort((a, b) => a.bn - b.bn || a.idx - b.idx);
    const navNowForInKind = new Map(); for (const b of baskets) navNowForInKind.set(b.basketId, await b.nav().catch(() => 0n));
    const holds = (w) => [...P.values()].some((x) => x.wallet === w && BigInt(x.balance) > 0n);
    log(`replaying ${events.length} events`);
    for (const e of events) {
      const ts = await tsOf(e.bn);
      if (e.type === "Transfer") { // balances, opened_at, holding spans; avg cost carries over on wallet-to-wallet transfers
        const fromOk = await isWallet(e.fromA), toOk = await isWallet(e.toA);
        const fromPos = fromOk ? pos(e.fromA, e.b) : null, toPos = toOk ? pos(e.toA, e.b) : null;
        if (toPos) {
          const before = BigInt(toPos.balance);
          if (fromPos && before + e.v > 0n) { const tot = Number(formatUnits(before + e.v, 18)); toPos.avg_cost_per_share = (num(toPos.avg_cost_per_share) * Number(formatUnits(before, 18)) + num(fromPos.avg_cost_per_share) * Number(formatUnits(e.v, 18))) / tot; }
          toPos.balance = (before + e.v).toString(); if (before === 0n) toPos.opened_at = new Date(ts * 1000).toISOString();
          const w = wallet(e.toA); touched.add(e.toA);
          if (!w.first_seen_at || new Date(w.first_seen_at).getTime() / 1000 > ts) w.first_seen_at = new Date(ts * 1000).toISOString();
          if (!w.holding_since) w.holding_since = new Date(ts * 1000).toISOString();
        }
        if (fromPos) {
          const after = BigInt(fromPos.balance) - e.v; fromPos.balance = (after < 0n ? 0n : after).toString(); if (after <= 0n) { fromPos.avg_cost_per_share = 0; fromPos.opened_at = null; }
          const w = wallet(e.fromA); touched.add(e.fromA);
          if (!holds(e.fromA) && w.holding_since) {
            const since = new Date(w.holding_since).getTime() / 1000;
            w.held_seconds = num(w.held_seconds) + Math.max(0, ts - since);
            w.week_held_seconds = num(w.week_held_seconds) + Math.max(0, ts - Math.max(since, epochStartNow)); // the part of the span inside the open epoch
            w.holding_since = null;
          }
        }
        continue;
      }
      if (!(await isWallet(e.w))) continue;
      const w = wallet(e.w), ps = pos(e.w, e.b); touched.add(e.w);
      if (e.type === "Minted") { // the share Transfer (0x0 -> user) in the same tx has already been applied: new units are inside ps.balance
        const bal = BigInt(ps.balance); const oldBal = bal > e.shares ? bal - e.shares : 0n;
        const oldCost = num(ps.avg_cost_per_share) * Number(formatUnits(oldBal, 18)); const tot = Number(formatUnits(bal, 18));
        ps.avg_cost_per_share = tot > 0 ? (oldCost + e.usd) / tot : 0;
        w.volume_usd = num(w.volume_usd) + e.usd; if (ts >= epochStartNow) { w.week_flow_usd = num(w.week_flow_usd) + e.usd; w.week_volume_usd = num(w.week_volume_usd) + e.usd; }
        if (!w.first_seen_at || new Date(w.first_seen_at).getTime() / 1000 > ts) w.first_seen_at = new Date(ts * 1000).toISOString();
        if (!w.first_mint_at || new Date(w.first_mint_at).getTime() / 1000 > ts) w.first_mint_at = new Date(ts * 1000).toISOString();
        w.mint_count = num(w.mint_count) + 1;
        activity.push({tx_hash: e.tx, log_index: e.idx, wallet: e.w, block: e.bn, ts: new Date(ts * 1000).toISOString(), action: "mint", basket_id: e.b.basketId, symbol: e.b.symbol, amount_usd: +e.usd.toFixed(2), shares: e.shares.toString(), epoch: null});
      } else { // Redeemed: average cost per remaining share is unchanged; volume + outflow
        const usd = e.inKind ? Number(formatUnits((e.shares * (navNowForInKind.get(e.b.basketId) ?? 0n)) / ONE, 18)) : e.usd;
        w.volume_usd = num(w.volume_usd) + usd; if (ts >= epochStartNow) { w.week_flow_usd = num(w.week_flow_usd) - usd; w.week_volume_usd = num(w.week_volume_usd) + usd; }
        activity.push({tx_hash: e.tx, log_index: e.idx, wallet: e.w, block: e.bn, ts: new Date(ts * 1000).toISOString(), action: "redeem", basket_id: e.b.basketId, symbol: e.b.symbol, amount_usd: +usd.toFixed(2), shares: e.shares.toString(), epoch: null});
      }
    }
    state.activity = activity;
  }
  // ---- 3. value, return, tenure, staking (all wallets; cheap)
  const navNow = new Map(); for (const b of baskets) navNow.set(b.basketId, await b.nav().catch(() => 0n));
  const staking = new Contract(STAKING, STAKING_ABI, p);
  const now = Math.floor(Date.now() / 1000);
  for (const w of W.values()) {
    let value = 0, cost = 0;
    for (const ps of P.values()) { if (ps.wallet !== w.wallet) continue; const bal = BigInt(ps.balance); const units = Number(formatUnits(bal, 18));
      ps.value_usd = +(Number(formatUnits((bal * (navNow.get(ps.basket_id) ?? 0n)) / ONE, 18))).toFixed(2); value += ps.value_usd; cost += units * num(ps.avg_cost_per_share); }
    w.value_usd = +value.toFixed(2); w.cost_basis_usd = +cost.toFixed(2); w.return_pct = cost > 0 ? +(((value - cost) / cost) * 100).toFixed(4) : null;
    w.tenure_days = +((num(w.held_seconds) + (w.holding_since ? now - new Date(w.holding_since).getTime() / 1000 : 0)) / 86400).toFixed(2);
    w.week_tenure_days = +((num(w.week_held_seconds) + (w.holding_since ? now - Math.max(new Date(w.holding_since).getTime() / 1000, epochStartNow) : 0)) / 86400).toFixed(2);
    w.staked_stax = (await staking.balanceOf(w.wallet).catch(() => 0n)).toString();
    w.volume_usd = +num(w.volume_usd).toFixed(2); w.week_flow_usd = +num(w.week_flow_usd).toFixed(2);
  }
  // ---- 3b. hourly nav_snapshots rows for the site's price charts (official baskets with supply; clones have no chart)
  const snapRows = (await Promise.all(baskets.filter((b) => b.snap && !b.basketId.startsWith("v1-") && !b.basketId.startsWith("v2-")).map((b) => b.snap().catch(() => null)))).filter(Boolean);
  state.snapRows = snapRows;
  // ---- 4. live reward score for the open window (the number the distributor pays on when it closes)
  const dist = new Contract(DIST, DIST_ABI, p);
  const winStart = ANCHOR + Math.floor((now - ANCHOR) / LEN) * LEN, winEnd = winStart + LEN;
  const epochN = (winStart - ANCHOR) / LEN + 2; // epoch 2 starts at the anchor; derived from time so it is right even before the runner publishes
  const live = fileURLToPath(new URL("reports/leaderboard/live.json", root));
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [fileURLToPath(new URL("scripts/rewards/score-epoch.mjs", root)), "--epoch", String(epochN), "--start", String(winStart), "--end", String(now - 60), "--out", live], {cwd: fileURLToPath(root), env: process.env, stdio: ["ignore", "ignore", "inherit"]});
    child.on("close", (c) => c === 0 ? resolve() : reject(new Error(`score-epoch exited ${c}`)));
  });
  const scored = JSON.parse(await readFile(live, "utf8"));
  for (const w of W.values()) { w.reward_score = 0; w.reward_eligible = false; }
  for (const s of scored.wallets) { const w = wallet(s.account.toLowerCase()); w.reward_score = +(Number(s.tvlTwUsd) * Number(s.multiplier)).toFixed(6); w.reward_eligible = !!s.eligible; }
  // ---- 5. epoch boundary -> close the week for every wallet (streak)
  const lastClosed = state.cursor?.lastClosedEpochStart ?? null;
  const weeklyRows = [];
  if (lastClosed === null || winStart > lastClosed) {
    const closedEpoch = epochN - 1; // the window that just ended
    for (const w of W.values()) {
      const start = num(w.week_start_value), end = num(w.value_usd), flow = num(w.week_flow_usd);
      const denom = start + Math.max(flow, 0); const ret = denom > 0 ? +(((end - start - flow) / denom) * 100).toFixed(4) : null;
      if (lastClosed !== null && (start > 0 || end > 0 || flow !== 0 || num(w.week_volume_usd) > 0)) weeklyRows.push({wallet: w.wallet, epoch: closedEpoch, start_value_usd: start, end_value_usd: end, flow_usd: flow, week_return_pct: ret, reward_score: num(w.reward_score), volume_usd: num(w.week_volume_usd), tenure_days: num(w.week_tenure_days)});
      if (lastClosed !== null) w.hot_streak_weeks = ret !== null && ret > 0 ? num(w.hot_streak_weeks) + 1 : 0;
      w.week_start_value = end; w.week_flow_usd = 0; w.week_volume_usd = 0; w.week_held_seconds = 0; w.week_tenure_days = w.holding_since ? +((now - Math.max(new Date(w.holding_since).getTime() / 1000, winStart)) / 86400).toFixed(2) : 0;
    }
    if (lastClosed === null) log(`first run: week baseline set at ${new Date(winStart * 1000).toISOString()} (streaks start counting from the next boundary)`);
    else log(`epoch boundary ${new Date(winStart * 1000).toISOString()}: closed week ${closedEpoch} for ${weeklyRows.length} wallets`);
  }
  // ---- 6. ranks
  const active = [...W.values()];
  const RANK_COL = {reward_score: "rank_reward", return_pct: "rank_gains", hot_streak_weeks: "rank_streak", volume_usd: "rank_volume", tenure_days: "rank_tenure", week_volume_usd: "rank_week_volume", week_tenure_days: "rank_week_tenure"};
  const rank = (key, pick) => { const col = RANK_COL[key]; const sorted = active.filter(pick).sort((a, b) => num(b[key]) - num(a[key])); for (const w of active) w[col] = null; sorted.forEach((w, i) => { w[col] = i + 1; }); };
  rank("reward_score", (w) => num(w.reward_score) > 0);
  rank("return_pct", (w) => w.return_pct !== null && num(w.value_usd) >= 1);
  rank("hot_streak_weeks", (w) => num(w.hot_streak_weeks) > 0);
  rank("volume_usd", (w) => num(w.volume_usd) > 0);
  rank("tenure_days", (w) => num(w.tenure_days) > 0);
  rank("week_volume_usd", (w) => num(w.week_volume_usd) > 0);
  rank("week_tenure_days", (w) => num(w.week_tenure_days) > 0);
  const updated_at = new Date().toISOString();
  const walletRows = active.map((w) => ({...w, updated_at}));
  const posRows = [...P.values()].map((r) => ({...r, updated_at}));
  const summary = {block: latest, at: updated_at, wallets: walletRows.length, positions: posRows.length, epoch: epochN, windowStart: winStart, windowEnd: winEnd, lastClosedEpochStart: winStart, unallocatedUsdg: formatUnits(await dist.unallocated(), 6)};
  if (DRY) {
    const top = [...active].sort((a, b) => num(b.reward_score) - num(a.reward_score)).slice(0, 10);
    log("dry run, top 10 by reward score:"); for (const w of top) console.log(`  ${w.wallet}  score ${w.reward_score}  value $${w.value_usd}  vol $${w.volume_usd}  tenure ${w.tenure_days}d  ret ${w.return_pct}%  staked ${formatUnits(BigInt(w.staked_stax), 18)}`);
    log(`dry run: ${(state.activity ?? []).length} activity rows, ${(state.snapRows ?? []).length} nav snapshots`); log("summary", JSON.stringify(summary)); return;
  }
  await upsert("lb_wallets", walletRows, "wallet");
  if (state.activity?.length) await upsert("lb_activity", state.activity, "tx_hash,log_index");
  if (state.snapRows?.length) { try { await sb("POST", "nav_snapshots", state.snapRows); } catch (e) { log("nav_snapshots insert failed:", e.message); } }
  await upsert("lb_positions", posRows, "wallet,basket_id");
  if (weeklyRows.length) await upsert("lb_weekly", weeklyRows, "wallet,epoch");
  await upsert("lb_state", [{key: "cursor", value: summary, updated_at}], "key");
  log(`written: ${walletRows.length} wallets, ${posRows.length} positions, ${(state.activity ?? []).length} activity rows, ${(state.snapRows ?? []).length} nav snapshots, ${weeklyRows.length} weekly rows, cursor ${latest}`);
}

log(`indexer: rpc ${RPC}, anchor ${new Date(ANCHOR * 1000).toISOString()}, tick ${TICK}s${DRY ? " (dry run)" : ""}`);
let failures = 0;
do {
  try { await tick(); failures = 0; }
  catch (e) { failures++; log("tick failed:", e.message); if (ONCE || DRY) process.exit(1); }
  if (!ONCE && !DRY) await new Promise((r) => setTimeout(r, TICK * 1000));
} while (!ONCE && !DRY);
