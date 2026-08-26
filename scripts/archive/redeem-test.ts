import { network } from "hardhat";

const VAULT_ADDRESS = "0x80B9594400eF598D7260b643A18417EeDdE936e0";
const BASKET_ID = 2; // Mag 7

async function main() {
  const { ethers } = await network.connect();
  const [, signer] = await ethers.getSigners(); // second account = funded test-user wallet

  console.log("Redeeming from:", signer.address);

  const vault = await ethers.getContractAt("StaxVault", VAULT_ADDRESS);

  const basket = await vault.baskets(BASKET_ID);
  const StaxBasketToken = await ethers.getContractFactory("StaxBasketToken");
  const basketToken = StaxBasketToken.attach(basket.token);

  const tokenBalance = await (basketToken.connect(signer) as any).balanceOf(signer.address);
  console.log("Basket token balance to redeem:", ethers.formatUnits(tokenBalance, 18));

  if (tokenBalance === 0n) {
    console.log("Nothing to redeem.");
    return;
  }

  const ethBalanceBefore = await ethers.provider.getBalance(signer.address);

  const redeemData = vault.interface.encodeFunctionData("redeem", [BASKET_ID, tokenBalance]);

  const tx = await signer.sendTransaction({
    to: VAULT_ADDRESS,
    data: redeemData,
    gasLimit: 3_000_000,
    gasPrice: ethers.parseUnits("1", "gwei"),
  });
  console.log("Tx sent:", tx.hash);
  const receipt = await tx.wait();
  console.log("Confirmed in block:", receipt!.blockNumber);

  const ethBalanceAfter = await ethers.provider.getBalance(signer.address);
  const gasCost = receipt!.gasUsed * receipt!.gasPrice;
  const netReceived = ethBalanceAfter - ethBalanceBefore + gasCost;

  const remainingTokens = await (basketToken.connect(signer) as any).balanceOf(signer.address);

  console.log("");
  console.log("ETH received (net of gas):", ethers.formatEther(netReceived));
  console.log("Remaining basket token balance:", ethers.formatUnits(remainingTokens, 18));
  console.log("");
  console.log("=== REDEEM SUCCESSFUL ===");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
