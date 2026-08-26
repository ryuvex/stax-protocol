import { network } from "hardhat";

const VAULT_ADDRESS = "0x420943e5A26efFfaD91eD968cC4C4322a19306b2";

async function main() {
  const { ethers } = await network.connect({ network: "robinhoodMainnet" });
  const [deployer] = await ethers.getSigners();

  const vaultAbi = ["function mint(uint256 basketId, uint256 usdgAmount) external"];
  const vault = await ethers.getContractAt(vaultAbi, VAULT_ADDRESS, deployer);

  console.log("Sending the real transaction with a manually fixed gas limit -- this");
  console.log("bypasses automatic gas estimation, which has been silently catching");
  console.log("the revert before ever broadcasting. This WILL likely revert on-chain,");
  console.log("but that gives us a REAL, traceable transaction hash to inspect.\n");

  try {
    const tx = await vault.mint(1, 2_100_000n, { gasLimit: 500_000 });
    console.log("Transaction broadcast! Hash:", tx.hash);
    console.log("Waiting for it to be mined (it will likely show as failed, that's expected)...");

    const receipt = await tx.wait().catch((err) => {
      console.log("\ntx.wait() threw (expected if it reverted) -- but the hash above is still real and traceable.");
      console.log("Error from wait():", err.message ?? err);
      return null;
    });

    if (receipt) {
      console.log("Status:", receipt.status === 1 ? "SUCCESS (unexpected!)" : "REVERTED (expected)");
      console.log("Gas used:", receipt.gasUsed);
    }

    console.log("\n=== USE THIS HASH FOR THE TRACE ===");
    console.log(tx.hash);
  } catch (err: any) {
    console.log("Failed even to broadcast:", err.message ?? err);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
