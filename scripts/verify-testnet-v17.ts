import { network } from "hardhat";

const VAULT_ADDRESS = "0xDFdc474f54ECfDEBcEd8D79A6EF49E99197130F7";
const USDG_ADDRESS = "0x60d07CaF6178283241Ba3f54F3681BBCdCE3B5Be";
const BASKET_ID = 1; // AI Infrastructure

async function main() {
  const { ethers } = await network.connect({ network: "robinhoodTestnet" });
  const [deployer] = await ethers.getSigners();

  const vaultAbi = [
    "function mint(uint256,uint256) external",
    "function redeem(uint256,uint256) external",
    "function baskets(uint256) external view returns (string,address,uint256,uint256,bool,bool)",
    "function getBasketNavUsd(uint256) external view returns (uint256)",
  ];
  const usdgAbi = [
    "function decimals() external view returns (uint8)",
    "function mint(address,uint256) external",
    "function approve(address,uint256) external returns (bool)",
    "function balanceOf(address) external view returns (uint256)",
  ];
  const tokenAbi = ["function balanceOf(address) external view returns (uint256)"];

  const vault = await ethers.getContractAt(vaultAbi, VAULT_ADDRESS);
  const usdg = await ethers.getContractAt(usdgAbi, USDG_ADDRESS);

  console.log("=== Real mint/redeem verification against live v17 testnet deploy ===\n");

  const basketInfo = await vault.baskets(BASKET_ID);
  const basketTokenAddress = basketInfo[1];
  console.log("Basket 1 token address:", basketTokenAddress);
  const basketToken = await ethers.getContractAt(tokenAbi, basketTokenAddress);

  const mintAmount = ethers.parseUnits("1000", 6); // 1000 USDG
  console.log(`\nMinting ${ethers.formatUnits(mintAmount, 6)} test USDG to deployer...`);
  const mintTx = await usdg.mint(deployer.address, mintAmount);
  await mintTx.wait();

  console.log("Approving vault...");
  const approveTx = await usdg.approve(VAULT_ADDRESS, mintAmount);
  await approveTx.wait();

  console.log("Depositing into basket 1 (AI Infrastructure)...");
  const depositTx = await vault.mint(BASKET_ID, mintAmount);
  const depositReceipt = await depositTx.wait();
  console.log("  Deposit tx:", depositReceipt!.hash);

  const basketTokenBalance = await basketToken.balanceOf(deployer.address);
  console.log("  Basket token balance received:", ethers.formatUnits(basketTokenBalance, 18));

  const navAfterMint = await vault.getBasketNavUsd(BASKET_ID);
  console.log("  Basket NAV after mint (usd18):", ethers.formatUnits(navAfterMint, 18));

  if (basketTokenBalance === 0n) {
    console.log("\n*** MINT FAILED TO PRODUCE TOKENS -- something is wrong, stop here. ***");
    process.exitCode = 1;
    return;
  }

  console.log("\nRedeeming full balance...");
  const usdgBeforeRedeem = await usdg.balanceOf(deployer.address);
  const redeemTx = await vault.redeem(BASKET_ID, basketTokenBalance);
  const redeemReceipt = await redeemTx.wait();
  console.log("  Redeem tx:", redeemReceipt!.hash);

  const usdgAfterRedeem = await usdg.balanceOf(deployer.address);
  const usdgReceived = usdgAfterRedeem - usdgBeforeRedeem;
  console.log("  USDG received back:", ethers.formatUnits(usdgReceived, 6));

  const remainingBasketTokens = await basketToken.balanceOf(deployer.address);
  console.log("  Remaining basket tokens:", ethers.formatUnits(remainingBasketTokens, 18), "(should be 0)");

  console.log("\n=== RESULT ===");
  if (remainingBasketTokens === 0n && usdgReceived > 0n) {
    console.log("SUCCESS: real mint and redeem both completed cleanly against live testnet v17.");
  } else {
    console.log("UNEXPECTED STATE -- review the numbers above before trusting this deploy.");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
