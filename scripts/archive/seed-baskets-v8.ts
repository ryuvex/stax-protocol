import { network } from "hardhat";

const VAULT_ADDRESS = "0xD06F68a482cE2ab891E01dB5D9bE24b92b06aBbd"; // v8, ledger-only

// On-chain numeric basket IDs, per deploy-testnet-v8.ts.
const BASKETS = [
  { name: "AI Infrastructure", id: 1 },
  { name: "Mag 7", id: 2 },
  { name: "Crypto Proxy Equities", id: 3 },
  { name: "Quantum Computing", id: 4 },
  { name: "New Space", id: 5 },
  { name: "Broad Semiconductors", id: 6 },
];

// ~$450 at $3000/ETH — comfortably above the $100 first-mint floor, with
// real margin, so this works whether a basket is totally empty (true here,
// v8 is a fresh deployment) or already has some dust-level supply.
const SEED_AMOUNT_ETH = "0.15";

async function main() {
  const { ethers } = await network.connect();
  const [, signer] = await ethers.getSigners(); // second account = funded test-user wallet

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
  console.log("=== SEEDING COMPLETE (v8) ===");
  console.log("Next: spot-check shared-ticker isolation with basketTickerHoldings, e.g.");
  console.log("  vault.basketTickerHoldings(1, NVDA_ADDRESS)  // AI Infrastructure's NVDA");
  console.log("  vault.basketTickerHoldings(2, NVDA_ADDRESS)  // Mag 7's NVDA");
  console.log("Both should be nonzero and independent -- sum of the two should equal");
  console.log("NVDA's real pooled balanceOf(vault).");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
