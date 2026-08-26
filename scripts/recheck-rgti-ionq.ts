import { network } from "hardhat";
import * as fs from "fs";

const LENS_ADDRESS = "0xa5fd118AF173BF852950D504c5035Dd4A461a87D";
const USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
const RAW_SCAN_FILE = "v4-pool-params-full.txt";

const TICKERS = ["RGTI", "IONQ"];

const TICKER_ADDRESSES: Record<string, string> = {
  RGTI: "0x284358abc07F9359f19f4b5b4aC91901Be2597Ba",
  IONQ: "0x558378E000D634A36593E338eBacdd6207640EfE",
};

// Confirmed decoy fingerprints from tonight -- excluded, but everything
// ELSE gets shown this time, not just the top survivor, so we can
// actually see the full picture for these two specifically.
const DECOY_SIGNATURES = new Set(["880000-17600", "30000-600"]);

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

    // Show ALL candidates paired against USDG specifically -- this is
    // the currency the vault actually needs, so non-USDG candidates
    // (even if real) aren't usable regardless.
    const isUsdg = pairedWith.toLowerCase() === USDG.toLowerCase();
    if (!isUsdg) continue;

    const sig = `${fee}-${tickSpacing}`;
    if (DECOY_SIGNATURES.has(sig)) continue;

    candidates.push({ symbol, pairedWith, fee, tickSpacing, hooks });
  }

  return candidates;
}

async function main() {
  const { ethers } = await network.connect({ network: "robinhoodMainnet" });

  console.log("Full candidate re-check for RGTI and IONQ -- showing ALL USDG-paired candidates, not just the top pick.\n");

  const candidates = parseScanFile(RAW_SCAN_FILE);

  const uniqueByTicker: Record<string, Map<string, Candidate>> = {};
  for (const c of candidates) {
    if (!uniqueByTicker[c.symbol]) uniqueByTicker[c.symbol] = new Map();
    const key = `${c.fee}-${c.tickSpacing}-${c.hooks}`;
    uniqueByTicker[c.symbol].set(key, c);
  }

  const lensAbi = [
    "function getLiquidityBatch(bytes32[] calldata poolIds) external view returns (uint128[] memory)",
  ];
  const lens = new ethers.Contract(LENS_ADDRESS, lensAbi, ethers.provider);

  for (const symbol of TICKERS) {
    const tickerAddress = TICKER_ADDRESSES[symbol];
    const uniqueCandidates = uniqueByTicker[symbol] ? Array.from(uniqueByTicker[symbol].values()) : [];

    console.log(`=== ${symbol} ===`);

    if (uniqueCandidates.length === 0) {
      console.log(`  NO USDG-paired candidates at all in the raw scan file (post decoy-exclusion). Genuinely nothing to find here.\n`);
      continue;
    }

    const poolIds: string[] = [];
    for (const c of uniqueCandidates) {
      const [currency0, currency1] =
        USDG.toLowerCase() < tickerAddress.toLowerCase() ? [USDG, tickerAddress] : [tickerAddress, USDG];
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
        .map((c, i) => ({ candidate: c, liquidity: liquidities[i] }))
        .sort((a, b) => (b.liquidity > a.liquidity ? 1 : b.liquidity < a.liquidity ? -1 : 0));

      console.log(`  ${ranked.length} candidate(s) found (all shown, not just top):`);
      for (const r of ranked) {
        const feeNum = Number(r.candidate.fee);
        const feePercent = (feeNum / 1_000_000) * 100;
        console.log(
          `    liquidity=${r.liquidity} fee=${r.candidate.fee} (${feePercent}%) tickSpacing=${r.candidate.tickSpacing} hooks=${r.candidate.hooks}`
        );
      }
      console.log("");
    } catch (err: any) {
      console.log(`  FAILED: ${err.message ?? err}\n`);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
