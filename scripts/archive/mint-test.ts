import { network } from "hardhat";

const VAULT_ADDRESS = "0x80B9594400eF598D7260b643A18417EeDdE936e0";
const BASKET_ID = 1; // AI Infrastructure

async function main() {
  const { ethers } = await network.connect();
  const [, signer] = await ethers.getSigners(); // second account = funded test-user wallet

  console.log("Minting from:", signer.address);

  const balance = await ethers.provider.getBalance(signer.address);
  console.log("Actual on-chain balance:", ethers.formatEther(balance), "ETH");

  const feeData = await ethers.provider.getFeeData();
  console.log("Fee data:", {
    gasPrice: feeData.gasPrice?.toString(),
    maxFeePerGas: feeData.maxFeePerGas?.toString(),
    maxPriorityFeePerGas: feeData.maxPriorityFeePerGas?.toString(),
  });

  const vault = await ethers.getContractAt("StaxVault", VAULT_ADDRESS);

  const basketBefore = await vault.baskets(BASKET_ID);
  console.log("Basket:", basketBefore.name);

  const StaxBasketToken = await ethers.getContractFactory("StaxBasketToken");
  const basketToken = StaxBasketToken.attach(basketBefore.token);

  const balanceBefore = await basketToken.balanceOf(signer.address);
  console.log("Basket token balance before:", ethers.formatUnits(balanceBefore, 18));

  const depositAmount = ethers.parseEther("0.05"); // ~$150 at $3000/ETH, safely above the $100 min
  console.log("Minting with", ethers.formatEther(depositAmount), "ETH...");

  const mintData = vault.interface.encodeFunctionData("mint", [BASKET_ID]);

  const tx = await signer.sendTransaction({
    to: VAULT_ADDRESS,
    data: mintData,
    value: depositAmount,
    gasLimit: 3_000_000,
    gasPrice: ethers.parseUnits("1", "gwei"),
  });
  console.log("Tx sent:", tx.hash);
  const receipt = await tx.wait();
  console.log("Confirmed in block:", receipt!.blockNumber);

  const balanceAfter = await basketToken.balanceOf(signer.address);
  console.log("Basket token balance after:", ethers.formatUnits(balanceAfter, 18));

  console.log("");
  console.log("=== MINT SUCCESSFUL ===");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
