import { network } from "hardhat";

function feedPrice(dollars: bigint, decimals = 8): bigint {
  return dollars * 10n ** BigInt(decimals);
}

// NVDA oracle from the v8 deploy. Currently set to $150 -- bumping to
// $300 (2x) so the price move is obvious and easy to eyeball on the
// frontend. NVDA is shared between AI Infrastructure (40% weight) and
// Mag 7 (14.3% weight), so both baskets' prices should move, but by
// different amounts proportional to their NVDA weight -- itself a good
// live confirmation that the shared-ticker ledger fix is working
// correctly (each basket's price reflects only its own NVDA exposure).
const NVDA_ORACLE_ADDRESS = "0xB59916De27223D658bc929360A261Bbbed5F4BB1";
const NEW_PRICE_DOLLARS = 300n;

async function main() {
  const { ethers } = await network.connect();
  const oracle = await ethers.getContractAt("MockPriceOracle", NVDA_ORACLE_ADDRESS);

  const tx = await oracle.setPrice(feedPrice(NEW_PRICE_DOLLARS));
  await tx.wait();

  console.log(`NVDA oracle price set to $${NEW_PRICE_DOLLARS} (was $150).`);
  console.log("");
  console.log("Refresh the frontend now -- AI Infrastructure (40% NVDA weight)");
  console.log("and Mag 7 (14.3% NVDA weight) should both show a higher token");
  console.log("price than before, with AI Infrastructure moving proportionally");
  console.log("more since it holds a larger NVDA weight.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
