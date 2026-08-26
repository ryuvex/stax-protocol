// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {StaxVault} from "../../contracts/StaxVault.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MockERC20Decimals} from "../../contracts/mocks/MockERC20Decimals.sol";

/// @notice Handler contract for Foundry invariant fuzzing against
/// StaxVault. See prior comments for the general design (bounded
/// mint/redeem, shared-ticker basket shape).
///
/// v17.1 fix (Opus review, second pass): two real gaps found in the
/// original USDG-migration version of this handler:
///
/// 1. SILENT NO-OPS MASKED AS A CLEAN CAMPAIGN. The handler held a
///    fixed 50M USDG budget; each mint spends 20-10,000 USDG. After
///    roughly 5,000 mints, the handler could run dry, and every
///    subsequent mint call became a silent early-return no-op --
///    invisible to Foundry's own call-summary table, which only sees
///    the OUTER handler function (never reverts, by the try/catch
///    design) and can't see that the INNER vault.mint() call never
///    even happened. A "512k calls, 0 reverts" result could therefore
///    have been "5,000 real mints + a long tail of no-ops" rather than
///    512k real operations -- impossible to tell without instrumenting
///    it directly.
///
/// 2. FIX: self-refunding. The handler now holds the CONCRETE
///    MockERC20Decimals type (not just IERC20), specifically so it can
///    mint itself fresh USDG whenever its balance runs low -- sustaining
///    real throughput for the entire campaign length instead of
///    degenerating into no-ops partway through.
///
/// 3. FIX: ghost counters. mintCalls/mintSuccesses/mintReverts and
///    redeemCalls/redeemNoops/redeemSuccesses/redeemReverts are tracked
///    explicitly, so the REAL effective campaign size (and its revert
///    rate) can be read directly after a run instead of inferred from
///    Foundry's outer-call table, which cannot see inside the
///    try/catch.
contract StaxVaultHandler {
    StaxVault public immutable vault;
    MockERC20Decimals public immutable usdgToken;
    uint256 public immutable basketAId;
    uint256 public immutable basketBId;

    address[] public tickers;

    // Ghost counters -- read these after a campaign to know what
    // actually happened, not just what Foundry's outer table shows.
    uint256 public mintCalls;
    uint256 public mintSuccesses;
    uint256 public mintReverts;
    uint256 public redeemCalls;
    uint256 public redeemNoops;
    uint256 public redeemSuccesses;
    uint256 public redeemReverts;

    // v17.4 (Opus review, fourth pass): size-bucketed redeem counters.
    // A 60% redeem revert rate is a COVERAGE question, not a safety
    // one (atomicity already proves reverts are harmless) -- but a high
    // undifferentiated revert rate can't distinguish "fuzzer's uniform
    // random draws frequently hit the dust floor" (harness artifact,
    // benign) from "legitimate mid-size redeems are also failing" (a
    // real 6-decimal payout rounding bug hiding behind a safe revert).
    // These buckets answer that directly: "tiny" = under 0.1% of the
    // handler's balance at redeem time (exactly where dust rounding is
    // expected to bite), "substantial" = 10%+ of balance (a redeem no
    // real user behavior would consider negligible -- this bucket
    // failing at any meaningful rate would be the real finding).
    uint256 public redeemTinyReverts;
    uint256 public redeemTinySuccesses;
    uint256 public redeemSubstantialReverts;
    uint256 public redeemSubstantialSuccesses;

    // Self-refund parameters -- when balance drops below the maximum
    // possible single mint, top back up well beyond what a single fuzz
    // run could plausibly exhaust again soon.
    uint256 constant REFUND_THRESHOLD = 10_000e6;
    uint256 constant REFUND_AMOUNT = 50_000_000e6;

    constructor(
        StaxVault _vault,
        uint256 _basketAId,
        uint256 _basketBId,
        address _shared,
        address _exclusiveA,
        address _exclusiveB
    ) {
        vault = _vault;
        usdgToken = MockERC20Decimals(_vault.usdg());
        basketAId = _basketAId;
        basketBId = _basketBId;
        tickers.push(_shared);
        tickers.push(_exclusiveA);
        tickers.push(_exclusiveB);
    }

    function tickersLength() external view returns (uint256) {
        return tickers.length;
    }

    function mint(uint256 basketSeed, uint256 usdgAmount) external {
        mintCalls++;
        uint256 basketId = (basketSeed % 2 == 0) ? basketAId : basketBId;
        usdgAmount = _bound(usdgAmount, 20e6, 10_000e6);

        // Self-refund instead of no-op-ing -- this is the actual fix
        // for the coverage gap. No more silent skips for the rest of a
        // long campaign once initial funding runs out.
        if (usdgToken.balanceOf(address(this)) < usdgAmount) {
            usdgToken.mint(address(this), REFUND_AMOUNT);
        }

        usdgToken.approve(address(vault), usdgAmount);

        try vault.mint(basketId, usdgAmount) {
            mintSuccesses++;
        } catch {
            mintReverts++;
        }
    }

    function redeem(uint256 basketSeed, uint256 tokenAmountSeed) external {
        redeemCalls++;
        uint256 basketId = (basketSeed % 2 == 0) ? basketAId : basketBId;

        (, address token, , , , ) = vault.baskets(basketId);
        uint256 balance = IERC20(token).balanceOf(address(this));
        if (balance == 0) {
            // A genuine, expected no-op case (nothing to redeem yet, or
            // fully redeemed already) -- unlike the mint case, there's
            // no meaningful "self-refund" for basket-token holdings
            // (they only come from real mints), so this counter is kept
            // to measure how often it happens, not eliminated.
            redeemNoops++;
            return;
        }

        uint256 tokenAmount = _bound(tokenAmountSeed, 1, balance);

        // Bucket by size, evaluated BEFORE the attempt (against the
        // balance the draw was made from), so the bucket reflects what
        // KIND of redeem was attempted, independent of whether it
        // succeeded or reverted.
        bool isTiny = tokenAmount * 1000 < balance; // < 0.1% of balance
        bool isSubstantial = tokenAmount * 10 >= balance; // >= 10% of balance

        try vault.redeem(basketId, tokenAmount) {
            redeemSuccesses++;
            if (isTiny) redeemTinySuccesses++;
            if (isSubstantial) redeemSubstantialSuccesses++;
        } catch {
            redeemReverts++;
            if (isTiny) redeemTinyReverts++;
            if (isSubstantial) redeemSubstantialReverts++;
        }
    }

    function _bound(uint256 x, uint256 min, uint256 max) internal pure returns (uint256) {
        if (min > max) return min;
        uint256 range = max - min + 1;
        return min + (x % range);
    }
}
