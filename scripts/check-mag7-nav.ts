import { network } from "hardhat";

const VAULT_ADDRESS = "0xca3F3182221F86E89BeE99795170bd4251A6BA82";
const MAG7_BASKET_ID = 2;

const VAULT_ABI = [
  {
    type: "function",
    name: "getBasketNavUsd",
    stateMutability: "view",
    inputs: [{ name: "basketId", type: "uint256" }],
    outputs: [{ name: "totalValueUsd", type: "uint256" }],
  },
  {
    type: "function",
    name: "baskets",
    stateMutability: "view",
    inputs: [{ name: "", type: "uint256" }],
    outputs: [
      { name: "name", type: "string" },
      { name: "token", type: "address" },
      { name: "depositCapUsd", type: "uint256" },
      { name: "maxMintUsd", type: "uint256" },
      { name: "mintPaused", type: "bool" },
      { name: "exists", type: "bool" },
    ],
  },
] as const;

const ERC20_ABI = [
  {
    type: "function",
    name: "totalSupply",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

async function main() {
  const { ethers } = await network.connect({ network: "robinhoodMainnet" });

  const vault = new ethers.Contract(VAULT_ADDRESS, VAULT_ABI, ethers.provider);

  console.log("=== DIRECT ON-CHAIN CHECK, bypassing the frontend entirely ===\n");

  const basketInfo = await vault.baskets(MAG7_BASKET_ID);
  console.log("baskets(2) raw result:");
  console.log("  name:", basketInfo[0]);
  console.log("  token:", basketInfo[1]);
  console.log("  depositCapUsd:", basketInfo[2].toString());
  console.log("  maxMintUsd:", basketInfo[3].toString());
  console.log("  mintPaused:", basketInfo[4]);
  console.log("  exists:", basketInfo[5]);

  try {
    const nav = await vault.getBasketNavUsd(MAG7_BASKET_ID);
    console.log("\ngetBasketNavUsd(2) raw result:", nav.toString());
    console.log("Formatted (18dp):", ethers.formatUnits(nav, 18));
  } catch (err: any) {
    console.log("\n*** getBasketNavUsd(2) REVERTED ***");
    console.log("Error:", err.message);
  }

  const tokenAddress = basketInfo[1];
  const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, ethers.provider);
  const supply = await tokenContract.totalSupply();
  console.log("\nBasket token totalSupply() raw:", supply.toString());
  console.log("Formatted (18dp):", ethers.formatUnits(supply, 18));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
