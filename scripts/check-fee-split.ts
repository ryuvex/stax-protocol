import { network } from "hardhat";

const VAULT_ADDRESS = "0xca3F3182221F86E89BeE99795170bd4251A6BA82";
const USDG_ADDRESS = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";

const VAULT_ABI = [
  {
    type: "function",
    name: "pendingBuyBurn",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "pendingRewardsPool",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "pendingTreasuryFees",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "rewardsPool",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "treasury",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
] as const;

const ERC20_ABI = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

async function main() {
  const { ethers } = await network.connect({ network: "robinhoodMainnet" });

  const vault = new ethers.Contract(VAULT_ADDRESS, VAULT_ABI, ethers.provider);
  const usdg = new ethers.Contract(USDG_ADDRESS, ERC20_ABI, ethers.provider);

  console.log("=== REAL, LIVE FEE-SPLIT STATE CHECK ===\n");

  const pendingBuyBurn = await vault.pendingBuyBurn();
  const pendingRewardsPool = await vault.pendingRewardsPool();
  const pendingTreasuryFees = await vault.pendingTreasuryFees();

  console.log("Pending buy-burn (50%):", ethers.formatUnits(pendingBuyBurn, 6), "USDG");
  console.log("Pending rewards pool (30%):", ethers.formatUnits(pendingRewardsPool, 6), "USDG");
  console.log("Pending treasury (20%):", ethers.formatUnits(pendingTreasuryFees, 6), "USDG");

  const total = pendingBuyBurn + pendingRewardsPool + pendingTreasuryFees;
  console.log("\nTotal accrued fees:", ethers.formatUnits(total, 6), "USDG");

  // Real split percentages, computed from real numbers, not assumed.
  if (total > 0n) {
    const burnPct = (Number(pendingBuyBurn) / Number(total)) * 100;
    const rewardsPct = (Number(pendingRewardsPool) / Number(total)) * 100;
    const treasuryPct = (Number(pendingTreasuryFees) / Number(total)) * 100;
    console.log(`\nReal split: ${burnPct.toFixed(2)}% burn / ${rewardsPct.toFixed(2)}% rewards / ${treasuryPct.toFixed(2)}% treasury`);
    console.log("(expected: 50% / 30% / 20%)");
  }

  const vaultUsdgBalance = await usdg.balanceOf(VAULT_ADDRESS);
  console.log("\nContract's real USDG balance:", ethers.formatUnits(vaultUsdgBalance, 6));
  console.log("Invariant check (balance >= pending sum):", vaultUsdgBalance >= total ? "HOLDS" : "*** VIOLATED ***");

  const rewardsPoolAddr = await vault.rewardsPool();
  const treasuryAddr = await vault.treasury();
  console.log("\nRewards pool address:", rewardsPoolAddr);
  console.log("Treasury address:", treasuryAddr);

  const rewardsPoolBalanceBefore = await usdg.balanceOf(rewardsPoolAddr);
  const treasuryBalanceBefore = await usdg.balanceOf(treasuryAddr);
  console.log("\nRewards pool's REAL USDG balance right now:", ethers.formatUnits(rewardsPoolBalanceBefore, 6));
  console.log("Treasury's REAL USDG balance right now:", ethers.formatUnits(treasuryBalanceBefore, 6));
  console.log("\n(These should still be 0 -- fees ACCRUE on mint/redeem, but only actually");
  console.log("move to these addresses when claimRewardsPool()/claimTreasuryFees() are");
  console.log("explicitly called. Accrual and payout are two separate, distinct steps.)");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
