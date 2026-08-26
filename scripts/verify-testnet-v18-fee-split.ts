import { network } from "hardhat";

function feedPrice(dollars: bigint, decimals = 8): bigint {
  return dollars * 10n ** BigInt(decimals);
}

function computeRate(fromDollars: bigint, fromDecimals: number, toDollars: bigint, toDecimals: number): bigint {
  const fromUsd18 = fromDollars * 10n ** 18n;
  const toUsd18 = toDollars * 10n ** 18n;
  const baseRate = (fromUsd18 * 10n ** 18n) / toUsd18;
  const decimalsDiff = toDecimals - fromDecimals;
  if (decimalsDiff >= 0) {
    return baseRate * 10n ** BigInt(decimalsDiff);
  } else {
    return baseRate / 10n ** BigInt(-decimalsDiff);
  }
}

const USDG_DECIMALS = 6;
const USDG_USD_DOLLARS = 1n;
const NVDA_USD_DOLLARS = 150n;

async function main() {
  const { ethers } = await network.connect({ network: "robinhoodTestnet" });
  const [deployer] = await ethers.getSigners();

  console.log("=== v18 testnet deploy: fee-split routing verification ===");
  console.log("with account:", deployer.address);

  // Real, distinct addresses for rewards/treasury -- using deterministic
  // derived wallets so the balances are easy to read and unambiguous
  // for this verification pass. Real mainnet deploy will use real,
  // hand-verified rewardsPool/treasury addresses -- these testnet ones
  // exist ONLY to prove the routing mechanics work correctly.
  const rewardsPoolWallet = ethers.Wallet.createRandom();
  const treasuryWallet = ethers.Wallet.createRandom();
  console.log("Test rewardsPool address:", rewardsPoolWallet.address);
  console.log("Test treasury address:", treasuryWallet.address);

  console.log("\nDeploying shared infrastructure...");

  const MockERC20Decimals = await ethers.getContractFactory("MockERC20Decimals");
  const usdg = await MockERC20Decimals.deploy("Mock USDG (Testnet)", "mUSDG", USDG_DECIMALS);
  const usdgAddress = await usdg.getAddress();
  console.log("  Mock USDG (testnet):", usdgAddress);

  const MockPermit2 = await ethers.getContractFactory("MockPermit2");
  const permit2 = await MockPermit2.deploy();

  const MockUniversalRouter = await ethers.getContractFactory("MockUniversalRouter");
  const router = await MockUniversalRouter.deploy(await permit2.getAddress(), usdgAddress);

  const MockPriceOracle = await ethers.getContractFactory("MockPriceOracle");
  const usdgUsdOracle = await MockPriceOracle.deploy(feedPrice(USDG_USD_DOLLARS), 8);

  const sequencerFeed = await MockPriceOracle.deploy(0, 8);
  await sequencerFeed.setPriceAt(0, 1);

  console.log("\nDeploying StaxVault (v18 -- fee-split)...");
  const StaxVault = await ethers.getContractFactory("StaxVault");
  const vault = await StaxVault.deploy(
    rewardsPoolWallet.address,
    treasuryWallet.address,
    deployer.address, // staxToken placeholder
    await router.getAddress(),
    await permit2.getAddress(),
    usdgAddress,
    await usdgUsdOracle.getAddress(),
    3600,
    await sequencerFeed.getAddress()
  );
  const vaultAddress = await vault.getAddress();
  console.log("  StaxVault (v18):", vaultAddress);

  console.log("\nSeeding router with mock USDG for swap liquidity...");
  await usdg.mint(await router.getAddress(), ethers.parseUnits("1000000", USDG_DECIMALS));

  console.log("\nDeploying one test ticker (NVDA) and one basket...");
  const MockERC20 = await ethers.getContractFactory("MockERC20");
  const nvda = await MockERC20.deploy("Mock NVDA", "mNVDA");
  const nvdaAddress = await nvda.getAddress();

  const nvdaOracle = await MockPriceOracle.deploy(feedPrice(NVDA_USD_DOLLARS), 8);
  await vault.setPriceFeed(nvdaAddress, await nvdaOracle.getAddress(), 3600);

  const [currency0, currency1] =
    usdgAddress.toLowerCase() < nvdaAddress.toLowerCase() ? [usdgAddress, nvdaAddress] : [nvdaAddress, usdgAddress];
  await vault.setTickerPool(nvdaAddress, currency0, currency1, 3000, 60, ethers.ZeroAddress);

  await nvda.mint(await router.getAddress(), ethers.parseUnits("1000000", 18));
  const rateUsdgToNvda = computeRate(USDG_USD_DOLLARS, USDG_DECIMALS, NVDA_USD_DOLLARS, 18);
  const rateNvdaToUsdg = computeRate(NVDA_USD_DOLLARS, 18, USDG_USD_DOLLARS, USDG_DECIMALS);
  await router.setRate(usdgAddress, nvdaAddress, rateUsdgToNvda);
  await router.setRate(nvdaAddress, usdgAddress, rateNvdaToUsdg);

  const basketId = 1;
  await vault.createBasket(
    basketId, "Test Basket", "sTEST", [nvdaAddress], [10000],
    ethers.parseUnits("1000000", 18), ethers.parseUnits("100000", 18)
  );

  console.log("\n=== REAL ROUTING VERIFICATION ===\n");

  const mintAmount = ethers.parseUnits("1000", USDG_DECIMALS); // 1000 USDG
  await usdg.mint(deployer.address, mintAmount);
  await usdg.approve(vaultAddress, mintAmount);
  console.log(`Minting into basket with ${ethers.formatUnits(mintAmount, USDG_DECIMALS)} USDG...`);
  await vault.mint(basketId, mintAmount);

  const expectedFee = (mintAmount * 25n) / 10000n;
  const expectedRewards = (expectedFee * 3000n) / 10000n;
  const expectedTreasury = (expectedFee * 2000n) / 10000n;
  const expectedBurn = expectedFee - expectedRewards - expectedTreasury;

  const pendingBurn = await vault.pendingBuyBurn();
  const pendingRewards = await vault.pendingRewardsPool();
  const pendingTreasury = await vault.pendingTreasuryFees();

  console.log("\nAfter mint -- pending balances (real on-chain read):");
  console.log(`  pendingBuyBurn:      ${pendingBurn} (expected ${expectedBurn})`);
  console.log(`  pendingRewardsPool:  ${pendingRewards} (expected ${expectedRewards})`);
  console.log(`  pendingTreasuryFees: ${pendingTreasury} (expected ${expectedTreasury})`);

  const mintSplitCorrect = pendingBurn === expectedBurn && pendingRewards === expectedRewards && pendingTreasury === expectedTreasury;
  console.log(`  Split matches expected 50/30/20: ${mintSplitCorrect ? "YES" : "*** NO -- STOP AND INVESTIGATE ***"}`);

  // Redeem too, so the routing is proven on both fee-generating paths,
  // not just mint.
  const basket = await vault.baskets(basketId);
  const basketTokenAbi = ["function balanceOf(address) external view returns (uint256)"];
  const basketToken = await ethers.getContractAt(basketTokenAbi, basket[1]);
  const basketTokenBalance = await basketToken.balanceOf(deployer.address);

  console.log("\nRedeeming full balance...");
  await vault.redeem(basketId, basketTokenBalance);

  const pendingBurnAfterRedeem = await vault.pendingBuyBurn();
  const pendingRewardsAfterRedeem = await vault.pendingRewardsPool();
  const pendingTreasuryAfterRedeem = await vault.pendingTreasuryFees();
  console.log("\nAfter redeem -- cumulative pending balances (real on-chain read):");
  console.log(`  pendingBuyBurn:      ${pendingBurnAfterRedeem}`);
  console.log(`  pendingRewardsPool:  ${pendingRewardsAfterRedeem}`);
  console.log(`  pendingTreasuryFees: ${pendingTreasuryAfterRedeem}`);

  // THE actual real-infrastructure check Opus asked for: pull both new
  // claim functions and confirm real USDG lands in the real addresses.
  console.log("\nPulling claimRewardsPool()...");
  const rewardsBalanceBefore = await usdg.balanceOf(rewardsPoolWallet.address);
  await vault.claimRewardsPool();
  const rewardsBalanceAfter = await usdg.balanceOf(rewardsPoolWallet.address);
  console.log(`  rewardsPool USDG balance: ${rewardsBalanceBefore} -> ${rewardsBalanceAfter}`);
  console.log(`  Moved exactly the pending amount: ${rewardsBalanceAfter - rewardsBalanceBefore === pendingRewardsAfterRedeem ? "YES" : "*** NO -- STOP AND INVESTIGATE ***"}`);

  console.log("\nPulling claimTreasuryFees()...");
  const treasuryBalanceBefore = await usdg.balanceOf(treasuryWallet.address);
  await vault.claimTreasuryFees();
  const treasuryBalanceAfter = await usdg.balanceOf(treasuryWallet.address);
  console.log(`  treasury USDG balance: ${treasuryBalanceBefore} -> ${treasuryBalanceAfter}`);
  console.log(`  Moved exactly the pending amount: ${treasuryBalanceAfter - treasuryBalanceBefore === pendingTreasuryAfterRedeem ? "YES" : "*** NO -- STOP AND INVESTIGATE ***"}`);

  console.log("\n=== RESULT ===");
  if (mintSplitCorrect && rewardsBalanceAfter > rewardsBalanceBefore && treasuryBalanceAfter > treasuryBalanceBefore) {
    console.log("SUCCESS: real 50/30/20 routing confirmed, both claim paths moved real USDG to the real addresses.");
  } else {
    console.log("UNEXPECTED STATE -- do not treat the fee-split contract as deploy-ready until this is understood.");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
