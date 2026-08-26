import { network } from "hardhat";

const VAULT_ADDRESS = "0x420943e5A26efFfaD91eD968cC4C4322a19306b2";
const USDG_ADDRESS = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
const USDG_DECIMALS = 6;
const BASKET_ID = 1; // AI Infrastructure
const REAL_DEPLOYER = "0xCECa5491a16ea73F29990313924285EEB9771e3b";

async function main() {
  // Reuses the same forking network already configured for the gas
  // estimation work -- forks REAL current mainnet state, so this is
  // testing against the actual real Uniswap V4 router/pools, not mocks.
  const { ethers } = await network.connect({ network: "robinhoodMainnetFork" });

  console.log("Impersonating the real deployer account on the fork...");
  await ethers.provider.send("hardhat_impersonateAccount", [REAL_DEPLOYER]);
  const deployer = await ethers.getSigner(REAL_DEPLOYER);

  // Ensure gas isn't the constraint on the SIMULATION itself.
  await ethers.provider.send("hardhat_setBalance", [REAL_DEPLOYER, "0x21E19E0C9BAB2400000"]);

  const vaultAbi = [
    "function mint(uint256 basketId, uint256 usdgAmount) external",
  ];
  const vault = await ethers.getContractAt(vaultAbi, VAULT_ADDRESS, deployer);

  const erc20Abi = [
    "function approve(address spender, uint256 amount) external returns (bool)",
    "function balanceOf(address account) external view returns (uint256)",
  ];
  const usdg = await ethers.getContractAt(erc20Abi, USDG_ADDRESS, deployer);

  const amount = ethers.parseUnits("2.10", USDG_DECIMALS);

  const balance = await usdg.balanceOf(REAL_DEPLOYER);
  console.log("Real USDG balance on fork (inherited from real mainnet state):", ethers.formatUnits(balance, USDG_DECIMALS));

  console.log("\nApproving vault to pull USDG (on fork)...");
  const approveTx = await usdg.approve(VAULT_ADDRESS, amount);
  await approveTx.wait();

  console.log("\nAttempting the real mint call on the fork -- capturing full local trace...");
  try {
    const tx = await vault.mint(BASKET_ID, amount);
    const receipt = await tx.wait();
    console.log("SUCCEEDED on fork. Receipt:", receipt?.hash, "gasUsed:", receipt?.gasUsed);
  } catch (err: any) {
    console.log("\n=== FULL ERROR DETAIL FROM LOCAL SIMULATION ===");
    console.log("Message:", err.message);
    console.log("\nShortMessage:", err.shortMessage);
    console.log("\nReason:", err.reason);
    console.log("\nFull error object:");
    console.log(JSON.stringify(err, Object.getOwnPropertyNames(err), 2));
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
