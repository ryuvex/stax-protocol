import { network } from "hardhat";
import * as fs from "fs";

// Same lens used by resolve-real-pools.ts -- reuse it rather than
// redeploying anything.
const LENS_ADDRESS = "0xa5fd118AF173BF852950D504c5035Dd4A461a87D";

const RAW_SCAN_FILE = "v4-pool-params-full.txt";

// Only the three tickers under question -- CRCL, IONQ, RKLB. Their
// highest-liquidity pool was confirmed (via getState) to be a Doppler
// bonding-curve launch using the ticker as NUMERAIRE, not a real market
// for the ticker itself. This script checks whether a smaller, but
// genuinely real, market exists further down the candidate list.
const TICKERS = ["CRCL", "IONQ", "RKLB"];

const TICKER_ADDRESSES: Record<string, string> = {
  CRCL: "0xdF0992E440dD0be65BD8439b609d6D4366bf1CB5",
  IONQ: "0x558378E000D634A36593E338eBacdd6207640EfE",
  RKLB: "0x3b14C39E89D60D627b42a1A4CA45b5bb45Fc12e2",
};

const WETH = "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73";

// Same unverified-hook blocklist as resolve-real-pools.ts.
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
    candidates.push({ symbol, pairedWith, fee, tickSpacing, hooks });
  }

  return candidates;
}

async function main() {
  const { ethers } = await network.connect({ network: "robinhoodMainnet" });

  console.log(`Reading local scan file: ${RAW_SCAN_FILE}`);
  const candidates = parseScanFile(RAW_SCAN_FILE);
  console.log(`Parsed ${candidates.length} candidate entries for CRCL/IONQ/RKLB.\n`);

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

  for (const symbol of TICKERS) {
    const tickerAddress = TICKER_ADDRESSES[symbol];
    const uniqueCandidates = uniqueByTicker[symbol] ? Array.from(uniqueByTicker[symbol].values()) : [];

    console.log(`\n=== ${symbol} -- ${uniqueCandidates.length} unique candidates ===`);

    if (uniqueCandidates.length === 0) {
      console.log("  (none found)");
      continue;
    }

    const poolIds: string[] = [];
    const currencyPairs: { currency0: string; currency1: string }[] = [];
    for (const c of uniqueCandidates) {
      const otherAddress = c.pairedWith === "WETH" ? WETH : c.pairedWith === "NATIVE ETH" ? ethers.ZeroAddress : c.pairedWith;
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

      // Rank every candidate by liquidity, descending -- not just the winner.
      const ranked = uniqueCandidates
        .map((c, i) => ({
          candidate: c,
          liquidity: liquidities[i],
          currency0: currencyPairs[i].currency0,
          currency1: currencyPairs[i].currency1,
          blocked: BLOCKED_HOOKS.has(c.hooks.toLowerCase()),
        }))
        .sort((a, b) => (b.liquidity > a.liquidity ? 1 : b.liquidity < a.liquidity ? -1 : 0));

      const top5 = ranked.slice(0, 5);
      for (const [i, r] of top5.entries()) {
        console.log(
          `  #${i + 1}  liquidity=${r.liquidity}  fee=${r.candidate.fee}  tickSpacing=${r.candidate.tickSpacing}  hooks=${r.candidate.hooks}  currency0=${r.currency0}  currency1=${r.currency1}${r.blocked ? "  [BLOCKED unverified hook]" : ""}`
        );
      }
    } catch (err: any) {
      console.log(`  FAILED: ${err.message ?? err}`);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
