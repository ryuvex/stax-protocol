import { network } from "hardhat";
import * as fs from "fs";

const V4_POOL_MANAGER = "0x8366a39cc670b4001a1121b8f6a443a643e40951";
const UNIVERSAL_ROUTER = "0x8876789976dEcBfCbBbe364623C63652db8C0904";

// SPCX's real, resolved pool from last night's work -- highest liquidity
// of all 21 tickers, and it uses the widely-shared hook
// (0x4e3468951D49f2EEa976eD0D6e75fFCb44a9a544) that covers most of our
// real ticker pools. If we find a real swap here, it directly answers
// the hookData question for the majority of your basket.
const SPCX_POOL_ID = "0x4b8b7245a1fef2708efcca1aededaea533c2d29da9925c9e0e1bed143be6692e";

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

  console.log(`Searching for a real swap on OUR resolved SPCX pool`);
  console.log(`(poolId: ${SPCX_POOL_ID}, uses the widely-shared hook)`);
  console.log(`Scanning backward from block ${currentBlock}, ANY sender first...\n`);

  let found = false;
  let chunksChecked = 0;

  // First pass: ANY swap on this pool, regardless of sender -- widest net,
  // most likely to find something given this pool's high liquidity.
  for (let toBlock = currentBlock; toBlock >= 0 && !found; toBlock -= CHUNK_SIZE) {
    const fromBlock = Math.max(0, toBlock - CHUNK_SIZE + 1);
    chunksChecked++;

    try {
      const events = await withTimeout(
        poolManager.queryFilter(poolManager.filters.Swap(SPCX_POOL_ID), fromBlock, toBlock),
        CHUNK_TIMEOUT_MS
      );

      if (events.length > 0) {
        const event = events[events.length - 1];
        const args = (event as any).args;
        console.log(`Found a real swap on our SPCX pool at block ${event.blockNumber}!`);
        console.log(`Transaction hash: ${event.transactionHash}`);
        console.log(`Sender (who called PoolManager -- may be router or something else): ${args.sender}`);
        console.log(`Sender matches our confirmed Universal Router?: ${args.sender.toLowerCase() === UNIVERSAL_ROUTER.toLowerCase()}\n`);

        const output = {
          transactionHash: event.transactionHash,
          blockNumber: event.blockNumber,
          sender: args.sender,
          senderIsConfirmedRouter: args.sender.toLowerCase() === UNIVERSAL_ROUTER.toLowerCase(),
        };
        fs.writeFileSync("spcx-swap-example.json", JSON.stringify(output, null, 2), "utf-8");
        console.log("Details saved to spcx-swap-example.json");
        console.log("\nNext step: fetch this transaction's raw trace the same way as before,");
        console.log("to see the real calldata for a swap on a hook-using pool.");

        found = true;
      }
    } catch (err: any) {
      // Skip failed chunks silently
    }

    if (chunksChecked % 20 === 0) {
      process.stdout.write(`\r  Checked ${chunksChecked} chunks, currently at block ${toBlock}...   `);
    }
  }

  if (!found) {
    console.log("\nNo swaps found on this specific pool in the scanned history.");
    console.log("Despite high liquidity, real trade frequency may still be low --");
    console.log("worth trying a different hook-using ticker's pool if this comes up empty.");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
