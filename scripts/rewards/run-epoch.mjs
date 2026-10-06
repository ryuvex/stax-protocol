// Weekly epoch runner (pm2 "stax-epoch"). Every tick it checks whether the next epoch window has closed and, if so:
//   1. vault.claimRewardsPool()  (only if pendingRewardsPool > 0; any wallet may call it -- the publisher key does)
//   2. score-epoch.mjs           -> reports/rewards/epoch-N.json
//   3. publish-epoch.mjs         -> root on-chain (skipped when there is nothing to distribute)
//   4. upload-epoch.mjs          -> reward_epochs + reward_claims in Supabase
// Idempotent: N is always epochCount()+1 on-chain, the window comes from reports/rewards/run-state.json (nextStart),
// and a publish that succeeded but failed to upload is retried before anything else. Safe to restart at any time.
//   node scripts/rewards/run-epoch.mjs            loop (pm2)
//   node scripts/rewards/run-epoch.mjs --once     one tick, then exit
//   node scripts/rewards/run-epoch.mjs --dry-run  one tick, score only (no claim / publish / upload)
// Env (besides what the three scripts need): STAX_EPOCH_ANCHOR (unix, start of the first automated window; default = end
// of the manual epoch 1), STAX_EPOCH_LENGTH_SEC (default 604800), STAX_EPOCH_GRACE_SEC (default 600, wait after the window
// closes), STAX_EPOCH_TICK_SEC (default 3600), STAX_EPOCH_FIRST_AUTO (default 2: never auto-publish epochs below this),
// STAX_SLACK_WEBHOOK (optional, one line per publish / failure).
import {Contract, JsonRpcProvider, Wallet} from "ethers";
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
const DIST = process.env.STAX_REWARDS_DISTRIBUTOR; if (!DIST) throw new Error("STAX_REWARDS_DISTRIBUTOR not set");
const p = new JsonRpcProvider(process.env.STAX_RPC_URL ?? "https://rpc.mainnet.chain.robinhood.com", 4663, {staticNetwork: true});
const dist = new Contract(DIST, ["function epochCount() view returns(uint256)", "function unallocated() view returns(uint256)"], p);
const vault = new Contract(VAULT, ["function pendingRewardsPool() view returns(uint256)", "function claimRewardsPool()"], p);
const root = new URL("../../", import.meta.url);
const STATE = new URL("reports/rewards/run-state.json", root);
const log = (...a) => console.log(new Date().toISOString(), ...a);

async function loadState() { try { return JSON.parse(await readFile(STATE, "utf8")); } catch { return {nextStart: ANCHOR}; } }
async function saveState(s) { await mkdir(new URL("reports/rewards/", root), {recursive: true}); await writeFile(STATE, JSON.stringify(s, null, 2)); }
async function slack(text) {
  if (!process.env.STAX_SLACK_WEBHOOK) return;
  try { await fetch(process.env.STAX_SLACK_WEBHOOK, {method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify({text})}); } catch (e) { log("slack failed", e.message); }
}
function run(script, args) { // run a sibling script, stream its output, resolve with captured stdout
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [fileURLToPath(new URL(`scripts/rewards/${script}`, root)), ...args], {cwd: fileURLToPath(root), env: process.env});
    let out = "";
    child.stdout.on("data", (d) => { process.stdout.write(d); out += d; });
    child.stderr.on("data", (d) => process.stderr.write(d));
    child.on("close", (code) => code === 0 ? resolve(out) : reject(new Error(`${script} exited ${code}`)));
  });
}
async function publisherKey() {
  return (process.env.STAX_REWARDS_PUBLISHER_PRIVATE_KEY ?? await readFile(process.env.STAX_REWARDS_PUBLISHER_KEY_FILE ?? fileURLToPath(new URL("../rewards-publisher-private-key.txt", root)), "utf8")).trim();
}

async function tick() {
  const state = await loadState();
  if (state.pendingUpload) { // publish went through earlier but the upload did not: finish that first
    const {epoch, tx} = state.pendingUpload;
    log(`retrying upload for epoch ${epoch} (${tx})`);
    await run("upload-epoch.mjs", ["--epoch", String(epoch), "--tx", tx]);
    delete state.pendingUpload; await saveState(state);
    await slack(`✅ rewards epoch ${epoch}: claims uploaded (retry)`);
  }
  const n = Number(await dist.epochCount()) + 1;
  const start = Number(state.nextStart), end = start + LEN, now = Math.floor(Date.now() / 1000);
  if (n < FIRST_AUTO) { log(`next epoch is ${n} < STAX_EPOCH_FIRST_AUTO=${FIRST_AUTO}; waiting for the manual publish`); return; }
  if (now < end + GRACE) { log(`epoch ${n} window ${new Date(start * 1000).toISOString()} -> ${new Date(end * 1000).toISOString()} closes in ${((end + GRACE - now) / 3600).toFixed(1)} h`); return; }

  log(`epoch ${n}: window closed, running`);
  if (!DRY) {
    const pending = await vault.pendingRewardsPool();
    if (pending > 0n) {
      const signer = new Wallet(await publisherKey(), p);
      const tx = await vault.connect(signer).claimRewardsPool(); log(`claimRewardsPool ${pending} -> ${tx.hash}`); await tx.wait();
    }
  }
  const scored = await run("score-epoch.mjs", ["--epoch", String(n), "--start", String(start), "--end", String(end)]);
  const file = JSON.parse(await readFile(new URL(`reports/rewards/epoch-${n}.json`, root), "utf8"));
  if (DRY) { log(`dry run: epoch ${n} scored, ${file.leaves.length} claims, ${file.distributed} USDG base units; not publishing`); return; }
  if (!file.leaves.length || BigInt(file.distributed) === 0n) {
    log(`epoch ${n}: nothing to distribute (${file.wallets.length} wallets, pool ${file.total}); window rolls forward`);
    state.nextStart = end; await saveState(state);
    await slack(`ℹ️ rewards epoch ${n}: nothing to distribute for ${new Date(start * 1000).toISOString().slice(0, 10)} → ${new Date(end * 1000).toISOString().slice(0, 10)} (pool ${(Number(file.total) / 1e6).toFixed(6)} USDG). Next window starts there.`);
    return;
  }
  const published = await run("publish-epoch.mjs", ["--epoch", String(n)]);
  const tx = published.match(/sent (0x[0-9a-fA-F]{64})/)?.[1];
  if (!tx || !/published/.test(published)) throw new Error(`publish-epoch did not confirm (output: ${published.slice(-300)})`);
  state.nextStart = end; state.pendingUpload = {epoch: n, tx}; await saveState(state); // from here on, never re-score this window
  await run("upload-epoch.mjs", ["--epoch", String(n), "--tx", tx]);
  delete state.pendingUpload; state.lastPublished = {epoch: n, tx, at: new Date().toISOString()}; await saveState(state);
  const paid = file.leaves.length, usdg = (Number(file.distributed) / 1e6).toFixed(6);
  log(`epoch ${n} done: ${paid} claims, ${usdg} USDG, tx ${tx}`);
  await slack(`✅ rewards epoch ${n} published: ${paid} wallets, ${usdg} USDG, window ${new Date(start * 1000).toISOString().slice(0, 10)} → ${new Date(end * 1000).toISOString().slice(0, 10)}. tx ${tx}`);
}

log(`epoch runner: distributor ${DIST}, anchor ${new Date(ANCHOR * 1000).toISOString()}, length ${LEN / 86400} d, tick ${TICK} s${DRY ? " (dry run)" : ""}`);
let failures = 0;
do {
  try { await tick(); failures = 0; }
  catch (e) {
    failures++; log("tick failed:", e.message);
    if (failures === 1 || failures % 24 === 0) await slack(`🔴 rewards epoch runner failed (${failures}x): ${e.message.slice(0, 300)}`);
    if (ONCE || DRY) process.exit(1);
  }
  if (!ONCE && !DRY) await new Promise((r) => setTimeout(r, TICK * 1000));
} while (!ONCE && !DRY);
