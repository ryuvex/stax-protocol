import { network } from "hardhat";

async function main() {
  const { ethers } = await network.connect({ network: "robinhoodMainnet" });
  const blockNumber = await ethers.provider.getBlockNumber();
  console.log("Current MAINNET block number:", blockNumber);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
