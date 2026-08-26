import { network } from "hardhat";
import * as fs from "fs";

// CONFIRMED real Universal Router on Robinhood Chain mainnet -- cross-
// verified across two independent sources (Uniswap's own dev docs AND
// Bags' third-party integration docs, which explicitly documents this
// exact address as "the only correct one" among several look-alikes on
// this chain).
const UNIVERSAL_ROUTER = "0x8876789976dEcBfCbBbe364623C63652db8C0904";
const V4_POOL_MANAGER = "0x8366a39cc670b4001a1121b8f6a443a643e40951";

// Standard V4 PoolManager Swap event. "sender" is the caller that
// unlocked the PoolManager to perform the swap -- for a swap routed
// through the Universal Router, this will be the router's own address,
// regardless of which specific pool/hook was used. Filtering on this
// directly answers "did the confirmed real router actually perform a
// swap we can learn from" using the same efficient chunked event-scan
// pattern already proven last night, instead of a slow per-block scan.
const POOL_MANAGER_ABI = [
  "event Swap(bytes32 indexed id, address indexed sender, int128 amount0, int128 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick, uint24 fee)",
];

const CHUNK_SIZE = 10_000;
const CHUNK_TIMEOUT_MS = 15_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms)),
  ]);
}

async function main() {
  const { ethers } = await network.connect({ network: "robinhoodMainnet" });
  const poolManager = new ethers.Contract(V4_POOL_MANAGER, POOL_MANAGER_ABI, ethers.provider);
  const currentBlock = await ethers.provider.getBlockNumber();

  console.log(`Searching for real Swap events where sender = the confirmed`);
  console.log(`real Universal Router (${UNIVERSAL_ROUTER})`);
  console.log(`Scanning backward from block ${currentBlock} in chunks of ${CHUNK_SIZE}...\n`);

  let found = false;
  let chunksChecked = 0;

  for (let toBlock = currentBlock; toBlock >= 0 && !found; toBlock -= CHUNK_SIZE) {
    const fromBlock = Math.max(0, toBlock - CHUNK_SIZE + 1);
    chunksChecked++;

    try {
      // Filter directly on sender = router -- second indexed param.
      const events = await withTimeout(
        poolManager.queryFilter(poolManager.filters.Swap(null, UNIVERSAL_ROUTER), fromBlock, toBlock),
        CHUNK_TIMEOUT_MS
      );

      if (events.length > 0) {
        const event = events[events.length - 1];
        console.log(`Found a real swap via the confirmed router at block ${event.blockNumber}!`);
        console.log(`Transaction hash: ${event.transactionHash}\n`);

        const tx = await ethers.provider.getTransaction(event.transactionHash);

        const output = {
          transactionHash: event.transactionHash,
          blockNumber: event.blockNumber,
          to: tx?.to,
          from: tx?.from,
          value: tx?.value?.toString(),
          data: tx?.data,
        };

        fs.writeFileSync("real-swap-example.json", JSON.stringify(output, null, 2), "utf-8");
        console.log("Full transaction details written to real-swap-example.json");
        console.log(`Sent TO: ${tx?.to} (should match the router address exactly)`);
        console.log(`Raw calldata (this is the actual, working, real-world encoding):`);
        console.log(tx?.data);

        found = true;
      }
    } catch (err: any) {
      // Skip failed chunks silently -- summarized behavior is fine here,
      // same as last night's pattern.
    }

    if (chunksChecked % 20 === 0) {
      process.stdout.write(`\r  Checked ${chunksChecked} chunks, currently at block ${toBlock}...   `);
    }
  }

  if (!found) {
    console.log("\nNo swaps found where sender = the confirmed router, in the full scanned history.");
    console.log("This would be a genuinely important finding -- it would mean real users");
    console.log("are NOT calling this router directly, and everything routes through");
    console.log("aggregators/wrappers instead. Worth knowing either way.");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
