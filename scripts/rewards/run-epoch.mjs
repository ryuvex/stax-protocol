// Weekly epoch runner (pm2 "stax-epoch"), approval mode ("option A", Dan 2026-10-09).
// Every tick (hourly) it:
//   0. recovers expired epochs: recoverExpired(e) for every published epoch past expiresAt with unclaimed USDG,
//      which releases that USDG back into unallocated() for the next epoch (publisher key)
//   1. if an epoch is waiting for approval: checks whether it has been published by hand (epochCount moved);
//      if so rolls the window forward and posts "published"; otherwise does nothing
//   2. otherwise, once the next window has closed (+grace):
//        vault.claimRewardsPool()  (only if pendingRewardsPool > 0; publisher key)
//        score-epoch.mjs           -> reports/rewards/epoch-N.json
//        posts epoch, window, every wallet + amount, total and root to Telegram (and Slack if set), then STOPS.
// Publishing is manual: on Dan's yes run
//        node scripts/rewards/publish-epoch.mjs --epoch N
//        node scripts/rewards/upload-epoch.mjs --epoch N --tx 0x...
// and the next tick notices epochCount() moved. Nothing to distribute -> the window just rolls forward.
// Idempotent: N is always epochCount()+1 on-chain, the window comes from reports/rewards/run-state.json. Safe to restart.
//   node scripts/rewards/run-epoch.mjs                   loop (pm2)
//   node scripts/rewards/run-epoch.mjs --once            one tick, then exit
//   node scripts/rewards/run-epoch.mjs --dry-run         one tick, score only (no claim / recover / post)
//   node scripts/rewards/run-epoch.mjs --telegram-setup  print the chat ids that have messaged the bot, then exit
// Env (besides what score-epoch needs): STAX_TELEGRAM_RELAY_URL + STAX_TELEGRAM_RELAY_SECRET (the approval post goes
// through stax-finance's /api/telegram-notify on Vercel, because this PC cannot reach api.telegram.org; the bot token and
// chat id live in Vercel env), STAX_SLACK_WEBHOOK (optional copy), STAX_EPOCH_ANCHOR (unix, start of the first automated window; default = end of
// the manual epoch 1), STAX_EPOCH_LENGTH_SEC (604800), STAX_EPOCH_GRACE_SEC (600), STAX_EPOCH_TICK_SEC (3600),
// STAX_EPOCH_FIRST_AUTO (2: never score epochs below this).
import {Contract, JsonRpcProvider, Wallet, formatUnits} from "ethers";
import {spawn} from "node:child_process";
import {readFile, writeFile, mkdir} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import "dotenv/config";

const ONCE = process.argv.includes("--once"), DRY = process.argv.includes("--dry-run");
const ANCHOR = Number(process.env.STAX_EPOCH_ANCHOR ?? 1791227700);
const LEN = Number(process.env.STAX_EPOCH_LENGTH_SEC ?? 7 * 86400);
const GRACE = Number(process.env.STAX_EPOCH_GRACE_SEC ?? 600);
const TICK = Number(process.env.STAX_EPOCH_TICK_SEC ?? 3600);
const FIRST_AUTO = Number(process.env.STAX_EPOCH_FIRST_AUTO ?? 2);
const VAULT = "0xAda84161033C0Cc54EF21CEeF913A8fEC4239b33";
const RELAY = process.env.STAX_TELEGRAM_RELAY_URL, RELAY_SECRET = process.env.STAX_TELEGRAM_RELAY_SECRET;
const TG = !!(RELAY && RELAY_SECRET);
const log = (...a) => console.log(new Date().toISOString(), ...a);

if (process.argv.includes("--telegram-setup")) { // who has talked to the bot? (Dan hits Start, we read the chat id via the relay)
  if (!TG) throw new Error("STAX_TELEGRAM_RELAY_URL / STAX_TELEGRAM_RELAY_SECRET not set");
  const r = await (await fetch(RELAY, {headers: {authorization: `Bearer ${RELAY_SECRET}`}})).json();
  if (!r.ok) throw new Error(`relay: ${JSON.stringify(r)}`);
  if (!r.chats.length) console.log("no messages yet: open the bot in Telegram and hit Start, then rerun");
  for (const c of r.chats) console.log(`chat id ${c.id}  ${c.type}  ${c.username ? "@" + c.username : ""} ${c.name ?? ""}`);
  process.exit(0);
}

const DIST = process.env.STAX_REWARDS_DISTRIBUTOR; if (!DIST) throw new Error("STAX_REWARDS_DISTRIBUTOR not set");
const p = new JsonRpcProvider(process.env.STAX_RPC_URL ?? "https://rpc.mainnet.chain.robinhood.com", 4663, {staticNetwork: true});
const dist = new Contract(DIST, [
  "function epochCount() view returns(uint256)", "function unallocated() view returns(uint256)",
  "function epochs(uint256) view returns(bytes32 merkleRoot,uint256 total,uint256 claimed,uint64 publishedAt,uint64 expiresAt,bool recovered)",
  "function recoverExpired(uint256)",
], p);
const vault = new Contract(VAULT, ["function pendingRewardsPool() view returns(uint256)", "function claimRewardsPool()"], p);
const root = new URL("../../", import.meta.url);
const STATE = new URL("reports/rewards/run-state.json", root);
const usdg = (x) => formatUnits(BigInt(x), 6);
const day = (t) => new Date(t * 1000).toISOString().slice(0, 10);

async function loadState() { try { return JSON.parse(await readFile(STATE, "utf8")); } catch { return {nextStart: ANCHOR}; } }
async function saveState(s) { await mkdir(new URL("reports/rewards/", root), {recursive: true}); await writeFile(STATE, JSON.stringify(s, null, 2)); }
async function notify(text) {
  if (DRY) { log("(dry run) would post:\n" + text); return; }
  if (TG) {
    try {
      const res = await fetch(RELAY, {method: "POST", headers: {"content-type": "application/json", authorization: `Bearer ${RELAY_SECRET}`}, body: JSON.stringify({text})});
      const r = await res.json().catch(() => ({}));
      if (!res.ok || !r.ok) log("telegram relay failed", res.status, JSON.stringify(r).slice(0, 200));
    } catch (e) { log("telegram relay failed", e.message); }
  } else log("telegram relay not configured (STAX_TELEGRAM_RELAY_URL / STAX_TELEGRAM_RELAY_SECRET)");
  if (process.env.STAX_SLACK_WEBHOOK) {
    try { await fetch(process.env.STAX_SLACK_WEBHOOK, {method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify({text})}); } catch (e) { log("slack failed", e.message); }
  }
}
function run(script, args) { // run a sibling script, stream its output
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [fileURLToPath(new URL(`scripts/rewards/${script}`, root)), ...args], {cwd: fileURLToPath(root), env: process.env});
    let out = "";
    child.stdout.on("data", (d) => { process.stdout.write(d); out += d; });
    child.stderr.on("data", (d) => process.stderr.write(d));
    child.on("close", (code) => code === 0 ? resolve(out) : reject(new Error(`${script} exited ${code}`)));
  });
}
let _signer;
async function signer() {
  if (!_signer) {
    const key = (process.env.STAX_REWARDS_PUBLISHER_PRIVATE_KEY ?? await readFile(process.env.STAX_REWARDS_PUBLISHER_KEY_FILE ?? fileURLToPath(new URL("../rewards-publisher-private-key.txt", root)), "utf8")).trim();
    _signer = new Wallet(key, p);
  }
  return _signer;
}

async function recoverExpired(count) { // step 0
  const now = Math.floor(Date.now() / 1000);
  for (let e = 1; e <= count; e++) {
    const ep = await dist.epochs(e);
    if (ep.recovered || ep.expiresAt === 0n || now <= Number(ep.expiresAt) || ep.total <= ep.claimed) continue;
    const remainder = ep.total - ep.claimed;
    if (DRY) { log(`dry run: epoch ${e} expired ${day(Number(ep.expiresAt))}, would recover ${usdg(remainder)} USDG`); continue; }
    const tx = await dist.connect(await signer()).recoverExpired(e); log(`recoverExpired(${e}) ${usdg(remainder)} USDG -> ${tx.hash}`); await tx.wait();
    await notify(`♻️ rewards epoch ${e} expired on ${day(Number(ep.expiresAt))}: ${usdg(remainder)} USDG unclaimed, released back into the pool for the next epoch. tx ${tx.hash}`);
  }
}

async function tick() {
  const state = await loadState();
  const count = Number(await dist.epochCount());
  await recoverExpired(count);

  if (state.pendingApproval) { // step 1: waiting for Dan's yes + the manual publish
    const pa = state.pendingApproval;
    if (count >= pa.epoch) {
      const ep = await dist.epochs(pa.epoch);
      const match = ep.merkleRoot.toLowerCase() === pa.root.toLowerCase();
      state.nextStart = pa.end; delete state.pendingApproval; state.lastPublished = {epoch: pa.epoch, root: ep.merkleRoot, at: new Date().toISOString()}; await saveState(state);
      log(`epoch ${pa.epoch} published on-chain (root ${ep.merkleRoot}${match ? "" : " -- DIFFERENT from the scored root " + pa.root}); window rolls forward`);
      await notify(`✅ rewards epoch ${pa.epoch} published: ${usdg(ep.total)} USDG, root ${ep.merkleRoot}${match ? "" : "\n⚠️ root differs from the scored file " + pa.root}. Next window starts ${day(pa.end)}.`);
    } else log(`epoch ${pa.epoch} scored (${usdg(pa.distributed)} USDG, ${pa.claims} claims), waiting for approval + manual publish`);
    return;
  }

  const n = count + 1; // step 2
  const start = Number(state.nextStart), end = start + LEN, now = Math.floor(Date.now() / 1000);
  if (n < FIRST_AUTO) { log(`next epoch is ${n} < STAX_EPOCH_FIRST_AUTO=${FIRST_AUTO}; waiting for the manual publish`); return; }
  if (now < end + GRACE) { log(`epoch ${n} window ${new Date(start * 1000).toISOString()} -> ${new Date(end * 1000).toISOString()} closes in ${((end + GRACE - now) / 3600).toFixed(1)} h`); return; }

  log(`epoch ${n}: window closed, scoring`);
  if (!DRY) {
    const pending = await vault.pendingRewardsPool();
    if (pending > 0n) { const tx = await vault.connect(await signer()).claimRewardsPool(); log(`claimRewardsPool ${usdg(pending)} USDG -> ${tx.hash}`); await tx.wait(); }
  }
  await run("score-epoch.mjs", ["--epoch", String(n), "--start", String(start), "--end", String(end)]);
  const file = JSON.parse(await readFile(new URL(`reports/rewards/epoch-${n}.json`, root), "utf8"));
  const window = `${day(start)} → ${day(end)}`;
  if (!file.leaves.length || BigInt(file.distributed) === 0n) {
    log(`epoch ${n}: nothing to distribute (${file.wallets.length} wallets, pool ${usdg(file.total)} USDG); window rolls forward`);
    if (!DRY) { state.nextStart = end; await saveState(state); }
    await notify(`ℹ️ rewards epoch ${n}: nothing to distribute for ${window} (pool ${usdg(file.total)} USDG). Next window starts there.`);
    return;
  }
  const lines = file.leaves.map((l) => `${l.account}  ${usdg(l.amount)} USDG`);
  const list = lines.slice(0, 50).join("\n") + (lines.length > 50 ? `\n… +${lines.length - 50} more (see reports/rewards/epoch-${n}.json)` : "");
  await notify(`🟡 rewards epoch ${n} scored, waiting for your yes\nwindow ${window}\n${file.leaves.length} wallets, total ${usdg(file.distributed)} USDG (pool ${usdg(file.total)})\nroot ${file.merkleRoot}\n\n${list}\n\nReply "yes ${n}" and Armaghan publishes + uploads.`);
  if (DRY) { log(`dry run: epoch ${n} scored, ${file.leaves.length} claims, ${usdg(file.distributed)} USDG; not recording approval state`); return; }
  state.pendingApproval = {epoch: n, start, end, root: file.merkleRoot, distributed: file.distributed, claims: file.leaves.length, scoredAt: new Date().toISOString()};
  await saveState(state);
  log(`epoch ${n} scored and posted; waiting for approval`);
}

log(`epoch runner: distributor ${DIST}, anchor ${new Date(ANCHOR * 1000).toISOString()}, length ${LEN / 86400} d, tick ${TICK} s, telegram relay ${TG ? "on" : "OFF"}${DRY ? " (dry run)" : ""}`);
let failures = 0;
do {
  try { await tick(); failures = 0; }
  catch (e) {
    failures++; log("tick failed:", e.message);
    if (failures === 1 || failures % 24 === 0) await notify(`🔴 rewards epoch runner failed (${failures}x): ${e.message.slice(0, 300)}`);
    if (ONCE || DRY) process.exit(1);
  }
  if (!ONCE && !DRY) await new Promise((r) => setTimeout(r, TICK * 1000));
} while (!ONCE && !DRY);
