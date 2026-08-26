import { network } from "hardhat";

async function main() {
  const { ethers } = await network.connect();
  const vaultAddress = "0xC10Ef76b35cB7ae4a68226E3b82F58B1cf4c32f4"; // v15

  const vault = await ethers.getContractAt("StaxVault", vaultAddress);

  console.log("teamWallet:          ", await vault.teamWallet());
  console.log("staxToken:           ", await vault.staxToken());
  console.log("universalRouter:     ", await vault.universalRouter());
  console.log("permit2:             ", await vault.permit2());
  console.log("weth:                ", await vault.weth());
  console.log("ethUsdFeed:          ", await vault.ethUsdFeed());
  console.log("ethUsdMaxStaleness:  ", await vault.ethUsdMaxStaleness());
  console.log("sequencerUptimeFeed: ", await vault.sequencerUptimeFeed());
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});