import { network } from "hardhat";

// ============================================================================
// CREATE MAG 7 FRESH ON v19 -- retiring v18.4 entirely.
//
// Real decision made today: v18.4 has zero remaining funds (confirmed),
// and nobody but Dan has ever used the live site, so there's no real
// user migration to manage. Rather than maintain two contracts forever,
// Mag 7 gets re-created here on v19 with the exact same 7 tickers,
// weights, and caps as the original -- v18.4 becomes fully retired
// after this, no live references anywhere going forward.
//
// All 7 tickers were already registered during the v19 deploy itself,
// so like Retail Favorites, this is a pure createBasket() config call.
// ============================================================================

const VAULT_ADDRESS = "0x13045D3Dab253fDB15181C16f135D612fa8546E6";

const AAPL = "0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9";
const MSFT = "0xe93237C50D904957Cf27E7B1133b510C669c2e74";
const GOOGL = "0x2e0847E8910a9732eB3fb1bb4b70a580ADAD4FE3";
const AMZN = "0x12f190a9F9d7D37a250758b26824B97CE941bF54";
const NVDA = "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC";
const META = "0xc0D6457C16Cc70d6790Dd43521C899C87ce02f35";
const TSLA = "0x322F0929c4625eD5bAd873c95208D54E1c003b2d";

const MAG7_ID = 3;
const DEPOSIT_CAP_USD = 1_000_000n * 10n ** 18n;
const MAX_MINT_USD = 100_000n * 10n ** 18n;

const TICKERS = [
  ["AAPL", AAPL], ["MSFT", MSFT], ["GOOGL", GOOGL], ["AMZN", AMZN],
  ["NVDA", NVDA], ["META", META], ["TSLA", TSLA],
] as const;

async function main() {
  const { ethers } = await network.connect({ network: "robinhoodMainnet" });
  const [deployer] = await ethers.getSigners();

  console.log("=== Creating Mag 7 fresh on v19 (retiring v18.4) ===\n");
  console.log(`Deployer: ${deployer.address}`);
  console.log(`Vault: ${VAULT_ADDRESS}\n`);

  const vault = await ethers.getContractAt("StaxVault", VAULT_ADDRESS);

  for (const [symbol, addr] of TICKERS) {
    const [feed] = await vault.priceFeeds(addr);
    if (feed === ethers.ZeroAddress) {
      throw new Error(`PREFLIGHT FAILED: ${symbol} (${addr}) has no registered price feed on this contract. Aborting.`);
    }
    console.log(`${symbol} feed confirmed registered: ${feed}`);
  }
  console.log("\nAll 7 tickers confirmed registered.\n");

  // Equal weight, same pattern as the original Mag 7 -- 14.3% x6 + 14.2%
  // on the last leg to sum exactly to 10000.
  const createTx = await vault.createBasket(
    MAG7_ID,
    "Mag 7",
    "sMAG7",
    [AAPL, MSFT, GOOGL, AMZN, NVDA, META, TSLA],
    [1430, 1430, 1430, 1430, 1430, 1430, 1420],
    DEPOSIT_CAP_USD,
    MAX_MINT_USD
  );
  await createTx.wait();
  console.log(`Mag 7 basket created (id ${MAG7_ID}).`);
  console.log(`Tx: ${createTx.hash}\n`);

  const [tickers, weights] = await vault.getBasketComposition(MAG7_ID);
  console.log("On-chain composition read-back:");
  tickers.forEach((addr: string, i: number) => {
    console.log(`  ${addr} — weight ${weights[i]}`);
  });

  const expected = [AAPL, MSFT, GOOGL, AMZN, NVDA, META, TSLA];
  const expectedWeights = [1430n, 1430n, 1430n, 1430n, 1430n, 1430n, 1420n];
  const compositionCorrect =
    tickers.length === 7 &&
    tickers.every((t: string, i: number) => t.toLowerCase() === expected[i].toLowerCase()) &&
    weights.every((w: bigint, i: number) => w === expectedWeights[i]);

  console.log(`\nComposition matches intent: ${compositionCorrect ? "YES" : "NO — CHECK MANUALLY"}`);

  console.log("\n=== MAG 7 LIVE ON v19 ===");
  console.log(`Basket id: ${MAG7_ID}`);
  console.log(`\nv18.4 (0xca3F3182221F86E89BeE99795170bd4251A6BA82) is now fully retired.`);
  console.log(`Next steps:`);
  console.log(`  1. Update src/lib/baskets.ts: add Mag 7 back to BASKETS, remove MAG7_MIGRATING usage`);
  console.log(`  2. Update src/lib/vault.ts: add mag7: ${MAG7_ID} to BASKET_ONCHAIN_ID`);
  console.log(`  3. Remove migration-notice code from portfolio.tsx, baskets.$id.tsx, baskets.index.tsx`);
  console.log(`  4. Seed with a real mint`);
  console.log(`  5. Push, full smoke test`);
}

main().catch((error) => {
  console.error("\n=== SCRIPT FAILED ===");
  console.error(error);
  process.exitCode = 1;
});
