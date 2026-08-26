import { network } from "hardhat";

const VAULT_ADDRESS = "0x420943e5A26efFfaD91eD968cC4C4322a19306b2";
const USDG_ADDRESS = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
const USDG_DECIMALS = 6;
const BASKET_ID = 1; // AI Infrastructure

async function main() {
  const { ethers } = await network.connect({ network: "robinhoodMainnet" });
  const [deployer] = await ethers.getSigners();

  const vaultAbi = [
    "function mint(uint256 basketId, uint256 usdgAmount) external",
    "function baskets(uint256) external view returns (string name, address token, uint256 depositCapUsd, uint256 maxMintUsd, bool mintPaused, bool exists)",
    "function getBasketComposition(uint256 basketId) external view returns (address[] memory tickers, uint256[] memory weights)",
    "function priceFeeds(address) external view returns (address feed, uint48 maxStaleness)",
    "function tickerPools(address) external view returns (address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks)",
  ];
  const vault = await ethers.getContractAt(vaultAbi, VAULT_ADDRESS);

  const amount = ethers.parseUnits("2.10", USDG_DECIMALS);

  console.log("=== Diagnosing the mint failure ===\n");

  // 1. Confirm basket state
  const basket = await vault.baskets(BASKET_ID);
  console.log("Basket exists:", basket.exists, "| mintPaused:", basket.mintPaused);
  console.log("Deposit cap:", ethers.formatUnits(basket.depositCapUsd, 18), "| Max mint:", ethers.formatUnits(basket.maxMintUsd, 18));

  // 2. Confirm composition and each ticker's real config
  const [tickers, weights] = await vault.getBasketComposition(BASKET_ID);
  console.log("\nTickers in this basket:");
  for (let i = 0; i < tickers.length; i++) {
    const feedConfig = await vault.priceFeeds(tickers[i]);
    const poolConfig = await vault.tickerPools(tickers[i]);
    console.log(`  ${tickers[i]} (weight ${weights[i]}bps)`);
    console.log(`    feed=${feedConfig.feed} maxStaleness=${feedConfig.maxStaleness}`);
    console.log(`    pool currency0=${poolConfig.currency0} currency1=${poolConfig.currency1} fee=${poolConfig.fee} tickSpacing=${poolConfig.tickSpacing} hooks=${poolConfig.hooks}`);
  }

  // 3. Try a static call (simulation, no real tx) to get a real error
  console.log("\n=== Attempting static call simulation ===");
  try {
    await vault.mint.staticCall(BASKET_ID, amount);
    console.log("Static call succeeded (unexpected, given the real tx failed) -- this is odd, worth investigating separately.");
  } catch (err: any) {
    console.log("Static call failed. Full error object:");
    console.log(JSON.stringify(err, Object.getOwnPropertyNames(err), 2));
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
