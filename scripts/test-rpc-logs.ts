import { network } from "hardhat";

const V4_POOL_MANAGER = "0x8366a39cc670b4001a1121b8f6a443a643e40951";

const POOL_MANAGER_ABI = [
  "event Initialize(bytes32 indexed id, address indexed currency0, address indexed currency1, uint24 fee, int24 tickSpacing, address hooks, uint160 sqrtPriceX96, int24 tick)",
];

async function main() {
  const { ethers } = await network.connect({ network: "robinhoodMainnet" });
  const poolManager = new ethers.Contract(V4_POOL_MANAGER, POOL_MANAGER_ABI, ethers.provider);

  const currentBlock = await ethers.provider.getBlockNumber();
  const fromBlock = currentBlock - 10_000;

  console.log(`Quick test: querying just blocks ${fromBlock} to ${currentBlock} (10,000 blocks)...`);
  console.log("This should complete in seconds if the RPC handles eth_getLogs normally.\n");

  const start = Date.now();
  const events = await poolManager.queryFilter(poolManager.filters.Initialize(), fromBlock, currentBlock);
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);

  console.log(`Done in ${elapsed}s. Found ${events.length} Initialize events in this small range.`);
}

main().catch((error) => {
  console.error("FAILED:", error.message ?? error);
  process.exitCode = 1;
});
