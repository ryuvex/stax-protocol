import { network } from "hardhat";

// ============================================================================
// RESOLVE PLTR'S REAL POOL -- settles a real discrepancy found tonight:
// the Phase1 discovery script's compiled candidate list had one PLTR
// token address; the manual liquidity sheet (tied to a real, confirmed
// $100k pool) has a different one. Rather than guess which is right,
// pull the real Initialize event for the sheet's poolId directly -- the
// event itself contains the authoritative on-chain currency addresses,
// no ambiguity possible. Same technique as the COIN pool resolution
// earlier tonight.
// ============================================================================

const POOL_MANAGER = "0x8366a39CC670B4001A1121B8F6A443A643e40951";

const PLTR_POOL_ID = "0xee430ee1003e1985e1828a01b9a20dad67ad4302994fe2abb4a173de4ac54623";

const INITIALIZE_TOPIC_SIG =
  "Initialize(bytes32,address,address,uint24,int24,address,uint160,int24)";

async function main() {
  const { ethers } = await network.connect({ network: "robinhoodMainnet" });

  const initTopic = ethers.id(INITIALIZE_TOPIC_SIG);
  const latestBlock = await ethers.provider.getBlockNumber();
  console.log(`Latest block: ${latestBlock}\n`);

  console.log(`=== Resolving PLTR/USDG V4 pool ===`);
  console.log(`  poolId: ${PLTR_POOL_ID}`);

  let chunk = 2_000_000;
  let from = 0;
  let log: any = null;

  while (from <= latestBlock && !log) {
    const to = Math.min(from + chunk - 1, latestBlock);
    try {
      const logs = await ethers.provider.getLogs({
        address: POOL_MANAGER,
        topics: [initTopic, PLTR_POOL_ID],
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
    console.log(`  NOT FOUND -- this poolId has never been initialized on the real PoolManager.`);
    return;
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

  const USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
  const realPltrAddress = currency0.toLowerCase() === USDG.toLowerCase() ? currency1 : currency0;

  console.log(`\n  REAL PLTR token address (resolved from the actual pool): ${realPltrAddress}`);
  console.log(`  Compare against:`);
  console.log(`    - Phase1 candidate list had: 0xa249baF1063aF884807C1e1400aEF7784836917E`);
  console.log(`    - Manual sheet's ca column had: 0x894E1EC2D74FFE5AEF8Dc8A9e84686acCB964F2A`);

  const isStandardFee = [100, 500, 3000, 10000].includes(Number(fee));
  const isDecoy =
    (Number(fee) === 880000 && Number(tickSpacing) === 17600) ||
    (Number(fee) === 30000 && Number(tickSpacing) === 600);
  const hasHook = hooks !== ethers.ZeroAddress;

  if (isDecoy) console.log(`\n  VERDICT: DEAD (decoy fingerprint)`);
  else if (!isStandardFee) console.log(`\n  VERDICT: SUSPECT (non-standard fee)`);
  else if (hasHook) console.log(`\n  VERDICT: SUSPECT (hooked)`);
  else console.log(`\n  VERDICT: clean fee/hook profile -- ready for round-trip test`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});