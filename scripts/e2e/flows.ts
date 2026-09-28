// End-to-end flow tests: the exact contract calls the frontend makes, with the
// frontend's own quoting logic (share formula, slippage, deadline).
//
//   npm run e2e                 local mainnet fork (free, default). Funds a throwaway account with USDG.
//   STAX_E2E_LIVE=1 npm run e2e  real Robinhood Chain with a small wallet (Stax/e2e-private-key.txt or STAX_E2E_PRIVATE_KEY).
//   STAX_E2E_ONLY=T2,T3          run a subset (PowerShell: $env:STAX_E2E_ONLY="T6"; npm run e2e; Remove-Item Env:STAX_E2E_ONLY)
//   STAX_E2E_CLONE=0x...        community basket to test (default: Dan's "My Friday Night" 0xaD4C…)
//   STAX_E2E_OFFICIAL_ID=5      official V2 basket for T6 (default sSEMI)
//   STAX_E2E_USDG=3             mint size in USDG (default 3)
//
// Every case prints PASS/FAIL and the report (with tx hashes) is written to reports/e2e/<timestamp>.json.
// Add a case: write `async function Tn(ctx)` returning {ok, note, txs?} and add it to CASES.
import { network } from "hardhat";
import { ethers as ethersLib } from "ethers";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

// `hardhat run` swallows unknown flags, so options come from env: STAX_E2E_LIVE=1, STAX_E2E_ONLY=T2,T3
const LIVE = process.env.STAX_E2E_LIVE === "1";
const ONLY = (process.env.STAX_E2E_ONLY ?? "").split(",").map((x) => x.trim()).filter(Boolean);
const RPC = process.env.STAX_RPC_URL ?? "https://rpc.mainnet.chain.robinhood.com";
const CLONE = (process.env.STAX_E2E_CLONE ?? "0xaD4C4E4c217317488aBf06242aEE4930c44B1B0b") as string;
const OFFICIAL_ID = BigInt(process.env.STAX_E2E_OFFICIAL_ID ?? 5);
const MINT_USDG = Number(process.env.STAX_E2E_USDG ?? 3);
// Frontend constants (src/routes/mint.tsx): 1% slippage, 20-minute deadline, 0.25% protocol fee.
const FE_SLIPPAGE_BPS = 100n, FE_DEADLINE_SEC = 20 * 60, FEE_BPS = 25n;

const root = new URL("../../", import.meta.url);
const json = async (p: string) => JSON.parse(await readFile(new URL(p, root), "utf8"));
const abiOf = async (name: string) => { const a = await json(`abi/${name}.json`); return Array.isArray(a) ? a : a.abi; };
const deployment = await json("reports/mainnet-v2-deployment/deployment.json");
const userDeployment = await json("reports/userbasket-v2-deployment/deployment.json");
const addr = (n: string) => deployment.contracts.find((c: any) => c.name === n).address as string;
const VAULT = addr("StaxVaultV2"), REGISTRY = addr("UnifiedTwapRegistry"), FACTORY = userDeployment.factory.address as string;
const ABI = { vault: await abiOf("StaxVaultV2"), clone: await abiOf("StaxUserBasketV2"), factory: await abiOf("StaxUserBasketFactoryV2"), registry: await abiOf("UnifiedTwapRegistry") };
const ERC20 = ["function balanceOf(address) view returns(uint256)", "function approve(address,uint256) returns(bool)", "function allowance(address,address) view returns(uint256)", "function decimals() view returns(uint8)", "function symbol() view returns(string)", "function totalSupply() view returns(uint256)"];
// Custom errors from vault + registry + clone, so reverts decode to names (this is what the FE relies on).
const ERRORS = new ethersLib.Interface([...ABI.vault, ...ABI.registry, ...ABI.clone].filter((e: any) => e.type === "error"));

type Ctx = { ethers: typeof ethersLib; provider: any; signer: any; who: string; isFork: boolean; usdg: any; usdgDec: number };
type Result = { ok: boolean; note: string; txs?: string[]; skipped?: boolean };

function decodeError(e: any): string {
  const data = e?.data ?? e?.error?.data ?? e?.info?.error?.data ?? e?.receipt?.revertReason;
  if (typeof data === "string" && data.startsWith("0x") && data.length >= 10) {
    try { return ERRORS.parseError(data)?.name ?? data.slice(0, 10); } catch { return data.slice(0, 10); }
  }
  const m: string = e?.shortMessage ?? e?.message ?? String(e);
  const hit = m.match(/custom error '([A-Za-z0-9_]+)\(\)'/); if (hit) return hit[1];
  return m.slice(0, 100);
}
const fmt = (v: bigint, d: number) => ethersLib.formatUnits(v, d);
const deadline = async (ctx: Ctx) => BigInt((await ctx.provider.getBlock("latest")).timestamp + FE_DEADLINE_SEC);
// Frontend share quote (mint.tsx): shares = net * (supply+1)/(nav+1); genesis = net; then minus slippage.
function feMinSharesOut(usdgRaw: bigint, usdgDec: number, supply: bigint, nav: bigint): bigint {
  const net18 = (usdgRaw - (usdgRaw * FEE_BPS) / 10000n) * 10n ** BigInt(18 - usdgDec);
  const shares = supply === 0n ? net18 : (net18 * (supply + 1n)) / (nav + 1n);
  return (shares * (10000n - FE_SLIPPAGE_BPS)) / 10000n;
}
function feMinUsdgOut(shares: bigint, supply: bigint, nav: bigint, usdgDec: number): bigint {
  const value18 = supply === 0n ? 0n : (shares * nav) / supply;
  const afterFee = value18 - (value18 * FEE_BPS) / 10000n;
  const usdg = afterFee / 10n ** BigInt(18 - usdgDec);
  return (usdg * (10000n - FE_SLIPPAGE_BPS)) / 10000n;
}
async function send(ctx: Ctx, label: string, fn: () => Promise<any>): Promise<string> {
  const tx = await fn(); const r = await tx.wait();
  if (r.status !== 1) throw new Error(`${label}: tx ${r.hash} reverted on-chain`);
  console.log(`   ${label}: ${r.hash}`);
  return r.hash;
}

// ---------------------------------------------------------------- context
async function makeCtx(): Promise<Ctx> {
  if (LIVE) {
    const provider = new ethersLib.JsonRpcProvider(RPC, 4663, { staticNetwork: true });
    const key = (process.env.STAX_E2E_PRIVATE_KEY ?? await readFile(fileURLToPath(new URL("../e2e-private-key.txt", root)), "utf8")).trim();
    const signer = new ethersLib.Wallet(key, provider);
    const owner = await new ethersLib.Contract(VAULT, ABI.vault, provider).owner();
    if (signer.address.toLowerCase() === owner.toLowerCase()) throw new Error("Refusing the vault owner key for e2e. Use a small test wallet.");
    const usdg = new ethersLib.Contract(await new ethersLib.Contract(VAULT, ABI.vault, provider).usdg(), ERC20, signer);
    console.log(`LIVE mode, wallet ${signer.address}, USDG ${fmt(await usdg.balanceOf(signer.address), 6)}`);
    return { ethers: ethersLib, provider, signer, who: signer.address, isFork: false, usdg, usdgDec: Number(await usdg.decimals()) };
  }
  // Pin the fork a few blocks behind head (same as token-fork.ts) so every read/execution is on a settled block.
  const head = await new ethersLib.JsonRpcProvider(RPC, 4663, { staticNetwork: true }).getBlockNumber();
  const connection: any = await network.create({ network: "robinhoodMainnetFork", override: { forking: { url: RPC, blockNumber: head - 5 } } });
  const { ethers } = connection;
  // Mine one empty block so "latest" is a local block: EDR treats the fork block itself as remote/historical and
  // refuses to execute there for a chain it has no hardfork history for.
  await ethers.provider.send("evm_mine", []);
  const [signer] = await ethers.getSigners();
  const vault = await ethers.getContractAt(ABI.vault, VAULT);
  const usdg = await ethers.getContractAt(ERC20, await vault.usdg(), signer);
  // Fund the throwaway account with USDG by writing its balance slot (same trick as token-fork.ts).
  const target = 100_000n * 10n ** 6n; let funded = false;
  for (let slot = 0; slot < 64 && !funded; slot++) {
    const key = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["address", "uint256"], [signer.address, slot]));
    const old = await ethers.provider.getStorage(usdg.target, key);
    await ethers.provider.send("hardhat_setStorageAt", [usdg.target, key, ethers.toBeHex(target, 32)]);
    if ((await usdg.balanceOf(signer.address)) === target) funded = true; else await ethers.provider.send("hardhat_setStorageAt", [usdg.target, key, old]);
  }
  if (!funded) throw new Error("could not fund USDG on the fork");
  console.log(`FORK mode at block ${await ethers.provider.getBlockNumber()}, account ${signer.address}, USDG ${fmt(target, 6)} (fake)`);
  return { ethers, provider: ethers.provider, signer, who: signer.address, isFork: true, usdg, usdgDec: 6 };
}
const contract = (ctx: Ctx, address: string, abi: any) => new ctx.ethers.Contract(address, abi, ctx.signer);
async function approveUsdg(ctx: Ctx, spender: string, amount: bigint) {
  if ((await ctx.usdg.allowance(ctx.who, spender)) < amount) await send(ctx, "approve USDG", () => ctx.usdg.approve(spender, amount));
}

// ---------------------------------------------------------------- cases
// T1: every V2 official basket's tickers must price via the vault (what the basket page / cards / Paused pill use).
async function T1(ctx: Ctx): Promise<Result> {
  const vault = contract(ctx, VAULT, ABI.vault);
  const notes: string[] = []; let paused = 0;
  for (let id = 1n; id <= 20n; id++) {
    const b = await vault.baskets(id); if (!b.exists) continue; if (b.mintPaused) continue;
    const [tickers] = await vault.getBasketComposition(id);
    for (const t of tickers) {
      const sym = await new ctx.ethers.Contract(t, ERC20, ctx.provider).symbol().catch(() => t.slice(0, 8));
      try { const p = await vault.getOraclePriceUsd18(t); notes.push(`#${id} ${sym} $${Number(p) / 1e18}`); }
      catch (e) { paused++; notes.push(`#${id} ${sym} PAUSED ${decodeError(e)}`); }
    }
  }
  console.log("   " + notes.join(" | "));
  return { ok: true, note: paused ? `${paused} leg(s) paused (expected to show as Paused in the UI)` : "all legs priced" };
}

// T2: quote a clone mint exactly like the frontend, prove the contract accepts it, then mint.
let mintedShares = 0n;
async function T2(ctx: Ctx): Promise<Result> {
  const clone = contract(ctx, CLONE, ABI.clone);
  const token = new ctx.ethers.Contract(await clone.token(), ERC20, ctx.signer);
  const [nav, supply] = [await clone.getBasketNavUsd(), await token.totalSupply()];
  const usdgRaw = BigInt(Math.round(MINT_USDG * 10 ** ctx.usdgDec));
  const minShares = feMinSharesOut(usdgRaw, ctx.usdgDec, supply, nav);
  console.log(`   clone ${CLONE} nav ${fmt(nav, 18)} supply ${fmt(supply, 18)} -> share price $${supply === 0n ? 1 : Number(nav + 1n) / Number(supply + 1n)}; FE minSharesOut ${fmt(minShares, 18)}`);
  await approveUsdg(ctx, CLONE, usdgRaw);
  try { await clone.mint.staticCall(usdgRaw, minShares, await deadline(ctx)); }
  catch (e) { const name = decodeError(e); return { ok: false, note: `staticCall mint reverted: ${name}${name === "UserLimitNotMet" ? " (FE quote is wrong)" : ""}` }; }
  const before: bigint = await token.balanceOf(ctx.who);
  const hash = await send(ctx, "mint", () => clone.mint(usdgRaw, minShares, deadline(ctx).then((d) => d)));
  mintedShares = ((await token.balanceOf(ctx.who)) as bigint) - before;
  return { ok: mintedShares >= minShares, note: `received ${fmt(mintedShares, 18)} shares for ${MINT_USDG} USDG (min ${fmt(minShares, 18)})`, txs: [hash] };
}

// T3: redeem half of what T2 minted, quoted like the frontend.
async function T3(ctx: Ctx): Promise<Result> {
  if (mintedShares === 0n) return { ok: false, note: "nothing minted in T2", skipped: true };
  const clone = contract(ctx, CLONE, ABI.clone);
  const token = new ctx.ethers.Contract(await clone.token(), ERC20, ctx.signer);
  const half = mintedShares / 2n;
  const [nav, supply] = [await clone.getBasketNavUsd(), await token.totalSupply()];
  const minOut = feMinUsdgOut(half, supply, nav, ctx.usdgDec);
  try { await clone.redeem.staticCall(half, minOut, await deadline(ctx)); }
  catch (e) { return { ok: false, note: `staticCall redeem reverted: ${decodeError(e)}` }; }
  const before: bigint = await ctx.usdg.balanceOf(ctx.who);
  const hash = await send(ctx, "redeem", () => clone.redeem(half, minOut, deadline(ctx)));
  const got: bigint = ((await ctx.usdg.balanceOf(ctx.who)) as bigint) - before;
  mintedShares -= half;
  return { ok: got >= minOut, note: `redeemed ${fmt(half, 18)} shares -> ${fmt(got, ctx.usdgDec)} USDG (min ${fmt(minOut, ctx.usdgDec)})`, txs: [hash] };
}

// T4: redeem the rest in kind -- must work with no swap and deliver underlying tokens.
async function T4(ctx: Ctx): Promise<Result> {
  if (mintedShares === 0n) return { ok: false, note: "nothing left from T2/T3", skipped: true };
  const clone = contract(ctx, CLONE, ABI.clone);
  const [tickers] = await clone.getComposition();
  const before: bigint[] = await Promise.all(tickers.map((t: string) => new ctx.ethers.Contract(t, ERC20, ctx.provider).balanceOf(ctx.who)));
  const hash = await send(ctx, "redeemInKind", () => clone.redeemInKind(mintedShares, ctx.who));
  const after: bigint[] = await Promise.all(tickers.map((t: string) => new ctx.ethers.Contract(t, ERC20, ctx.provider).balanceOf(ctx.who)));
  const owed: bigint[] = await Promise.all(tickers.map((t: string) => clone.owedInKind(ctx.who, t)));
  const gained = tickers.map((t: string, i: number) => `${t.slice(0, 6)}… +${fmt(after[i] - before[i], 18)}${owed[i] > 0n ? ` (owed ${fmt(owed[i], 18)})` : ""}`);
  mintedShares = 0n;
  return { ok: after.some((a: bigint, i: number) => a > before[i]) || owed.some((o: bigint) => o > 0n), note: gained.join(", "), txs: [hash] };
}

// T5: the pre-flight path -- an impossible minimum must come back as a DECODED UserLimitNotMet.
async function T5(ctx: Ctx): Promise<Result> {
  const clone = contract(ctx, CLONE, ABI.clone);
  const usdgRaw = BigInt(Math.round(MINT_USDG * 10 ** ctx.usdgDec));
  await approveUsdg(ctx, CLONE, usdgRaw);
  try { await clone.mint.staticCall(usdgRaw, 10n ** 30n, await deadline(ctx)); return { ok: false, note: "did not revert" }; }
  catch (e) { const name = decodeError(e); return { ok: name === "UserLimitNotMet", note: `decoded as ${name}` }; }
}

// T6: official V2 basket -- previewMint vs the FE formula, then a real mint + full redeem.
async function T6(ctx: Ctx): Promise<Result> {
  const vault = contract(ctx, VAULT, ABI.vault);
  const b = await vault.baskets(OFFICIAL_ID); if (!b.exists) return { ok: false, note: `basket ${OFFICIAL_ID} missing` };
  const token = new ctx.ethers.Contract(b.token, ERC20, ctx.signer);
  const usdgRaw = BigInt(Math.round(MINT_USDG * 10 ** ctx.usdgDec));
  const [nav, supply] = [await vault.getBasketNavUsd(OFFICIAL_ID), await token.totalSupply()];
  const fe = feMinSharesOut(usdgRaw, ctx.usdgDec, supply, nav) * 10000n / (10000n - FE_SLIPPAGE_BPS); // undo slippage for comparison
  let preview = 0n; try { preview = await vault.previewMint(OFFICIAL_ID, usdgRaw); } catch (e) { return { ok: false, note: `previewMint reverted: ${decodeError(e)}` }; }
  const diffBps = preview === 0n ? 0 : Number(((fe > preview ? fe - preview : preview - fe) * 10000n) / preview);
  console.log(`   ${await token.symbol()} previewMint ${fmt(preview, 18)} vs FE formula ${fmt(fe, 18)} (${diffBps} bps apart)`);
  // Official-basket quote the FE uses: previewMint (oracle value) minus the weighted DEX pool fees of the legs,
  // then the official-basket slippage default (covers the oracle-vs-DEX spot gap, which moves both ways).
  const [tickers, weights] = await vault.getBasketComposition(OFFICIAL_ID);
  let feeBpsWeighted = 0n; const legNotes: string[] = [];
  for (let i = 0; i < tickers.length; i++) {
    const isV3 = await vault.tickerIsV3(tickers[i]);
    const feePpm: bigint = isV3 ? (await vault.tickerPoolsV3(tickers[i])).fee : (await vault.tickerPools(tickers[i])).fee; // 3000 = 0.30%
    feeBpsWeighted += (BigInt(feePpm) * BigInt(weights[i])) / 100n / 10000n; // ppm -> bps, weighted by bps weight
    legNotes.push(`${tickers[i].slice(0, 6)}… ${isV3 ? "v3" : "v4"} fee ${Number(feePpm) / 100} bps`);
  }
  const OFFICIAL_SLIPPAGE_BPS = 200n;
  const estimate = (preview * (10000n - feeBpsWeighted)) / 10000n;
  const minShares = (estimate * (10000n - OFFICIAL_SLIPPAGE_BPS)) / 10000n;
  console.log(`   legs: ${legNotes.join(", ")} -> weighted fee ${feeBpsWeighted} bps; FE estimate ${fmt(estimate, 18)}, min (−${OFFICIAL_SLIPPAGE_BPS} bps) ${fmt(minShares, 18)}`);
  await approveUsdg(ctx, VAULT, usdgRaw);
  try { await vault.mint.staticCall(OFFICIAL_ID, usdgRaw, minShares, await deadline(ctx)); }
  catch (e) {
    const name = decodeError(e);
    if (name !== "UserLimitNotMet" || !ctx.isFork) return { ok: false, note: `staticCall mint reverted: ${name}` };
    // Fork only: measure how far the REAL mint lands below previewMint (swap fees + price impact) so the FE quote can be fixed.
    const snap = await ctx.provider.send("evm_snapshot", []);
    const b0: bigint = await token.balanceOf(ctx.who);
    await (await vault.mint(OFFICIAL_ID, usdgRaw, 1n, await deadline(ctx))).wait();
    const actual: bigint = ((await token.balanceOf(ctx.who)) as bigint) - b0;
    await ctx.provider.send("evm_revert", [snap]);
    const shortBps = Number(((preview - actual) * 10000n) / preview);
    return { ok: false, note: `FE minSharesOut rejected: real mint gives ${fmt(actual, 18)} = ${shortBps} bps below previewMint (fees ${feeBpsWeighted} bps + oracle/spot gap). Budget was ${feeBpsWeighted + OFFICIAL_SLIPPAGE_BPS} bps.` };
  }
  const before: bigint = await token.balanceOf(ctx.who);
  const h1 = await send(ctx, "official mint", () => vault.mint(OFFICIAL_ID, usdgRaw, minShares, deadline(ctx)));
  const got: bigint = ((await token.balanceOf(ctx.who)) as bigint) - before;
  const minOut = (await vault.previewRedeem(OFFICIAL_ID, got)) * (10000n - FE_SLIPPAGE_BPS) / 10000n;
  const h2 = await send(ctx, "official redeem", () => vault.redeem(OFFICIAL_ID, got, minOut, deadline(ctx)));
  const realBps = Number(((preview - got) * 10000n) / preview);
  return { ok: got >= minShares, note: `real mint ${realBps} bps below previewMint (fees ${feeBpsWeighted} bps); minted ${fmt(got, 18)} and redeemed`, txs: [h1, h2] };
}

// T7 (fork only): make every TWAP pool stale by jumping 3h+, then the clone mint must revert StaleObservation -- the Paused banner case.
async function T7(ctx: Ctx): Promise<Result> {
  if (!ctx.isFork) return { ok: true, note: "fork only", skipped: true };
  const clone = contract(ctx, CLONE, ABI.clone);
  const usdgRaw = BigInt(Math.round(MINT_USDG * 10 ** ctx.usdgDec));
  await approveUsdg(ctx, CLONE, usdgRaw);
  const snap = await ctx.provider.send("evm_snapshot", []);
  await ctx.provider.send("evm_increaseTime", [3 * 3600 + 120]); await ctx.provider.send("evm_mine", []);
  let name = "";
  try { await clone.mint.staticCall(usdgRaw, 1n, await deadline(ctx)); name = "(no revert)"; } catch (e) { name = decodeError(e); }
  await ctx.provider.send("evm_revert", [snap]);
  const ok = name === "StaleObservation" || name === "StaleOraclePrice";
  return { ok, note: ok ? `after +3h the mint reverts ${name} -> FE shows the Paused banner` : `expected StaleObservation, got ${name} (basket may have no TWAP leg)` };
}

// ---------------------------------------------------------------- runner
const CASES: Array<[string, (c: Ctx) => Promise<Result>, string]> = [
  ["T1", T1, "V2 basket tickers price via vault"],
  ["T2", T2, "clone mint with FE quote"],
  ["T3", T3, "clone redeem half with FE quote"],
  ["T4", T4, "clone redeem in kind"],
  ["T5", T5, "pre-flight decodes UserLimitNotMet"],
  ["T6", T6, "official V2 previewMint vs FE, mint + redeem"],
  ["T7", T7, "stale pool -> StaleObservation (fork)"],
];
const ctx = await makeCtx();
const report: any = { mode: LIVE ? "live" : "fork", wallet: ctx.who, clone: CLONE, startedAt: new Date().toISOString(), cases: {} };
let failed = 0;
for (const [id, fn, title] of CASES) {
  if (ONLY.length && !ONLY.includes(id)) continue;
  console.log(`\n${id} ${title}`);
  let r: Result;
  try { r = await fn(ctx); } catch (e: any) { r = { ok: false, note: `threw: ${decodeError(e)}` }; }
  report.cases[id] = { title, ...r };
  if (!r.ok && !r.skipped) failed++;
  console.log(`   ${r.skipped ? "SKIP" : r.ok ? "PASS" : "FAIL"} — ${r.note}`);
}
await mkdir(new URL("reports/e2e/", root), { recursive: true });
const out = new URL(`reports/e2e/${report.mode}-${Date.now()}.json`, root);
await writeFile(out, JSON.stringify(report, null, 2));
console.log(`\n${failed ? `${failed} FAILED` : "ALL PASSED"} — report ${fileURLToPath(out)}`);
process.exit(failed ? 1 : 0);
