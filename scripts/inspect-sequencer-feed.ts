import { network } from "hardhat";

async function main() {
  const { ethers } = await network.connect();
  const address = "0x0952621d4a4eEF3Aa659edBd98669dF2689DBEaA";

  const code = await ethers.provider.getCode(address);
  console.log("Has contract code:", code !== "0x", "(length:", code.length, ")");

  if (code === "0x") {
    console.log("This is NOT a contract -- it's an empty/unused address. Any call to it would revert.");
    return;
  }

  // Try treating it as a Chainlink-style price feed, same interface
  // the vault expects (IPriceOracle: decimals() + latestRoundData()).
  try {
    const feed = await ethers.getContractAt(
      ["function decimals() external view returns (uint8)",
       "function latestRoundData() external view returns (uint80,int256,uint256,uint256,uint80)"],
      address
    );
    const decimals = await feed.decimals();
    console.log("decimals():", decimals);
    const roundData = await feed.latestRoundData();
    console.log("latestRoundData():", roundData);
  } catch (err) {
    console.log("Call failed -- doesn't implement the expected interface, or reverted:");
    console.log(err);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});