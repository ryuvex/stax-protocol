import { network } from "hardhat";

const VAULT_ADDRESS = "0x576b931BA15B632003062403Dd194fC09eB9413c"; // v11

// Only the 3 baskets confirmed still empty by check-v11-seed-state.ts --
// baskets 1-3 already seeded successfully in an earlier run tonight and
// are deliberately NOT included here, so we don't double-spend on them.
const BASKETS = [
  { name: "Quantum Computing", id: 4 },
  { name: "New Space", id: 5 },
  { name: "Broad Semiconductors", id: 6 },
];

// Genesis floor is now $2 (v10+), so this comfortably clears it with
// room to spare while conserving the wallet's remaining ~0.145 ETH
// balance -- no need for the earlier 0.15 ETH/basket amount anymore.
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
  console.log("=== REMAINING BASKETS SEEDED (v11) ===");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
