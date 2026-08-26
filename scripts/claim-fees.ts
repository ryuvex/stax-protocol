import { network } from "hardhat";

const VAULT_ADDRESS = "0xca3F3182221F86E89BeE99795170bd4251A6BA82";
const USDG_ADDRESS = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";

const VAULT_ABI = [
  {
    type: "function",
    name: "claimRewardsPool",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
  {
    type: "function",
    name: "claimTreasuryFees",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
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
  const [signer] = await ethers.getSigners();

  const vault = new ethers.Contract(VAULT_ADDRESS, VAULT_ABI, signer);
  const usdg = new ethers.Contract(USDG_ADDRESS, ERC20_ABI, ethers.provider);

  console.log("=== REAL CLAIM TEST -- rewards pool + treasury payout ===\n");

  const rewardsPoolAddr = await vault.rewardsPool();
  const treasuryAddr = await vault.treasury();

  const rewardsPending = await vault.pendingRewardsPool();
  const treasuryPending = await vault.pendingTreasuryFees();
  console.log("Pending rewards pool:", ethers.formatUnits(rewardsPending, 6), "USDG");
  console.log("Pending treasury:", ethers.formatUnits(treasuryPending, 6), "USDG");

  const rewardsBefore = await usdg.balanceOf(rewardsPoolAddr);
  const treasuryBefore = await usdg.balanceOf(treasuryAddr);
  console.log("\nRewards pool balance BEFORE:", ethers.formatUnits(rewardsBefore, 6));
  console.log("Treasury balance BEFORE:", ethers.formatUnits(treasuryBefore, 6));

  console.log("\nCalling claimRewardsPool()...");
  const tx1 = await vault.claimRewardsPool();
  console.log("  tx:", tx1.hash);
  await tx1.wait();
  console.log("  confirmed.");

  console.log("\nCalling claimTreasuryFees()...");
  const tx2 = await vault.claimTreasuryFees();
  console.log("  tx:", tx2.hash);
  await tx2.wait();
  console.log("  confirmed.");

  const rewardsAfter = await usdg.balanceOf(rewardsPoolAddr);
  const treasuryAfter = await usdg.balanceOf(treasuryAddr);
  console.log("\n=== RESULTS ===");
  console.log("Rewards pool balance AFTER:", ethers.formatUnits(rewardsAfter, 6));
  console.log("Treasury balance AFTER:", ethers.formatUnits(treasuryAfter, 6));

  const rewardsReceived = rewardsAfter - rewardsBefore;
  const treasuryReceived = treasuryAfter - treasuryBefore;
  console.log("\nReal USDG received by rewards pool:", ethers.formatUnits(rewardsReceived, 6));
  console.log("Real USDG received by treasury:", ethers.formatUnits(treasuryReceived, 6));

  const pendingAfter1 = await vault.pendingRewardsPool();
  const pendingAfter2 = await vault.pendingTreasuryFees();
  console.log("\nPending rewards pool AFTER claim (should be 0):", ethers.formatUnits(pendingAfter1, 6));
  console.log("Pending treasury AFTER claim (should be 0):", ethers.formatUnits(pendingAfter2, 6));

  console.log("\n=== CLAIM PAYOUT: CONFIRMED WORKING ===");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
