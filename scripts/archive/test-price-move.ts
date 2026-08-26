import { network } from "hardhat";

// NVDA is in AI Infrastructure (40% weight) and Mag 7 (14.3% weight) --
// bump its price 20% to create a clear, predictable P&L move for anyone
// holding either of those baskets.
const NVDA_ORACLE = "0x1E36a65473De361C638fD33F97B41AFF6B90954B";
const NEW_PRICE_DOLLARS = 180n; // was $150, now $150 * 1.20 = $180

function feedPrice(dollars: bigint, decimals = 8): bigint {
  return dollars * 10n ** BigInt(decimals);
}

async function main() {
  const { ethers } = await network.connect();
  const oracle = await ethers.getContractAt("MockPriceOracle", NVDA_ORACLE);

  const tx = await oracle.setPrice(feedPrice(NEW_PRICE_DOLLARS));
  await tx.wait();

  console.log(`NVDA price moved to $${NEW_PRICE_DOLLARS} (was $150, +20%)`);
  console.log("Refresh the portfolio page now -- if you hold AI Infrastructure or Mag 7,");
  console.log("your P&L should now show a real, positive move.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
