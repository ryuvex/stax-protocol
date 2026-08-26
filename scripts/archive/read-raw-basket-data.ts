import { network } from "hardhat";

const VAULT_ADDRESS = "0x80B9594400eF598D7260b643A18417EeDdE936e0";

async function main() {
  const { ethers } = await network.connect();
  const vault = await ethers.getContractAt("StaxVault", VAULT_ADDRESS);

  for (const [name, basketId] of [
    ["Mag 7", 2],
    ["AI Infrastructure", 1],
  ] as const) {
    console.log(`\n=== ${name} (basket ${basketId}) ===`);

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

    const navPerToken = Number(ethers.formatUnits(navUsd18, 18)) / Number(ethers.formatUnits(totalSupplyRaw, 18));
    console.log("Computed price per token: $" + navPerToken.toFixed(6));
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
