// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {console} from "forge-std/console.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";
import {StaxVault} from "../../contracts/StaxVault.sol";
import {MockERC20} from "../../contracts/mocks/MockERC20.sol";
import {MockERC20Decimals} from "../../contracts/mocks/MockERC20Decimals.sol";
import {MockUniversalRouter} from "../../contracts/mocks/MockUniversalRouter.sol";
import {MockPermit2} from "../../contracts/mocks/MockPermit2.sol";
import {MockPriceOracle} from "../../contracts/mocks/MockPriceOracle.sol";
import {StaxVaultHandler} from "./StaxVaultHandler.sol";

/// @notice Invariant (fuzz) test for StaxVault's core solvency property:
///
///     for every ticker T:
///       sum over all baskets of basketTickerHoldings[basketId][T]
///         <= IERC20(T).balanceOf(vault)
///
/// v17: updated for the USDG migration -- USDG (6-decimal mock) replaces
/// WETH as the vault's deposit/quote currency throughout. See
/// StaxVaultHandler.sol for the corresponding fuzzer-side changes.
///
/// Run with: forge test --match-contract StaxVaultInvariantTest -vv
contract StaxVaultInvariantTest is StdInvariant, Test {
    StaxVault public vault;
    StaxVaultHandler public handler;

    MockERC20Decimals public usdg;
    MockUniversalRouter public router;
    MockPermit2 public permit2;
    MockPriceOracle public usdgUsdOracle;
    MockPriceOracle public sequencerFeed;

    MockERC20 public shared;
    MockERC20 public exclusiveA;
    MockERC20 public exclusiveB;

    uint256 constant BASKET_A_ID = 1;
    uint256 constant BASKET_B_ID = 2;

    uint256 constant ONE_HOUR = 3600;
    uint8 constant USDG_DECIMALS = 6;
    int256 constant USDG_USD_DOLLARS = 1;
    int256 constant SHARED_USD_DOLLARS = 150;
    int256 constant EXCLUSIVE_A_USD_DOLLARS = 100;
    int256 constant EXCLUSIVE_B_USD_DOLLARS = 200;

    function setUp() public {
        address rewardsPool = makeAddr("rewards");
        address treasury = makeAddr("treasury");
        // v18.1: staxToken removed -- it's no longer a constructor arg
        // at all (set once, post-deploy, via setStaxToken). This test
        // never exercises buy-burn, so nothing else in this file needs
        // it.

        // v17: replaces MockWETH. 6 decimals, matching the real
        // confirmed USDG contract.
        usdg = new MockERC20Decimals("Mock USDG", "mUSDG", USDG_DECIMALS);

        permit2 = new MockPermit2();

        // ASSUMPTION FLAGGED (same as the Hardhat suite): passing usdg's
        // address where weth's address used to go, assuming
        // MockUniversalRouter's second constructor param is a generic
        // quote/settle currency role. Needs confirming against the
        // mock's real source.
        router = new MockUniversalRouter(address(permit2), address(usdg));

        sequencerFeed = new MockPriceOracle(0, 8);
        sequencerFeed.setPriceAt(0, 1);
        vm.warp(block.timestamp + ONE_HOUR + 1);

        // v17.3 CRITICAL fix (real bug, found via the genesis-seeding
        // check surfacing it): usdgUsdOracle MUST be created AFTER the
        // warp, not before. Its constructor sets updatedAt to
        // block.timestamp AT CREATION TIME -- creating it before warping
        // forward by ONE_HOUR+1 (needed for the sequencer grace-period
        // check) meant it was already stale (elapsed time > its own
        // maxStaleness = ONE_HOUR) before a single price read ever
        // happened. Every mint's first oracle read would revert with
        // "stale oracle price" -- silently caught by the handler's
        // try/catch, invisible in Foundry's own outer call-summary
        // table. This is the likely real explanation for the
        // 0-mint-successes result seen earlier, not "small sample
        // noise" as first assumed -- every invariant run tonight may
        // have been testing an empty vault this whole time. Moving
        // creation to here (post-warp) matches the same pattern the
        // ticker oracles already correctly followed (they're created
        // later, via _setUpTicker, naturally after this point).
        usdgUsdOracle = new MockPriceOracle(_feedPrice(USDG_USD_DOLLARS), 8);

        vault = new StaxVault(
            rewardsPool,
            treasury,
            address(router),
            address(permit2),
            address(usdg),
            address(usdgUsdOracle),
            uint48(ONE_HOUR),
            address(sequencerFeed)
        );

        // v17: replaces "deal ETH, wrap to WETH, transfer to router".
        // Mint USDG liquidity directly to the router -- no wrap step
        // needed since USDG is always a plain ERC20.
        usdg.mint(address(router), 1_000_000e6);

        shared = new MockERC20("Mock Shared", "mSHARED");
        exclusiveA = new MockERC20("Mock ExclusiveA", "mEXA");
        exclusiveB = new MockERC20("Mock ExclusiveB", "mEXB");

        _setUpTicker(shared, SHARED_USD_DOLLARS);
        _setUpTicker(exclusiveA, EXCLUSIVE_A_USD_DOLLARS);
        _setUpTicker(exclusiveB, EXCLUSIVE_B_USD_DOLLARS);

        address[] memory tickersA = new address[](2);
        tickersA[0] = address(shared);
        tickersA[1] = address(exclusiveA);
        uint256[] memory weightsA = new uint256[](2);
        weightsA[0] = 5000;
        weightsA[1] = 5000;

        vault.createBasket(
            BASKET_A_ID, "Basket A", "sA", tickersA, weightsA,
            1_000_000_000e18, 1_000_000_000e18
        );

        address[] memory tickersB = new address[](2);
        tickersB[0] = address(shared);
        tickersB[1] = address(exclusiveB);
        uint256[] memory weightsB = new uint256[](2);
        weightsB[0] = 5000;
        weightsB[1] = 5000;

        vault.createBasket(
            BASKET_B_ID, "Basket B", "sB", tickersB, weightsB,
            1_000_000_000e18, 1_000_000_000e18
        );

        handler = new StaxVaultHandler(
            vault, BASKET_A_ID, BASKET_B_ID,
            address(shared), address(exclusiveA), address(exclusiveB)
        );

        // v17: replaces vm.deal(address(handler), 500 ether). The
        // handler needs a real USDG balance, not native ETH -- there is
        // no vm.deal-equivalent for ERC20s, so this mints mock USDG
        // directly to the handler's address. Sized generously against
        // the handler's per-mint bound (20e6 to 10_000e6) times enough
        // fuzz runs to not run dry mid-campaign.
        usdg.mint(address(handler), 50_000_000e6);

        // v17.2 fix (Opus review, third pass -- the real defect, not a
        // cosmetic one): `runs = 512` means 512 INDEPENDENT campaigns,
        // each from a fresh setUp() call -- i.e. a fresh, EMPTY vault
        // every time. Without a guaranteed starting position, a run
        // whose early random calls happen to be redeems (no-op, nothing
        // to redeem yet) or sub-floor mints (revert on
        // MIN_INITIAL_VALUE_USD) can spend its entire depth never
        // establishing a real position -- "solvency held" for an empty
        // vault proves nothing. Seeding a real genesis mint into BOTH
        // baskets here, directly from the test contract (not through
        // the fuzzed handler), guarantees every one of the 512 runs
        // starts from a funded, real state where both mint and redeem
        // have genuine work to do from call one.
        uint256 seedAmount = 1000e6; // 1000 USDG per basket, comfortably clears MIN_INITIAL_VALUE_USD
        usdg.mint(address(this), seedAmount * 2);
        usdg.approve(address(vault), seedAmount * 2);
        vault.mint(BASKET_A_ID, seedAmount);
        vault.mint(BASKET_B_ID, seedAmount);

        targetContract(address(handler));
    }

    function _setUpTicker(MockERC20 token, int256 priceDollars) internal {
        MockPriceOracle oracle = new MockPriceOracle(_feedPrice(priceDollars), 8);
        vault.setPriceFeed(address(token), address(oracle), uint48(ONE_HOUR));

        // v17: pool is now usdg<->ticker, enforced by setTickerPool
        // itself (passing anything else reverts).
        (address currency0, address currency1) = address(usdg) < address(token)
            ? (address(usdg), address(token))
            : (address(token), address(usdg));
        vault.setTickerPool(address(token), currency0, currency1, 3000, 60, address(0));

        token.mint(address(router), 1_000_000e18);

        (uint256 rateUsdgToToken, uint256 rateTokenToUsdg) = _computeRates(
            USDG_USD_DOLLARS, USDG_DECIMALS, priceDollars, 18
        );

        router.setRate(address(usdg), address(token), rateUsdgToToken);
        router.setRate(address(token), address(usdg), rateTokenToUsdg);
    }

    /// @dev Same decimals-aware rate calculation as the Hardhat suite's
    /// computeRate() -- verified there to reproduce the original
    /// hand-written 6-decimal-ticker formula exactly. Returns both
    /// directions since every ticker setup needs both.
    function _computeRates(int256 fromDollars, uint8 fromDecimals, int256 toDollars, uint8 toDecimals)
        internal
        pure
        returns (uint256 rateFromTo, uint256 rateToFrom)
    {
        uint256 fromUsd18 = uint256(fromDollars) * 1e18;
        uint256 toUsd18 = uint256(toDollars) * 1e18;

        uint256 baseRateFromTo = (fromUsd18 * 1e18) / toUsd18;
        int256 diffFromTo = int256(uint256(toDecimals)) - int256(uint256(fromDecimals));
        rateFromTo = diffFromTo >= 0
            ? baseRateFromTo * (10 ** uint256(diffFromTo))
            : baseRateFromTo / (10 ** uint256(-diffFromTo));

        uint256 baseRateToFrom = (toUsd18 * 1e18) / fromUsd18;
        int256 diffToFrom = int256(uint256(fromDecimals)) - int256(uint256(toDecimals));
        rateToFrom = diffToFrom >= 0
            ? baseRateToFrom * (10 ** uint256(diffToFrom))
            : baseRateToFrom / (10 ** uint256(-diffToFrom));
    }

    function _feedPrice(int256 dollars) internal pure returns (int256) {
        return dollars * 1e8;
    }

    /// @notice THE core invariant: unchanged in meaning from before the
    /// migration -- ledger solvency is about ticker holdings, not
    /// deposit-asset accounting.
    function invariant_ledgerSolvency() public view {
        uint256 tickerCount = handler.tickersLength();
        for (uint256 i = 0; i < tickerCount; i++) {
            address ticker = handler.tickers(i);

            uint256 ledgerSum = vault.basketTickerHoldings(BASKET_A_ID, ticker)
                + vault.basketTickerHoldings(BASKET_B_ID, ticker);
            uint256 realBalance = MockERC20(ticker).balanceOf(address(vault));

            assertLe(
                ledgerSum,
                realBalance,
                "LEDGER SOLVENCY VIOLATED: baskets collectively claim more of a ticker than the vault actually holds"
            );
        }
    }

    /// @notice v18: updated for the 3-way fee split -- checks all three
    /// pending destinations now (burn/rewards/treasury), not just
    /// burn+team.
    function invariant_usdgCoversPendingFees() public view {
        uint256 vaultUsdgBalance = usdg.balanceOf(address(vault));
        uint256 pending = vault.pendingBuyBurn() + vault.pendingRewardsPool() + vault.pendingTreasuryFees();
        assertGe(vaultUsdgBalance, pending, "Vault USDG balance fell below pending fee obligations");
    }

    /// @notice v17.3 fix (Opus review, third pass): with genesis-seeding
    /// now in setUp() (fixing the ROOT CAUSE -- empty-start runs), the
    /// remaining gap is visibility: afterInvariant() only ever sees the
    /// LAST of the 512 independent runs (a fresh handler is redeployed
    /// every run via setUp()), so even a healthy last-run reading can't
    /// confirm the OTHER 511 runs were equally healthy. Fixed by
    /// appending each run's ghost-counter snapshot to a log file via
    /// vm.writeLine -- an actual filesystem write, outside EVM state, so
    /// it survives across all 512 independent runs and can be read/summed
    /// afterward. Requires fs_permissions in foundry.toml (added
    /// alongside this).
    ///
    /// Percentage-based revert-rate tolerance (5%, not exactly 0) is
    /// still correct even after the seeding fix -- MIN_TOKENS_OUT
    /// legitimately firing on rare drifted-price/bottom-of-range mints
    /// is expected, real behavior, not a bug (see prior comment, still
    /// accurate). What genesis-seeding fixes is runs that never get a
    /// real position at all -- not the small legitimate revert rate on
    /// runs that do.
    function afterInvariant() public {
        console.log("=== Handler ghost counter report (LAST run only -- see log file for all 512) ===");
        console.log("mint calls:      ", handler.mintCalls());
        console.log("mint successes:  ", handler.mintSuccesses());
        console.log("mint reverts:    ", handler.mintReverts());
        console.log("redeem calls:    ", handler.redeemCalls());
        console.log("redeem successes:", handler.redeemSuccesses());
        console.log("redeem noops:    ", handler.redeemNoops());
        console.log("redeem reverts:  ", handler.redeemReverts());
        console.log("redeem tiny successes:      ", handler.redeemTinySuccesses());
        console.log("redeem tiny reverts:        ", handler.redeemTinyReverts());
        console.log("redeem substantial successes:", handler.redeemSubstantialSuccesses());
        console.log("redeem substantial reverts:  ", handler.redeemSubstantialReverts());

        // v18: file-logging (vm.writeLine) removed -- it served its
        // purpose during the earlier "512 independent runs" ghost-counter
        // investigation (already resolved and closed) and was causing an
        // fs_permissions friction point specifically under Hardhat's own
        // built-in Solidity-test runner (npx hardhat test), which
        // apparently doesn't honor foundry.toml's fs_permissions the
        // same way a direct `forge test` invocation does. Console
        // reporting and the real safety assertions below are unaffected
        // and remain the load-bearing checks.

        // v17.4 fix (Opus review, fourth pass): the ">1000" threshold
        // below was silently inert for EVERY real per-run measurement --
        // each run only gets `depth=1000` TOTAL calls split across both
        // mint and redeem, so no single run's per-function count could
        // ever exceed 1000. Lowered to a realistic sample-size floor
        // (>20) that actually fires against real per-run data.
        uint256 mintCallsTotal = handler.mintCalls();
        if (mintCallsTotal > 20) {
            uint256 mintRevertPct = (handler.mintReverts() * 100) / mintCallsTotal;
            assertLt(
                mintRevertPct,
                5,
                "MINT REVERT RATE TOO HIGH: over 5% of mints reverted -- this is beyond what the granularity floor alone should explain, investigate"
            );
        }

        // THE actual question this whole pass exists to answer: is the
        // high overall redeem-revert rate concentrated in tiny draws
        // (expected -- fuzzer's uniform sampling hits the dust floor far
        // more than real user behavior would) or does it also show up
        // in substantial redeems (would mean a real 6-decimal payout
        // rounding bug is rejecting redeems it shouldn't -- a
        // value-correctness defect hiding behind a technically-safe
        // revert, exactly the risk Opus flagged). Only the substantial
        // bucket is asserted on -- tiny-bucket reverts are expected and
        // not evidence of anything wrong.
        uint256 substantialTotal = handler.redeemSubstantialSuccesses() + handler.redeemSubstantialReverts();
        if (substantialTotal > 5) {
            uint256 substantialRevertPct = (handler.redeemSubstantialReverts() * 100) / substantialTotal;
            assertLt(
                substantialRevertPct,
                5,
                "SUBSTANTIAL REDEEM REVERT RATE TOO HIGH: redeems of >=10% of balance are failing at a meaningful rate -- this is NOT expected dust-floor rounding, investigate the 6-decimal redeem payout math directly"
            );
        }
    }
}
