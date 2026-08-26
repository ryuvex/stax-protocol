import { network } from "hardhat";

const VAULT_ADDRESS = "0x420943e5A26efFfaD91eD968cC4C4322a19306b2";
const USDG_ADDRESS = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
const USDG_DECIMALS = 6;

// $2.10 gross per basket -- nets to $2.0947 after the 0.25% fee,
// clearing the $2.00 MIN_INITIAL_VALUE_USD genesis-mint floor with
// real margin (confirmed via direct arithmetic, not assumed).
const SEED_AMOUNT_PER_BASKET = "2.10";

const BASKETS = [
  { id: 1, name: "AI Infrastructure" },
  { id: 2, name: "Mag 7" },
  { id: 3, name: "Crypto Proxy Equities" },
  { id: 4, name: "Broad Semiconductors" },
];

async function main() {
  const { ethers } = await network.connect({ network: "robinhoodMainnet" });
  const [deployer] = await ethers.getSigners();

  const vaultAbi = [
    "function mint(uint256 basketId, uint256 usdgAmount) external",
    "function baskets(uint256) external view returns (string name, address token, uint256 depositCapUsd, uint256 maxMintUsd, bool mintPaused, bool exists)",
  ];
  const erc20Abi = [
    "function approve(address spender, uint256 amount) external returns (bool)",
    "function allowance(address owner, address spender) external view returns (uint256)",
    "function balanceOf(address account) external view returns (uint256)",
  ];

  const vault = await ethers.getContractAt(vaultAbi, VAULT_ADDRESS);
  const usdg = await ethers.getContractAt(erc20Abi, USDG_ADDRESS);

  const amountPerBasket = ethers.parseUnits(SEED_AMOUNT_PER_BASKET, USDG_DECIMALS);
  const totalNeeded = amountPerBasket * BigInt(BASKETS.length);

  console.log(`=== Seeding all ${BASKETS.length} baskets with ${SEED_AMOUNT_PER_BASKET} USDG each ===\n`);

  const usdgBalance = await usdg.balanceOf(deployer.address);
  console.log(`Current USDG balance: ${ethers.formatUnits(usdgBalance, USDG_DECIMALS)}`);
  console.log(`Total needed: ${ethers.formatUnits(totalNeeded, USDG_DECIMALS)}\n`);

  if (usdgBalance < totalNeeded) {
    console.log("*** INSUFFICIENT USDG -- stopping before spending anything. ***");
    process.exitCode = 1;
    return;
  }

  // Approve the FULL total up front, once -- simpler than approving
  // per-basket, and this wallet only ever mints from itself, so a
  // single standing approval for the known total is safe here.
  console.log("Approving vault to pull total USDG needed...");
  const approveTx = await usdg.approve(VAULT_ADDRESS, totalNeeded);
  await approveTx.wait();
  const allowance = await usdg.allowance(deployer.address, VAULT_ADDRESS);
  console.log(`Allowance confirmed: ${ethers.formatUnits(allowance, USDG_DECIMALS)} USDG\n`);

  for (const basket of BASKETS) {
    console.log(`--- Basket ${basket.id}: ${basket.name} ---`);

    const before = await vault.baskets(basket.id);
    if (!before.exists) {
      console.log(`  *** Basket ${basket.id} does not exist on-chain. Skipping. ***\n`);
      continue;
    }

    const basketTokenAbi = ["function totalSupply() external view returns (uint256)", "function balanceOf(address) external view returns (uint256)"];
    const basketToken = await ethers.getContractAt(basketTokenAbi, before.token);
    const supplyBefore = await basketToken.totalSupply();
    console.log(`  Token supply before: ${supplyBefore}`);

    console.log(`  Minting ${SEED_AMOUNT_PER_BASKET} USDG...`);
    const mintTx = await vault.mint(basket.id, amountPerBasket);
    const receipt = await mintTx.wait();
    console.log(`  Mint tx confirmed: ${receipt?.hash}`);

    // Real read-back, not just "the transaction didn't revert."
    const supplyAfter = await basketToken.totalSupply();
    const deployerBalance = await basketToken.balanceOf(deployer.address);

    if (supplyAfter <= supplyBefore) {
      console.log(`  *** MISMATCH: supply did not increase (before=${supplyBefore}, after=${supplyAfter}). STOP AND INVESTIGATE. ***\n`);
      process.exitCode = 1;
      return;
    }

    console.log(`  Token supply after: ${supplyAfter}`);
    console.log(`  Deployer basket-token balance: ${deployerBalance}`);
    console.log(`  ${basket.name}: seeded and verified.\n`);
  }

  const finalUsdgBalance = await usdg.balanceOf(deployer.address);
  console.log(`=== DONE. Remaining USDG: ${ethers.formatUnits(finalUsdgBalance, USDG_DECIMALS)} ===`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
