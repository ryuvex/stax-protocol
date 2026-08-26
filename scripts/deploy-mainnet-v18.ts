import { network } from "hardhat";

/*//////////////////////////////////////////////////////////////////////////
                    STAX MAINNET DEPLOY SCRIPT (v18)

  DEPLOY-CRITICAL CHECKLIST -- confirm every one of these before running
  this against real mainnet, not just before running it against a
  simulation:

  [ ] USDG address correct: 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168
  [ ] USDG/USD feed correct: 0x61B7e5650328764B076A108EFF5fa7282a1B9aD2
  [x] USDG_USD_MAX_STALENESS -- RESOLVED. Empirically measured from 60
      days of the feed's real on-chain round history (not inferred, not
      Chainlink's published figure -- actually stronger than that, since
      it's the feed's real observed behavior). Set to 27h, comfortably
      above the measured 24.01h maximum. See constant's comment below.
  [ ] sequencerUptimeFeed = address(0) explicitly -- confirmed correct
      below, NEVER the testnet mock address
      (0x0952621d4a4eEF3Aa659edBd98669dF2689DBEaA)
  [ ] rewardsPool address correct: 0xc02F399cBbF90CEc6DD3a7c2D90fcA84C0a3a5ad
      -- confirmed real, checksummed, deployer holds the keys (per Dan,
      tonight)
  [ ] treasury address correct: 0xFF843Bc76C276086569D081E02DAC467C2aDa5cE
      -- same confirmation as above
  [ ] Every TICKER_FEEDS address below is filled in with the REAL,
      confirmed Chainlink feed for that ticker -- currently PLACEHOLDER
      VALUES, see TODO markers. Do not deploy with any placeholder still
      in place.
  [ ] Deployer wallet holds enough real USDG to seed all baskets (see
      SEED_AMOUNT_PER_BASKET below) plus ETH for gas.

  BASKET LINEUP (v18.3, this session's final, verified list):
  16 tickers survive out of the original 21 -- ASML, CLSK, RGTI, RKLB,
  IONQ all confirmed dead via direct on-chain verification (see the
  USDG migration progress doc for the full audit trail). Quantum
  Computing and New Space baskets are DROPPED from this launch as a
  result. Filed under the post-mainnet ticker-expansion roadmap item.

  v18.3 UPDATE (real fork-tested cost data, this session): a real
  struct-encoding bug (missing minHopPriceX36 field) was found and
  fixed, then verified via a genuine fork-based end-to-end mint/redeem
  against real mainnet infrastructure. That same fork harness then
  swept all 16 tickers for real, measured execution cost -- not just
  pass/fail. Findings:
    - TSM and MSTR: real pools carry 40% and 5% fees respectively,
      breaching the 2% slippage tolerance outright -- mint reverts,
      genuinely unusable. REMOVED from all baskets.
    - SNDK: 147bps real cost, confirmed NOT a routing artifact (its
      USDG pool is already the primary, most active venue for this
      ticker) -- a genuine small-cap liquidity constraint. REMOVED.
    - AI Infrastructure (NVDA/AMD, post-TSM): 2.40% round-trip blended
      cost -- both legs expensive, no clean leg to dilute against.
      HELD for post-launch, pending NVDA/AMD routing improvements.
    - Broad Semiconductors: SNDK's removal leaves INTC/MU, which blend
      to a clean 0.51% round-trip -- basket SURVIVES, reweighted 50/50.
    - Mag 7: 0.83% round-trip (precise, not the earlier ~0.37% rough
      estimate) -- ships, but with cost disclosure surfaced in the
      mint UI per Opus's explicit recommendation (see mint.tsx).
    - Crypto Proxy Equities: MSTR removed, COIN/CRCL reweighted 50/50,
      genuinely 0bps clean.

  FINAL LAUNCH LINEUP: Mag 7, Crypto Proxy Equities, Broad
  Semiconductors (3 baskets). AI Infrastructure held for later --
  basket ID 1 deliberately left unused/reserved for it, not reassigned,
  so it can be added back later as a pure config addition without ID
  collisions.
//////////////////////////////////////////////////////////////////////////*/

// ============================================================
// CONFIRMED REAL MAINNET ADDRESSES
// ============================================================
const USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
const USDG_USD_FEED = "0x61B7e5650328764B076A108EFF5fa7282a1B9aD2";
const UNIVERSAL_ROUTER = "0x8876789976dEcBfCbBbe364623C63652db8C0904";
const PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3";
const REWARDS_POOL = "0xc02F399cBbF90CEc6DD3a7c2D90fcA84C0a3a5ad";
const TREASURY = "0xFF843Bc76C276086569D081E02DAC467C2aDa5cE";

// CONFIRMED, not inferred: measured directly from the feed's own
// on-chain round history (60 rounds walked back via getRoundData,
// spanning a full 60 days). Every single observed gap fell between
// 86,401-86,429 seconds -- a tight, deterministic 24.00-24.01h
// heartbeat, not deviation-threshold-triggered irregular updates.
// Maximum observed gap: 86,429s. This is real measured behavior across
// 60 independent updates, not a single-sample inference -- resolves
// the exact "floor vs. ceiling" concern flagged in review: one 19.2h
// observation could only establish a floor, this establishes the
// actual ceiling directly.
// Set to 27h (97,200s): the measured max (86,429s) plus a clean ~3h
// buffer -- comfortably above the tightest real observation, not the
// bare minimum, and a clean round number rather than an oddly-precise
// one that could look like an error.
const USDG_USD_MAX_STALENESS = 27 * 60 * 60; // 27 hours, EMPIRICALLY MEASURED from 60 days of real feed history

// TODO CONFIRM PER-TICKER BEFORE DEPLOY: real Chainlink heartbeats for
// each of the 16 stock feeds individually. Opus review caught a real
// bug: the original draft of this script blanket-applied
// v18.2 CORRECTED (real mainnet finding, post-first-deploy): the
// original 1h value below was carried over from testnet without ever
// being empirically verified against real equity feed behavior -- and
// it was badly wrong. Equity feeds have a fundamentally different,
// bimodal update cadence than a stablecoin: frequent during market
// hours, then a long deterministic silence overnight and across
// weekends/holidays, since the underlying genuinely isn't trading.
// Empirically measured (same method as the USDG heartbeat): 11 of 16
// tickers gave reliable multi-week data (6.7-24.4 day windows),
// clustering tightly at 51-58h for NORMAL weekends. But NONE of those
// windows contained a US market holiday (confirmed directly against
// the calendar) -- so that data establishes the normal-weekend floor,
// not the holiday-extended-weekend ceiling. The real worst case is a
// 3-day holiday weekend (Friday close to Tuesday open, ~89.5h
// theoretical), which the measured data cannot rule out. Set to cover
// that worst case with real buffer, not the normal-week measurement --
// same floor-vs-ceiling discipline as the USDG single-sample concern,
// applied here after almost repeating the same mistake at a larger
// scale. Trade-off, stated explicitly: a genuinely broken mid-week
// feed could go undetected for up to ~4 days under this bound -- an
// unavoidable cost without a market-hours oracle, bounded by the low
// deposit caps already in place. Applied uniformly across all 16
// tickers, including 5 (COIN, MSTR, CRCL, MU, SNDK) whose observation
// windows were too short to independently confirm -- justified on the
// merits (identical exchange hours/holiday calendar governs all 16,
// not ticker-specific behavior), not merely as a "fix it later"
// assumption.
const STOCK_FEED_MAX_STALENESS = 96 * 60 * 60; // 96 hours, empirically-grounded holiday-weekend bound

// Deliberately address(0) -- Robinhood Chain has no published Chainlink
// L2 Sequencer Uptime Feed yet. NEVER use the testnet mock here.
const SEQUENCER_UPTIME_FEED = "0x0000000000000000000000000000000000000000";

// ============================================================
// TICKER TOKEN + PRICE FEED ADDRESSES
// All 16 tickers remain REGISTERED (feed + pool) even though only 12
// of them are used in an active basket right now -- TSM, MSTR, and
// SNDK stay registered but basket-less, same harmless precedent as
// SPCX. Costs nothing, avoids a redundant registration call if any of
// them becomes usable again later (routing fix, liquidity growth).
// ============================================================
interface TickerConfig {
  token: string;
  feed: string; // TODO -- fill in real address
}

const TICKERS: Record<string, TickerConfig> = {
  NVDA: { token: "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC", feed: "0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15" },
  AMD: { token: "0x86923f96303D656E4aa86D9d42D1e57ad2023fdC", feed: "0x943A29E7ae51A4798823ca9eEd2ed533B2A22C72" },
  TSM: { token: "0x58FfE4a942d3885bAa22D7520691F611EF09e7AA", feed: "0x874cF94aa8eC88Fd9560094dD065f2fB3E41Fc2F" },
  AAPL: { token: "0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9", feed: "0x6B22A786bAa607d76728168703a39Ea9C99f2cD0" },
  MSFT: { token: "0xe93237C50D904957Cf27E7B1133b510C669c2e74", feed: "0x45C3C877C15E6BA2EBB19eA114Ea508d14C1Af2E" },
  GOOGL: { token: "0x2e0847E8910a9732eB3fb1bb4b70a580ADAD4FE3", feed: "0xF6f373a037c30F0e5010d854385cA89185AE638b" },
  AMZN: { token: "0x12f190a9F9d7D37a250758b26824B97CE941bF54", feed: "0xD5a1508ceD74c084eBf3cBe853e2C968fB2a651C" },
  META: { token: "0xc0D6457C16Cc70d6790Dd43521C899C87ce02f35", feed: "0x7C38C00C30BEe9378381E7B6135d7283356D71b1" },
  TSLA: { token: "0x322F0929c4625eD5bAd873c95208D54E1c003b2d", feed: "0x4A1166a659A55625345e9515b32adECea5547C38" },
  COIN: { token: "0x6330D8C3178a418788dF01a47479c0ce7CCF450b", feed: "0xA3a468A452940B7D6b69991207B508c609a98Ef2" },
  MSTR: { token: "0xec262a75e413fAfD0dF80480274532C79D42da09", feed: "0x396118bdFB181e6240E74D243F266B061c0edc3D" },
  CRCL: { token: "0xdF0992E440dD0be65BD8439b609d6D4366bf1CB5", feed: "0x6652eDf64bA3731C4F2D3ce821A0Fb1f1f6b482a" },
  // v18.1 deliberate decision (Opus review flagged this needed to be
  // conscious, not a leftover): SPCX is registered here even though no
  // launch basket uses it (New Space was dropped -- see design notes).
  // This is intentional, not an oversight: registering it costs
  // nothing, is harmless with no basket pointing at it, and saves a
  // redundant setPriceFeed/setTickerPool call later if a Space basket
  // gets revived post-mainnet with SPCX included.
  SPCX: { token: "0x4a0E65A3EcceC6dBe60AE065F2e7bb85Fae35eEa", feed: "0xB265810950ba6c5C0Ff821c9963014a56fD8Bffb" },
  INTC: { token: "0xc72b96e0E48ecd4DC75E1e45396e26300BC39681", feed: "0x3f390C5C24628Ac7C489515402235FeAD71D1913" },
  MU: { token: "0xfF080c8ce2E5feadaCa0Da81314Ae59D232d4afD", feed: "0x425EEFdCf05ed6526C3cE61Af99429A228a6d596" },
  SNDK: { token: "0xB90A19fF0Af67f7779afF50A882A9CfF42446400", feed: "0xfb133Fa4B7b385802B693a293606682Df47109A3" },
};

// ============================================================
// REAL, VERIFIED USDG-PAIRED POOL CONFIG (confirmed on-chain, decoy-
// signature excluded, fee-sanity checked)
// ============================================================
interface PoolConfig {
  currency0: string;
  currency1: string;
  fee: number;
  tickSpacing: number;
  hooks: string;
}

const ZERO_ADDR = "0x0000000000000000000000000000000000000000";

const TICKER_POOLS: Record<string, PoolConfig> = {
  NVDA: { currency0: USDG, currency1: TICKERS.NVDA.token, fee: 3000, tickSpacing: 60, hooks: ZERO_ADDR },
  AMD: { currency0: USDG, currency1: TICKERS.AMD.token, fee: 10000, tickSpacing: 200, hooks: ZERO_ADDR },
  TSM: { currency0: TICKERS.TSM.token, currency1: USDG, fee: 400000, tickSpacing: 8000, hooks: ZERO_ADDR },
  AAPL: { currency0: USDG, currency1: TICKERS.AAPL.token, fee: 3000, tickSpacing: 60, hooks: ZERO_ADDR },
  MSFT: { currency0: USDG, currency1: TICKERS.MSFT.token, fee: 3000, tickSpacing: 60, hooks: ZERO_ADDR },
  GOOGL: { currency0: TICKERS.GOOGL.token, currency1: USDG, fee: 3000, tickSpacing: 60, hooks: ZERO_ADDR },
  AMZN: { currency0: TICKERS.AMZN.token, currency1: USDG, fee: 3000, tickSpacing: 60, hooks: ZERO_ADDR },
  META: { currency0: USDG, currency1: TICKERS.META.token, fee: 3000, tickSpacing: 60, hooks: ZERO_ADDR },
  TSLA: { currency0: TICKERS.TSLA.token, currency1: USDG, fee: 3000, tickSpacing: 60, hooks: ZERO_ADDR },
  COIN: { currency0: USDG, currency1: TICKERS.COIN.token, fee: 10000, tickSpacing: 200, hooks: ZERO_ADDR },
  MSTR: { currency0: USDG, currency1: TICKERS.MSTR.token, fee: 50000, tickSpacing: 1100, hooks: ZERO_ADDR },
  CRCL: { currency0: USDG, currency1: TICKERS.CRCL.token, fee: 3000, tickSpacing: 30, hooks: ZERO_ADDR },
  SPCX: { currency0: TICKERS.SPCX.token, currency1: USDG, fee: 10000, tickSpacing: 200, hooks: ZERO_ADDR },
  INTC: { currency0: USDG, currency1: TICKERS.INTC.token, fee: 10000, tickSpacing: 200, hooks: ZERO_ADDR },
  MU: { currency0: USDG, currency1: TICKERS.MU.token, fee: 10000, tickSpacing: 200, hooks: ZERO_ADDR },
  SNDK: { currency0: USDG, currency1: TICKERS.SNDK.token, fee: 10000, tickSpacing: 200, hooks: ZERO_ADDR },
};

// ============================================================
// BASKET DEFINITIONS -- v18.4 final lineup (Mag 7 alone launches now)
//
// v18.4 UPDATE: the final-lineup fork round-trip test (mint+redeem as
// complete multi-leg wholes, not just individual legs) found that
// Crypto Proxy Equities and Broad Semiconductors BOTH fail on redeem
// specifically -- COIN and INTC are 0bps clean on MINT (confirmed
// earlier) but genuinely revert on REDEEM, confirmed isolated
// individually, not a multi-leg interaction artifact. This is a real,
// asymmetric buy/sell liquidity problem, invisible to any mint-only
// check -- the most insidious kind of bug for a redemption product,
// since it passes every check except the one that matters most.
//
// Checked precisely whether a clean, thematically-honest replacement
// ticker exists to pair with the survivors (CRCL for Crypto Proxy, MU
// for Broad Semi): none does. Every other crypto/semi-themed ticker in
// the 16-ticker set is already dead (TSM, MSTR), already excluded on
// cost grounds (SNDK), or already excluded from an earlier session
// (ASML). Using a Mag7 tech ticker to pad either basket would be
// thematically dishonest regardless of whether it passes verification.
//
// RESULT: both baskets HELD ENTIRELY (not just their bad legs) pending
// ticker-expansion work finding genuinely new, round-trip-clean,
// thematically-fitting candidates. IDs 1, 3, 4 all reserved, not
// reassigned.
//
// Mag 7 (id 2) is the ONLY basket launching tonight -- but it is
// FULLY verified, both directions, every one of its 7 legs
// individually confirmed clean on redeem (a successful multi-leg
// redeem cannot happen if even one leg fails -- same mechanism as
// mint). This is a real, complete, honestly-priced launch, not a
// partial one.
//
// PERMANENT PROCESS CHANGE (going forward, starting with ticker
// expansion): every ticker and every basket gets a full round-trip
// mint+redeem fork test before it can ship, forever -- not mint-only,
// not "pool exists." Buy-side cleanliness proved tonight that it says
// nothing about sell-side. This also propagates into the
// user-created-baskets roadmap spec: the allowlist must be
// round-trip-verified tickers only, not just "has a real pool."
// ============================================================
interface BasketConfig {
  id: number;
  name: string;
  symbol: string;
  tickers: string[];
  weights: number[]; // bps, must sum to 10000
  depositCapUsd: string;
  maxMintUsd: string;
}

const BASKETS: BasketConfig[] = [
  {
    id: 2,
    name: "Mag 7",
    symbol: "sMAG7",
    tickers: ["AAPL", "MSFT", "GOOGL", "AMZN", "NVDA", "META", "TSLA"],
    weights: [1430, 1430, 1430, 1430, 1430, 1430, 1420],
    depositCapUsd: "1000000",
    maxMintUsd: "100000",
  },
];

async function main() {
  const { ethers } = await network.connect({ network: "robinhoodMainnet" });
  const [deployer] = await ethers.getSigners();

  console.log(`=== STAX MAINNET DEPLOY (v18.4: struct fix + real round-trip-verified launch, Mag 7 only) ===\n`);
  console.log("Deployer:", deployer.address);
  const ethBalance = await ethers.provider.getBalance(deployer.address);
  console.log("ETH balance:", ethers.formatEther(ethBalance));

  // ============================================================
  // PREFLIGHT VALIDATION -- Opus review: fail before any transactions,
  // not mid-deploy leaving a partially-configured vault.
  // ============================================================
  console.log("\n=== PREFLIGHT VALIDATION ===");
  let preflightFailed = false;

  const missingFeeds = Object.entries(TICKERS).filter(([, cfg]) => cfg.feed === "TODO_FILL_IN_REAL_FEED");
  if (missingFeeds.length > 0) {
    console.log("  FAIL: missing real Chainlink feed addresses for:", missingFeeds.map(([sym]) => sym).join(", "));
    preflightFailed = true;
  } else {
    console.log("  OK: all 16 ticker feed addresses are filled in (not placeholders)");
  }

  // Feed distinctness -- catches a transposed real address (e.g. NVDA's
  // feed accidentally pasted into AMD's slot) that the placeholder check
  // can't see.
  const feedAddresses = Object.values(TICKERS).map((cfg) => cfg.feed.toLowerCase());
  const uniqueFeeds = new Set(feedAddresses);
  if (uniqueFeeds.size !== feedAddresses.length) {
    console.log("  FAIL: duplicate feed addresses detected -- at least two tickers point at the same feed. Check for a copy-paste transposition.");
    preflightFailed = true;
  } else {
    console.log("  OK: all 16 feed addresses are distinct");
  }

  // currency0 < currency1 for every pool -- contract enforces this and
  // will revert mid-deploy if wrong; check it here instead, before any
  // transaction is sent.
  let poolOrderingOk = true;
  for (const [symbol, pool] of Object.entries(TICKER_POOLS)) {
    if (!(BigInt(pool.currency0) < BigInt(pool.currency1))) {
      console.log(`  FAIL: ${symbol} pool currency0 (${pool.currency0}) is NOT less than currency1 (${pool.currency1}) -- setTickerPool will revert.`);
      preflightFailed = true;
      poolOrderingOk = false;
    }
  }
  if (poolOrderingOk) console.log("  OK: all 16 pool currency orderings are correct (currency0 < currency1)");

  // Basket weights sum to exactly 10000 -- check the array up front.
  let weightsOk = true;
  for (const basket of BASKETS) {
    const totalWeight = basket.weights.reduce((a, b) => a + b, 0);
    if (totalWeight !== 10000) {
      console.log(`  FAIL: ${basket.name} weights sum to ${totalWeight}, not 10000.`);
      preflightFailed = true;
      weightsOk = false;
    }
  }
  if (weightsOk) console.log(`  OK: all ${BASKETS.length} basket weight array(s) sum to exactly 10000`);

  if (preflightFailed) {
    console.log("\n*** PREFLIGHT FAILED -- fix the issues above before running this against mainnet. ***");
    process.exitCode = 1;
    return;
  }

  console.log("\n*** USDG_USD_MAX_STALENESS:", USDG_USD_MAX_STALENESS, "seconds (", USDG_USD_MAX_STALENESS / 3600, "hours) -- empirically measured from 60 days of real feed history, USDG feed only ***");
  console.log("*** STOCK_FEED_MAX_STALENESS:", STOCK_FEED_MAX_STALENESS, "seconds (", STOCK_FEED_MAX_STALENESS / 3600, "hours) -- applied to all 16 stock feeds, empirically-grounded holiday-weekend bound ***\n");

  console.log("Deploying StaxVault (v18.3 -- struct fix: ExactInputSingleParams now has minHopPriceX36, real router decode confirmed)...");
  const StaxVault = await ethers.getContractFactory("StaxVault");
  const vault = await StaxVault.deploy(
    REWARDS_POOL,
    TREASURY,
    UNIVERSAL_ROUTER,
    PERMIT2,
    USDG,
    USDG_USD_FEED,
    USDG_USD_MAX_STALENESS,
    SEQUENCER_UPTIME_FEED
  );
  const vaultAddress = await vault.getAddress();
  console.log("  StaxVault (v18.3):", vaultAddress);

  // ============================================================
  // POST-DEPLOY IMMUTABLE READ-BACK (Opus review): this is the
  // mechanical catch for a constructor-argument-order mistake -- if any
  // arg landed in the wrong slot, one of these reads will show a wrong
  // value and the script halts here, BEFORE spending gas registering 16
  // pools against a corrupted vault.
  // ============================================================
  console.log("\nVerifying deployed immutables match intended config...");
  const checks: [string, string, string][] = [
    ["usdg", await vault.usdg(), USDG],
    ["usdgUsdFeed", await vault.usdgUsdFeed(), USDG_USD_FEED],
    ["rewardsPool", await vault.rewardsPool(), REWARDS_POOL],
    ["treasury", await vault.treasury(), TREASURY],
    ["universalRouter", await vault.universalRouter(), UNIVERSAL_ROUTER],
    ["permit2", await vault.permit2(), PERMIT2],
    ["sequencerUptimeFeed", await vault.sequencerUptimeFeed(), SEQUENCER_UPTIME_FEED],
  ];
  let immutablesOk = true;
  for (const [name, actual, expected] of checks) {
    const matches = actual.toLowerCase() === expected.toLowerCase();
    console.log(`  ${matches ? "OK" : "*** MISMATCH ***"}  ${name}: ${actual}${matches ? "" : ` (expected ${expected})`}`);
    if (!matches) immutablesOk = false;
  }
  const onChainStaleness = await vault.usdgUsdMaxStaleness();
  const stalenessOk = onChainStaleness === BigInt(USDG_USD_MAX_STALENESS);
  console.log(`  ${stalenessOk ? "OK" : "*** MISMATCH ***"}  usdgUsdMaxStaleness: ${onChainStaleness}`);
  if (!stalenessOk) immutablesOk = false;

  // v18.1 addition (Opus review): staxToken is no longer a constructor
  // arg -- correct post-deploy state is explicitly address(0) until
  // configured. Asserting this catches, mechanically, any future
  // accidental change that sets it at construction again.
  const onChainStaxToken = await vault.staxToken();
  const staxTokenOk = onChainStaxToken === ethers.ZeroAddress;
  console.log(`  ${staxTokenOk ? "OK" : "*** MISMATCH ***"}  staxToken: ${onChainStaxToken} (expected address(0) -- unset until STAX launches)`);
  if (!staxTokenOk) immutablesOk = false;

  if (!immutablesOk) {
    console.log("\n*** CONSTRUCTOR VERIFICATION FAILED -- the deployed vault does not match intended config. STOP. Do not proceed. This vault is unusable and should be abandoned. ***");
    process.exitCode = 1;
    return;
  }
  console.log("  All immutables confirmed correct -- safe to proceed.\n");

  console.log("staxToken deliberately left UNSET -- STAX has not launched yet.");
  console.log("Call setStaxToken(<real STAX address>) once it genuinely exists, NOT before.\n");

  console.log("Registering price feeds and pools for all 16 tickers (12 basket-active, 4 registered-but-unused: TSM, MSTR, SNDK, SPCX)...");
  for (const [symbol, cfg] of Object.entries(TICKERS)) {
    // v18 fix (Opus review): stock feeds get STOCK_FEED_MAX_STALENESS,
    // NOT the USDG-specific 27h value -- the original draft blanket-
    // applied the wrong constant here.
    await vault.setPriceFeed(cfg.token, cfg.feed, STOCK_FEED_MAX_STALENESS);

    const pool = TICKER_POOLS[symbol];
    await vault.setTickerPool(cfg.token, pool.currency0, pool.currency1, pool.fee, pool.tickSpacing, pool.hooks);

    // Read-back verification (Opus review): confirm the pool actually
    // registered as intended, not just that the transaction didn't
    // revert.
    const registeredPool = await vault.tickerPools(cfg.token);
    const poolMatches =
      registeredPool.currency0.toLowerCase() === pool.currency0.toLowerCase() &&
      registeredPool.currency1.toLowerCase() === pool.currency1.toLowerCase() &&
      registeredPool.fee === BigInt(pool.fee) &&
      registeredPool.tickSpacing === BigInt(pool.tickSpacing);

    // v18.1 addition (Opus review): read back the FEED config too, not
    // just the pool -- this is the exact parameter that carried the
    // staleness bug fixed earlier, so it's the one most worth verifying
    // actually landed correctly.
    const registeredFeed = await vault.priceFeeds(cfg.token);
    const feedMatches =
      registeredFeed.feed.toLowerCase() === cfg.feed.toLowerCase() &&
      registeredFeed.maxStaleness === BigInt(STOCK_FEED_MAX_STALENESS);

    if (!poolMatches || !feedMatches) {
      console.log(`  *** ${symbol}: READ-BACK MISMATCH (pool ok=${poolMatches}, feed ok=${feedMatches}) -- on-chain state does not match intended config. STOP AND INVESTIGATE. ***`);
      process.exitCode = 1;
      return;
    }

    console.log(`  ${symbol}: feed + pool registered and verified`);
  }

  console.log("\nCreating baskets (Mag 7 only -- Crypto Proxy and Broad Semiconductors both held, see header comment)...");
  for (const basket of BASKETS) {
    const tokenAddrs = basket.tickers.map((s) => TICKERS[s].token);
    await vault.createBasket(
      basket.id,
      basket.name,
      basket.symbol,
      tokenAddrs,
      basket.weights,
      ethers.parseUnits(basket.depositCapUsd, 18),
      ethers.parseUnits(basket.maxMintUsd, 18)
    );

    // Read-back verification (Opus review), DEEPENED: `exists` alone
    // only proves a basket got created at this ID, not that it has the
    // right composition. This is the immutable heart of the product --
    // what users actually buy -- so it gets the deepest check in the
    // script: real tickers and weights, element-by-element, via the new
    // getBasketComposition() view added specifically for this.
    const registeredBasket = await vault.baskets(basket.id);
    if (!registeredBasket.exists) {
      console.log(`  *** Basket ${basket.id} (${basket.name}): READ-BACK FAILED -- basket does not exist on-chain after creation. STOP AND INVESTIGATE. ***`);
      process.exitCode = 1;
      return;
    }

    const [onChainTickers, onChainWeights] = await vault.getBasketComposition(basket.id);
    const onChainTickersLower = onChainTickers.map((t: string) => t.toLowerCase());
    const expectedTickersLower = tokenAddrs.map((t) => t.toLowerCase());

    const tickersMatch =
      onChainTickersLower.length === expectedTickersLower.length &&
      onChainTickersLower.every((t: string, i: number) => t === expectedTickersLower[i]);
    const weightsMatch =
      onChainWeights.length === basket.weights.length &&
      onChainWeights.every((w: bigint, i: number) => w === BigInt(basket.weights[i]));

    if (!tickersMatch || !weightsMatch) {
      console.log(`  *** Basket ${basket.id} (${basket.name}): COMPOSITION MISMATCH (tickers ok=${tickersMatch}, weights ok=${weightsMatch}) -- on-chain composition does not match intended config. STOP AND INVESTIGATE. ***`);
      console.log(`      Expected tickers: ${expectedTickersLower.join(", ")}`);
      console.log(`      On-chain tickers: ${onChainTickersLower.join(", ")}`);
      console.log(`      Expected weights: ${basket.weights.join(", ")}`);
      console.log(`      On-chain weights: ${onChainWeights.join(", ")}`);
      process.exitCode = 1;
      return;
    }

    console.log(`  Basket ${basket.id} (${basket.name} / ${basket.symbol}) created and verified`);
  }

  console.log("\n=== MAINNET DEPLOY COMPLETE ===");
  console.log("StaxVault address:", vaultAddress);
  console.log("\nNext steps:");
  console.log("  1. Blockscout verification");
  console.log("  2. Seed baskets with real USDG mints");
  console.log("  3. Update VAULT_ADDRESS in src/lib/vault.ts");
  console.log("  4. Confirm mint.tsx shows Mag 7 round-trip cost disclosure (~1.3% incl. protocol fee)");
  console.log("  5. *** REMEMBER: call setStaxToken(<real STAX address>) once STAX genuinely");
  console.log("     launches -- this is now a required manual step (staxToken starts unset,");
  console.log("     see Opus review). Buy-burn silently does nothing until this is called.");
  console.log("     Put this on the actual launch-day runbook, not just this printed reminder.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
