import { network } from "hardhat";

const VAULT_ADDRESS = "0x576b931BA15B632003062403Dd194fC09eB9413c";

const BASKETS = [
  { name: "AI Infrastructure", id: 1 },
  { name: "Mag 7", id: 2 },
  { name: "Crypto Proxy Equities", id: 3 },
  { name: "Quantum Computing", id: 4 },
  { name: "New Space", id: 5 },
  { name: "Broad Semiconductors", id: 6 },
];

async function main() {
  const { ethers } = await network.connect();
  const vault = await ethers.getContractAt("StaxVault", VAULT_ADDRESS);

  console.log("Checking real on-chain seed state for v11...\n");

  for (const basket of BASKETS) {
    const info = await vault.baskets(basket.id);
    const tokenAddress = info[1] as string;
    const token = await ethers.getContractAt("StaxBasketToken", tokenAddress);
    const supply = await token.totalSupply();
    const navRaw = await vault.getBasketNavUsd(basket.id);

    const supplyFormatted = ethers.formatUnits(supply, 18);
    const navFormatted = ethers.formatUnits(navRaw, 18);

    console.log(
      `  ${basket.name} (id ${basket.id}): supply=${supplyFormatted} NAV=$${navFormatted} ${
        supply === 0n ? "-- EMPTY, needs seeding" : "-- seeded"
      }`
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
