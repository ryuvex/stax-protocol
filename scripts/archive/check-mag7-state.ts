import { network } from "hardhat";

const VAULT_ADDRESS = "0xD06F68a482cE2ab891E01dB5D9bE24b92b06aBbd";
const MAG7_BASKET_ID = 2;

async function main() {
  const { ethers } = await network.connect();
  const vault = await ethers.getContractAt("StaxVault", VAULT_ADDRESS);

  const basket = await vault.baskets(MAG7_BASKET_ID);
  console.log("Basket token address:", basket.token);

  const basketToken = await ethers.getContractAt("StaxBasketToken", basket.token);
  const totalSupply = await basketToken.totalSupply();
  console.log("Total supply (raw):", totalSupply.toString());
  console.log("Total supply (formatted):", ethers.formatUnits(totalSupply, 18));

  const navUsd = await vault.getBasketNavUsd(MAG7_BASKET_ID);
  console.log("NAV (raw):", navUsd.toString());
  console.log("NAV (formatted USD):", ethers.formatUnits(navUsd, 18));

  console.log("");
  if (totalSupply === 0n) {
    console.log("Supply is genuinely zero. If NAV is also zero, contract is correct --");
    console.log("any nonzero price shown in the UI is a frontend display bug (likely");
    console.log("dividing NAV/supply without handling the 0/0 case), not a contract issue.");
  } else {
    console.log("Supply is NOT zero -- redeem may not have fully cleared. Worth investigating.");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
