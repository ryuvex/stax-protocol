import { network } from "hardhat";

const DEPLOYER_ADDRESS = "0xCECa5491a16ea73F29990313924285EEB9771e3b";
const USDG_ADDRESS = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";

async function main() {
  const { ethers } = await network.connect({ network: "robinhoodMainnet" });

  const erc20Abi = [
    "function balanceOf(address) external view returns (uint256)",
    "function decimals() external view returns (uint8)",
  ];
  const usdg = await ethers.getContractAt(erc20Abi, USDG_ADDRESS);

  const decimals = await usdg.decimals();
  const balance = await usdg.balanceOf(DEPLOYER_ADDRESS);

  console.log("Real USDG balance for deployer:", ethers.formatUnits(balance, decimals), "USDG");
  console.log("(decimals confirmed:", decimals, ")");

  const ethBalance = await ethers.provider.getBalance(DEPLOYER_ADDRESS);
  console.log("Remaining ETH balance:", ethers.formatEther(ethBalance), "ETH");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
