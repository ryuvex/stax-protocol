import { network } from "hardhat";

const TICKERS: Record<string, string> = {
  COIN: "0xA3a468A452940B7D6b69991207B508c609a98Ef2",
  MSTR: "0x396118bdFB181e6240E74D243F266B061c0edc3D",
  CRCL: "0x6652eDf64bA3731C4F2D3ce821A0Fb1f1f6b482a",
  SPCX: "0xB265810950ba6c5C0Ff821c9963014a56fD8Bffb",
  INTC: "0x3f390C5C24628Ac7C489515402235FeAD71D1913",
  MU: "0x425EEFdCf05ed6526C3cE61Af99429A228a6d596",
  SNDK: "0xfb133Fa4B7b385802B693a293606682Df47109A3",
};

// Generous walk-back -- equity feeds likely update multiple times per
// trading day, so this needs to be much deeper than USDG's 60 rounds
// to span several full weeks and confidently capture weekend gaps.
const MAX_ROUNDS_TO_WALK = 200;

async function main() {
  const { ethers } = await network.connect({ network: "robinhoodMainnet" });

  const oracleAbi = [
    "function latestRoundData() external view returns (uint80,int256,uint256,uint256,uint80)",
    "function getRoundData(uint80 _roundId) external view returns (uint80,int256,uint256,uint256,uint80)",
  ];

  console.log("=== Measuring real max staleness gap for all 16 stock feeds ===\n");
  console.log(`Walking back up to ${MAX_ROUNDS_TO_WALK} rounds per feed -- this will take a while.\n`);

  const results: { symbol: string; maxGapSeconds: number; maxGapHours: number; roundsChecked: number; spanDays: number }[] = [];

  for (const [symbol, feedAddress] of Object.entries(TICKERS)) {
    const feed = await ethers.getContractAt(oracleAbi, feedAddress);

    const latest = await feed.latestRoundData();
    const latestRoundId: bigint = latest[0];
    const updates: number[] = [Number(latest[3])];

    let currentRoundId = latestRoundId;
    for (let i = 0; i < MAX_ROUNDS_TO_WALK; i++) {
      currentRoundId = currentRoundId - 1n;
      let attempts = 0;
      let succeeded = false;
      while (attempts < 3 && !succeeded) {
        try {
          const round = await feed.getRoundData(currentRoundId);
          const updatedAt = Number(round[3]);
          if (updatedAt === 0) {
            succeeded = true;
            i = MAX_ROUNDS_TO_WALK; // break outer loop too
            break;
          }
          updates.push(updatedAt);
          succeeded = true;
        } catch (err: any) {
          attempts++;
          if (attempts >= 3) {
            console.log(`  (${symbol}: giving up on round ${currentRoundId} after 3 attempts -- ${err.message ?? err})`);
            i = MAX_ROUNDS_TO_WALK; // stop this ticker, move to next rather than crash the whole script
            break;
          }
          // Brief pause before retry -- transient network blips (like a
          // DNS hiccup) often clear within a second or two.
          await new Promise((resolve) => setTimeout(resolve, 1500));
        }
      }
    }

    updates.sort((a, b) => a - b);
    let maxGap = 0;
    for (let i = 1; i < updates.length; i++) {
      const gap = updates[i] - updates[i - 1];
      if (gap > maxGap) maxGap = gap;
    }

    const spanDays = updates.length > 1 ? (updates[updates.length - 1] - updates[0]) / 86400 : 0;

    results.push({
      symbol,
      maxGapSeconds: maxGap,
      maxGapHours: maxGap / 3600,
      roundsChecked: updates.length,
      spanDays,
    });

    console.log(`${symbol}: ${updates.length} rounds, spanning ${spanDays.toFixed(1)} days, max gap = ${maxGap}s (${(maxGap / 3600).toFixed(2)}h)`);
  }

  console.log("\n=== SUMMARY ===");
  const overallMax = Math.max(...results.map((r) => r.maxGapSeconds));
  const overallMaxHours = overallMax / 3600;
  console.log(`Largest gap observed across ALL 16 feeds: ${overallMax}s (${overallMaxHours.toFixed(2)}h)`);
  console.log(`\nRecommended STOCK_FEED_MAX_STALENESS (measured max + buffer):`);
  const withBuffer = overallMax + 4 * 3600; // 4h buffer, same reasoning pattern as USDG's 2-3h
  console.log(`  ${withBuffer}s (${(withBuffer / 3600).toFixed(1)}h)`);

  console.log("\nDo the gaps cluster (similar across tickers) or vary widely? Check the per-ticker list above --");
  console.log("if they cluster, a single uniform value is fine; if they vary a lot, per-ticker values may be worth considering.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
