import { network } from "hardhat";

const VAULT_ADDRESS = "0x8C1fe310f75c16453EEd2d25cddd49eeE48d89EC";

async function main() {
  const { ethers } = await network.connect();
  const vault = await ethers.getContractAt("StaxVault", VAULT_ADDRESS);

  const basketId = 1; // AI Infrastructure

  const navUsd18 = await vault.getBasketNavUsd(basketId);
  console.log("Raw NAV (usd18):", navUsd18.toString());
  console.log("NAV in USD:", ethers.formatUnits(navUsd18, 18));

  const basketData = await vault.baskets(basketId);
  const tokenAddress = basketData[1];
  console.log("Basket token address:", tokenAddress);

  const token = await ethers.getContractAt("StaxBasketToken", tokenAddress);
  const totalSupplyRaw = await token.totalSupply();
  console.log("Raw total supply:", totalSupplyRaw.toString());
  console.log("Total supply (tokens):", ethers.formatUnits(totalSupplyRaw, 18));

  if (totalSupplyRaw > 0n) {
    const navPerToken = Number(ethers.formatUnits(navUsd18, 18)) / Number(ethers.formatUnits(totalSupplyRaw, 18));
    console.log("Computed price per token: $" + navPerToken.toFixed(6));
  } else {
    console.log("Total supply is exactly zero -- no mints have landed on this basket yet.");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
