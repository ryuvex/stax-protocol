import { network } from "hardhat";

function feedPrice(dollars: bigint, decimals = 8): bigint {
  return dollars * 10n ** BigInt(decimals);
}

// IONQ oracle from the v11 deploy. Currently $30 -- bumping to $60 (2x).
// IONQ is 50% weight in Quantum Computing (id 4), so the basket's price
// should rise ~50% (2x on half the basket = +50% overall), giving a
// clean, calculable expected gain to verify Realized P&L against after
// a full redeem: expect roughly +$29.93 (50% of the $59.85 cost basis).
const IONQ_ORACLE_ADDRESS = "0xfd373F9196A4559CcC87f80fBc78A8D4ad625e8d";
const NEW_PRICE_DOLLARS = 60n;

async function main() {
  const { ethers } = await network.connect();
  const oracle = await ethers.getContractAt("MockPriceOracle", IONQ_ORACLE_ADDRESS);

  const tx = await oracle.setPrice(feedPrice(NEW_PRICE_DOLLARS));
  await tx.wait();

  console.log(`IONQ oracle price set to $${NEW_PRICE_DOLLARS} (was $30).`);
  console.log("");
  console.log("Now redeem your full Quantum Computing balance through the UI.");
  console.log("Expected: Quantum Computing's price should show ~50% higher than");
  console.log("when you minted, and after redeeming, Portfolio's Realized P&L");
  console.log("should show a real gain around +$29.93 (50% of your $59.85 cost basis).");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
