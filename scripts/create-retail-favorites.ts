import { network } from "hardhat";

// ============================================================================
// CREATE RETAIL FAVORITES -- GME / PLTR / CRCL, on the already-live v19
// contract. All three tickers were registered during the v19 deploy
// itself, so this is purely a createBasket() config call -- no
// redeploy, no new registrations, exactly the "Tier 1" pattern
// described in the original post-mainnet roadmap doc.
//
// Real basis for this basket: GME round-trip tested clean via V3
// tonight, PLTR is pure V4 (zero new-code risk), CRCL has now passed
// isolated redeem 4+ separate times across two sessions -- the most
// proven ticker in the whole candidate pool. Real measured round-trip
// cost: ~161bps, disclosed honestly on the mint page same as
// Commodities and the old Mag 7 pattern.
// ============================================================================

const VAULT_ADDRESS = "0x13045D3Dab253fDB15181C16f135D612fa8546E6";

const GME = "0x1b0E319c6A659F002271B69dB8A7df2F911c153E";
const PLTR = "0x894E1EC2D74FFE5AEF8Dc8A9e84686acCB964F2A";
const CRCL = "0xdF0992E440dD0be65BD8439b609d6D4366bf1CB5";

const RETAIL_FAVORITES_ID = 2;
const DEPOSIT_CAP_USD = 1_000_000n * 10n ** 18n;
const MAX_MINT_USD = 100_000n * 10n ** 18n;

async function main() {
  const { ethers } = await network.connect({ network: "robinhoodMainnet" });
  const [deployer] = await ethers.getSigners();

  console.log("=== Creating Retail Favorites (GME/PLTR/CRCL) on v19 ===\n");
  console.log(`Deployer: ${deployer.address}`);
  console.log(`Vault: ${VAULT_ADDRESS}\n`);

  const vault = await ethers.getContractAt("StaxVault", VAULT_ADDRESS);

  // Sanity check: confirm all three tickers are already registered
  // (feed set) before attempting createBasket -- a clean, early failure
  // here is much easier to diagnose than createBasket's own revert.
  for (const [symbol, addr] of [["GME", GME], ["PLTR", PLTR], ["CRCL", CRCL]] as const) {
    const [feed] = await vault.priceFeeds(addr);
    if (feed === ethers.ZeroAddress) {
      throw new Error(`PREFLIGHT FAILED: ${symbol} (${addr}) has no registered price feed on this contract. Aborting.`);
    }
    console.log(`${symbol} feed confirmed registered: ${feed}`);
  }
  console.log("\nAll three tickers confirmed registered.\n");

  const createTx = await vault.createBasket(
    RETAIL_FAVORITES_ID,
    "Retail Favorites",
    "sRETAIL",
    [GME, PLTR, CRCL],
    [3334, 3333, 3333],
    DEPOSIT_CAP_USD,
    MAX_MINT_USD
  );
  await createTx.wait();
  console.log(`Retail Favorites basket created (id ${RETAIL_FAVORITES_ID}).`);
  console.log(`Tx: ${createTx.hash}\n`);

  // Deep composition read-back -- same discipline as every basket
  // creation tonight.
  const [tickers, weights] = await vault.getBasketComposition(RETAIL_FAVORITES_ID);
  console.log("On-chain composition read-back:");
  tickers.forEach((addr: string, i: number) => {
    console.log(`  ${addr} — weight ${weights[i]}`);
  });

  const compositionCorrect =
    tickers.length === 3 &&
    tickers[0].toLowerCase() === GME.toLowerCase() &&
    tickers[1].toLowerCase() === PLTR.toLowerCase() &&
    tickers[2].toLowerCase() === CRCL.toLowerCase() &&
    weights[0] === 3334n &&
    weights[1] === 3333n &&
    weights[2] === 3333n;

  console.log(`\nComposition matches intent: ${compositionCorrect ? "YES" : "NO — CHECK MANUALLY"}`);

  console.log("\n=== RETAIL FAVORITES LIVE ===");
  console.log(`Basket id: ${RETAIL_FAVORITES_ID}`);
  console.log(`\nNext steps:`);
  console.log(`  1. Add Retail Favorites to src/lib/baskets.ts BASKETS array`);
  console.log(`  2. Add its onchain id (2) to src/lib/vault.ts BASKET_ONCHAIN_ID`);
  console.log(`  3. Push, smoke test, seed with a real mint`);
}

main().catch((error) => {
  console.error("\n=== SCRIPT FAILED ===");
  console.error(error);
  process.exitCode = 1;
});
