import { network } from "hardhat";

const USDG_USD_FEED = "0x61B7e5650328764B076A108EFF5fa7282a1B9aD2";

// Walk back this many rounds -- generous enough to comfortably cover
// 2+ weeks even if the feed updates more often than the ~24h we're
// hypothesizing (e.g. if it updates every 6h, 60 rounds covers 15 days;
// if every 24h, 60 rounds covers 60 days).
const MAX_ROUNDS_TO_WALK = 60;

async function main() {
  const { ethers } = await network.connect({ network: "robinhoodMainnet" });

  const oracleAbi = [
    "function decimals() external view returns (uint8)",
    "function latestRoundData() external view returns (uint80,int256,uint256,uint256,uint80)",
    "function getRoundData(uint80 _roundId) external view returns (uint80,int256,uint256,uint256,uint80)",
  ];
  const feed = await ethers.getContractAt(oracleAbi, USDG_USD_FEED);

  console.log("=== Measuring USDG/USD feed's real observed update history ===\n");

  const latest = await feed.latestRoundData();
  const latestRoundId: bigint = latest[0];
  console.log("Latest roundId:", latestRoundId.toString());
  console.log("Latest updatedAt:", new Date(Number(latest[3]) * 1000).toISOString());

  const updates: { roundId: bigint; updatedAt: number; price: bigint }[] = [
    { roundId: latestRoundId, updatedAt: Number(latest[3]), price: latest[1] },
  ];

  console.log(`\nWalking back up to ${MAX_ROUNDS_TO_WALK} rounds...\n`);

  let currentRoundId = latestRoundId;
  let successfulReads = 0;

  for (let i = 0; i < MAX_ROUNDS_TO_WALK; i++) {
    currentRoundId = currentRoundId - 1n;
    try {
      const round = await feed.getRoundData(currentRoundId);
      const updatedAt = Number(round[3]);
      if (updatedAt === 0) {
        console.log(`  roundId ${currentRoundId}: no data (updatedAt=0), stopping walk-back here.`);
        break;
      }
      updates.push({ roundId: currentRoundId, updatedAt, price: round[1] });
      successfulReads++;
    } catch (err: any) {
      console.log(`  roundId ${currentRoundId}: read failed (${err.message ?? err}), stopping walk-back here.`);
      break;
    }
  }

  console.log(`\nSuccessfully read ${successfulReads} historical rounds beyond the latest.\n`);

  if (updates.length < 2) {
    console.log("Not enough historical data to compute gaps. Cannot proceed with empirical measurement.");
    return;
  }

  // Sort oldest to newest, compute gaps between consecutive updates.
  updates.sort((a, b) => a.updatedAt - b.updatedAt);

  console.log("=== Observed update history (oldest to newest) ===");
  let maxGapSeconds = 0;
  let maxGapRounds = { from: 0n, to: 0n };

  for (let i = 0; i < updates.length; i++) {
    const u = updates[i];
    const date = new Date(u.updatedAt * 1000).toISOString();
    if (i === 0) {
      console.log(`  roundId=${u.roundId} updatedAt=${date} price=${u.price}`);
    } else {
      const gap = u.updatedAt - updates[i - 1].updatedAt;
      console.log(`  roundId=${u.roundId} updatedAt=${date} price=${u.price}  (gap from previous: ${gap}s / ${(gap / 3600).toFixed(2)}h)`);
      if (gap > maxGapSeconds) {
        maxGapSeconds = gap;
        maxGapRounds = { from: updates[i - 1].roundId, to: u.roundId };
      }
    }
  }

  const oldestTimestamp = updates[0].updatedAt;
  const newestTimestamp = updates[updates.length - 1].updatedAt;
  const totalSpanDays = (newestTimestamp - oldestTimestamp) / 86400;

  console.log("\n=== RESULT ===");
  console.log(`Total history spanned: ${totalSpanDays.toFixed(1)} days`);
  console.log(`Maximum observed gap between updates: ${maxGapSeconds} seconds (${(maxGapSeconds / 3600).toFixed(2)} hours)`);
  console.log(`  (between roundId ${maxGapRounds.from} and ${maxGapRounds.to})`);

  const recommendedBuffer = 2 * 3600; // 2 hour buffer, same reasoning as before
  const recommendedMaxStaleness = maxGapSeconds + recommendedBuffer;
  console.log(`\nRecommended maxStaleness (observed max gap + 2h buffer): ${recommendedMaxStaleness} seconds (${(recommendedMaxStaleness / 3600).toFixed(2)} hours)`);

  if (totalSpanDays < 7) {
    console.log("\n*** WARNING: less than 7 days of history captured -- this measurement covers a shorter window than ideal. Treat the result as a floor, not a fully confident ceiling. ***");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
