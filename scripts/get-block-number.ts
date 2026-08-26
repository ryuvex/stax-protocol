import { network } from "hardhat";

async function main() {
  const { ethers } = await network.connect();
  const blockNumber = await ethers.provider.getBlockNumber();
  console.log("Current block number:", blockNumber);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
