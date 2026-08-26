import { network } from "hardhat";

// ============================================================================
// v19 MAINNET DEPLOY — V3 support live, Commodities basket registered.
//
// Scope, deliberately tight for tonight's window: deploy v19, register
// ALL 20 tickers (the 16 already live on v18.4 + the 4 new ones from
// tonight: GME/USO/SLV via V3, PLTR via V4), create ONLY Commodities
// (USO/SLV). Registering the full set now — even though only one new
// basket ships tonight — means Retail Favorites tomorrow is a pure
// createBasket() call with zero new registration work, since every
// ticker it needs (GME, PLTR, CRCL) is already registered here.
//
// Mag 7 is deliberately NOT recreated on v19 in this script — that's
// the open "two-contract vs. migrate" decision Opus flagged, not yet
// made. v18.4 keeps running exactly as it is; this is a new, separate
// contract, not a replacement.
//
// All values below are real, confirmed data from tonight's actual
// testing (FullRegistryTest.t.sol's exact 16-ticker list, matching
// live v18.4 state precisely, plus the 4 new tickers' real feeds/pools
// resolved and round-trip-tested tonight).
// ============================================================================

const REWARDS_POOL = "0xc02F399cBbF90CEc6DD3a7c2D90fcA84C0a3a5ad";
const TREASURY = "0xFF843Bc76C276086569D081E02DAC467C2aDa5cE";
const UNIVERSAL_ROUTER = "0x8876789976dEcBfCbBbe364623C63652db8C0904";
const PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3";
const USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
const USDG_USD_FEED = "0x61B7e5650328764B076A108EFF5fa7282a1B9aD2";
// Real, measured USDG/USD feed staleness (27h) -- distinct from the
// 96h used for individual STOCK feeds below. Do not conflate these two
// -- that exact confusion is the class of bug that bricked mint/redeem
// on the very first mainnet deploy attempt several sessions ago.
const USDG_USD_MAX_STALENESS = 97_200; // 27 hours
const SEQUENCER_UPTIME_FEED = "0x0000000000000000000000000000000000000000"; // deliberately address(0) -- no published feed for this chain yet
const DEPLOYER = "0xCECa5491a16ea73F29990313924285EEB9771e3b";

// Real, measured stock-feed staleness -- covers real weekend/holiday
// gaps in equity market hours. Applied uniformly to every stock
// ticker's feed below.
const STOCK_FEED_MAX_STALENESS = 345_600; // 96 hours

type TickerConfigV4 = {
  symbol: string;
  token: string;
  feed: string;
  currency0: string;
  currency1: string;
  fee: number;
  tickSpacing: number;
  venue: "v4";
};

type TickerConfigV3 = {
  symbol: string;
  token: string;
  feed: string;
  fee: number;
  venue: "v3";
};

type TickerConfig = TickerConfigV4 | TickerConfigV3;

// The 16 tickers already live on v18.4, registered here identically --
// same feeds, same pools, same fee tiers. Matches FullRegistryTest.t.sol
// exactly, which already proved this exact set works together on a
// fresh v19-equivalent deploy.
const EXISTING_16: TickerConfig[] = [
  { symbol: "NVDA", token: "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC", feed: "0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15", currency0: USDG, currency1: "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC", fee: 3000, tickSpacing: 60, venue: "v4" },
  { symbol: "AMD", token: "0x86923f96303D656E4aa86D9d42D1e57ad2023fdC", feed: "0x943A29E7ae51A4798823ca9eEd2ed533B2A22C72", currency0: USDG, currency1: "0x86923f96303D656E4aa86D9d42D1e57ad2023fdC", fee: 10000, tickSpacing: 200, venue: "v4" },
  { symbol: "TSM", token: "0x58FfE4a942d3885bAa22D7520691F611EF09e7AA", feed: "0x874cF94aa8eC88Fd9560094dD065f2fB3E41Fc2F", currency0: "0x58FfE4a942d3885bAa22D7520691F611EF09e7AA", currency1: USDG, fee: 400000, tickSpacing: 8000, venue: "v4" },
  { symbol: "AAPL", token: "0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9", feed: "0x6B22A786bAa607d76728168703a39Ea9C99f2cD0", currency0: USDG, currency1: "0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9", fee: 3000, tickSpacing: 60, venue: "v4" },
  { symbol: "MSFT", token: "0xe93237C50D904957Cf27E7B1133b510C669c2e74", feed: "0x45C3C877C15E6BA2EBB19eA114Ea508d14C1Af2E", currency0: USDG, currency1: "0xe93237C50D904957Cf27E7B1133b510C669c2e74", fee: 3000, tickSpacing: 60, venue: "v4" },
  { symbol: "GOOGL", token: "0x2e0847E8910a9732eB3fb1bb4b70a580ADAD4FE3", feed: "0xF6f373a037c30F0e5010d854385cA89185AE638b", currency0: "0x2e0847E8910a9732eB3fb1bb4b70a580ADAD4FE3", currency1: USDG, fee: 3000, tickSpacing: 60, venue: "v4" },
  { symbol: "AMZN", token: "0x12f190a9F9d7D37a250758b26824B97CE941bF54", feed: "0xD5a1508ceD74c084eBf3cBe853e2C968fB2a651C", currency0: "0x12f190a9F9d7D37a250758b26824B97CE941bF54", currency1: USDG, fee: 3000, tickSpacing: 60, venue: "v4" },
  { symbol: "META", token: "0xc0D6457C16Cc70d6790Dd43521C899C87ce02f35", feed: "0x7C38C00C30BEe9378381E7B6135d7283356D71b1", currency0: USDG, currency1: "0xc0D6457C16Cc70d6790Dd43521C899C87ce02f35", fee: 3000, tickSpacing: 60, venue: "v4" },
  { symbol: "TSLA", token: "0x322F0929c4625eD5bAd873c95208D54E1c003b2d", feed: "0x4A1166a659A55625345e9515b32adECea5547C38", currency0: "0x322F0929c4625eD5bAd873c95208D54E1c003b2d", currency1: USDG, fee: 3000, tickSpacing: 60, venue: "v4" },
  { symbol: "COIN", token: "0x6330D8C3178a418788dF01a47479c0ce7CCF450b", feed: "0xA3a468A452940B7D6b69991207B508c609a98Ef2", currency0: USDG, currency1: "0x6330D8C3178a418788dF01a47479c0ce7CCF450b", fee: 10000, tickSpacing: 200, venue: "v4" },
  { symbol: "MSTR", token: "0xec262a75e413fAfD0dF80480274532C79D42da09", feed: "0x396118bdFB181e6240E74D243F266B061c0edc3D", currency0: USDG, currency1: "0xec262a75e413fAfD0dF80480274532C79D42da09", fee: 50000, tickSpacing: 1100, venue: "v4" },
  { symbol: "CRCL", token: "0xdF0992E440dD0be65BD8439b609d6D4366bf1CB5", feed: "0x6652eDf64bA3731C4F2D3ce821A0Fb1f1f6b482a", currency0: USDG, currency1: "0xdF0992E440dD0be65BD8439b609d6D4366bf1CB5", fee: 3000, tickSpacing: 30, venue: "v4" },
  { symbol: "INTC", token: "0xc72b96e0E48ecd4DC75E1e45396e26300BC39681", feed: "0x3f390C5C24628Ac7C489515402235FeAD71D1913", currency0: USDG, currency1: "0xc72b96e0E48ecd4DC75E1e45396e26300BC39681", fee: 10000, tickSpacing: 200, venue: "v4" },
  { symbol: "MU", token: "0xfF080c8ce2E5feadaCa0Da81314Ae59D232d4afD", feed: "0x425EEFdCf05ed6526C3cE61Af99429A228a6d596", currency0: USDG, currency1: "0xfF080c8ce2E5feadaCa0Da81314Ae59D232d4afD", fee: 10000, tickSpacing: 200, venue: "v4" },
  { symbol: "SNDK", token: "0xB90A19fF0Af67f7779afF50A882A9CfF42446400", feed: "0xfb133Fa4B7b385802B693a293606682Df47109A3", currency0: USDG, currency1: "0xB90A19fF0Af67f7779afF50A882A9CfF42446400", fee: 10000, tickSpacing: 200, venue: "v4" },
  { symbol: "SPCX", token: "0x4a0E65A3EcceC6dBe60AE065F2e7bb85Fae35eEa", feed: "0xB265810950ba6c5C0Ff821c9963014a56fD8Bffb", currency0: "0x4a0E65A3EcceC6dBe60AE065F2e7bb85Fae35eEa", currency1: USDG, fee: 10000, tickSpacing: 200, venue: "v4" },
];

// The 4 new tickers from tonight. GME/USO/SLV via V3 (real liquidity is
// there, not on V4); PLTR via V4 (real pool resolved directly from the
// Initialize event tonight, settling a real address discrepancy).
const NEW_4: TickerConfig[] = [
  { symbol: "GME", token: "0x1b0E319c6A659F002271B69dB8A7df2F911c153E", feed: "0x27C71df6A64fB476468EdF256CF72c038baB5B67", fee: 10000, venue: "v3" },
  { symbol: "PLTR", token: "0x894E1EC2D74FFE5AEF8Dc8A9e84686acCB964F2A", feed: "0x820ABedFF239034956B7A9d2F0a331f9F075eB4c", currency0: USDG, currency1: "0x894E1EC2D74FFE5AEF8Dc8A9e84686acCB964F2A", fee: 10000, tickSpacing: 200, venue: "v4" } as TickerConfigV4,
  { symbol: "USO", token: "0xa30FA36Db767ad9eD3f7a60fC79526fB4d56D344", feed: "0x75a9c76Ef439e2C7c2E5a34Ab105EcFe3766431c", fee: 3000, venue: "v3" },
  { symbol: "SLV", token: "0x411eFb0E7f985935DAec3D4C3ebaEa0d0AD7D89f", feed: "0x209b73908e92Ae021826eD79609845451Ecba2ce", fee: 10000, venue: "v3" },
];

const ALL_TICKERS: TickerConfig[] = [...EXISTING_16, ...NEW_4];

const COMMODITIES_BASKET_ID = 1;
const COMMODITIES_DEPOSIT_CAP_USD = 1_000_000n * 10n ** 18n;
const COMMODITIES_MAX_MINT_USD = 100_000n * 10n ** 18n;

async function main() {
  const { ethers } = await network.connect({ network: "robinhoodMainnet" });
  const [deployer] = await ethers.getSigners();

  console.log("=== v19 MAINNET DEPLOY: Commodities basket, full 20-ticker registry ===\n");
  console.log(`Deployer: ${deployer.address}`);
  if (deployer.address.toLowerCase() !== DEPLOYER.toLowerCase()) {
    throw new Error(
      `PREFLIGHT FAILED: connected deployer (${deployer.address}) does not match expected deployer (${DEPLOYER}). Aborting before any transaction.`
    );
  }

  // --- PREFLIGHT: confirm deployer is funded for the full tx count. ---
  // 1 deploy + 20 tickers × 2 calls (setPriceFeed + setTickerPool/V3) +
  // 1 createBasket = 42 transactions total.
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`Deployer balance: ${ethers.formatEther(balance)} (native gas token)`);
  console.log(`Expected transaction count: 1 deploy + 40 registrations + 1 createBasket = 42\n`);

  const usdgContract = await ethers.getContractAt(
    ["function balanceOf(address) view returns (uint256)"],
    USDG
  );
  const usdgBalance = await usdgContract.balanceOf(deployer.address);
  console.log(`Deployer USDG balance: ${ethers.formatUnits(usdgBalance, 6)} (needed for seeding Commodities after registration)\n`);

  // --- DEPLOY ---
  console.log("Deploying StaxVault (v19)...");
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
  await vault.waitForDeployment();
  const vaultAddress = await vault.getAddress();
  const deployTx = vault.deploymentTransaction();
  console.log(`StaxVault (v19) deployed: ${vaultAddress}`);
  console.log(`Deploy tx: ${deployTx?.hash}`);

  const deployReceipt = await deployTx?.wait();
  const deployBlock = deployReceipt?.blockNumber;
  console.log(`Deploy block: ${deployBlock}\n`);

  // --- IMMUTABLE READ-BACKS (before touching anything else) ---
  console.log("=== Immutable read-back verification ===");
  const readSequencerFeed = await vault.sequencerUptimeFeed();
  const readUsdgFeed = await vault.usdgUsdFeed();
  const readUsdgStaleness = await vault.usdgUsdMaxStaleness();
  console.log(`sequencerUptimeFeed: ${readSequencerFeed} (expect address(0))`);
  console.log(`usdgUsdFeed: ${readUsdgFeed}`);
  console.log(`usdgUsdMaxStaleness: ${readUsdgStaleness} (expect 97200 / 27h)`);

  if (readSequencerFeed !== SEQUENCER_UPTIME_FEED) {
    throw new Error("PREFLIGHT FAILED: sequencerUptimeFeed is not address(0) as expected. Stopping.");
  }
  if (readUsdgStaleness !== BigInt(USDG_USD_MAX_STALENESS)) {
    throw new Error("PREFLIGHT FAILED: usdgUsdMaxStaleness mismatch. Stopping.");
  }
  console.log("Immutable read-backs confirmed correct.\n");

  // --- REGISTER ALL 20 TICKERS ---
  console.log("=== Registering all 20 tickers (feed + pool) ===");
  for (const t of ALL_TICKERS) {
    console.log(`\n${t.symbol} (${t.venue.toUpperCase()})...`);

    const feedTx = await vault.setPriceFeed(t.token, t.feed, STOCK_FEED_MAX_STALENESS);
    await feedTx.wait();
    console.log(`  Feed set: ${t.feed} (staleness ${STOCK_FEED_MAX_STALENESS}s)`);

    if (t.venue === "v3") {
      const poolTx = await vault.setTickerPoolV3(t.token, t.fee);
      await poolTx.wait();
      console.log(`  V3 pool set: fee ${t.fee}`);
    } else {
      const v4 = t as TickerConfigV4;
      const poolTx = await vault.setTickerPool(
        v4.token,
        v4.currency0,
        v4.currency1,
        v4.fee,
        v4.tickSpacing,
        ethers.ZeroAddress
      );
      await poolTx.wait();
      console.log(`  V4 pool set: fee ${v4.fee}, tickSpacing ${v4.tickSpacing}`);
    }
  }
  console.log("\nAll 20 tickers registered.\n");

  // --- READ-BACK: confirm tickerIsV3 matches intent for every ticker ---
  // Opus's specific ask -- the thin router branches on this bool, so a
  // mis-registration here would silently route a swap to the wrong
  // venue.
  console.log("=== Verifying tickerIsV3 per ticker ===");
  let venueCheckFailed = false;
  for (const t of ALL_TICKERS) {
    const isV3 = await vault.tickerIsV3(t.token);
    const expected = t.venue === "v3";
    const status = isV3 === expected ? "OK" : "MISMATCH";
    if (isV3 !== expected) venueCheckFailed = true;
    console.log(`  ${t.symbol}: tickerIsV3=${isV3}, expected=${expected} — ${status}`);
  }
  if (venueCheckFailed) {
    throw new Error("PREFLIGHT FAILED: at least one ticker's venue registration doesn't match intent. Stopping before basket creation.");
  }
  console.log("All venue registrations confirmed correct.\n");

  // --- CREATE COMMODITIES BASKET (USO/SLV, 50/50) ---
  console.log("=== Creating Commodities basket (USO/SLV) ===");
  const uso = NEW_4.find((t) => t.symbol === "USO")!;
  const slv = NEW_4.find((t) => t.symbol === "SLV")!;

  const createTx = await vault.createBasket(
    COMMODITIES_BASKET_ID,
    "Commodities",
    "sCOMM",
    [uso.token, slv.token],
    [5000, 5000],
    COMMODITIES_DEPOSIT_CAP_USD,
    COMMODITIES_MAX_MINT_USD
  );
  await createTx.wait();
  console.log(`Commodities basket created (id ${COMMODITIES_BASKET_ID}).`);

  // --- DEEP COMPOSITION READ-BACK ---
  const [tickers, weights] = await vault.getBasketComposition(COMMODITIES_BASKET_ID);
  console.log(`\nOn-chain composition read-back:`);
  tickers.forEach((addr: string, i: number) => {
    console.log(`  ${addr} — weight ${weights[i]}`);
  });
  const compositionCorrect =
    tickers.length === 2 &&
    tickers[0].toLowerCase() === uso.token.toLowerCase() &&
    tickers[1].toLowerCase() === slv.token.toLowerCase() &&
    weights[0] === 5000n &&
    weights[1] === 5000n;
  console.log(`Composition matches intent: ${compositionCorrect ? "YES" : "NO — CHECK MANUALLY"}\n`);

  console.log("=== v19 DEPLOY COMPLETE ===");
  console.log(`Vault address: ${vaultAddress}`);
  console.log(`Deploy block: ${deployBlock}`);
  console.log(`Commodities basket id: ${COMMODITIES_BASKET_ID}`);
  console.log(`\nNext steps:`);
  console.log(`  1. Verify on Blockscout + Sourcify (same manual-upload workaround as prior deploys if the API 500s)`);
  console.log(`  2. Update src/lib/vault.ts: VAULT_ADDRESS, VAULT_DEPLOY_BLOCK`);
  console.log(`  3. Update src/lib/baskets.ts: add Commodities to BASKETS array`);
  console.log(`  4. Seed Commodities with a real mint (same pattern as seed-mag7.ts)`);
  console.log(`  5. Mag 7 / v18.4 migration decision -- NOT done in this script, still open`);
}

main().catch((error) => {
  console.error("\n=== DEPLOY SCRIPT FAILED ===");
  console.error(error);
  process.exitCode = 1;
});
