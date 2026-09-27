# V2 audit fixes — 2026-09-20

Current revision: see [DAN-FEEDBACK-FIXES.md](DAN-FEEDBACK-FIXES.md). It supersedes the earlier slippage range, compatibility stubs, fixed fee destinations, immutable sequencer-feed setting, preview availability and size figures below.

All three reported code/interface findings have been remediated in the local draft. Final combined run: **85 passing, 0 failing** (50 V1, 23 V2, 12 audit-fix regressions). Scoped TypeScript checking passes. Nothing was deployed; real-chain tests, economic parameter review and Dan's Opus checkpoints remain outstanding.

## A-01: price precision and deviation

The registry now exposes `quoteUsdg18(token)`, returning an **18-decimal USDG price per whole token** plus harmonic liquidity. The old raw-unit quote method was removed to avoid silently changing its units. V2 uses the new interface directly, converts through the USDG/USD feed, and rounds to actual token units only when constructing the swap minimum.

The base amount is scaled before Uniswap quote math. Its maximum exponent is 36, which fits uint128. The spot/TWAP comparison uses conservative endpoints of the integer quote intervals, so residual rounding cannot mask a large deviation even at extremely small prices. Quotes too imprecise to prove the configured bound fail closed.

Tests reject the former 65% price-move bypass and the underpriced redemption. Stable tokens at 0.0000015 and 0.0000005 USDG now mint and redeem at 2% swap slippage; both address orderings are covered. USDG feed conversion and stock V1/V2 minimum-output comparisons pass.

## A-02: explicit transaction bounds

V2 callers must use:

```solidity
mint(uint256 basketId, uint256 usdgAmount, uint256 minSharesOut, uint256 deadline)
redeem(uint256 basketId, uint256 tokenAmount, uint256 minUsdgOut, uint256 deadline)
```

The minimum must be nonzero. `minSharesOut` is in basket-token units (18 decimals); `minUsdgOut` is raw USDG units and applies to the net payout after vault fees. `deadline` is a Unix timestamp in seconds, checked before any deposit, burn or swap. The router receives the current block timestamp as a tighter same-transaction expiry; it cannot extend a user deadline that already failed the entry check.

The old two-argument selectors explicitly revert with `UseBoundedEntryPoint`. No unbounded alternative remains on V2. V1 is unchanged. Frontend and other V2 callers must adopt the new ABI and derive meaningful user-approved minimums and expiries; `1` or a far-future deadline is not a recommended client default.

Regression tests cover rejected legacy/zero-bound calls, expiry on mint/redeem, rollback after insufficient minted shares, and rejection of a delayed redemption below its original net payout minimum.

## A-03: route validation and oracle binding

Deploy `StaxV3RouteValidator(router, factory, poolInitCodeHash)` before deploying V2. Pass its address as the final constructor argument. It is immutable, holds no funds, and has no administrative setters. The constructor checks that its configured router equals the vault router.

The validator requires a real pool from the configured factory, the expected CREATE2 address for its pair/fee/init-code hash, matching token pair/factory/fee getters, and nonzero active liquidity. Initial and updated V3 routes are checked before writing storage. Basket creation requires a configured route.

For the initial TWAP integration, the oracle pool and the V3 execution pool **must be identical**. Registry replacement, fee changes, and every subsequent TWAP price read enforce that relationship. If the registry owner changes its pool, reads fail closed until a matching reviewed execution route is configured. Coordinated governance transactions should avoid unnecessary periods with mismatched settings. Existing Chainlink-priced V4 execution remains supported; TWAP-only V4 execution is outside this phase.

Universal Router's factory/init-code hash are internal immutables in its [upstream implementation](https://github.com/Uniswap/universal-router/blob/main/contracts/modules/uniswap/UniswapImmutables.sol), not public getters. Therefore deployment must independently verify the actual deployed router's factory and hash and supply them correctly. The validator enforces those pinned inputs; it does not prove the operator extracted them from the correct router bytecode. Mainnet router/factory verification remains a rollout gate.

Tests reject nonexistent initial/updated routes without changing settings. They also reject a different real fee-tier pool while it mismatches the registry and detect later registry pool changes; a coordinated correct route update restores redemption.

## Configuration: deviation versus slippage

`maxDeviationBps` remains **owner-configurable per token** in `UnifiedTwapRegistry.configureToken(token, SafetyParams)`. Supply the full settings struct when updating; preserve other fields unless intentionally changing them. Valid values are 1–9,999 bps; 100 bps = 1%, 500 bps = 5%. Configuration runs the safety checks immediately, so a tighter limit can reject an update if the current pool already exceeds it.

This controls spot versus TWAP deviation. It is separate from `tickerSlippageBps` (oracle-relative swap tolerance) and the caller's minimum shares/USDG payout. Tests explicitly show that changing the owner-configured threshold changes enforcement and that unauthorized changes revert. No production thresholds were selected for CASHCAT/PONS.

## Size, compatibility and remaining gates

The subsequent client-requested revision makes V2 non-upgradeable and removes the proxy and storage gap. See [V2-CONTRACT-REVIEW.md](V2-CONTRACT-REVIEW.md) for direct deployment and [LOCAL-TEST-RESULTS.md](LOCAL-TEST-RESULTS.md) for current runtime size. The audit fixes remain in place; `priceFeeds()` and basket getter shapes remain unchanged. V2 mint/redeem and TWAP quote APIs require caller updates as described above.

Reproduce using Node 24:

```text
npm run test:local
npm run typecheck:v2
```

The previous audit's sustained-manipulation, observation-activity, redemption-availability and governance risks remain. These fixes do not create an independent price source or establish safe live liquidity/window thresholds.
