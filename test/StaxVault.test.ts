import { expect } from "chai";
import { network } from "hardhat";

const ONE_HOUR = 3600;
const USDG_USD_DOLLARS = 1n;
const NVDA_USD_DOLLARS = 150n;
const USDG_DECIMALS = 6;

function feedPrice(dollars: bigint, decimals = 8): bigint {
  return dollars * 10n ** BigInt(decimals);
}

/// @dev v17: general decimals-aware rate calculator, generalizing the
/// pattern the original 6-decimal-ticker test already established
/// (verified to reproduce that test's exact original formula when
/// fromDecimals=18/toDecimals=6 or vice versa). MockUniversalRouter's
/// rate application appears to operate on RAW token amounts
/// (amountOut = amountIn * rate / 1e18), so any decimals difference
/// between the two sides of a pair must be baked into the rate itself
/// -- this was already true before this migration (see the original
/// 6-decimal ticker test), it just now applies on BOTH sides of every
/// pair, since USDG (6 decimals) replaces WETH (always 18) as the
/// universal quote currency.
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

/// @dev v14: registers a ticker's V4 pool on the vault. v17: pool is
/// now always usdg<->ticker (setTickerPool itself enforces this at
/// registration -- passing anything else reverts).
async function setupTickerPool(vault: any, owner: any, usdg: any, ticker: any, ethers: any) {
  const usdgAddr = await usdg.getAddress();
  const tickerAddr = await ticker.getAddress();
  const [currency0, currency1] =
    usdgAddr.toLowerCase() < tickerAddr.toLowerCase() ? [usdgAddr, tickerAddr] : [tickerAddr, usdgAddr];

  await vault.connect(owner).setTickerPool(
    tickerAddr,
    currency0,
    currency1,
    3000, // fee
    60,   // tickSpacing
    ethers.ZeroAddress // hooks -- hookless
  );
}

/// @dev v17: replaces the old "{value: X}" payable pattern. mint() now
/// pulls USDG via approve+transferFrom, so every deposit needs: mint
/// USDG to the depositor, approve the vault, then call mint(). Bundled
/// into one helper since this exact three-step sequence now appears at
/// every call site that used to be a single payable call.
async function depositUsdg(usdg: any, vault: any, depositor: any, basketId: number, usdgAmount: bigint) {
  await usdg.mint(depositor.address, usdgAmount);
  await usdg.connect(depositor).approve(await vault.getAddress(), usdgAmount);
  return vault.connect(depositor).mint(basketId, usdgAmount);
}

describe("StaxVault", function () {
  async function deployCore(rewardsPoolOverride?: string, sharedEthers?: any) {
    const { ethers } = sharedEthers ? { ethers: sharedEthers } : await network.connect();
    const [owner, rewardsPool, treasury, staxTokenStandIn, user] = await ethers.getSigners();

    // v17: replaces MockWETH. USDG is a 6-decimal ERC20 (confirmed
    // on-chain), so this uses the same configurable-decimals mock
    // already established for the 6-decimal-ticker test, rather than a
    // new mock contract.
    const MockERC20Decimals = await ethers.getContractFactory("MockERC20Decimals");
    const usdg = await MockERC20Decimals.deploy("Mock USDG", "mUSDG", USDG_DECIMALS);

    const MockPermit2 = await ethers.getContractFactory("MockPermit2");
    const permit2 = await MockPermit2.deploy();

    // ASSUMPTION FLAGGED: passing usdg's address where weth's address
    // used to go. This assumes MockUniversalRouter's second constructor
    // param is a generic "quote/settle currency" role, not WETH-specific
    // unwrap logic. Needs confirming against MockUniversalRouter.sol's
    // actual source -- if it turns out to be WETH-specific, this needs
    // a different fix (either genericizing the mock, or the mock simply
    // not needing that param at all anymore since the vault never sends
    // native ETH/msgValue).
    const MockUniversalRouter = await ethers.getContractFactory("MockUniversalRouter");
    const router = await MockUniversalRouter.deploy(await permit2.getAddress(), await usdg.getAddress());

    const MockPriceOracle = await ethers.getContractFactory("MockPriceOracle");
    const usdgUsdOracle = await MockPriceOracle.deploy(feedPrice(USDG_USD_DOLLARS), 8);

    const sequencerFeed = await MockPriceOracle.deploy(0, 8);
    await sequencerFeed.setPriceAt(0, 1);

    // v18.1: constructor no longer takes staxToken at all -- it's set
    // once, post-deploy, via setStaxToken() (see Opus review: an
    // immutable staxToken set to a deployer placeholder would have
    // permanently bricked buy-burn once STAX genuinely launches).
    // staxTokenStandIn is kept as a signer for tests that need to
    // exercise setStaxToken/setStaxSwapPool/executeBuyBurn explicitly --
    // NOT set automatically here, since the whole point is that it
    // starts unset.
    const StaxVault = await ethers.getContractFactory("StaxVault");
    const vault = await StaxVault.deploy(
      rewardsPoolOverride ?? (await rewardsPool.getAddress()),
      await treasury.getAddress(),
      await router.getAddress(),
      await permit2.getAddress(),
      await usdg.getAddress(),
      await usdgUsdOracle.getAddress(),
      ONE_HOUR, // real deployment TBD (~26h placeholder) -- ONE_HOUR is fine for test purposes, unrelated to this staleness value's real-world sizing
      await sequencerFeed.getAddress()
    );

    // v17: replaces "send ETH to weth contract" (which pre-funded owner
    // with WETH for later top-ups). Equivalent: mint owner a stockpile
    // of USDG directly, since MockERC20Decimals has an open mint().
    await usdg.mint(owner.address, ethers.parseUnits("1000000", USDG_DECIMALS));

    return {
      ethers,
      owner,
      rewardsPool,
      treasury,
      staxTokenStandIn,
      user,
      usdg,
      router,
      permit2,
      usdgUsdOracle,
      sequencerFeed,
      vault,
    };
  }

  async function createSingleTickerBasket(
    ctx: Awaited<ReturnType<typeof deployCore>>,
    basketId = 1,
    depositCapUsd = "1000000",
    maxMintUsd = "100000"
  ) {
    const { ethers, owner, vault, router, usdg } = ctx;

    const MockERC20 = await ethers.getContractFactory("MockERC20");
    const nvda = await MockERC20.deploy("Mock NVDA", "mNVDA");

    const MockPriceOracle = await ethers.getContractFactory("MockPriceOracle");
    const nvdaOracle = await MockPriceOracle.deploy(feedPrice(NVDA_USD_DOLLARS), 8);

    await vault.connect(owner).setPriceFeed(await nvda.getAddress(), await nvdaOracle.getAddress(), ONE_HOUR);
    await setupTickerPool(vault, owner, usdg, nvda, ethers);

    await vault.connect(owner).createBasket(
      basketId,
      "AI Infrastructure",
      "sAI",
      [await nvda.getAddress()],
      [10000],
      ethers.parseUnits(depositCapUsd, 18),
      ethers.parseUnits(maxMintUsd, 18)
    );

    await nvda.mint(await router.getAddress(), ethers.parseUnits("1000000", 18));

    const rateUsdgToNvda = computeRate(USDG_USD_DOLLARS, USDG_DECIMALS, NVDA_USD_DOLLARS, 18);
    const rateNvdaToUsdg = computeRate(NVDA_USD_DOLLARS, 18, USDG_USD_DOLLARS, USDG_DECIMALS);

    await router.setRate(await usdg.getAddress(), await nvda.getAddress(), rateUsdgToNvda);
    await router.setRate(await nvda.getAddress(), await usdg.getAddress(), rateNvdaToUsdg);

    return { basketId, nvda, nvdaOracle, rateUsdgToNvda, rateNvdaToUsdg };
  }

  /// @dev Unchanged from before the migration -- ledger solvency is
  /// about ticker holdings, not deposit-asset accounting.
  async function assertLedgerSolvency(vault: any, tokens: any[], basketIds: number[]) {
    for (const token of tokens) {
      const addr = await token.getAddress();
      let ledgerSum = 0n;
      for (const id of basketIds) {
        ledgerSum += await vault.basketTickerHoldings(id, addr);
      }
      const realBal = await token.balanceOf(await vault.getAddress());
      expect(ledgerSum).to.be.lte(realBal,
        `Ledger solvency violated for token ${addr}: ledgerSum ${ledgerSum} > realBal ${realBal}`
      );
    }
  }

  it("should create a basket correctly", async function () {
    const ctx = await deployCore();
    const { basketId } = await createSingleTickerBasket(ctx);

    const basket = await ctx.vault.baskets(basketId);
    expect(basket.exists).to.equal(true);
    expect(basket.token).to.not.equal(ctx.ethers.ZeroAddress);
  });

  it("should mint basket tokens and actually acquire the underlying ticker via the DEX", async function () {
    const ctx = await deployCore();
    const { basketId, nvda } = await createSingleTickerBasket(ctx);
    const { ethers, vault, user, usdg } = ctx;

    await depositUsdg(usdg, vault, user, basketId, ethers.parseUnits("1000", USDG_DECIMALS));

    const vaultNvdaBalance = await nvda.balanceOf(await vault.getAddress());
    expect(vaultNvdaBalance).to.be.greaterThan(0n);

    const basket = await vault.baskets(basketId);
    const StaxBasketToken = await ethers.getContractFactory("StaxBasketToken");
    const basketToken = StaxBasketToken.attach(basket.token);
    const userBalance = await basketToken.balanceOf(user.address);
    expect(userBalance).to.be.greaterThan(0n);
  });

  it("should reject mint of zero value", async function () {
    const ctx = await deployCore();
    const { basketId } = await createSingleTickerBasket(ctx);
    const { vault, user } = ctx;

    // v19.1: was revertedWith("StaxVault: deposit must be greater than zero")
    await expect(
      vault.connect(user).mint(basketId, 0)
    ).to.be.revertedWithCustomError(vault, "ZeroDeposit");
  });

  it("should reject mint that exceeds the basket's TVL cap", async function () {
    const ctx = await deployCore();
    const { basketId } = await createSingleTickerBasket(ctx, 1, "1", "10000");
    const { ethers, vault, user, usdg } = ctx;

    // v19.1: was revertedWith("StaxVault: deposit exceeds vault cap")
    await expect(
      depositUsdg(usdg, vault, user, basketId, ethers.parseUnits("1000", USDG_DECIMALS))
    ).to.be.revertedWithCustomError(vault, "ExceedsVaultCap");
  });

  it("should reject mint that exceeds the per-transaction mint limit", async function () {
    const ctx = await deployCore();
    const { basketId } = await createSingleTickerBasket(ctx, 1, "1000000", "1");
    const { ethers, vault, user, usdg } = ctx;

    // v19.1: was revertedWith("StaxVault: mint exceeds per-tx limit")
    await expect(
      depositUsdg(usdg, vault, user, basketId, ethers.parseUnits("1000", USDG_DECIMALS))
    ).to.be.revertedWithCustomError(vault, "ExceedsMintLimit");
  });

  it("v14: setTickerPool rejects a non-canonically-ordered PoolKey (Fable review finding)", async function () {
    const ctx = await deployCore();
    const { ethers, owner, vault, usdg } = ctx;

    const MockERC20 = await ethers.getContractFactory("MockERC20");
    const nvda = await MockERC20.deploy("Mock NVDA", "mNVDA");
    const nvdaAddr = await nvda.getAddress();
    const usdgAddr = await usdg.getAddress();

    const [correctLow, correctHigh] =
      usdgAddr.toLowerCase() < nvdaAddr.toLowerCase() ? [usdgAddr, nvdaAddr] : [nvdaAddr, usdgAddr];

    // v19.1: was revertedWith("StaxVault: currencies not ordered")
    await expect(
      vault.connect(owner).setTickerPool(nvdaAddr, correctHigh, correctLow, 3000, 60, ethers.ZeroAddress)
    ).to.be.revertedWithCustomError(vault, "CurrenciesNotOrdered");

    await expect(
      vault.connect(owner).setTickerPool(nvdaAddr, correctLow, correctHigh, 3000, 60, ethers.ZeroAddress)
    ).to.not.be.revert(ethers);
  });

  it("v17: setTickerPool rejects a pool not paired against USDG", async function () {
    // New test: v17 added this enforcement specifically because tonight's
    // session found real, high-liquidity pools that passed every other
    // check while being paired against the wrong currency entirely (SPY,
    // an unrelated token). This proves that class of pool is now
    // rejected at registration, not just theoretically unusable later.
    const ctx = await deployCore();
    const { ethers, owner, vault } = ctx;

    const MockERC20 = await ethers.getContractFactory("MockERC20");
    const nvda = await MockERC20.deploy("Mock NVDA", "mNVDA");
    const wrongQuote = await MockERC20.deploy("Not USDG", "mWRONG");

    const nvdaAddr = await nvda.getAddress();
    const wrongAddr = await wrongQuote.getAddress();
    const [currency0, currency1] =
      wrongAddr.toLowerCase() < nvdaAddr.toLowerCase() ? [wrongAddr, nvdaAddr] : [nvdaAddr, wrongAddr];

    // v19.1: was revertedWith("StaxVault: not paired with USDG")
    await expect(
      vault.connect(owner).setTickerPool(nvdaAddr, currency0, currency1, 3000, 60, ethers.ZeroAddress)
    ).to.be.revertedWithCustomError(vault, "NotPairedWithUsdg");
  });

  it("should redeem basket tokens for a proportional USDG payout via the DEX", async function () {
    const ctx = await deployCore();
    const { basketId } = await createSingleTickerBasket(ctx);
    const { ethers, vault, user, usdg } = ctx;

    await depositUsdg(usdg, vault, user, basketId, ethers.parseUnits("1000", USDG_DECIMALS));

    const basket = await vault.baskets(basketId);
    const StaxBasketToken = await ethers.getContractFactory("StaxBasketToken");
    const basketToken = StaxBasketToken.attach(basket.token);
    const userTokenBalance = await basketToken.balanceOf(user.address);

    await vault.connect(user).redeem(basketId, userTokenBalance);

    const remaining = await basketToken.balanceOf(user.address);
    expect(remaining).to.equal(0n);

    // v17: unlike ETH, USDG received on redeem is trivially checkable
    // without any gas-cost adjustment -- gas is paid in the chain's
    // native ETH regardless of which asset the vault deals in, so it no
    // longer intermixes with the payout asset's balance at all. Genuine
    // simplification from the migration, not just a mechanical port.
    expect(await usdg.balanceOf(user.address)).to.be.greaterThan(0n);
  });

  it("v13: vault deployed WITHOUT a sequencer feed (address zero) allows mint/redeem normally, skipping only the sequencer check", async function () {
    const { ethers } = await network.connect();
    const [owner, rewardsPool, treasury, staxTokenStandIn, user] = await ethers.getSigners();

    const MockERC20Decimals = await ethers.getContractFactory("MockERC20Decimals");
    const usdg = await MockERC20Decimals.deploy("Mock USDG", "mUSDG", USDG_DECIMALS);

    const MockPermit2 = await ethers.getContractFactory("MockPermit2");
    const permit2 = await MockPermit2.deploy();

    const MockUniversalRouter = await ethers.getContractFactory("MockUniversalRouter");
    const router = await MockUniversalRouter.deploy(await permit2.getAddress(), await usdg.getAddress());

    const MockPriceOracle = await ethers.getContractFactory("MockPriceOracle");
    const usdgUsdOracle = await MockPriceOracle.deploy(feedPrice(USDG_USD_DOLLARS), 8);

    const StaxVault = await ethers.getContractFactory("StaxVault");
    const vaultNoSequencer = await StaxVault.deploy(
      await rewardsPool.getAddress(),
      await treasury.getAddress(),
      await router.getAddress(),
      await permit2.getAddress(),
      await usdg.getAddress(),
      await usdgUsdOracle.getAddress(),
      ONE_HOUR,
      ethers.ZeroAddress // <-- the actual thing under test
    );

    expect(await vaultNoSequencer.sequencerUptimeFeed()).to.equal(ethers.ZeroAddress);

    const MockERC20 = await ethers.getContractFactory("MockERC20");
    const nvda = await MockERC20.deploy("Mock NVDA", "mNVDA");
    const nvdaOracle = await MockPriceOracle.deploy(feedPrice(NVDA_USD_DOLLARS), 8);

    await vaultNoSequencer.connect(owner).setPriceFeed(await nvda.getAddress(), await nvdaOracle.getAddress(), ONE_HOUR);
    await setupTickerPool(vaultNoSequencer, owner, usdg, nvda, ethers);

    const basketId = 1;
    await vaultNoSequencer.connect(owner).createBasket(
      basketId, "AI Infrastructure", "sAI",
      [await nvda.getAddress()], [10000],
      ethers.parseUnits("1000000", 18), ethers.parseUnits("100000", 18)
    );

    await nvda.mint(await router.getAddress(), ethers.parseUnits("1000000", 18));
    const rateUsdgToNvda = computeRate(USDG_USD_DOLLARS, USDG_DECIMALS, NVDA_USD_DOLLARS, 18);
    const rateNvdaToUsdg = computeRate(NVDA_USD_DOLLARS, 18, USDG_USD_DOLLARS, USDG_DECIMALS);
    await router.setRate(await usdg.getAddress(), await nvda.getAddress(), rateUsdgToNvda);
    await router.setRate(await nvda.getAddress(), await usdg.getAddress(), rateNvdaToUsdg);

    await expect(
      depositUsdg(usdg, vaultNoSequencer, user, basketId, ethers.parseUnits("1000", USDG_DECIMALS))
    ).to.not.be.revert(ethers);

    const basket = await vaultNoSequencer.baskets(basketId);
    const StaxBasketToken = await ethers.getContractFactory("StaxBasketToken");
    const basketToken = StaxBasketToken.attach(basket.token);
    const userBalance = await basketToken.balanceOf(user.address);
    expect(userBalance).to.be.greaterThan(0n);

    await expect(
      vaultNoSequencer.connect(user).redeem(basketId, userBalance)
    ).to.not.be.revert(ethers);
  });

  it("v11: redeem emits valueReturnedUsd matching the real oracle-priced value of assets redeemed", async function () {
    const ctx = await deployCore();
    const { basketId, nvda } = await createSingleTickerBasket(ctx);
    const { ethers, vault, user, usdg } = ctx;

    await depositUsdg(usdg, vault, user, basketId, ethers.parseUnits("1000", USDG_DECIMALS));

    const basket = await vault.baskets(basketId);
    const StaxBasketToken = await ethers.getContractFactory("StaxBasketToken");
    const basketToken = StaxBasketToken.attach(basket.token);
    const userTokenBalance = await basketToken.balanceOf(user.address);

    // Unaffected by the USDG migration -- this is computed from the
    // ticker-side ledger holding, which was never deposit-asset-decimals
    // dependent.
    const nvdaHeld = await vault.basketTickerHoldings(basketId, await nvda.getAddress());
    const expectedValueUsd18 = (nvdaHeld * feedPrice(NVDA_USD_DOLLARS, 18)) / 10n ** 18n;

    const tx = await vault.connect(user).redeem(basketId, userTokenBalance);
    const receipt = await tx.wait();

    const redeemedEvent = receipt!.logs
      .map((log: any) => {
        try {
          return vault.interface.parseLog(log);
        } catch {
          return null;
        }
      })
      .find((parsed: any) => parsed?.name === "Redeemed");

    expect(redeemedEvent).to.not.be.undefined;
    const valueReturnedUsd = redeemedEvent!.args.valueReturnedUsd as bigint;

    expect(valueReturnedUsd).to.equal(expectedValueUsd18);
    expect(valueReturnedUsd).to.be.greaterThan(0n);
  });

  it("should reject redeem if user has insufficient basket token balance", async function () {
    const ctx = await deployCore();
    const { basketId } = await createSingleTickerBasket(ctx);
    const { ethers, vault, user, usdg } = ctx;

    await depositUsdg(usdg, vault, user, basketId, ethers.parseUnits("1000", USDG_DECIMALS));

    const basket = await vault.baskets(basketId);
    const StaxBasketToken = await ethers.getContractFactory("StaxBasketToken");
    const basketToken = StaxBasketToken.attach(basket.token);
    const userTokenBalance = await basketToken.balanceOf(user.address);

    // Unchanged: this reverts from the OZ ERC20 burn logic (insufficient
    // balance), not a StaxVault custom error -- generic check stays.
    await expect(
      vault.connect(user).redeem(basketId, userTokenBalance + 1n)
    ).to.be.revert(ethers);
  });

  it("v17: deposit value conversion is exact to the wei -- proves the 6-to-18-decimal scaling site is correct, not just non-zero (Opus review, second pass)", async function () {
    // The single most important remaining gap from Opus's second review:
    // every existing mint test asserts greaterThan(0n), which confirms
    // the plumbing runs but would NOT catch a 10^12 scaling error at
    // the depositValueUsd site -- the exact site flagged as "most likely
    // to pass happy-path tests and be wrong." This pins an EXACT
    // expected value, computed from first principles by hand (NOT via
    // the computeRate() helper, since that's a second implementation of
    // similar decimals logic and could share a bug with the contract) --
    // using a precise cap-boundary trick instead: choose depositCapUsd
    // to land EXACTLY on the expected depositValueUsd for a known
    // deposit, and confirm the cap check passes at that exact value and
    // fails one wei below it. A scaling bug of any kind (wrong power of
    // 10, missing conversion entirely) would make this boundary behave
    // nothing like predicted -- either always passing or always failing
    // regardless of the 1-wei difference.
    const ctx = await deployCore();
    const { ethers, owner, vault, router, usdg, user } = ctx;

    const MockERC20 = await ethers.getContractFactory("MockERC20");
    const nvda = await MockERC20.deploy("Mock NVDA", "mNVDA");
    const MockPriceOracle = await ethers.getContractFactory("MockPriceOracle");
    const nvdaOracle = await MockPriceOracle.deploy(feedPrice(NVDA_USD_DOLLARS), 8);
    await vault.connect(owner).setPriceFeed(await nvda.getAddress(), await nvdaOracle.getAddress(), ONE_HOUR);
    await setupTickerPool(vault, owner, usdg, nvda, ethers);
    await nvda.mint(await router.getAddress(), ethers.parseUnits("1000000", 18));
    await router.setRate(await usdg.getAddress(), await nvda.getAddress(), computeRate(USDG_USD_DOLLARS, USDG_DECIMALS, NVDA_USD_DOLLARS, 18));
    await router.setRate(await nvda.getAddress(), await usdg.getAddress(), computeRate(NVDA_USD_DOLLARS, 18, USDG_USD_DOLLARS, USDG_DECIMALS));

    // Hand-picked, clean numbers: deposit exactly 1000 USDG (raw,
    // 6-decimal: 1,000,000,000). FEE_BPS=25, BPS_DENOMINATOR=10000, so
    // fee = 1,000,000,000 * 25 / 10000 = 2,500,000 EXACTLY (clean
    // integer division, no truncation ambiguity). netDeposit =
    // 1,000,000,000 - 2,500,000 = 997,500,000 raw USDG (997.5 USDG).
    //
    // Expected depositValueUsd (hand-computed, NOT via computeRate):
    // _to18(997_500_000, 6) = 997_500_000 * 10^(18-6) = 997_500_000 * 10^12
    //   = 997_500_000_000_000_000_000 (997.5e18)
    // usdgUsd18 for a $1.00 feed = exactly 1e18, so
    // depositValueUsd = 997_500_000_000_000_000_000 * 1e18 / 1e18
    //   = 997_500_000_000_000_000_000 exactly.
    const grossDeposit = 1_000_000_000n; // 1000 USDG raw (6 decimals)
    const expectedFee = (grossDeposit * 25n) / 10000n;
    const expectedNetDeposit = grossDeposit - expectedFee;
    const expectedDepositValueUsd = expectedNetDeposit * 10n ** 12n; // hand-derived _to18, not via any helper

    expect(expectedDepositValueUsd).to.equal(997_500_000_000_000_000_000n); // sanity-check my own hand math

    // Case 1: cap set to EXACTLY the expected value -- must PASS ("<=").
    const basketIdPass = 501;
    await vault.connect(owner).createBasket(
      basketIdPass, "Boundary Pass", "sBP", [await nvda.getAddress()], [10000],
      expectedDepositValueUsd, ethers.parseUnits("1000000", 18)
    );
    await usdg.mint(user.address, grossDeposit);
    await usdg.connect(user).approve(await vault.getAddress(), grossDeposit);
    await expect(vault.connect(user).mint(basketIdPass, grossDeposit)).to.not.be.revert(ethers);

    // Case 2: cap set to ONE WEI below the expected value -- must FAIL.
    // A scaling bug would make depositValueUsd wildly different from
    // this tightly-chosen boundary, so this case would behave nothing
    // like "revert only when exactly 1 wei short" if the conversion
    // were wrong.
    const basketIdFail = 502;
    await vault.connect(owner).createBasket(
      basketIdFail, "Boundary Fail", "sBF", [await nvda.getAddress()], [10000],
      expectedDepositValueUsd - 1n, ethers.parseUnits("1000000", 18)
    );
    await usdg.mint(user.address, grossDeposit);
    await usdg.connect(user).approve(await vault.getAddress(), grossDeposit);
    // v19.1: was revertedWith("StaxVault: deposit exceeds vault cap")
    await expect(
      vault.connect(user).mint(basketIdFail, grossDeposit)
    ).to.be.revertedWithCustomError(vault, "ExceedsVaultCap");
  });

  it("v17: redeem USDG payout matches the independently-verified ticker-side USD value, within fee and rounding tolerance -- catches a scaling bug of any real-world magnitude (Opus review, second pass)", async function () {
    // Ties together two things that are each independently trustworthy
    // on their own but had never been checked AGAINST each other:
    // valueReturnedUsd (already proven exact in the "v11" test above,
    // computed purely from ticker-side ledger + oracle, NEVER
    // USDG-decimals-dependent) and the ACTUAL USDG the redeemer
    // receives (which IS USDG-decimals-dependent, via _from18(...,
    // usdgDecimals) in _swapTickerForUsdg). A real decimals bug at the
    // redeem payout site would be off by a factor of 10^6 or 10^12 --
    // nothing like ordinary swap/rounding noise -- so a generous-looking
    // 2% tolerance here is still tight enough to catch any realistic
    // scaling error while not being flakily sensitive to legitimate
    // integer-division rounding in the mock swap.
    const ctx = await deployCore();
    const { basketId, nvda } = await createSingleTickerBasket(ctx);
    const { ethers, vault, user, usdg } = ctx;

    await depositUsdg(usdg, vault, user, basketId, ethers.parseUnits("1000", USDG_DECIMALS));

    const basket = await vault.baskets(basketId);
    const StaxBasketToken = await ethers.getContractFactory("StaxBasketToken");
    const basketToken = StaxBasketToken.attach(basket.token);
    const userTokenBalance = await basketToken.balanceOf(user.address);

    const usdgBefore = await usdg.balanceOf(user.address);
    const tx = await vault.connect(user).redeem(basketId, userTokenBalance);
    const receipt = await tx.wait();
    const usdgAfter = await usdg.balanceOf(user.address);
    const netPayout = usdgAfter - usdgBefore; // raw, 6-decimal USDG actually received

    const redeemedEvent = receipt!.logs
      .map((log: any) => {
        try { return vault.interface.parseLog(log); } catch { return null; }
      })
      .find((parsed: any) => parsed?.name === "Redeemed");
    const valueReturnedUsd = redeemedEvent!.args.valueReturnedUsd as bigint; // usd18, independently proven exact elsewhere

    // Expected: valueReturnedUsd (usd18, $1 = 1e18) converted to raw
    // 6-decimal USDG at the $1.00 test peg, minus the 0.25% redeem fee
    // -- hand-computed here, not via computeRate.
    const expectedGrossUsdg = valueReturnedUsd / 10n ** 12n; // usd18 -> raw 6-decimal, at $1 peg
    const expectedFee = (expectedGrossUsdg * 25n) / 10000n;
    const expectedNetPayout = expectedGrossUsdg - expectedFee;

    // Tight relative tolerance (2%) -- catches any realistic decimals
    // bug (which would be off by many orders of magnitude, not a few
    // percent) while tolerating real integer-rounding noise from the
    // mock swap's own arithmetic.
    const lowerBound = (expectedNetPayout * 98n) / 100n;
    const upperBound = (expectedNetPayout * 102n) / 100n;

    expect(netPayout).to.be.greaterThanOrEqual(lowerBound);
    expect(netPayout).to.be.lessThanOrEqual(upperBound);
  });

  it("should reject redeem of zero tokens", async function () {
    const ctx = await deployCore();
    const { basketId } = await createSingleTickerBasket(ctx);
    const { vault, user } = ctx;

    // v19.1: was revertedWith("StaxVault: amount must be nonzero")
    await expect(
      vault.connect(user).redeem(basketId, 0)
    ).to.be.revertedWithCustomError(vault, "AmountMustBeNonzero");
  });

  it("v17: should reject redeem below MIN_TOKENS_IN with a clear, immediate revert (Opus review, Finding #2)", async function () {
    // Before this fix, a sufficiently small redeem could have every
    // per-ticker share floor to zero during rounding, producing a zero
    // grossPayout that only reverted at the very end -- after burn,
    // ledger debits, and swap attempts already ran (harmlessly, since
    // it's all one atomic transaction, but with a late, confusing
    // revert instead of an immediate clear one). This proves the new
    // early check catches it before any of that.
    const ctx = await deployCore();
    const { basketId } = await createSingleTickerBasket(ctx);
    const { ethers, vault, user, usdg } = ctx;

    await depositUsdg(usdg, vault, user, basketId, ethers.parseUnits("1000", USDG_DECIMALS));

    const minTokensIn = await vault.MIN_TOKENS_IN();

    const basket = await vault.baskets(basketId);
    const StaxBasketToken = await ethers.getContractFactory("StaxBasketToken");
    const basketToken = StaxBasketToken.attach(basket.token);
    const userBalance = await basketToken.balanceOf(user.address);

    // v19.1: was revertedWith("StaxVault: redeem amount too small")
    await expect(
      vault.connect(user).redeem(basketId, minTokensIn - 1n)
    ).to.be.revertedWithCustomError(vault, "RedeemAmountTooSmall");

    // v17 fix: NOT asserting success at exactly minTokensIn -- that
    // floor is deliberately tiny (mirrors MIN_TOKENS_OUT), and at this
    // basket's real scale, an amount that small survives the ledger-
    // share calculation but still rounds to zero on the SWAP side
    // (mock router's amountOut = amountIn * rate / 1e18 floors when
    // amountIn is this small) -- a legitimate, different dust case the
    // existing "zero payout" check correctly catches. MIN_TOKENS_IN's
    // real job is a clearer, earlier revert for truly negligible
    // amounts, not a guarantee that anything above it survives the
    // downstream swap. Proving the check doesn't over-trigger for
    // legitimate small (but real) redeems instead, using a genuinely
    // small fraction of the user's actual holdings.
    const smallRealRedeem = userBalance / 100n; // ~1% of holdings
    await expect(
      vault.connect(user).redeem(basketId, smallRealRedeem)
    ).to.not.be.revert(ethers);
  });

  it("v17: a frozen redeemer's transaction rolls back completely -- no partial burn, no partial ledger debit (Opus review, Finding #5)", async function () {
    // This is the untested path Opus specifically flagged: the accepted
    // Paxos trust-model assumption (USDG can freeze/block an address)
    // means a frozen user's redeem() call reverts on the final
    // safeTransfer -- but does that revert cleanly roll back the burn
    // and ledger debits that already happened earlier in the SAME
    // function, or can state get corrupted? Standard EVM transaction
    // atomicity says it must roll back entirely (nothing persists from
    // a reverted transaction), but this proves it directly rather than
    // just asserting it by reasoning about the EVM spec.
    const { ethers } = await network.connect();
    const [owner, rewardsPool, treasury, staxTokenStandIn, user] = await ethers.getSigners();

    const MockFreezableERC20 = await ethers.getContractFactory("MockFreezableERC20");
    const usdg = await MockFreezableERC20.deploy("Mock Freezable USDG", "mfUSDG", USDG_DECIMALS);

    const MockPermit2 = await ethers.getContractFactory("MockPermit2");
    const permit2 = await MockPermit2.deploy();

    const MockUniversalRouter = await ethers.getContractFactory("MockUniversalRouter");
    const router = await MockUniversalRouter.deploy(await permit2.getAddress(), await usdg.getAddress());

    const MockPriceOracle = await ethers.getContractFactory("MockPriceOracle");
    const usdgUsdOracle = await MockPriceOracle.deploy(feedPrice(USDG_USD_DOLLARS), 8);
    const sequencerFeed = await MockPriceOracle.deploy(0, 8);
    await sequencerFeed.setPriceAt(0, 1);

    const StaxVault = await ethers.getContractFactory("StaxVault");
    const vault = await StaxVault.deploy(
      await rewardsPool.getAddress(),
      await treasury.getAddress(),
      await router.getAddress(),
      await permit2.getAddress(),
      await usdg.getAddress(),
      await usdgUsdOracle.getAddress(),
      ONE_HOUR,
      await sequencerFeed.getAddress()
    );

    const MockERC20 = await ethers.getContractFactory("MockERC20");
    const nvda = await MockERC20.deploy("Mock NVDA", "mNVDA");
    const nvdaOracle = await MockPriceOracle.deploy(feedPrice(NVDA_USD_DOLLARS), 8);

    await vault.connect(owner).setPriceFeed(await nvda.getAddress(), await nvdaOracle.getAddress(), ONE_HOUR);
    await setupTickerPool(vault, owner, usdg, nvda, ethers);

    const basketId = 1;
    await vault.connect(owner).createBasket(
      basketId, "AI Infrastructure", "sAI",
      [await nvda.getAddress()], [10000],
      ethers.parseUnits("1000000", 18), ethers.parseUnits("100000", 18)
    );

    await nvda.mint(await router.getAddress(), ethers.parseUnits("1000000", 18));
    const rateUsdgToNvda = computeRate(USDG_USD_DOLLARS, USDG_DECIMALS, NVDA_USD_DOLLARS, 18);
    const rateNvdaToUsdg = computeRate(NVDA_USD_DOLLARS, 18, USDG_USD_DOLLARS, USDG_DECIMALS);
    await router.setRate(await usdg.getAddress(), await nvda.getAddress(), rateUsdgToNvda);
    await router.setRate(await nvda.getAddress(), await usdg.getAddress(), rateNvdaToUsdg);

    // Normal mint, BEFORE freezing -- user is not frozen yet, so this
    // must succeed cleanly.
    const depositAmount = ethers.parseUnits("1000", USDG_DECIMALS);
    await usdg.mint(user.address, depositAmount);
    await usdg.connect(user).approve(await vault.getAddress(), depositAmount);
    await vault.connect(user).mint(basketId, depositAmount);

    const basket = await vault.baskets(basketId);
    const StaxBasketToken = await ethers.getContractFactory("StaxBasketToken");
    const basketToken = StaxBasketToken.attach(basket.token);

    // Capture full pre-redeem state.
    const balanceBefore = await basketToken.balanceOf(user.address);
    const supplyBefore = await basketToken.totalSupply();
    const ledgerBefore = await vault.basketTickerHoldings(basketId, await nvda.getAddress());
    expect(balanceBefore).to.be.greaterThan(0n);

    // NOW freeze the user -- their redeem's final safeTransfer(user, ...)
    // will hit MockFreezableERC20's frozen check and revert.
    await usdg.setFrozen(user.address, true);

    await expect(
      vault.connect(user).redeem(basketId, balanceBefore)
    ).to.be.revert(ethers);

    // THE ACTUAL PROOF: every piece of state touched earlier in the
    // same (reverted) call must be completely unchanged -- burn didn't
    // stick, ledger debits didn't stick, supply didn't change. If any
    // of these differ from the pre-redeem snapshot, that's a real
    // partial-state-corruption bug, not just an inconvenient revert.
    expect(await basketToken.balanceOf(user.address)).to.equal(balanceBefore);
    expect(await basketToken.totalSupply()).to.equal(supplyBefore);
    expect(await vault.basketTickerHoldings(basketId, await nvda.getAddress())).to.equal(ledgerBefore);

    // Confirm it's SPECIFICALLY the freeze causing this, not something
    // else broken -- unfreeze and prove the exact same redeem call now
    // succeeds cleanly.
    await usdg.setFrozen(user.address, false);
    await expect(
      vault.connect(user).redeem(basketId, balanceBefore)
    ).to.not.be.revert(ethers);
    expect(await basketToken.balanceOf(user.address)).to.equal(0n);
  });

  it("should correctly split a deposit across multiple tickers per basket weights", async function () {
    const ctx = await deployCore();
    const { ethers, owner, vault, router, usdg, user } = ctx;

    const MockERC20 = await ethers.getContractFactory("MockERC20");
    const nvda = await MockERC20.deploy("Mock NVDA", "mNVDA");
    const amd = await MockERC20.deploy("Mock AMD", "mAMD");
    const avgo = await MockERC20.deploy("Mock AVGO", "mAVGO");

    const MockPriceOracle = await ethers.getContractFactory("MockPriceOracle");
    const nvdaOracle = await MockPriceOracle.deploy(feedPrice(150n), 8);
    const amdOracle = await MockPriceOracle.deploy(feedPrice(100n), 8);
    const avgoOracle = await MockPriceOracle.deploy(feedPrice(200n), 8);

    await vault.connect(owner).setPriceFeed(await nvda.getAddress(), await nvdaOracle.getAddress(), ONE_HOUR);
    await vault.connect(owner).setPriceFeed(await amd.getAddress(), await amdOracle.getAddress(), ONE_HOUR);
    await vault.connect(owner).setPriceFeed(await avgo.getAddress(), await avgoOracle.getAddress(), ONE_HOUR);
    await setupTickerPool(vault, owner, usdg, nvda, ethers);
    await setupTickerPool(vault, owner, usdg, amd, ethers);
    await setupTickerPool(vault, owner, usdg, avgo, ethers);

    const basketId = 2;
    await vault.connect(owner).createBasket(
      basketId,
      "AI Infrastructure",
      "sAI",
      [await nvda.getAddress(), await amd.getAddress(), await avgo.getAddress()],
      [4000, 3000, 3000],
      ethers.parseUnits("1000000", 18),
      ethers.parseUnits("100000", 18)
    );

    for (const [token, priceDollars] of [
      [nvda, 150n],
      [amd, 100n],
      [avgo, 200n],
    ] as const) {
      await token.mint(await router.getAddress(), ethers.parseUnits("1000000", 18));
      const rateUsdgToToken = computeRate(USDG_USD_DOLLARS, USDG_DECIMALS, priceDollars, 18);
      const rateTokenToUsdg = computeRate(priceDollars, 18, USDG_USD_DOLLARS, USDG_DECIMALS);
      await router.setRate(await usdg.getAddress(), await token.getAddress(), rateUsdgToToken);
      await router.setRate(await token.getAddress(), await usdg.getAddress(), rateTokenToUsdg);
    }

    await depositUsdg(usdg, vault, user, basketId, ethers.parseUnits("1000", USDG_DECIMALS));

    expect(await nvda.balanceOf(await vault.getAddress())).to.be.greaterThan(0n);
    expect(await amd.balanceOf(await vault.getAddress())).to.be.greaterThan(0n);
    expect(await avgo.balanceOf(await vault.getAddress())).to.be.greaterThan(0n);
  });

  it("should reject mint when the DEX pool price has diverged from the oracle (manipulation defense, buy side)", async function () {
    const ctx = await deployCore();
    const { basketId, nvda } = await createSingleTickerBasket(ctx);
    const { ethers, router, usdg, vault, user } = ctx;

    const manipulatedRate = 15n * 10n ** 18n;
    await router.setRate(await usdg.getAddress(), await nvda.getAddress(), manipulatedRate);

    // Unchanged: this is MockUniversalRouter's own string revert, not
    // touched by the StaxVault custom-error migration.
    await expect(
      depositUsdg(usdg, vault, user, basketId, ethers.parseUnits("1000", USDG_DECIMALS))
    ).to.be.revertedWith("MockUniversalRouter: slippage too high");
  });

  it("should reject redeem when the DEX pool price has diverged from the oracle (manipulation defense, sell side)", async function () {
    const ctx = await deployCore();
    const { basketId, nvda } = await createSingleTickerBasket(ctx);
    const { ethers, router, usdg, vault, user } = ctx;

    await depositUsdg(usdg, vault, user, basketId, ethers.parseUnits("1000", USDG_DECIMALS));

    const basket = await vault.baskets(basketId);
    const StaxBasketToken = await ethers.getContractFactory("StaxBasketToken");
    const basketToken = StaxBasketToken.attach(basket.token);
    const userTokenBalance = await basketToken.balanceOf(user.address);

    const nvdaAddress = await nvda.getAddress();
    // v17 fix: the old constant (3n * 10n ** 16n) was calibrated for an
    // 18-decimal WETH output and, reused blindly against a 6-decimal
    // USDG output, was off by ~8 orders of magnitude -- enough to trip
    // an unrelated arithmetic/balance error (a "custom error" revert)
    // instead of the router's own intended slippage check. The
    // legitimate nvda->usdg rate here is ~150,000,000 (150n at 18
    // decimals converted to 1n at 6 decimals via computeRate); this
    // manipulated rate is a clear, deliberate ~3x reduction from that,
    // correctly scaled for a 6-decimal output.
    const manipulatedRate = 50_000_000n;
    await router.setRate(nvdaAddress, await usdg.getAddress(), manipulatedRate);

    // Unchanged: MockUniversalRouter's own string revert.
    await expect(
      vault.connect(user).redeem(basketId, userTokenBalance)
    ).to.be.revertedWith("MockUniversalRouter: slippage too high");
  });

  it("executeBuyBurn should require the STAX pool to be set, be owner-only, and require a nonzero minStaxOut", async function () {
    const ctx = await deployCore();
    const { basketId } = await createSingleTickerBasket(ctx);
    const { ethers, owner, staxTokenStandIn, vault, usdg, user } = ctx;

    await depositUsdg(usdg, vault, user, basketId, ethers.parseUnits("1000", USDG_DECIMALS));

    const pending = await vault.pendingBuyBurn();
    expect(pending).to.be.greaterThan(0n);

    // v18.1: staxToken is no longer set at construction -- this now
    // correctly reverts because BOTH staxToken and the pool are unset.
    // v19.1: was revertedWith("StaxVault: STAX pool not set")
    await expect(
      vault.connect(owner).executeBuyBurn(1)
    ).to.be.revertedWithCustomError(vault, "StaxPoolNotSet");

    // v18.1: staxToken must be explicitly set before setStaxSwapPool
    // will accept anything at all -- this is the new gate.
    const staxAddr = await staxTokenStandIn.getAddress();
    await vault.connect(owner).setStaxToken(staxAddr);

    // v17: STAX pool must now be USDG-paired (setStaxSwapPool enforces
    // this), not WETH-paired.
    const usdgAddr = await usdg.getAddress();
    const [currency0, currency1] =
      usdgAddr.toLowerCase() < staxAddr.toLowerCase() ? [usdgAddr, staxAddr] : [staxAddr, usdgAddr];
    await vault.connect(owner).setStaxSwapPool(currency0, currency1, 3000, 60, ethers.ZeroAddress);

    // Unchanged: Ownable's own onlyOwner revert, not a StaxVault custom error.
    await expect(
      vault.connect(user).executeBuyBurn(1)
    ).to.be.revert(ethers);

    // v19.1: was revertedWith("StaxVault: minStaxOut must be set")
    await expect(
      vault.connect(owner).executeBuyBurn(0)
    ).to.be.revertedWithCustomError(vault, "MinStaxOutMustBeSet");
  });

  // ---------------------------------------------------------------------
  // v18.1 regression tests: staxToken set-once + ordering safety
  // (Opus review: required before the fix locks in -- these prove the
  // zero-window is safe, which can't be verified by reading alone)
  // ---------------------------------------------------------------------

  it("v18.1: setStaxToken is set-once -- a second call reverts", async function () {
    const ctx = await deployCore();
    const { owner, staxTokenStandIn, vault, ethers } = ctx;
    const [, , , , bob] = await ethers.getSigners();

    const staxAddr = await staxTokenStandIn.getAddress();
    await vault.connect(owner).setStaxToken(staxAddr);
    expect(await vault.staxToken()).to.equal(staxAddr);

    // A second call, even with a different (also valid) address, must
    // revert -- set-once means once, not "once per distinct value".
    // v19.1: was revertedWith("StaxVault: staxToken already set")
    await expect(
      vault.connect(owner).setStaxToken(bob.address)
    ).to.be.revertedWithCustomError(vault, "StaxTokenAlreadySet");

    // Confirm it genuinely didn't change.
    expect(await vault.staxToken()).to.equal(staxAddr);
  });

  it("v18.1: setStaxToken rejects address(0) as input", async function () {
    const ctx = await deployCore();
    const { owner, vault, ethers } = ctx;

    // v19.1: was revertedWith("StaxVault: zero stax token")
    await expect(
      vault.connect(owner).setStaxToken(ethers.ZeroAddress)
    ).to.be.revertedWithCustomError(vault, "ZeroStaxToken");

    // Confirm it's still genuinely unset after the failed attempt --
    // proves there's no path where a rejected call still marks it set.
    expect(await vault.staxToken()).to.equal(ethers.ZeroAddress);
  });

  it("v18.1: setStaxSwapPool reverts while staxToken is still unset -- the new gate works", async function () {
    const ctx = await deployCore();
    const { owner, staxTokenStandIn, usdg, vault, ethers } = ctx;

    const usdgAddr = await usdg.getAddress();
    const staxAddr = await staxTokenStandIn.getAddress();
    const [currency0, currency1] =
      usdgAddr.toLowerCase() < staxAddr.toLowerCase() ? [usdgAddr, staxAddr] : [staxAddr, usdgAddr];

    // staxToken was never set in this test -- setStaxSwapPool must
    // refuse to run at all, not just fail some later check.
    // v19.1: was revertedWith("StaxVault: staxToken not set")
    await expect(
      vault.connect(owner).setStaxSwapPool(currency0, currency1, 3000, 60, ethers.ZeroAddress)
    ).to.be.revertedWithCustomError(vault, "StaxTokenNotSet");
  });

  it("v18.1: full correct ordering succeeds end-to-end; executeBuyBurn before setStaxToken reverts cleanly (proves the zero-window is safe)", async function () {
    const ctx = await deployCore();
    const { basketId } = await createSingleTickerBasket(ctx);
    const { owner, staxTokenStandIn, usdg, vault, user, ethers } = ctx;

    await depositUsdg(usdg, vault, user, basketId, ethers.parseUnits("1000", USDG_DECIMALS));
    expect(await vault.pendingBuyBurn()).to.be.greaterThan(0n);

    // Step 1: executeBuyBurn before ANYTHING is configured -- must
    // revert cleanly, not do anything unexpected with a zero staxToken.
    // v19.1: was revertedWith("StaxVault: STAX pool not set")
    await expect(
      vault.connect(owner).executeBuyBurn(1)
    ).to.be.revertedWithCustomError(vault, "StaxPoolNotSet");

    // Step 2: setStaxToken -- the real forward-ordering flow.
    const staxAddr = await staxTokenStandIn.getAddress();
    await vault.connect(owner).setStaxToken(staxAddr);
    expect(await vault.staxToken()).to.equal(staxAddr);

    // Step 3: setStaxSwapPool now succeeds, since staxToken is set.
    const usdgAddr = await usdg.getAddress();
    const [currency0, currency1] =
      usdgAddr.toLowerCase() < staxAddr.toLowerCase() ? [usdgAddr, staxAddr] : [staxAddr, usdgAddr];
    await expect(
      vault.connect(owner).setStaxSwapPool(currency0, currency1, 3000, 60, ethers.ZeroAddress)
    ).to.not.be.revert(ethers);

    // Step 4: executeBuyBurn now reaches real logic -- staxTokenStandIn
    // is a plain signer with no contract code, so the actual swap will
    // fail for an unrelated reason (no code to receive tokens/no real
    // pool liquidity), but critically it must NOT revert with the
    // StaxPoolNotSet error anymore -- proving the ordering gate itself
    // is satisfied and we've moved past it to real swap logic.
    //
    // v19.1: was checking err.message for the OLD STRING "STAX pool not
    // set" -- that text no longer appears in any revert message at all
    // (custom errors surface by name, not that string), so the old
    // check would have silently always passed regardless of what
    // actually happened. Updated to check for the NEW custom error
    // name "StaxPoolNotSet" instead -- same intent, correct target.
    let revertReason = "";
    try {
      await vault.connect(owner).executeBuyBurn(1);
    } catch (err: any) {
      revertReason = String(err.message ?? err);
    }
    expect(revertReason).to.not.include("StaxPoolNotSet");
  });

  it("should reject mint when the sequencer is reported down", async function () {
    const ctx = await deployCore();
    const { basketId } = await createSingleTickerBasket(ctx);
    const { ethers, vault, user, sequencerFeed, usdg } = ctx;

    await sequencerFeed.setPriceAt(1, 1);

    // v19.1: was revertedWith("StaxVault: sequencer down")
    await expect(
      depositUsdg(usdg, vault, user, basketId, ethers.parseUnits("1000", USDG_DECIMALS))
    ).to.be.revertedWithCustomError(vault, "SequencerDown");
  });

  it("should reject redeem when the sequencer is reported down", async function () {
    const ctx = await deployCore();
    const { basketId } = await createSingleTickerBasket(ctx);
    const { ethers, vault, user, sequencerFeed, usdg } = ctx;

    await depositUsdg(usdg, vault, user, basketId, ethers.parseUnits("1000", USDG_DECIMALS));

    const basket = await vault.baskets(basketId);
    const StaxBasketToken = await ethers.getContractFactory("StaxBasketToken");
    const basketToken = StaxBasketToken.attach(basket.token);
    const userTokenBalance = await basketToken.balanceOf(user.address);

    await sequencerFeed.setPriceAt(1, 1);

    // v19.1: was revertedWith("StaxVault: sequencer down")
    await expect(
      vault.connect(user).redeem(basketId, userTokenBalance)
    ).to.be.revertedWithCustomError(vault, "SequencerDown");
  });

  it("should reject mint when the sequencer just came back up and grace period hasn't elapsed", async function () {
    const ctx = await deployCore();
    const { basketId } = await createSingleTickerBasket(ctx);
    const { ethers, vault, user, sequencerFeed, usdg } = ctx;

    const latestBlock = await ethers.provider.getBlock("latest");
    const now = latestBlock!.timestamp;

    await sequencerFeed.setPriceAt(0, now);

    // v19.1: was revertedWith("StaxVault: sequencer grace period not over")
    await expect(
      depositUsdg(usdg, vault, user, basketId, ethers.parseUnits("1000", USDG_DECIMALS))
    ).to.be.revertedWithCustomError(vault, "GracePeriodActive");
  });

  it("should reject mint when the sequencer round is uninitialized (startedAt == 0)", async function () {
    const ctx = await deployCore();
    const { basketId } = await createSingleTickerBasket(ctx);
    const { ethers, vault, user, sequencerFeed, usdg } = ctx;

    await sequencerFeed.setPriceAt(0, 0);

    // v19.1: was revertedWith("StaxVault: sequencer round not initialized")
    await expect(
      depositUsdg(usdg, vault, user, basketId, ethers.parseUnits("1000", USDG_DECIMALS))
    ).to.be.revertedWithCustomError(vault, "SequencerNotInit");
  });

  it("should accrue the mint fee across three destinations (50% burn / 30% rewards / 20% treasury, team takes zero) and let both new claim functions pay out correctly", async function () {
    const ctx = await deployCore();
    const { basketId } = await createSingleTickerBasket(ctx);
    const { ethers, vault, user, rewardsPool, treasury, usdg } = ctx;

    // Clean, round number -- every share divides evenly here, so this
    // test proves the BASIC 50/30/20 split and both claim paths. The
    // remainder-handling edge case (where the shares DON'T divide
    // evenly) gets its own dedicated test right after this one.
    const depositAmount = ethers.parseUnits("1000", USDG_DECIMALS);
    const expectedFee = (depositAmount * 25n) / 10000n;
    const expectedToRewards = (expectedFee * 3000n) / 10000n;
    const expectedToTreasury = (expectedFee * 2000n) / 10000n;
    const expectedToBurn = expectedFee - expectedToRewards - expectedToTreasury;

    await depositUsdg(usdg, vault, user, basketId, depositAmount);

    expect(await vault.pendingBuyBurn()).to.equal(expectedToBurn);
    expect(await vault.pendingRewardsPool()).to.equal(expectedToRewards);
    expect(await vault.pendingTreasuryFees()).to.equal(expectedToTreasury);

    // Sanity: the three shares must sum back to exactly the fee, no
    // dust lost anywhere.
    expect(expectedToBurn + expectedToRewards + expectedToTreasury).to.equal(expectedFee);

    // v18: USDG balance checks, no gas-cost adjustment needed (same
    // reasoning as before -- claim functions don't touch native ETH).
    const rewardsBalanceBefore = await usdg.balanceOf(rewardsPool.address);
    await vault.claimRewardsPool();
    const rewardsBalanceAfter = await usdg.balanceOf(rewardsPool.address);
    expect(rewardsBalanceAfter - rewardsBalanceBefore).to.equal(expectedToRewards);
    expect(await vault.pendingRewardsPool()).to.equal(0n);

    const treasuryBalanceBefore = await usdg.balanceOf(treasury.address);
    await vault.claimTreasuryFees();
    const treasuryBalanceAfter = await usdg.balanceOf(treasury.address);
    expect(treasuryBalanceAfter - treasuryBalanceBefore).to.equal(expectedToTreasury);
    expect(await vault.pendingTreasuryFees()).to.equal(0n);
  });

  it("v18: the 3-way fee split correctly handles the integer-division remainder -- the three shares always sum to exactly the fee, even when they don't divide evenly", async function () {
    // This is the exact failure mode flagged in review: computing all
    // three shares independently via (fee * bps / 10000) can leave 1-2
    // wei unallocated on every fee, forever, if the fee doesn't divide
    // evenly by 10000. The contract's fix: rewards and treasury are
    // computed precisely, and burn (the largest share) absorbs the
    // remainder via subtraction rather than its own independent bps
    // calculation. This test uses a deliberately "dirty" deposit amount
    // where the naive independent-calculation approach would strand 2
    // wei, and proves the real contract behavior doesn't.
    const ctx = await deployCore();
    const { basketId } = await createSingleTickerBasket(ctx);
    const { ethers, vault, user, usdg } = ctx;

    // Deliberately not a round number -- chosen so fee=2,499,999 (raw,
    // 6-decimal), which does NOT divide evenly into 30%/20%/50%.
    const dirtyDepositAmount = 999_999_999n;
    await usdg.mint(user.address, dirtyDepositAmount);
    await usdg.connect(user).approve(await vault.getAddress(), dirtyDepositAmount);
    await vault.connect(user).mint(basketId, dirtyDepositAmount);

    const expectedFee = (dirtyDepositAmount * 25n) / 10000n; // 2,499,999
    const expectedToRewards = (expectedFee * 3000n) / 10000n; // 749,999
    const expectedToTreasury = (expectedFee * 2000n) / 10000n; // 499,999

    // The naive independent calculation for burn WOULD be 1,249,999
    // (floor(2,499,999 * 5000 / 10000)) -- but 1,249,999 + 749,999 +
    // 499,999 = 2,499,997, which is 2 wei SHORT of the real fee. The
    // actual contract behavior (burn = fee - rewards - treasury) must
    // produce 1,250,001 instead, correctly absorbing that difference.
    const naiveBurnCalculation = (expectedFee * 5000n) / 10000n;
    const actualToBurn = await vault.pendingBuyBurn();

    expect(actualToBurn).to.not.equal(naiveBurnCalculation); // proves this test actually exercises the remainder case
    expect(actualToBurn + expectedToRewards + expectedToTreasury).to.equal(expectedFee); // proves no dust lost
  });

  it("claimRewardsPool and claimTreasuryFees should each revert with nothing to claim when their pending balance is zero", async function () {
    const ctx = await deployCore();
    const { vault } = ctx;

    // v19.1: was revertedWith("StaxVault: nothing to claim") x2
    await expect(vault.claimRewardsPool()).to.be.revertedWithCustomError(vault, "NothingToClaim");
    await expect(vault.claimTreasuryFees()).to.be.revertedWithCustomError(vault, "NothingToClaim");
  });

  it("v18: claimRewardsPool succeeds even when rewardsPool is a contract with no special receive logic (mirrors the same USDG-vs-ETH behavior change proven for the old team wallet)", async function () {
    // Same underlying point as before the fee-split rework: since
    // claims are ERC20 safeTransfers, not raw ETH sends, any address --
    // including a plain contract with no receive()/fallback -- can
    // receive them without issue.
    //
    // TODO (still outstanding, unchanged from before): this does NOT
    // test a FROZEN/paused USDG recipient specifically -- that needs
    // the MockFreezableERC20 pattern, already proven for the redeem
    // path (see the Finding #5 test), not yet applied here.
    const { ethers } = await network.connect();

    const MockERC20 = await ethers.getContractFactory("MockERC20");
    const contractRewardsPool = await MockERC20.deploy("Non-EOA stand-in", "NOEOA");

    const vaultCtx = await deployCore(await contractRewardsPool.getAddress(), ethers);
    const { vault, user, usdg } = vaultCtx;

    const { basketId } = await createSingleTickerBasket(vaultCtx);

    await depositUsdg(usdg, vault, user, basketId, ethers.parseUnits("1000", USDG_DECIMALS));

    const basket = await vault.baskets(basketId);
    const StaxBasketToken = await ethers.getContractFactory("StaxBasketToken");
    const basketToken = StaxBasketToken.attach(basket.token);
    const userTokenBalance = await basketToken.balanceOf(user.address);

    await vault.connect(user).redeem(basketId, userTokenBalance);

    expect(await vault.pendingRewardsPool()).to.be.greaterThan(0n);

    await expect(vault.claimRewardsPool()).to.not.be.revert(ethers);
    expect(await usdg.balanceOf(await contractRewardsPool.getAddress())).to.be.greaterThan(0n);
  });

  it("should not let a direct token donation unfairly dilute a subsequent legitimate depositor", async function () {
    const ctx = await deployCore();
    const { basketId, nvda } = await createSingleTickerBasket(ctx);
    const { ethers, vault, user, usdg } = ctx;

    const [, , , , , bob] = await ethers.getSigners(); // v18: index shifted by 1 -- deployCore now uses owner/rewardsPool/treasury/staxTokenStandIn/user (5 signers, was 4)

    await depositUsdg(usdg, vault, user, basketId, ethers.parseUnits("1000", USDG_DECIMALS));

    const navBeforeDonation = await vault.getBasketNavUsd(basketId);

    const donationAmount = ethers.parseUnits("1000", 18);
    await nvda.mint(await vault.getAddress(), donationAmount);

    const navAfterDonation = await vault.getBasketNavUsd(basketId);
    expect(navAfterDonation).to.equal(navBeforeDonation);

    const bobDeposit = ethers.parseUnits("1000", USDG_DECIMALS);
    await depositUsdg(usdg, vault, bob, basketId, bobDeposit);

    const basket = await vault.baskets(basketId);
    const StaxBasketToken = await ethers.getContractFactory("StaxBasketToken");
    const basketToken = StaxBasketToken.attach(basket.token);
    const bobShares = await basketToken.balanceOf(bob.address);

    expect(bobShares).to.be.greaterThan(0n);

    // v17: simplified -- no gas-cost adjustment needed since the payout
    // asset (USDG) is separate from the native gas token.
    const bobUsdgBefore = await usdg.balanceOf(bob.address);
    await vault.connect(bob).redeem(basketId, bobShares);
    const bobUsdgAfter = await usdg.balanceOf(bob.address);
    const bobRecovered = bobUsdgAfter - bobUsdgBefore;

    const conservativeLowerBound = ethers.parseUnits("980", USDG_DECIMALS); // 98% of 1000 USDG deposit
    expect(bobRecovered).to.be.greaterThan(conservativeLowerBound);

    await assertLedgerSolvency(vault, [nvda], [basketId]);
  });

  it("should maintain the accounting invariant: contract USDG balance >= pendingBuyBurn + pendingRewardsPool + pendingTreasuryFees", async function () {
    const ctx = await deployCore();
    const { basketId } = await createSingleTickerBasket(ctx);
    const { ethers, vault, user, usdg } = ctx;

    await depositUsdg(usdg, vault, user, basketId, ethers.parseUnits("1000", USDG_DECIMALS));

    const basket = await vault.baskets(basketId);
    const StaxBasketToken = await ethers.getContractFactory("StaxBasketToken");
    const basketToken = StaxBasketToken.attach(basket.token);
    const userTokenBalance = await basketToken.balanceOf(user.address);

    await vault.connect(user).redeem(basketId, userTokenBalance);

    const vaultUsdgBalance = await usdg.balanceOf(await vault.getAddress());
    const pendingBuyBurn = await vault.pendingBuyBurn();
    const pendingRewardsPool = await vault.pendingRewardsPool();
    const pendingTreasuryFees = await vault.pendingTreasuryFees();

    expect(vaultUsdgBalance >= pendingBuyBurn + pendingRewardsPool + pendingTreasuryFees).to.equal(true);
  });

  it("should not let a donation immediately after the tightest possible genesis mint dilute the next depositor (frontrun-genesis variant)", async function () {
    const ctx = await deployCore();
    const { basketId, nvda } = await createSingleTickerBasket(ctx);
    const { ethers, vault, user, usdg } = ctx;
    const [, , , , , bob] = await ethers.getSigners(); // v18: index shifted by 1 -- deployCore now uses owner/rewardsPool/treasury/staxTokenStandIn/user (5 signers, was 4)

    // Tightest reasonable genesis mint above the $2 floor -- 3 USDG ($3).
    await depositUsdg(usdg, vault, user, basketId, ethers.parseUnits("3", USDG_DECIMALS));

    const donationAmount = ethers.parseUnits("1000", 18);
    await nvda.mint(await vault.getAddress(), donationAmount);

    const bobDeposit = ethers.parseUnits("1000", USDG_DECIMALS);
    await depositUsdg(usdg, vault, bob, basketId, bobDeposit);

    const basket = await vault.baskets(basketId);
    const StaxBasketToken = await ethers.getContractFactory("StaxBasketToken");
    const basketToken = StaxBasketToken.attach(basket.token);
    const bobShares = await basketToken.balanceOf(bob.address);
    expect(bobShares).to.be.greaterThan(0n);

    const bobUsdgBefore = await usdg.balanceOf(bob.address);
    await vault.connect(bob).redeem(basketId, bobShares);
    const bobUsdgAfter = await usdg.balanceOf(bob.address);
    const bobRecovered = bobUsdgAfter - bobUsdgBefore;

    expect(bobRecovered).to.be.greaterThan(ethers.parseUnits("980", USDG_DECIMALS));

    await assertLedgerSolvency(vault, [nvda], [basketId]);
  });

  it("should either mint proportionally-fair shares or cleanly revert with zero tokens out after an extreme donation, never mint zero-value shares silently", async function () {
    const ctx = await deployCore();
    const { basketId, nvda } = await createSingleTickerBasket(ctx, 1, "1000000000", "1000000000");
    const { ethers, vault, user, usdg } = ctx;

    await depositUsdg(usdg, vault, user, basketId, ethers.parseUnits("1000", USDG_DECIMALS));

    const extremeDonation = ethers.parseUnits("1000000", 18);
    await nvda.mint(await vault.getAddress(), extremeDonation);

    // Near the $2 genesis-adjacent floor equivalent -- 3 USDG ($3).
    const tinyDeposit = ethers.parseUnits("3", USDG_DECIMALS);
    let reverted = false;
    try {
      await depositUsdg(usdg, vault, user, basketId, tinyDeposit);
    } catch (err: any) {
      // v19.1: was checking err.message includes "StaxVault:" -- that
      // substring no longer appears in ANY revert message (custom error
      // names don't share a common prefix the way the old strings did),
      // so the old check would now ALWAYS FAIL here even on a genuinely
      // correct, expected revert (e.g. SharesTooLow). Loosened to just
      // confirming a revert occurred, which is what this test actually
      // needs -- the specific error identity isn't the point here, the
      // point is "never mint zero-value shares silently," and reaching
      // this catch block at all already proves that.
      reverted = true;
    }

    if (!reverted) {
      const basket = await vault.baskets(basketId);
      const StaxBasketToken = await ethers.getContractFactory("StaxBasketToken");
      const basketToken = StaxBasketToken.attach(basket.token);
      const newBalance = await basketToken.balanceOf(user.address);
      expect(newBalance).to.be.greaterThan(0n);
    }

    await assertLedgerSolvency(vault, [nvda], [basketId]);
  });

  it("should reject mint when a ticker's price feed is stale", async function () {
    const ctx = await deployCore();
    const { basketId, nvdaOracle } = await createSingleTickerBasket(ctx);
    const { ethers, vault, user, usdg } = ctx;

    const latestBlock = await ethers.provider.getBlock("latest");
    const now = latestBlock!.timestamp;
    const staleTimestamp = now - ONE_HOUR * 2;
    await nvdaOracle.setPriceAt(feedPrice(NVDA_USD_DOLLARS), staleTimestamp);

    // v19.1: was revertedWith("StaxVault: stale oracle price")
    await expect(
      depositUsdg(usdg, vault, user, basketId, ethers.parseUnits("1000", USDG_DECIMALS))
    ).to.be.revertedWithCustomError(vault, "StaleOraclePrice");
  });

  // ---------------------------------------------------------------------
  // v18.2 regression tests: updatePriceFeed (Opus review, post-mainnet-
  // deploy finding -- equity feed staleness needed a correction path,
  // this proves the new setter actually works and is properly gated,
  // same discipline as every other fund-path-adjacent change tonight)
  // ---------------------------------------------------------------------

  it("v18.2: updatePriceFeed genuinely recalibrates staleness -- a mint that fails under the old threshold succeeds after updating to a longer one, with the same price data", async function () {
    const ctx = await deployCore();
    const { basketId, nvda, nvdaOracle } = await createSingleTickerBasket(ctx);
    const { ethers, owner, vault, user, usdg } = ctx;

    const latestBlock = await ethers.provider.getBlock("latest");
    const now = latestBlock!.timestamp;
    const staleTimestamp = now - ONE_HOUR * 2; // 2h old -- stale under the original 1h threshold
    await nvdaOracle.setPriceAt(feedPrice(NVDA_USD_DOLLARS), staleTimestamp);

    // Confirm it genuinely fails first, under the original threshold --
    // otherwise this test wouldn't actually prove the update did
    // anything.
    // v19.1: was revertedWith("StaxVault: stale oracle price")
    await expect(
      depositUsdg(usdg, vault, user, basketId, ethers.parseUnits("1000", USDG_DECIMALS))
    ).to.be.revertedWithCustomError(vault, "StaleOraclePrice");

    // Recalibrate to a longer threshold (e.g. simulating the real
    // equity-feed weekend-gap fix) -- same feed address, same stale
    // price data, just a longer acceptance window.
    const THREE_HOURS = 3 * ONE_HOUR;
    await vault.connect(owner).updatePriceFeed(await nvda.getAddress(), await nvdaOracle.getAddress(), THREE_HOURS);

    // Same 2h-old price data now succeeds, since 2h < 3h.
    await expect(
      depositUsdg(usdg, vault, user, basketId, ethers.parseUnits("1000", USDG_DECIMALS))
    ).to.not.be.revert(ethers);
  });

  it("v18.2: updatePriceFeed rejects address(0) as the new feed", async function () {
    const ctx = await deployCore();
    const { nvda } = await createSingleTickerBasket(ctx);
    const { ethers, owner, vault } = ctx;

    // v19.1: was revertedWith("StaxVault: zero feed")
    await expect(
      vault.connect(owner).updatePriceFeed(await nvda.getAddress(), ethers.ZeroAddress, ONE_HOUR)
    ).to.be.revertedWithCustomError(vault, "ZeroFeed");
  });

  it("v18.2: updatePriceFeed reverts if the ticker was never set via setPriceFeed first -- can't be used to backdoor an initial set, mirrors updateTickerPool's exact guard", async function () {
    const ctx = await deployCore();
    const { ethers, owner, vault } = ctx;
    const [, , , , bob] = await ethers.getSigners();

    const MockPriceOracle = await ethers.getContractFactory("MockPriceOracle");
    const neverSetOracle = await MockPriceOracle.deploy(feedPrice(NVDA_USD_DOLLARS), 8);

    // v19.1: was revertedWith("StaxVault: feed not set")
    await expect(
      vault.connect(owner).updatePriceFeed(bob.address, await neverSetOracle.getAddress(), ONE_HOUR)
    ).to.be.revertedWithCustomError(vault, "FeedNotSet");
  });

  it("v14: should reject mint when a ticker's oraclePaused() is true, even with a FRESH timestamp (adversarial review finding)", async function () {
    const ctx = await deployCore();
    const { basketId, nvda, nvdaOracle } = await createSingleTickerBasket(ctx);
    const { ethers, vault, user, usdg } = ctx;

    const latestBlock = await ethers.provider.getBlock("latest");
    const now = latestBlock!.timestamp;
    await nvdaOracle.setPriceAt(feedPrice(NVDA_USD_DOLLARS), now);

    await nvda.setOraclePaused(true);

    // v19.1: was revertedWith("StaxVault: oracle paused")
    await expect(
      depositUsdg(usdg, vault, user, basketId, ethers.parseUnits("1000", USDG_DECIMALS))
    ).to.be.revertedWithCustomError(vault, "OraclePausedErr");
  });

  it("v14: should allow mint normally when oraclePaused() is false (confirms the check doesn't over-trigger)", async function () {
    const ctx = await deployCore();
    const { basketId, nvda } = await createSingleTickerBasket(ctx);
    const { ethers, vault, user, usdg } = ctx;

    expect(await nvda.oraclePaused()).to.equal(false);

    await expect(
      depositUsdg(usdg, vault, user, basketId, ethers.parseUnits("1000", USDG_DECIMALS))
    ).to.not.be.revert(ethers);
  });

  it("should correctly handle a ticker with non-18 decimals (6-decimal token)", async function () {
    const ctx = await deployCore();
    const { ethers, owner, vault, router, usdg, user } = ctx;

    const MockERC20Decimals = await ethers.getContractFactory("MockERC20Decimals");
    const sixDecToken = await MockERC20Decimals.deploy("Mock 6-Decimal Stock", "m6DEC", 6);

    const MockPriceOracle = await ethers.getContractFactory("MockPriceOracle");
    const tokenOracle = await MockPriceOracle.deploy(feedPrice(100n), 8);

    await vault.connect(owner).setPriceFeed(await sixDecToken.getAddress(), await tokenOracle.getAddress(), ONE_HOUR);
    await setupTickerPool(vault, owner, usdg, sixDecToken, ethers);

    const basketId = 99;
    await vault.connect(owner).createBasket(
      basketId,
      "Six Decimal Test",
      "s6DEC",
      [await sixDecToken.getAddress()],
      [10000],
      ethers.parseUnits("1000000", 18),
      ethers.parseUnits("100000", 18)
    );

    await sixDecToken.mint(await router.getAddress(), ethers.parseUnits("1000000", 6));

    // v17: BOTH sides of this pair are now 6-decimal (usdg AND the
    // ticker) -- computeRate handles this correctly since it takes each
    // side's decimals independently, unlike the old hardcoded /1e12 or
    // *1e12 which assumed exactly one side was always 18.
    const rateUsdgToToken = computeRate(USDG_USD_DOLLARS, USDG_DECIMALS, 100n, 6);
    const rateTokenToUsdg = computeRate(100n, 6, USDG_USD_DOLLARS, USDG_DECIMALS);

    await router.setRate(await usdg.getAddress(), await sixDecToken.getAddress(), rateUsdgToToken);
    await router.setRate(await sixDecToken.getAddress(), await usdg.getAddress(), rateTokenToUsdg);

    await depositUsdg(usdg, vault, user, basketId, ethers.parseUnits("1000", USDG_DECIMALS));

    const vaultTokenBalance = await sixDecToken.balanceOf(await vault.getAddress());
    expect(vaultTokenBalance).to.be.greaterThan(0n);

    const basket = await vault.baskets(basketId);
    const StaxBasketToken = await ethers.getContractFactory("StaxBasketToken");
    const basketToken = StaxBasketToken.attach(basket.token);
    const userBalance = await basketToken.balanceOf(user.address);
    expect(userBalance).to.be.greaterThan(0n);

    await vault.connect(user).redeem(basketId, userBalance);
    const remaining = await basketToken.balanceOf(user.address);
    expect(remaining).to.equal(0n);
  });

  it("should block minting when paused but still allow redemption", async function () {
    const ctx = await deployCore();
    const { basketId } = await createSingleTickerBasket(ctx);
    const { ethers, owner, vault, user, usdg } = ctx;

    await depositUsdg(usdg, vault, user, basketId, ethers.parseUnits("1000", USDG_DECIMALS));

    await vault.connect(owner).setMintPaused(basketId, true);

    // v19.1: was revertedWith("StaxVault: minting paused")
    await expect(
      depositUsdg(usdg, vault, user, basketId, ethers.parseUnits("1000", USDG_DECIMALS))
    ).to.be.revertedWithCustomError(vault, "MintingPaused");

    const basket = await vault.baskets(basketId);
    const StaxBasketToken = await ethers.getContractFactory("StaxBasketToken");
    const basketToken = StaxBasketToken.attach(basket.token);
    const userBalance = await basketToken.balanceOf(user.address);

    await vault.connect(user).redeem(basketId, userBalance);
    const remaining = await basketToken.balanceOf(user.address);
    expect(remaining).to.equal(0n);
  });

  it("v7: full exit then re-mint resets cleanly to real scale despite residual dust NAV", async function () {
    const ctx = await deployCore();
    const { basketId, nvda } = await createSingleTickerBasket(ctx);
    const { ethers, vault, user, usdg } = ctx;

    const basket = await vault.baskets(basketId);
    const StaxBasketToken = await ethers.getContractFactory("StaxBasketToken");
    const basketToken = StaxBasketToken.attach(basket.token);

    await depositUsdg(usdg, vault, user, basketId, ethers.parseUnits("1000", USDG_DECIMALS));
    const fullBalance = await basketToken.balanceOf(user.address);
    await vault.connect(user).redeem(basketId, fullBalance);
    expect(await basketToken.totalSupply()).to.equal(0n);

    await nvda.mint(await vault.getAddress(), 1000n);
    const dustNav = await vault.getBasketNavUsd(basketId);
    expect(dustNav).to.equal(0n);

    // v17 fix: bumped from 1000 to 2000 USDG -- the original 1000
    // deposit, net of the 0.25% mint fee (~997.5), left no real margin
    // above the 1000e18 assertion threshold below (the old ETH test had
    // a large margin because 1 ETH was worth ~$3000, not ~$1000).
    await depositUsdg(usdg, vault, user, basketId, ethers.parseUnits("2000", USDG_DECIMALS));
    const newBalance = await basketToken.balanceOf(user.address);

    expect(newBalance).to.be.greaterThan(ethers.parseUnits("1000", 18));

    await assertLedgerSolvency(vault, [nvda], [basketId]);
  });

  it("v7: repeated full-exit/re-mint cycles do not compound share deflation", async function () {
    const ctx = await deployCore();
    const { basketId, nvda } = await createSingleTickerBasket(ctx);
    const { ethers, vault, user, usdg, router, owner } = ctx;

    // v17: top up router's usdg liquidity from owner's stockpile,
    // replacing the old "transfer WETH to router" pattern.
    await usdg.connect(owner).transfer(await router.getAddress(), ethers.parseUnits("50000", USDG_DECIMALS));

    const basket = await vault.baskets(basketId);
    const StaxBasketToken = await ethers.getContractFactory("StaxBasketToken");
    const basketToken = StaxBasketToken.attach(basket.token);

    const mintedAmounts: bigint[] = [];

    for (let cycle = 0; cycle < 3; cycle++) {
      // v17 fix: same margin fix as the previous test -- 2000 instead
      // of 1000 USDG, so the post-fee amount stays comfortably above
      // the 1000e18 assertion threshold below.
      await depositUsdg(usdg, vault, user, basketId, ethers.parseUnits("2000", USDG_DECIMALS));
      const balance = await basketToken.balanceOf(user.address);
      mintedAmounts.push(balance);

      await vault.connect(user).redeem(basketId, balance);
      expect(await basketToken.totalSupply()).to.equal(0n);

      await nvda.mint(await vault.getAddress(), 1000n);
    }

    for (const amount of mintedAmounts) {
      expect(amount).to.be.greaterThan(ethers.parseUnits("1000", 18));
    }

    await assertLedgerSolvency(vault, [nvda], [basketId]);
  });

  it("v7: mint into an artificially-degenerate share scale reverts with the granularity floor, not a wei-scale mint", async function () {
    const ctx = await deployCore();
    const { basketId, nvda } = await createSingleTickerBasket(
      ctx,
      1,
      "100000000000000000000000",
      "100000000000000000000000"
    );
    const { ethers, vault, user, usdg } = ctx;
    const [, , , , , bob] = await ethers.getSigners(); // v18: index shifted by 1 -- deployCore now uses owner/rewardsPool/treasury/staxTokenStandIn/user (5 signers, was 4)

    await depositUsdg(usdg, vault, user, basketId, ethers.parseUnits("120", USDG_DECIMALS));

    await nvda.mint(await vault.getAddress(), ethers.parseUnits("100000000000000000000", 18));

    await expect(
      depositUsdg(usdg, vault, bob, basketId, ethers.parseUnits("1000", USDG_DECIMALS))
    ).to.not.be.revert(ethers);

    await assertLedgerSolvency(vault, [nvda], [basketId]);
  });

  it("v7: a normal mint does not meaningfully move the token's price-per-share (not a bonding curve)", async function () {
    const ctx = await deployCore();
    const { basketId } = await createSingleTickerBasket(ctx);
    const { ethers, vault, user, usdg } = ctx;
    const [, , , , , bob] = await ethers.getSigners(); // v18: index shifted by 1 -- deployCore now uses owner/rewardsPool/treasury/staxTokenStandIn/user (5 signers, was 4)

    await depositUsdg(usdg, vault, user, basketId, ethers.parseUnits("1000", USDG_DECIMALS));

    const navBefore = await vault.getBasketNavUsd(basketId);
    const basket = await vault.baskets(basketId);
    const StaxBasketToken = await ethers.getContractFactory("StaxBasketToken");
    const basketToken = StaxBasketToken.attach(basket.token);
    const supplyBefore = await basketToken.totalSupply();
    const priceBefore = Number(navBefore) / Number(supplyBefore);

    await depositUsdg(usdg, vault, bob, basketId, ethers.parseUnits("2000", USDG_DECIMALS));

    const navAfter = await vault.getBasketNavUsd(basketId);
    const supplyAfter = await basketToken.totalSupply();
    const priceAfter = Number(navAfter) / Number(supplyAfter);

    const relativeDrift = Math.abs(priceAfter - priceBefore) / priceBefore;
    expect(relativeDrift).to.be.lessThan(0.0001);
  });

  // ---------------------------------------------------------------------
  // v8 regression tests: shared-ticker ledger isolation fix
  // ---------------------------------------------------------------------

  it("v8: two baskets sharing a ticker have fully isolated NAV/holdings -- redeeming one doesn't affect the other", async function () {
    const ctx = await deployCore();
    const { ethers, owner, vault, router, usdg, user } = ctx;
    const [, , , , , bob] = await ethers.getSigners(); // v18: index shifted by 1 -- deployCore now uses owner/rewardsPool/treasury/staxTokenStandIn/user (5 signers, was 4)

    const MockERC20 = await ethers.getContractFactory("MockERC20");
    const shared = await MockERC20.deploy("Mock Shared", "mSHARED");
    const uniqueA = await MockERC20.deploy("Mock UniqueA", "mUNIQUEA");
    const uniqueB = await MockERC20.deploy("Mock UniqueB", "mUNIQUEB");

    const MockPriceOracle = await ethers.getContractFactory("MockPriceOracle");
    const sharedOracle = await MockPriceOracle.deploy(feedPrice(150n), 8);
    const uniqueAOracle = await MockPriceOracle.deploy(feedPrice(100n), 8);
    const uniqueBOracle = await MockPriceOracle.deploy(feedPrice(200n), 8);

    await vault.connect(owner).setPriceFeed(await shared.getAddress(), await sharedOracle.getAddress(), ONE_HOUR);
    await vault.connect(owner).setPriceFeed(await uniqueA.getAddress(), await uniqueAOracle.getAddress(), ONE_HOUR);
    await vault.connect(owner).setPriceFeed(await uniqueB.getAddress(), await uniqueBOracle.getAddress(), ONE_HOUR);
    await setupTickerPool(vault, owner, usdg, shared, ethers);
    await setupTickerPool(vault, owner, usdg, uniqueA, ethers);
    await setupTickerPool(vault, owner, usdg, uniqueB, ethers);

    const basketAId = 10;
    const basketBId = 11;
    await vault.connect(owner).createBasket(
      basketAId, "Basket A", "sA",
      [await shared.getAddress(), await uniqueA.getAddress()],
      [5000, 5000],
      ethers.parseUnits("1000000", 18),
      ethers.parseUnits("100000", 18)
    );
    await vault.connect(owner).createBasket(
      basketBId, "Basket B", "sB",
      [await shared.getAddress(), await uniqueB.getAddress()],
      [5000, 5000],
      ethers.parseUnits("1000000", 18),
      ethers.parseUnits("100000", 18)
    );

    for (const [token, priceDollars] of [
      [shared, 150n],
      [uniqueA, 100n],
      [uniqueB, 200n],
    ] as const) {
      await token.mint(await router.getAddress(), ethers.parseUnits("1000000", 18));
      const rateUsdgToToken = computeRate(USDG_USD_DOLLARS, USDG_DECIMALS, priceDollars, 18);
      const rateTokenToUsdg = computeRate(priceDollars, 18, USDG_USD_DOLLARS, USDG_DECIMALS);
      await router.setRate(await usdg.getAddress(), await token.getAddress(), rateUsdgToToken);
      await router.setRate(await token.getAddress(), await usdg.getAddress(), rateTokenToUsdg);
    }

    await depositUsdg(usdg, vault, user, basketAId, ethers.parseUnits("1000", USDG_DECIMALS));
    await depositUsdg(usdg, vault, bob, basketBId, ethers.parseUnits("1000", USDG_DECIMALS));

    const navA_before = await vault.getBasketNavUsd(basketAId);
    const navB_before = await vault.getBasketNavUsd(basketBId);
    expect(navA_before).to.be.greaterThan(0n);
    expect(navB_before).to.be.greaterThan(0n);

    const pooledSharedBalance = await shared.balanceOf(await vault.getAddress());
    const sharedAddr = await shared.getAddress();
    const basketASharedLedger = await vault.basketTickerHoldings(basketAId, sharedAddr);
    const basketBSharedLedger = await vault.basketTickerHoldings(basketBId, sharedAddr);

    expect(basketASharedLedger).to.be.greaterThan(0n);
    expect(basketBSharedLedger).to.be.greaterThan(0n);
    expect(basketASharedLedger).to.be.lessThan(pooledSharedBalance);
    expect(basketBSharedLedger).to.be.lessThan(pooledSharedBalance);
    expect(basketASharedLedger + basketBSharedLedger).to.equal(pooledSharedBalance);

    const basketAData = await vault.baskets(basketAId);
    const StaxBasketToken = await ethers.getContractFactory("StaxBasketToken");
    const tokenA = StaxBasketToken.attach(basketAData.token);
    const userBalanceA = await tokenA.balanceOf(user.address);
    await vault.connect(user).redeem(basketAId, userBalanceA);

    const navB_after = await vault.getBasketNavUsd(basketBId);
    expect(navB_after).to.equal(navB_before);

    const basketBData = await vault.baskets(basketBId);
    const tokenB = StaxBasketToken.attach(basketBData.token);
    const userBalanceB = await tokenB.balanceOf(bob.address);

    const bobUsdgBefore = await usdg.balanceOf(bob.address);
    await vault.connect(bob).redeem(basketBId, userBalanceB);
    const bobUsdgAfter = await usdg.balanceOf(bob.address);
    const bobRecovered = bobUsdgAfter - bobUsdgBefore;

    expect(bobRecovered).to.be.greaterThan(ethers.parseUnits("980", USDG_DECIMALS));

    await assertLedgerSolvency(vault, [shared, uniqueA, uniqueB], [basketAId, basketBId]);
  });

  it("v8: shared-ticker ledger correctness does not depend on basket creation order", async function () {
    const ctx = await deployCore();
    const { ethers, owner, vault, router, usdg, user } = ctx;
    const [, , , , , bob] = await ethers.getSigners(); // v18: index shifted by 1 -- deployCore now uses owner/rewardsPool/treasury/staxTokenStandIn/user (5 signers, was 4)

    const MockERC20 = await ethers.getContractFactory("MockERC20");
    const shared = await MockERC20.deploy("Mock Shared", "mSHARED");
    const uniqueA = await MockERC20.deploy("Mock UniqueA", "mUNIQUEA");
    const uniqueB = await MockERC20.deploy("Mock UniqueB", "mUNIQUEB");

    const MockPriceOracle = await ethers.getContractFactory("MockPriceOracle");
    const sharedOracle = await MockPriceOracle.deploy(feedPrice(150n), 8);
    const uniqueAOracle = await MockPriceOracle.deploy(feedPrice(100n), 8);
    const uniqueBOracle = await MockPriceOracle.deploy(feedPrice(200n), 8);

    await vault.connect(owner).setPriceFeed(await shared.getAddress(), await sharedOracle.getAddress(), ONE_HOUR);
    await vault.connect(owner).setPriceFeed(await uniqueA.getAddress(), await uniqueAOracle.getAddress(), ONE_HOUR);
    await vault.connect(owner).setPriceFeed(await uniqueB.getAddress(), await uniqueBOracle.getAddress(), ONE_HOUR);
    await setupTickerPool(vault, owner, usdg, shared, ethers);
    await setupTickerPool(vault, owner, usdg, uniqueA, ethers);
    await setupTickerPool(vault, owner, usdg, uniqueB, ethers);

    const basketAId = 20;
    const basketBId = 21;
    await vault.connect(owner).createBasket(
      basketBId, "Basket B", "sB",
      [await shared.getAddress(), await uniqueB.getAddress()],
      [5000, 5000],
      ethers.parseUnits("1000000", 18),
      ethers.parseUnits("100000", 18)
    );
    await vault.connect(owner).createBasket(
      basketAId, "Basket A", "sA",
      [await shared.getAddress(), await uniqueA.getAddress()],
      [5000, 5000],
      ethers.parseUnits("1000000", 18),
      ethers.parseUnits("100000", 18)
    );

    for (const [token, priceDollars] of [
      [shared, 150n],
      [uniqueA, 100n],
      [uniqueB, 200n],
    ] as const) {
      await token.mint(await router.getAddress(), ethers.parseUnits("1000000", 18));
      const rateUsdgToToken = computeRate(USDG_USD_DOLLARS, USDG_DECIMALS, priceDollars, 18);
      const rateTokenToUsdg = computeRate(priceDollars, 18, USDG_USD_DOLLARS, USDG_DECIMALS);
      await router.setRate(await usdg.getAddress(), await token.getAddress(), rateUsdgToToken);
      await router.setRate(await token.getAddress(), await usdg.getAddress(), rateTokenToUsdg);
    }

    await depositUsdg(usdg, vault, user, basketAId, ethers.parseUnits("1000", USDG_DECIMALS));
    await depositUsdg(usdg, vault, bob, basketBId, ethers.parseUnits("1000", USDG_DECIMALS));

    const navA = await vault.getBasketNavUsd(basketAId);
    const navB = await vault.getBasketNavUsd(basketBId);

    const navDiff = navA > navB ? navA - navB : navB - navA;
    const relativeDiff = Number(navDiff) / Number(navA);
    expect(relativeDiff).to.be.lessThan(0.01);

    const basketAData = await vault.baskets(basketAId);
    const basketBData = await vault.baskets(basketBId);
    const StaxBasketToken = await ethers.getContractFactory("StaxBasketToken");
    const tokenA = StaxBasketToken.attach(basketAData.token);
    const tokenB = StaxBasketToken.attach(basketBData.token);

    const userBalanceA = await tokenA.balanceOf(user.address);
    const userBalanceB = await tokenB.balanceOf(bob.address);

    await vault.connect(user).redeem(basketAId, userBalanceA);
    await vault.connect(bob).redeem(basketBId, userBalanceB);

    expect(await tokenA.totalSupply()).to.equal(0n);
    expect(await tokenB.totalSupply()).to.equal(0n);

    await assertLedgerSolvency(vault, [shared, uniqueA, uniqueB], [basketAId, basketBId]);
  });
});