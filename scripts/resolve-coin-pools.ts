import { network } from "hardhat";

// ============================================================================
// TARGETED RETEST: COIN against two specific pools Dan found in his manual
// sheet -- a USDG-paired v4 pool and a SPY-paired v4 pool, distinct from
// whatever pool was registered when v7's IsolateRedeemFailureTest killed
// COIN.
//
// V4 has no per-pool contract address -- what's in the sheet as "pool
// address" is actually the poolId (keccak256 hash of the PoolKey). This
// script resolves each poolId to its real PoolKey (currency0, currency1,
// fee, tickSpacing, hooks) by querying the PoolManager's own Initialize
// event directly, filtered on topics[1] = poolId -- targeted and cheap,
// no full-registry rescan needed.
// ============================================================================

const POOL_MANAGER = "0x8366a39CC670B4001A1121B8F6A443A643e40951";
const USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
const COIN = "0x6330D8C3178a418788dF01a47479c0ce7CCF450b";

const TARGET_POOL_IDS = [
  { label: "COIN/USDG (new, from sheet)", id: "0x007a13fa152f6dc383cad20a8eaab4e1e2538b606936eae2a424f8aa47d6db31" },
  { label: "COIN/SPY (from sheet)", id: "0x982af6ff6a2169c91a78634d3d10b3e1fe1e6a7e76387de04167234a41d50e4c" },
];

const INITIALIZE_TOPIC_SIG =
  "Initialize(bytes32,address,address,uint24,int24,address,uint160,int24)";

async function main() {
  const { ethers } = await network.connect({ network: "robinhoodMainnet" });

  const initTopic = ethers.id(INITIALIZE_TOPIC_SIG);
  const latestBlock = await ethers.provider.getBlockNumber();
  console.log(`Latest block: ${latestBlock}\n`);

  for (const target of TARGET_POOL_IDS) {
    console.log(`=== Resolving ${target.label} ===`);
    console.log(`  poolId: ${target.id}`);

    // Targeted: filter directly on topics[1] = this exact poolId.
    // Still chunk in case the RPC caps range size for filtered queries.
    let chunk = 2_000_000;
    let from = 0;
    let log: any = null;

    while (from <= latestBlock && !log) {
      const to = Math.min(from + chunk - 1, latestBlock);
      try {
        const logs = await ethers.provider.getLogs({
          address: POOL_MANAGER,
          topics: [initTopic, target.id],
          fromBlock: from,
          toBlock: to,
        });
        if (logs.length > 0) {
          log = logs[0];
          break;
        }
        from = to + 1;
      } catch (err: any) {
        if (chunk <= 50_000) throw err;
        chunk = Math.floor(chunk / 2);
      }
    }

    if (!log) {
      console.log(`  NOT FOUND -- this poolId has never been initialized on the real PoolManager.\n`);
      continue;
    }

    const currency0 = ethers.getAddress("0x" + log.topics[2].slice(26));
    const currency1 = ethers.getAddress("0x" + log.topics[3].slice(26));
    const [fee, tickSpacing, hooks] = ethers.AbiCoder.defaultAbiCoder().decode(
      ["uint24", "int24", "address", "uint160", "int24"],
      log.data
    );

    console.log(`  currency0: ${currency0}`);
    console.log(`  currency1: ${currency1}`);
    console.log(`  fee: ${fee} (${Number(fee) / 10000}%)`);
    console.log(`  tickSpacing: ${tickSpacing}`);
    console.log(`  hooks: ${hooks}`);
    console.log(`  block: ${log.blockNumber}`);

    const isStandardFee = [100, 500, 3000, 10000].includes(Number(fee));
    const isDecoy =
      (Number(fee) === 880000 && Number(tickSpacing) === 17600) ||
      (Number(fee) === 30000 && Number(tickSpacing) === 600);
    const hasHook = hooks !== ethers.ZeroAddress;

    if (isDecoy) console.log(`  VERDICT: DEAD (decoy fingerprint)`);
    else if (!isStandardFee) console.log(`  VERDICT: SUSPECT (non-standard fee)`);
    else if (hasHook) console.log(`  VERDICT: SUSPECT (hooked)`);
    else console.log(`  VERDICT: clean fee/hook profile -- proceeding to isolated fork test`);

    console.log("");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
