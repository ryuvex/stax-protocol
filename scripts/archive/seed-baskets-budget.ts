import { network } from "hardhat";

const VAULT_ADDRESS = "0x80B9594400eF598D7260b643A18417EeDdE936e0";

// Only baskets that actually need seeding right now:
// - Crypto Proxy, Quantum, New Space: genuinely zero supply, need a real
//   first mint clearing the $100 floor.
// - AI Infrastructure: has dust-level (nonzero) supply already, so the
//   $100 floor does NOT apply -- a small top-up is enough to fix its
//   real-price display.
// Mag 7 and Broad Semiconductors already have real, working supply --
// deliberately skipped to save budget.
const SEED_PLAN = [
  { name: "AI Infrastructure", id: 1, amountEth: "0.005" },
  { name: "Crypto Proxy Equities", id: 3, amountEth: "0.045" },
  { name: "Quantum Computing", id: 4, amountEth: "0.045" },
  { name: "New Space", id: 5, amountEth: "0.045" },
];

async function main() {
  const { ethers } = await network.connect();
  const [, signer] = await ethers.getSigners(); // second account = funded test-user wallet

  console.log("Seeding from:", signer.address);
  const balance = await ethers.provider.getBalance(signer.address);
  console.log("Balance:", ethers.formatEther(balance), "ETH");
  console.log("");

  const vault = await ethers.getContractAt("StaxVault", VAULT_ADDRESS);

  for (const basket of SEED_PLAN) {
    console.log(`Minting ${basket.amountEth} ETH into ${basket.name} (id ${basket.id})...`);

    const mintData = vault.interface.encodeFunctionData("mint", [basket.id]);
    const depositAmount = ethers.parseEther(basket.amountEth);

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
  console.log("=== SEEDING COMPLETE ===");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
