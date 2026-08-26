import { network } from "hardhat";
import * as fs from "fs";

// Filled in after deploying V4PoolLens.sol -- see deploy-v4-lens.ts
const LENS_ADDRESS = "0xa5fd118AF173BF852950D504c5035Dd4A461a87D"; // deployed tonight

const RAW_SCAN_FILE = "v4-pool-params-full.txt";

const TICKERS = [
  "NVDA", "AMD", "TSM", "AAPL", "MSFT", "GOOGL", "AMZN", "META", "TSLA",
  "COIN", "MSTR", "CLSK", "CRCL", "IONQ", "RGTI", "RKLB", "SPCX", "INTC",
  "MU", "ASML", "SNDK",
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
  ASML: "0x47F93d52cBeC7C6D2CfC080e154002370a60dAEA",
  SNDK: "0xB90A19fF0Af67f7779afF50A882A9CfF42446400",
};

const WETH = "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73";
const ZERO_HOOK = "0x0000000000000000000000000000000000000000";

// Below this, a "hookless alternative" isn't considered usable -- too
// thin to be a real fallback venue, just noise in the candidate list.
// Deliberately a very low floor (1e18) -- just filters obvious dust,
// doesn't try to pre-judge what counts as "enough" liquidity. Real
// adequacy for each ticker still needs a human look at the numbers
// printed below, not an automatic pass/fail.
const MIN_USABLE_HOOKLESS_LIQUIDITY = 1_000_000_000_000_000_000n; // 1e18

// Hooks confirmed UNVERIFIED on the block explorer (no public source,
// can't confirm what they actually do, including whether reported
// liquidity numbers reflect real redeemable value). Candidates using
// these are excluded from winner selection entirely -- better to route
// through a smaller, verifiable pool than a larger, opaque one.
const BLOCKED_HOOKS = new Set([
  "0x49a446E0DC7A4F998ac2CB4E5Ce861cc79e16054".toLowerCase(), // unverified -- confirmed via Blockscout tonight
]);

// Parses lines like:
//   SNDK   paired=0x24FEd15...  fee=8388608 tickSpacing= 200 hooks=0x4e34...  (block 33933073)
const LINE_REGEX = /^\s*(\S+)\s+paired=(\S+)\s+fee=\s*(-?\d+)\s+tickSpacing=\s*(-?\d+)\s+hooks=(\S+)/;

interface Candidate {
  symbol: string;
  pairedWith: string;
  fee: string;
  tickSpacing: string;
  hooks: string;
}

interface Winner {
  candidate: Candidate;
  liquidity: bigint;
  poolId: string;
  currency0: string;
  currency1: string;
}

function parseScanFile(path: string): Candidate[] {
  const text = fs.readFileSync(path, "utf-8");
  const lines = text.split("\n");
  const candidates: Candidate[] = [];

  for (const line of lines) {
    const match = line.match(LINE_REGEX);
    if (!match) continue;
    const [, symbol, pairedWith, fee, tickSpacing, hooks] = match;
    if (!TICKERS.includes(symbol)) continue; // skip header/noise lines
    candidates.push({ symbol, pairedWith, fee, tickSpacing, hooks });
  }

  return candidates;
}

async function main() {
  if (LENS_ADDRESS === "PASTE_DEPLOYED_LENS_ADDRESS_HERE") {
    throw new Error("Set LENS_ADDRESS to the real deployed V4PoolLens address first -- see deploy-v4-lens.ts");
  }

  const { ethers } = await network.connect({ network: "robinhoodMainnet" });

  console.log(`Reading local scan file: ${RAW_SCAN_FILE}`);
  const candidates = parseScanFile(RAW_SCAN_FILE);
  console.log(`Parsed ${candidates.length} candidate pool entries from the local file.\n`);

  // Dedupe identical (fee, tickSpacing, hooks, pairedWith) combos per
  // ticker -- the same pool can appear multiple times if it was
  // re-initialized or if our chunked scan somehow double-counted a
  // boundary block.
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

  const winners: Record<string, Winner | null> = {};
  // Best hookless (hooks == address(0)) candidate per ticker, even when
  // it's not the overall liquidity winner -- lets us check, per ticker,
  // whether a usable hook-free venue exists as an alternative to
  // allowlisting a hook at all. null if no hookless candidate was
  // parsed, or the best one found is below MIN_USABLE_HOOKLESS_LIQUIDITY.
  const hooklessAlternatives: Record<string, Winner | null> = {};

  for (const symbol of TICKERS) {
    const tickerAddress = TICKER_ADDRESSES[symbol];
    const uniqueCandidates = uniqueByTicker[symbol] ? Array.from(uniqueByTicker[symbol].values()) : [];

    if (uniqueCandidates.length === 0) {
      console.log(`  ${symbol.padEnd(6)} -- no candidates parsed from scan file`);
      winners[symbol] = null;
      hooklessAlternatives[symbol] = null;
      continue;
    }

    // Compute real PoolId for each candidate: keccak256(abi.encode(poolKey)),
    // poolKey = {currency0, currency1, fee, tickSpacing, hooks}, ordered
    // with currency0 < currency1 by address value (V4's actual ordering rule).
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

      // Overall winner (existing logic, unchanged): highest liquidity,
      // excluding explicitly blocked (unverified) hooks. Hooked
      // candidates ARE eligible to win here -- this is "best pool
      // regardless of hook," same behavior as before this edit.
      let bestIdx = -1;
      for (let i = 0; i < liquidities.length; i++) {
        if (BLOCKED_HOOKS.has(uniqueCandidates[i].hooks.toLowerCase())) continue;
        if (bestIdx === -1 || liquidities[i] > liquidities[bestIdx]) bestIdx = i;
      }

      // Best HOOKLESS candidate specifically, regardless of whether it's
      // also the overall winner. This is what lets us answer "does a
      // usable hook-free venue exist for this ticker" without vetting
      // any hook at all.
      let bestHooklessIdx = -1;
      for (let i = 0; i < liquidities.length; i++) {
        if (uniqueCandidates[i].hooks.toLowerCase() !== ZERO_HOOK.toLowerCase()) continue;
        if (bestHooklessIdx === -1 || liquidities[i] > liquidities[bestHooklessIdx]) bestHooklessIdx = i;
      }

      if (bestHooklessIdx !== -1 && liquidities[bestHooklessIdx] >= MIN_USABLE_HOOKLESS_LIQUIDITY) {
        hooklessAlternatives[symbol] = {
          candidate: uniqueCandidates[bestHooklessIdx],
          liquidity: liquidities[bestHooklessIdx],
          poolId: poolIds[bestHooklessIdx],
          currency0: currencyPairs[bestHooklessIdx].currency0,
          currency1: currencyPairs[bestHooklessIdx].currency1,
        };
      } else {
        hooklessAlternatives[symbol] = null;
      }

      if (bestIdx === -1) {
        console.log(`  ${symbol.padEnd(6)} -- ALL candidates used a blocked/unverified hook. No safe pool found -- consider removing this ticker.`);
        winners[symbol] = null;
        continue;
      }

      const skippedForBlockedHook = uniqueCandidates.filter((c) => BLOCKED_HOOKS.has(c.hooks.toLowerCase())).length;

      winners[symbol] = {
        candidate: uniqueCandidates[bestIdx],
        liquidity: liquidities[bestIdx],
        poolId: poolIds[bestIdx],
        currency0: currencyPairs[bestIdx].currency0,
        currency1: currencyPairs[bestIdx].currency1,
      };

      const blockedNote = skippedForBlockedHook > 0 ? ` (${skippedForBlockedHook} candidate(s) excluded for unverified hook)` : "";
      console.log(
        `  ${symbol.padEnd(6)} -- ${uniqueCandidates.length} candidates checked, real winner: liquidity=${liquidities[bestIdx]} fee=${uniqueCandidates[bestIdx].fee} tickSpacing=${uniqueCandidates[bestIdx].tickSpacing} hooks=${uniqueCandidates[bestIdx].hooks}${blockedNote}`
      );
    } catch (err: any) {
      console.log(`  ${symbol.padEnd(6)} -- FAILED: ${err.message ?? err}`);
      winners[symbol] = null;
      hooklessAlternatives[symbol] = null;
    }
  }

  console.log("\n=== FINAL: ONE REAL POOL PER TICKER (best overall, hooked or not) ===\n");
  for (const symbol of TICKERS) {
    const w = winners[symbol];
    if (!w) {
      console.log(`  ${symbol.padEnd(6)} -- UNRESOLVED, needs manual review`);
    } else {
      console.log(
        `  ${symbol.padEnd(6)} currency0=${w.currency0} currency1=${w.currency1} fee=${w.candidate.fee} tickSpacing=${w.candidate.tickSpacing} hooks=${w.candidate.hooks} liquidity=${w.liquidity}`
      );
    }
  }

  console.log("\n=== HOOKLESS ALTERNATIVES (per ticker, even if not the overall winner) ===\n");
  console.log("Use this to see which hooked tickers above could instead launch on a");
  console.log("hook-free pool, avoiding the need to vet any hook for that ticker at all.\n");
  for (const symbol of TICKERS) {
    const overallWinnerIsHookless = winners[symbol]?.candidate.hooks.toLowerCase() === ZERO_HOOK.toLowerCase();
    const alt = hooklessAlternatives[symbol];

    if (overallWinnerIsHookless) {
      console.log(`  ${symbol.padEnd(6)} -- overall winner is already hookless, no substitution needed`);
    } else if (!alt) {
      console.log(`  ${symbol.padEnd(6)} -- NO usable hookless alternative found (must vet the hook, or drop this ticker)`);
    } else {
      console.log(
        `  ${symbol.padEnd(6)} HOOKLESS OPTION -- currency0=${alt.currency0} currency1=${alt.currency1} fee=${alt.candidate.fee} tickSpacing=${alt.candidate.tickSpacing} liquidity=${alt.liquidity} (vs. hooked winner liquidity=${winners[symbol]?.liquidity ?? "n/a"})`
      );
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
