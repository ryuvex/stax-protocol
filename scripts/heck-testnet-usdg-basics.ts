import { network } from "hardhat";

// Real testnet USDG, confirmed on-chain earlier tonight.
const TESTNET_USDG = "0x1cBf081C3FFAFc136DF6e53eb4b26dddf191C38c";

async function main() {
  const { ethers } = await network.connect({ network: "robinhoodTestnet" });

  // Testnet WETH, from Robinhood's own documented contract list.
  const TESTNET_WETH = "0x7943e237c7F95DA44E0301572D358911207852Fa";

  console.log("Checking network...");
  const net = await ethers.provider.getNetwork();
  console.log("Chain ID:", net.chainId.toString(), "(expect 46630 for testnet)\n");

  // Confirm USDG contract is really there and readable.
  const erc20Abi = [
    "function decimals() external view returns (uint8)",
    "function balanceOf(address) external view returns (uint256)",
  ];
  const usdg = await ethers.getContractAt(erc20Abi, TESTNET_USDG);
  console.log("Testnet USDG decimals:", await usdg.decimals());

  const [deployer] = await ethers.getSigners();
  const ethBalance = await ethers.provider.getBalance(deployer.address);
  const usdgBalance = await usdg.balanceOf(deployer.address);
  console.log("Deployer ETH balance:", ethers.formatEther(ethBalance));
  console.log("Deployer USDG balance:", ethers.formatUnits(usdgBalance, 6));

  console.log("\nWETH address being checked:", TESTNET_WETH);
  console.log("(If this fails to resolve or looks wrong, the testnet WETH");
  console.log(" address needs confirming separately -- this is taken from");
  console.log(" Robinhood's documented testnet contract list.)");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
