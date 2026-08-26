import { network } from "hardhat";

const TICKERS = {
  NVDA: "0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15",
  AMD: "0x943A29E7ae51A4798823ca9eEd2ed533B2A22C72",
  TSM: "0x874cF94aa8eC88Fd9560094dD065f2fB3E41Fc2F",
};

const STOCK_FEED_MAX_STALENESS = 3600; // 1 hour, the deployed threshold

async function main() {
  const { ethers } = await network.connect({ network: "robinhoodMainnet" });

  const oracleAbi = [
    "function decimals() external view returns (uint8)",
    "function latestRoundData() external view returns (uint80,int256,uint256,uint256,uint80)",
  ];

  const latestBlock = await ethers.provider.getBlock("latest");
  const nowTimestamp = latestBlock?.timestamp ?? Math.floor(Date.now() / 1000);
  console.log("Current chain timestamp:", new Date(nowTimestamp * 1000).toISOString());
  console.log(`Staleness threshold: ${STOCK_FEED_MAX_STALENESS}s (1 hour)\n`);

  for (const [symbol, feedAddress] of Object.entries(TICKERS)) {
    const feed = await ethers.getContractAt(oracleAbi, feedAddress);
    const roundData = await feed.latestRoundData();
    const updatedAt = Number(roundData[3]);
    const staleness = nowTimestamp - updatedAt;
    const isStale = staleness > STOCK_FEED_MAX_STALENESS;

    console.log(`${symbol}:`);
    console.log(`  Last updated: ${new Date(updatedAt * 1000).toISOString()}`);
    console.log(`  Staleness: ${staleness}s (${(staleness / 3600).toFixed(2)}h)`);
    console.log(`  ${isStale ? "*** STALE -- exceeds 1h threshold ***" : "OK -- within threshold"}\n`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
