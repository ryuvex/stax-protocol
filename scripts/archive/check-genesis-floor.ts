import { network } from "hardhat";

const VAULT_ADDRESS = "0x62C641739c2317b740F5A18904311f5c4aD0DDb7";

async function main() {
  const { ethers } = await network.connect();
  const vault = await ethers.getContractAt("StaxVault", VAULT_ADDRESS);
  const floor = await vault.MIN_INITIAL_VALUE_USD();
  console.log("MIN_INITIAL_VALUE_USD (raw):", floor.toString());
  console.log("MIN_INITIAL_VALUE_USD (USD):", ethers.formatUnits(floor, 18));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
