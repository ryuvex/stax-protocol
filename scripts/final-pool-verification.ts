import { network } from "hardhat";
import * as fs from "fs";

const LENS_ADDRESS = "0xa5fd118AF173BF852950D504c5035Dd4A461a87D";
const USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
const RAW_SCAN_FILE = "v4-pool-params-full.txt";

// Every ticker still under consideration for mainnet, EXCLUDING the
// four already confirmed dead tonight: ASML (dropped earlier), CLSK,
// RGTI, RKLB (all three confirmed dead just now -- LaunchHook pool
// paired against "CleanSpar Duck", an unrelated 5-holder token, not a
// real market).
const TICKERS = [
  "NVDA", "AMD", "TSM", "AAPL", "MSFT", "GOOGL", "AMZN", "META", "TSLA",
  "COIN", "MSTR", "CRCL", "IONQ", "SPCX", "INTC", "MU", "SNDK",
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
  CRCL: "0xdF0992E440dD0be65BD8439b609d6D4366bf1CB5",
  IONQ: "0x558378E000D634A36593E338eBacdd6207640EfE",
  SPCX: "0x4a0E65A3EcceC6dBe60AE065F2e7bb85Fae35eEa",
  INTC: "0xc72b96e0E48ecd4DC75E1e45396e26300BC39681",
  MU: "0xfF080c8ce2E5feadaCa0Da81314Ae59D232d4afD",
  SNDK: "0xB90A19fF0Af67f7779afF50A882A9CfF42446400",
};

// Decoy fee/tickSpacing fingerprints confirmed tonight -- candidates
// matching ANY of these are excluded before ranking, regardless of
// reported liquidity or counterparty.
const DECOY_SIGNATURES = new Set([
  "880000-17600", // confirmed across 12 unrelated tickers (CLSK/RGTI/RKLB LaunchHook trap + more)
  "30000-600",    // confirmed across 14 occurrences, 5+ unrelated tickers (MSTR trap + more)
]);

// Standard, sane Uniswap fee tiers -- anything else gets an explicit
// WARNING printed even if it passes the decoy-signature check, since
// tonight has shown unusual fees deserve scrutiny regardless.
const STANDARD_FEE_TIERS = new Set([100, 500, 3000, 10000]);

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

    const isUsdg = pairedWith.toLowerCase() === USDG.toLowerCase();
    if (!isUsdg) continue; // only USDG-paired candidates matter for mainnet

    const sig = `${fee}-${tickSpacing}`;
    if (DECOY_SIGNATURES.has(sig)) continue; // exclude known decoy fingerprints entirely

    candidates.push({ symbol, pairedWith, fee, tickSpacing, hooks });
  }

  return candidates;
}

async function main() {
  const { ethers } = await network.connect({ network: "robinhoodMainnet" });

  console.log("Re-verifying every remaining ticker's USDG pool -- direct on-chain check, decoy signatures excluded.\n");

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

  const finalResults: Record<string, { candidate: Candidate; liquidity: bigint; currency0: string; currency1: string } | null> = {};

  for (const symbol of TICKERS) {
    const tickerAddress = TICKER_ADDRESSES[symbol];
    const uniqueCandidates = uniqueByTicker[symbol] ? Array.from(uniqueByTicker[symbol].values()) : [];

    if (uniqueCandidates.length === 0) {
      console.log(`  ${symbol.padEnd(6)} -- NO CANDIDATES SURVIVE after decoy-signature exclusion. NEEDS MANUAL REVIEW.`);
      finalResults[symbol] = null;
      continue;
    }

    const poolIds: string[] = [];
    const currencyPairs: { currency0: string; currency1: string }[] = [];
    for (const c of uniqueCandidates) {
      const [currency0, currency1] =
        USDG.toLowerCase() < tickerAddress.toLowerCase() ? [USDG, tickerAddress] : [tickerAddress, USDG];
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
        .map((c, i) => ({ candidate: c, liquidity: liquidities[i], ...currencyPairs[i] }))
        .sort((a, b) => (b.liquidity > a.liquidity ? 1 : b.liquidity < a.liquidity ? -1 : 0));

      const top = ranked[0];
      finalResults[symbol] = top;

      const feeNum = Number(top.candidate.fee);
      const feePercent = (feeNum / 1_000_000) * 100;
      const isStandardFee = STANDARD_FEE_TIERS.has(feeNum);
      const warningFlag = isStandardFee ? "" : `  *** NON-STANDARD FEE: ${feePercent}% -- verify manually before trusting ***`;

      console.log(
        `  ${symbol.padEnd(6)} -- ${ranked.length} candidate(s) post-exclusion. Best: liquidity=${top.liquidity} fee=${top.candidate.fee} (${feePercent}%) tickSpacing=${top.candidate.tickSpacing}${warningFlag}`
      );
    } catch (err: any) {
      console.log(`  ${symbol.padEnd(6)} -- FAILED: ${err.message ?? err}`);
      finalResults[symbol] = null;
    }
  }

  console.log("\n=== FINAL VERIFIED POOL CONFIG (decoy-excluded, ready for deploy script) ===\n");
  for (const symbol of TICKERS) {
    const result = finalResults[symbol];
    if (!result) {
      console.log(`  ${symbol.padEnd(6)} -- NEEDS MANUAL REVIEW, no safe candidate found`);
    } else {
      console.log(
        `  ${symbol.padEnd(6)} currency0=${result.currency0} currency1=${result.currency1} fee=${result.candidate.fee} tickSpacing=${result.candidate.tickSpacing} hooks=${result.candidate.hooks} liquidity=${result.liquidity}`
      );
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
