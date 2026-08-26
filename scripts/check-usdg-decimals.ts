import { network } from "hardhat";

const USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
const USDG_USD_FEED = "0x61B7e5650328764B076A108EFF5fa7282a1B9aD2";

async function main() {
  const { ethers } = await network.connect({ network: "robinhoodMainnet" });

  const erc20Abi = [
    "function decimals() external view returns (uint8)",
    "function name() external view returns (string)",
    "function symbol() external view returns (string)",
    "function totalSupply() external view returns (uint256)",
  ];
  const usdg = await ethers.getContractAt(erc20Abi, USDG);

  console.log("=== USDG token metadata ===");
  console.log("name:", await usdg.name());
  console.log("symbol:", await usdg.symbol());
  console.log("decimals:", await usdg.decimals());
  console.log("totalSupply (raw):", (await usdg.totalSupply()).toString());

  const oracleAbi = [
    "function decimals() external view returns (uint8)",
    "function latestRoundData() external view returns (uint80,int256,uint256,uint256,uint80)",
  ];
  const feed = await ethers.getContractAt(oracleAbi, USDG_USD_FEED);

  console.log("\n=== USDG/USD Chainlink feed ===");
  const feedDecimals = await feed.decimals();
  console.log("feed decimals:", feedDecimals);
  const roundData = await feed.latestRoundData();
  console.log("latestRoundData:", roundData);
  const price = Number(roundData[1]) / 10 ** Number(feedDecimals);
  console.log("implied price: $" + price.toFixed(4));
  const updatedAt = Number(roundData[3]);
  const now = Math.floor(Date.now() / 1000);
  console.log("seconds since last update:", now - updatedAt);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
