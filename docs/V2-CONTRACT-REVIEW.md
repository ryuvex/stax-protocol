# V2 contract draft

Current revision: see [DAN-FEEDBACK-FIXES.md](DAN-FEEDBACK-FIXES.md). It supersedes the earlier slippage range, compatibility stubs, fixed fee destinations, immutable sequencer-feed setting, preview availability and size figures below.

Status: local implementation for review, not deployment-approved. Audit fixes and current APIs are documented in [V2-AUDIT-FIXES.md](V2-AUDIT-FIXES.md). V1 source and existing baskets are unchanged. V4 TWAP/history, community baskets v2, and frontend changes are outside this change.

## Contracts and deployment order

1. Deploy the existing `UnifiedTwapRegistry` in `contracts/Twap.sol` with the reviewed owner, USDG and V3 factory. It remains non-upgradeable; V2 can replace the registry per TWAP ticker. Configure only independently validated tokens and parameters. No CASHCAT/PONS defaults are embedded.
2. Deploy `StaxBasketTokenDeployer`. It creates the existing basket ERC20 with the calling vault as its immutable mint/burn authority. It has no ownership, custody or registration state. This helper keeps token creation bytecode outside the vault's deployment-size budget.
3. Deploy `StaxV3RouteValidator(router, factory, poolInitCodeHash)` with independently verified router deployment values.
4. Deploy `StaxVaultV2` directly with constructor arguments in this order: governance owner, token deployer, legacy ticker/feed/staleness list, rewards pool, treasury, router, Permit2, USDG, USDG feed, USDG max staleness, sequencer feed, route validator. Supplied legacy tickers receive Chainlink settings and 200 bps atomically. Reconcile the complete ticker list against V1; the contract cannot enumerate V1 mappings. No balances or baskets migrate.
5. Configure execution pools on V2, register reviewed TWAP assets with `setTwapOracle(token, registry, slippageBps)`, and create new baskets. Their token authority is the directly deployed V2 address. Existing baskets continue using V1.

## Behavior and authority

- V2 is non-upgradeable: no proxy, initializer, UUPS functions or upgrade storage gap. Deploy it directly; never behind a proxy. Core dependencies and fee destinations are constructor immutables. The basket deployer and route validator are fixed.
- Ownership transfers require acceptance by the new owner. Renunciation remains disabled to preserve configuration administration. Owners can still configure pricing, registries, slippage, routes, baskets and caps. Immutable code does not remove this trust boundary. No timelock is implemented.
- OpenZeppelin Ownable2Step and ReentrancyGuard are initialized through direct deployment. A code change requires a new deployment and explicit integration changes; existing baskets cannot have their vault address replaced.
- Oracle types are explicit NONE/CHAINLINK/TWAP. `priceFeeds` keeps its two-field return shape. Oracle settings and slippage live in separate mappings. Stock registration cannot change type to bypass `oraclePaused()`; Chainlink pricing retains its original body.
- TWAP returns an 18-decimal USDG price per whole token through `quoteUsdg18`. V2 multiplies by the existing USDG/USD feed, including its sequencer and staleness checks. Deviation checks conservatively account for residual integer rounding. Oracle and execution V3 pools must match.
- The registry checks V3 factory/pair, history, observation age, current and harmonic liquidity, and spot deviation. These checks do not prove economic resistance to sustained manipulation. History and execution may use the same pool. Depth, volatility, manipulation-cost and lag-extraction modeling remain required.
- V3/V4 swap encoding, fees, mint/redeem calculations and per-basket holdings accounting are retained. Slippage calculation reads explicit per-ticker values; zero/unset is rejected. New Chainlink registration defaults atomically to 200 bps; updates retain the configured slippage. The legacy `MAX_SLIPPAGE_BPS()` getter remains 200 for ABI compatibility but no longer controls swaps.
- Changing/removing a registry configuration can block dependent redemptions. Governance procedures and emergency behavior require review. V4 execution remains available; V4 history-based pricing is not implemented.

## Verification performed

Solidity 0.8.28, viaIR, optimizer runs 10, EVM Cancun. See the current local test results for compilation, runtime size and test outcomes.

Legacy getter shapes remain present. V2 mint/redeem now require caller minimums and deadlines; the legacy two-argument selectors revert. This is ABI compatibility, not proof that every external consumer understands TWAP: consumers that require a nonzero Chainlink feed still cannot register TWAP tokens.

The Chainlink pricing body is retained. Swap arithmetic preserves the original operation order with per-token slippage, while duplicate approval/balance-delta handling is shared. Caller limits and deadlines were added to mint/redeem. Runtime comparisons verify stock NAV, shares and buy/sell minimums against V1 on local V3 and mock V4 routes.

Local runtime testing on 2026-09-20: **85 passing** (50 existing V1 tests, 23 V2 tests and 12 audit-fix regressions). See [LOCAL-TEST-RESULTS.md](LOCAL-TEST-RESULTS.md) for scope, commands, and limitations. The user explicitly authorized proceeding without the missing Hardhat skill. The subsequent immutability revision replaces the former proxy tests with direct-deployment and rejected-upgrade tests.

## Outstanding gates

- Real-chain fork testing and the full invariant fuzz campaign remain outstanding. Local tests cover direct constructor validation, absent upgrade selectors, rejected owner/user upgrade attempts with active holdings, redemption and two-step ownership.
- Fork full mint AND redeem for CASHCAT/PONS and existing stock baskets; compare Chainlink prices and exact amountOutMinimum with V1 at the same pinned chain state and 200 bps. Verify real token decimals, pools, router/Permit2 and deployed interfaces at that state.
- Local tests now cover insufficient history, stale observations, thin current/historical liquidity, negative-tick rounding, accumulator wraparound, USDG depeg/decimals, sequencer failures, registry replacement and shared-token ledger isolation. The seeded 30-operation accounting sequence is not a substitute for the full invariant fuzz campaign.
- Validate token-specific risk parameters and obtain Dan's Opus design and separate final pre-deploy reviews. The user's authorization covered local draft creation, not evidence that those production gates are complete.
