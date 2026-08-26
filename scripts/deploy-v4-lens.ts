import { network } from "hardhat";

const V4_POOL_MANAGER = "0x8366a39cc670b4001a1121b8f6a443a643e40951";

async function main() {
  const { ethers } = await network.connect({ network: "robinhoodMainnet" });
  const [deployer] = await ethers.getSigners();

  console.log("Deploying V4PoolLens with account:", deployer.address);
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Balance:", ethers.formatEther(balance), "ETH");

  const V4PoolLens = await ethers.getContractFactory("V4PoolLens");
  const lens = await V4PoolLens.deploy(V4_POOL_MANAGER);
  await lens.waitForDeployment();

  console.log("\nV4PoolLens deployed:", await lens.getAddress());
  console.log("\nCopy this address into LENS_ADDRESS in resolve-real-pools.ts");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
