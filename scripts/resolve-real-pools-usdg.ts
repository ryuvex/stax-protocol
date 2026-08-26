import { network } from "hardhat";
import * as fs from "fs";

// Filled in after deploying V4PoolLens.sol -- see deploy-v4-lens.ts
const LENS_ADDRESS = "0xa5fd118AF173BF852950D504c5035Dd4A461a87D"; // deployed tonight

const RAW_SCAN_FILE = "v4-pool-params-full.txt";

// v2 of resolution: CRITICAL FIX -- the original resolve-real-pools.ts
// picked the highest-liquidity candidate per ticker with NO constraint
// on what the ticker was actually paired against. This is wrong: the
// vault's _swapEthForTicker/_swapTickerForEth wrap deposited ETH into
// real WETH and then attempt to swap through whatever the pool's other
// currency is. If that other currency isn't WETH (or native ETH), the
// swap cannot settle -- the vault holds WETH, not whatever the pool
// actually expects, and the transaction reverts every time. Discovered
// tonight when TSM's and META's "confirmed good" hookless winners both
// turned out to be paired against SPY (a stock token), not WETH.
//
// This version ONLY considers candidates where pairedWith is WETH or
// NATIVE ETH. Every other candidate, regardless of liquidity, fee, or
// hook status, is excluded before ranking even begins.
const TICKERS = [
  "NVDA", "AMD", "TSM", "AAPL", "MSFT", "GOOGL", "AMZN", "META", "TSLA",
  "COIN", "MSTR", "CLSK", "CRCL", "IONQ", "RGTI", "RKLB", "SPCX", "INTC",
  "MU", "SNDK", // ASML already dropped
];

const TICKER_ADDRESSES: Record<string, string> = {
  NVDA: "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC",
  AMD: "0x86923f96303D656E4aa86D9d42D1e57ad2023fdC",
  TSM: "0x58FfE4a942d3885bAa22D7520691F611EF09e7AA",
  AAPL: "0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9",
  MSFT: "0xe93237C50D904957Cf27E7B1133b510C669c2e74",
  GOOGL: "0x2e0847E8910a9732eB3fb1bb4b70a580ADAD4FE3",
  AMZN: "0x12f190a9F9d7D37a250758b26824B97CE941bF54",
  META: "0xc0D6457C16Cc70d6790Dd43521C899C87ce02f35",
  TSLA: "0x322F0929c4625eD5bAd873c95208D54E1c003b2d",
  COIN: "0x6330D8C3178a418788dF01a47479c0ce7CCF450b",
  MSTR: "0xec262a75e413fAfD0dF80480274532C79D42da09",
  CLSK: "0xcBB95BBF36099d34dA091dc6Fa6F49EfA257Cee3",
  CRCL: "0xdF0992E440dD0be65BD8439b609d6D4366bf1CB5",
  IONQ: "0x558378E000D634A36593E338eBacdd6207640EfE",
  RGTI: "0x284358abc07F9359f19f4b5b4aC91901Be2597Ba",
  RKLB: "0x3b14C39E89D60D627b42a1A4CA45b5bb45Fc12e2",
  SPCX: "0x4a0E65A3EcceC6dBe60AE065F2e7bb85Fae35eEa",
  INTC: "0xc72b96e0E48ecd4DC75E1e45396e26300BC39681",
  MU: "0xfF080c8ce2E5feadaCa0Da81314Ae59D232d4afD",
  SNDK: "0xB90A19fF0Af67f7779afF50A882A9CfF42446400",
};

const WETH = "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73";

// DISCOVERY (this session): Robinhood Chain mainnet's real liquidity
// backbone appears to be USDG (Global Dollar, Paxos), not WETH -- this
// matches Robinhood's own bridge docs describing mainnet as
// "stablecoin-first and anchored to USDG." Confirmed via Blockscout:
// name/symbol at this address = "Global Dollar (USDG)".
// Checking real liquidity against THIS address instead of WETH, to see
// whether it's genuinely the chain's reserve asset before deciding
// anything about the vault's deposit/swap architecture.
const USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";

const BLOCKED_HOOKS = new Set([
  "0x49a446E0DC7A4F998ac2CB4E5Ce861cc79e16054".toLowerCase(),
]);

const LINE_REGEX = /^\s*(\S+)\s+paired=(\S+)\s+fee=\s*(-?\d+)\s+tickSpacing=\s*(-?\d+)\s+hooks=(\S+)/;

interface Candidate {
  symbol: string;
  pairedWith: string;
  fee: string;
  tickSpacing: string;
  hooks: string;
}

function parseScanFile(path: string): Candidate[] {
  const text = fs.readFileSync(path, "utf-8");
  const lines = text.split("\n");
  const candidates: Candidate[] = [];

  for (const line of lines) {
    const match = line.match(LINE_REGEX);
    if (!match) continue;
    const [, symbol, pairedWith, fee, tickSpacing, hooks] = match;
    if (!TICKERS.includes(symbol)) continue;

    // v3: checking against USDG instead of WETH -- diagnostic run to
    // see the real liquidity picture given the USDG discovery above.
    // Native ETH candidates are also kept since the vault could in
    // principle accept a native-ETH-paired pool directly too.
    const isUsdg = pairedWith.toLowerCase() === USDG.toLowerCase();
    const isNativeEth = pairedWith === "NATIVE ETH";
    if (!isUsdg && !isNativeEth) continue;

    candidates.push({ symbol, pairedWith, fee, tickSpacing, hooks });
  }

  return candidates;
}

async function main() {
  const { ethers } = await network.connect({ network: "robinhoodMainnet" });

  console.log(`Reading local scan file: ${RAW_SCAN_FILE}`);
  const candidates = parseScanFile(RAW_SCAN_FILE);
  console.log(`Parsed ${candidates.length} USDG/native-ETH-paired candidate entries (all other pairings excluded).\n`);

  const uniqueByTicker: Record<string, Map<string, Candidate>> = {};
  for (const c of candidates) {
    if (!uniqueByTicker[c.symbol]) uniqueByTicker[c.symbol] = new Map();
    const key = `${c.pairedWith}-${c.fee}-${c.tickSpacing}-${c.hooks}`;
    uniqueByTicker[c.symbol].set(key, c);
  }

  const lensAbi = [
    "function getLiquidityBatch(bytes32[] calldata poolIds) external view returns (uint128[] memory)",
  ];
  const lens = new ethers.Contract(LENS_ADDRESS, lensAbi, ethers.provider);

  interface Result {
    candidate: Candidate;
    liquidity: bigint;
    poolId: string;
    currency0: string;
    currency1: string;
  }

  const results: Record<string, Result[]> = {};

  for (const symbol of TICKERS) {
    const tickerAddress = TICKER_ADDRESSES[symbol];
    const uniqueCandidates = uniqueByTicker[symbol] ? Array.from(uniqueByTicker[symbol].values()) : [];

    if (uniqueCandidates.length === 0) {
      console.log(`  ${symbol.padEnd(6)} -- ZERO USDG/native-ETH-paired candidates found.`);
      results[symbol] = [];
      continue;
    }

    const poolIds: string[] = [];
    const currencyPairs: { currency0: string; currency1: string }[] = [];
    for (const c of uniqueCandidates) {
      const otherAddress = c.pairedWith === "NATIVE ETH" ? ethers.ZeroAddress : USDG;
      const [currency0, currency1] =
        tickerAddress.toLowerCase() < otherAddress.toLowerCase()
          ? [tickerAddress, otherAddress]
          : [otherAddress, tickerAddress];
      currencyPairs.push({ currency0, currency1 });
      const poolId = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ["address", "address", "uint24", "int24", "address"],
          [currency0, currency1, c.fee, c.tickSpacing, c.hooks]
        )
      );
      poolIds.push(poolId);
    }

    try {
      const liquidities: bigint[] = await lens.getLiquidityBatch(poolIds);

      const ranked = uniqueCandidates
        .map((c, i) => ({
          candidate: c,
          liquidity: liquidities[i],
          poolId: poolIds[i],
          currency0: currencyPairs[i].currency0,
          currency1: currencyPairs[i].currency1,
        }))
        .filter((r) => !BLOCKED_HOOKS.has(r.candidate.hooks.toLowerCase()))
        .sort((a, b) => (b.liquidity > a.liquidity ? 1 : b.liquidity < a.liquidity ? -1 : 0));

      results[symbol] = ranked;

      if (ranked.length === 0) {
        console.log(`  ${symbol.padEnd(6)} -- all USDG-paired candidates used a blocked/unverified hook.`);
        continue;
      }

      const top = ranked[0];
      console.log(
        `  ${symbol.padEnd(6)} -- ${ranked.length} usable USDG/native-ETH candidate(s). Best: liquidity=${top.liquidity} fee=${top.candidate.fee} tickSpacing=${top.candidate.tickSpacing} hooks=${top.candidate.hooks}`
      );
    } catch (err: any) {
      console.log(`  ${symbol.padEnd(6)} -- FAILED: ${err.message ?? err}`);
      results[symbol] = [];
    }
  }

  console.log("\n=== FINAL: BEST USDG/NATIVE-ETH-PAIRED POOL PER TICKER ===\n");
  for (const symbol of TICKERS) {
    const ranked = results[symbol] || [];
    if (ranked.length === 0) {
      console.log(`  ${symbol.padEnd(6)} -- NO USABLE POOL (needs manual review / drop)`);
    } else {
      const top = ranked[0];
      console.log(
        `  ${symbol.padEnd(6)} currency0=${top.currency0} currency1=${top.currency1} fee=${top.candidate.fee} tickSpacing=${top.candidate.tickSpacing} hooks=${top.candidate.hooks} liquidity=${top.liquidity}`
      );
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
