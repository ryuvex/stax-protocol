import { network } from "hardhat";

const VAULT_ADDRESS = "0xE5c681cF88F6E0B0c9a033059A2eD6511Fb60aeb"; // v13

const BASKETS = [
  { name: "AI Infrastructure", id: 1 },
  { name: "Mag 7", id: 2 },
  { name: "Crypto Proxy Equities", id: 3 },
  { name: "Quantum Computing", id: 4 },
  { name: "New Space", id: 5 },
  { name: "Broad Semiconductors", id: 6 },
];

const SEED_AMOUNT_ETH = "0.02";

async function main() {
  const { ethers } = await network.connect();
  const [, signer] = await ethers.getSigners();

  console.log("Seeding from:", signer.address);
  const balance = await ethers.provider.getBalance(signer.address);
  console.log("Balance:", ethers.formatEther(balance), "ETH");
  console.log("");

  const vault = await ethers.getContractAt("StaxVault", VAULT_ADDRESS);
  const depositAmount = ethers.parseEther(SEED_AMOUNT_ETH);

  for (const basket of BASKETS) {
    console.log(`Minting into ${basket.name} (id ${basket.id})...`);
    const mintData = vault.interface.encodeFunctionData("mint", [basket.id]);
    try {
      const tx = await signer.sendTransaction({
        to: VAULT_ADDRESS,
        data: mintData,
        value: depositAmount,
        gasLimit: 3_000_000,
        gasPrice: ethers.parseUnits("1", "gwei"),
      });
      await tx.wait();
      console.log(`  Success — tx: ${tx.hash}`);
    } catch (err: any) {
      console.log(`  FAILED: ${err?.message ?? err}`);
    }
  }

  console.log("");
  console.log("=== SEEDING COMPLETE (v13) ===");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
