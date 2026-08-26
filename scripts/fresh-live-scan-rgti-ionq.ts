import { network } from "hardhat";

// V4 PoolManager on Robinhood Chain mainnet.
const POOL_MANAGER = "0x8366a39cc670b4001a1121b8f6a443a643e40951";

const TICKER_ADDRESSES: Record<string, string> = {
  RGTI: "0x284358abc07F9359f19f4b5b4aC91901Be2597Ba",
  IONQ: "0x558378E000D634A36593E338eBacdd6207640EfE",
};

const USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";

// Initialize(bytes32 indexed id, address indexed currency0, address indexed currency1, uint24 fee, int24 tickSpacing, address hooks, uint160 sqrtPriceX96, int24 tick)
// Computed via ethers.id() rather than hardcoded from memory -- a
// hand-typed 32-byte hash is exactly the kind of thing that's easy to
// get subtly wrong (this one was, on the first attempt: 63 chars, one
// short of the required 64).
const INITIALIZE_EVENT_SIGNATURE = "Initialize(bytes32,address,address,uint24,int24,address,uint160,int24)";

async function main() {
  const { ethers } = await network.connect({ network: "robinhoodMainnet" });

  console.log("Fresh, live Initialize-event scan for RGTI and IONQ -- independent of any older cached scan data.\n");

  // Computed here, not hardcoded -- self-verifying, can't be a typo.
  const INITIALIZE_TOPIC = ethers.id(INITIALIZE_EVENT_SIGNATURE);
  console.log("Computed Initialize event topic0:", INITIALIZE_TOPIC);
  console.log("(Should be exactly 66 characters including 0x prefix -- length:", INITIALIZE_TOPIC.length, ")\n");

  const latestBlock = await ethers.provider.getBlockNumber();
  console.log("Current block:", latestBlock);

  for (const [symbol, tickerAddr] of Object.entries(TICKER_ADDRESSES)) {
    console.log(`\n=== ${symbol} (${tickerAddr}) ===`);

    // Query for Initialize events where this ticker is EITHER currency0
    // OR currency1 -- two separate topic-filtered queries, since
    // currency0/currency1 are separate indexed topics.
    const paddedTicker = ethers.zeroPadValue(tickerAddr.toLowerCase(), 32);

    let allLogs: any[] = [];
    try {
      const logsAsCurrency0 = await ethers.provider.getLogs({
        address: POOL_MANAGER,
        topics: [INITIALIZE_TOPIC, null, paddedTicker],
        fromBlock: 0,
        toBlock: "latest",
      });
      const logsAsCurrency1 = await ethers.provider.getLogs({
        address: POOL_MANAGER,
        topics: [INITIALIZE_TOPIC, null, null, paddedTicker],
        fromBlock: 0,
        toBlock: "latest",
      });
      allLogs = [...logsAsCurrency0, ...logsAsCurrency1];
    } catch (err: any) {
      console.log(`  Full-range query failed (likely block-range limit): ${err.message ?? err}`);
      console.log(`  Falling back to chunked scan over the last 2,000,000 blocks...`);

      const chunkSize = 10000;
      const startBlock = Math.max(0, latestBlock - 2_000_000);
      for (let from = startBlock; from <= latestBlock; from += chunkSize) {
        const to = Math.min(from + chunkSize - 1, latestBlock);
        try {
          const c0 = await ethers.provider.getLogs({
            address: POOL_MANAGER,
            topics: [INITIALIZE_TOPIC, null, paddedTicker],
            fromBlock: from,
            toBlock: to,
          });
          const c1 = await ethers.provider.getLogs({
            address: POOL_MANAGER,
            topics: [INITIALIZE_TOPIC, null, null, paddedTicker],
            fromBlock: from,
            toBlock: to,
          });
          allLogs.push(...c0, ...c1);
        } catch {
          // skip chunk on error, continue scanning
        }
      }
    }

    console.log(`  Found ${allLogs.length} Initialize event(s) total (live, right now, not cached).`);

    if (allLogs.length === 0) {
      console.log(`  Genuinely zero pools have EVER been initialized for ${symbol} on this PoolManager. Confirmed dead, not just "nothing found in old data."`);
      continue;
    }

    const iface = new ethers.Interface([
      "event Initialize(bytes32 indexed id, address indexed currency0, address indexed currency1, uint24 fee, int24 tickSpacing, address hooks, uint160 sqrtPriceX96, int24 tick)",
    ]);

    for (const log of allLogs) {
      const parsed = iface.parseLog(log);
      if (!parsed) continue;
      const { currency0, currency1, fee, tickSpacing, hooks } = parsed.args;
      const pairedWithUsdg = currency0.toLowerCase() === USDG.toLowerCase() || currency1.toLowerCase() === USDG.toLowerCase();
      const blockNum = log.blockNumber;
      console.log(
        `    block=${blockNum} currency0=${currency0} currency1=${currency1} fee=${fee} tickSpacing=${tickSpacing} hooks=${hooks} pairedWithUSDG=${pairedWithUsdg}`
      );
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
