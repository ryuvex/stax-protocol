import { network } from "hardhat";

// ============================================================================
// PHASE 1 POOL DISCOVERY -- all 31 new candidate tickers, one sweep.
//
// Self-contained: scans the real PoolManager's Initialize events directly
// (both currencies are indexed in V4, so we filter server-side for pools
// where one side is USDG), then reads real liquidity via the already-
// deployed V4PoolLens. No dependency on the old raw-scan-file pipeline.
//
// Token addresses: pulled from the live Robinhood Chain registry
// (robinscan.io/stocks + docs.robinhood.com/chain/contracts), Aug 24 2026.
// These are REGISTRY addresses, not yet verified as tradeable -- that is
// exactly what this script determines.
//
// Classification rules (from the v6/v7 sessions):
//   - Decoy fingerprints (auto-dead): fee=880000/tickSpacing=17600,
//     fee=30000/tickSpacing=600
//   - Non-standard fee tier (flag for manual review; historically fatal:
//     TSM 400000 = 40%, MSTR 50000 = 5%): anything not in {100,500,3000,10000}
//   - Hooked pools: flagged, not auto-dead (LaunchHook precedent: vet or drop)
//   - liquidity == 0: dead (initialized-but-never-funded slots, the
//     IONQ/RGTI pattern)
//
// Output: ranked table per ticker + a machine-readable JSON block at the
// end for the next stage (fork sweep test generation).
// ============================================================================

const POOL_MANAGER = "0x8366a39CC670B4001A1121B8F6A443A643e40951";
const USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
const LENS_ADDRESS = "0xa5fd118AF173BF852950D504c5035Dd4A461a87D";

// Registry addresses (lowercase from source; normalized at runtime).
const CANDIDATES: Record<string, string> = {
  // --- Broad Semiconductors revival (13) ---
  AVGO: "0x156e175dd063a8ce274c50654ef40e0032b3fbcf",
  LRCX: "0x57b0030166db0c31690d1a5aa167e2e26e2c29a4",
  KLAC: "0x96b933c74ecb4a0926b9210cef7b743ef46be2e9",
  AMAT: "0x36046893810a7e7fce501229d57dc3fc8c8716d0",
  QCOM: "0x0f17206447090e464c277571124dd2688e48aea9",
  ON: "0xbbd09f72b025360fee5c928053dca6248d35be54",
  TER: "0x2778c5024d5ca2cdb0f8ead671ffc69963adcd9c",
  MPWR: "0x52d50d0280ad1054b43f052bd70a49a212a1b128",
  MTSI: "0xc93f4d80e268ab922e871bd169156c3cc41894e6",
  ALAB: "0x748c32c3ca24edf31ea597db1f3d330a7a6da3dc",
  AMKR: "0xdd356aa38f40a7b7076755ac854b6fbb1f0d305b",
  MXL: "0x48961813349333209994750ffa89b3c5c22ec969",
  TSEM: "0x89776d4cd68193597a2fc132cfac1fde36ccea8a",
  // --- AI Infrastructure rebuild (only ANET is new vs. the semi list) ---
  ANET: "0x28babd556b60e53663b8615036479a29c2cdd1bf",
  // --- Enterprise Software (17) ---
  ADBE: "0x232b8ed6377be97813853b0ac104c4cda8378d1b",
  CRM: "0xd95b44124e475743a7589e68f3d74008a5536d44",
  CRWD: "0xea72ecca2d0f6bfa1394dbbcff85b52cd4233931",
  DDOG: "0x27c99fbde9d0d2aa4f4bfb4943f237843ddf6958",
  NOW: "0x0c3260af4b8f13a69c4c2dfb84fd667890cdfa14",
  SNOW: "0xba0cab75495255d0cb58e22b648bfed4ecd1f47e",
  PANW: "0xb039597ed45cba7b6e2fb9e8be51802969cee5be",
  WDAY: "0x82da4646242e1d962e96e932269dc644c94a9caa",
  ZS: "0x7dc013eb55e436f30d7ed1afe4e36d6e45e3c3f7",
  ZM: "0x44c4f142009036cf477ed2d09932051843137cf1",
  NET: "0x116f00968269b7bfbad4109ce591d6e74c0601d4",
  MDB: "0xddf2266b79abf0b48898959b0ed6e6adf512be74",
  TEAM: "0x5b97476b922f3305131b8f0b9d333172e87f4aae",
  INTU: "0x56d23bee5f41a7120170b0c603dae30128e460e9",
  APP: "0xa249baf1063af884807c1e1400aef7784836917e",
  PATH: "0xfb2664f07b6aadd29ea7a59d8859b1aeb8645cda",
  FTNT: "0x3fb8976980d486084b2eb4a404bd12e72823958f",
};

const STANDARD_FEES = new Set([100, 500, 3000, 10000]);
const DECOYS = [
  { fee: 880000, tickSpacing: 17600 },
  { fee: 30000, tickSpacing: 600 },
];

// Initialize(PoolId indexed id, Currency indexed currency0,
//            Currency indexed currency1, uint24 fee, int24 tickSpacing,
//            address hooks, uint160 sqrtPriceX96, int24 tick)
const INITIALIZE_TOPIC_SIG =
  "Initialize(bytes32,address,address,uint24,int24,address,uint160,int24)";

interface FoundPool {
  ticker: string;
  poolId: string;
  currency0: string;
  currency1: string;
  fee: number;
  tickSpacing: number;
  hooks: string;
  liquidity: bigint;
  verdict: string;
}

async function main() {
  const { ethers } = await network.connect({ network: "robinhoodMainnet" });

  const tickerByAddress = new Map<string, string>();
  for (const [sym, addr] of Object.entries(CANDIDATES)) {
    tickerByAddress.set(ethers.getAddress(addr).toLowerCase(), sym);
  }

  const initTopic = ethers.id(INITIALIZE_TOPIC_SIG);
  const usdgTopic = ethers.zeroPadValue(USDG, 32);

  const latestBlock = await ethers.provider.getBlockNumber();
  console.log(`Latest block: ${latestBlock}`);
  console.log(`Scanning PoolManager Initialize events (USDG on either side)...\n`);

  // Chunked scan; halves chunk size on RPC range errors.
  let chunk = 500_000;
  const rawLogs: any[] = [];
  let from = 0;
  while (from <= latestBlock) {
    const to = Math.min(from + chunk - 1, latestBlock);
    try {
      // USDG as currency0 and as currency1 -- two filtered queries.
      const [asC0, asC1] = await Promise.all([
        ethers.provider.getLogs({
          address: POOL_MANAGER,
          topics: [initTopic, null, usdgTopic, null],
          fromBlock: from,
          toBlock: to,
        }),
        ethers.provider.getLogs({
          address: POOL_MANAGER,
          topics: [initTopic, null, null, usdgTopic],
          fromBlock: from,
          toBlock: to,
        }),
      ]);
      rawLogs.push(...asC0, ...asC1);
      process.stdout.write(
        `\r  scanned to block ${to} (${rawLogs.length} USDG-paired pools so far)   `
      );
      from = to + 1;
    } catch (err: any) {
      if (chunk <= 10_000) throw err;
      chunk = Math.floor(chunk / 2);
      console.log(`\n  RPC range error -- reducing chunk to ${chunk}`);
    }
  }
  console.log(`\n\nTotal USDG-paired Initialize events: ${rawLogs.length}\n`);

  // Decode and keep only pools whose other side is one of our candidates.
  const abiCoder = ethers.AbiCoder.defaultAbiCoder();
  const found: FoundPool[] = [];
  const seenPoolIds = new Set<string>();

  for (const log of rawLogs) {
    const poolId = log.topics[1];
    if (seenPoolIds.has(poolId)) continue;
    seenPoolIds.add(poolId);

    const currency0 = ethers.getAddress("0x" + log.topics[2].slice(26));
    const currency1 = ethers.getAddress("0x" + log.topics[3].slice(26));
    const [fee, tickSpacing, hooks] = abiCoder.decode(
      ["uint24", "int24", "address", "uint160", "int24"],
      log.data
    );

    const other =
      currency0.toLowerCase() === USDG.toLowerCase() ? currency1 : currency0;
    const ticker = tickerByAddress.get(other.toLowerCase());
    if (!ticker) continue;

    found.push({
      ticker,
      poolId,
      currency0,
      currency1,
      fee: Number(fee),
      tickSpacing: Number(tickSpacing),
      hooks,
      liquidity: 0n, // filled below
      verdict: "",
    });
  }

  console.log(`Candidate-matching USDG pools: ${found.length}\n`);

  // Read real liquidity via the lens, batched.
  const lens = new ethers.Contract(
    LENS_ADDRESS,
    ["function getLiquidityBatch(bytes32[] calldata poolIds) external view returns (uint128[] memory)"],
    ethers.provider
  );
  const BATCH = 50;
  for (let i = 0; i < found.length; i += BATCH) {
    const slice = found.slice(i, i + BATCH);
    const liqs: bigint[] = await lens.getLiquidityBatch(slice.map((p) => p.poolId));
    slice.forEach((p, j) => (p.liquidity = liqs[j]));
  }

  // Classify.
  for (const p of found) {
    const isDecoy = DECOYS.some(
      (d) => d.fee === p.fee && d.tickSpacing === p.tickSpacing
    );
    const hasHook = p.hooks !== ethers.ZeroAddress;
    if (isDecoy) p.verdict = "DEAD (decoy fingerprint)";
    else if (p.liquidity === 0n) p.verdict = "DEAD (zero liquidity)";
    else if (!STANDARD_FEES.has(p.fee))
      p.verdict = `SUSPECT (non-standard fee ${p.fee} = ${p.fee / 10000}%)`;
    else if (hasHook) p.verdict = `SUSPECT (hooked: ${p.hooks})`;
    else p.verdict = "ALIVE";
  }

  // Report, grouped per ticker, best-liquidity first.
  console.log("=== PER-TICKER RESULTS (ranked by liquidity) ===\n");
  const survivors: FoundPool[] = [];
  for (const sym of Object.keys(CANDIDATES)) {
    const pools = found
      .filter((p) => p.ticker === sym)
      .sort((a, b) => (b.liquidity > a.liquidity ? 1 : b.liquidity < a.liquidity ? -1 : 0));
    if (pools.length === 0) {
      console.log(`  ${sym.padEnd(5)} -- NO USDG-PAIRED POOL AT ALL -> DEAD`);
      continue;
    }
    for (const p of pools) {
      console.log(
        `  ${sym.padEnd(5)} fee=${String(p.fee).padStart(6)} tickSpacing=${String(p.tickSpacing).padStart(6)} hooks=${p.hooks === ethers.ZeroAddress ? "none" : p.hooks} liquidity=${p.liquidity}  -> ${p.verdict}`
      );
    }
    const best = pools.find((p) => p.verdict === "ALIVE");
    if (best) survivors.push(best);
  }

  console.log(`\n=== SURVIVORS (clean, hookless, standard-fee, funded): ${survivors.length} ===\n`);
  for (const p of survivors) {
    console.log(
      `  ${p.ticker.padEnd(5)} currency0=${p.currency0} currency1=${p.currency1} fee=${p.fee} tickSpacing=${p.tickSpacing}`
    );
  }

  // Machine-readable block for the fork-sweep test generator.
  console.log("\n=== JSON (paste back for fork test generation) ===\n");
  console.log(
    JSON.stringify(
      survivors.map((p) => ({
        ticker: p.ticker,
        token: CANDIDATES[p.ticker],
        currency0: p.currency0,
        currency1: p.currency1,
        fee: p.fee,
        tickSpacing: p.tickSpacing,
        liquidity: p.liquidity.toString(),
      })),
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
