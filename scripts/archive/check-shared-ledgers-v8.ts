import { network } from "hardhat";

const VAULT_ADDRESS = "0xD06F68a482cE2ab891E01dB5D9bE24b92b06aBbd";
const NVDA_ADDRESS = "0x0590161bbf83e7b8B59Fb4F05aa5a8cC657c14E4"; // token, not the feed
const TSM_ADDRESS = "0x2f830e8D44c38ac8b1d83f4712fdE7AC3D874206";  // token, not the feed

async function main() {
  const { ethers } = await network.connect();
  const vault = await ethers.getContractAt("StaxVault", VAULT_ADDRESS);
  const nvda = await ethers.getContractAt("MockERC20", NVDA_ADDRESS);
  const tsm = await ethers.getContractAt("MockERC20", TSM_ADDRESS);

  console.log("=== NVDA (shared: AI Infrastructure [1] + Mag 7 [2]) ===");
  const aiInfraNvda = await vault.basketTickerHoldings(1, NVDA_ADDRESS);
  const mag7Nvda = await vault.basketTickerHoldings(2, NVDA_ADDRESS);
  const realNvdaBalance = await nvda.balanceOf(VAULT_ADDRESS);

  console.log("  AI Infrastructure's ledger:", ethers.formatUnits(aiInfraNvda, 18));
  console.log("  Mag 7's ledger:            ", ethers.formatUnits(mag7Nvda, 18));
  console.log("  Sum of both ledgers:       ", ethers.formatUnits(aiInfraNvda + mag7Nvda, 18));
  console.log("  Real pooled balanceOf:     ", ethers.formatUnits(realNvdaBalance, 18));
  console.log("  Solvent (sum <= real)?     ", aiInfraNvda + mag7Nvda <= realNvdaBalance);
  console.log("");

  console.log("=== TSM (shared: AI Infrastructure [1] + Broad Semiconductors [6]) ===");
  const aiInfraTsm = await vault.basketTickerHoldings(1, TSM_ADDRESS);
  const semisTsm = await vault.basketTickerHoldings(6, TSM_ADDRESS);
  const realTsmBalance = await tsm.balanceOf(VAULT_ADDRESS);

  console.log("  AI Infrastructure's ledger:", ethers.formatUnits(aiInfraTsm, 18));
  console.log("  Broad Semis' ledger:       ", ethers.formatUnits(semisTsm, 18));
  console.log("  Sum of both ledgers:       ", ethers.formatUnits(aiInfraTsm + semisTsm, 18));
  console.log("  Real pooled balanceOf:     ", ethers.formatUnits(realTsmBalance, 18));
  console.log("  Solvent (sum <= real)?     ", aiInfraTsm + semisTsm <= realTsmBalance);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
