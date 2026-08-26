import { network } from "hardhat";

async function main() {
  const { ethers } = await network.connect({ network: "robinhoodMainnet" });
  const [deployer] = await ethers.getSigners();

  console.log("Mainnet deployer address:", deployer.address);
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Mainnet balance:", ethers.formatEther(balance), "ETH");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
