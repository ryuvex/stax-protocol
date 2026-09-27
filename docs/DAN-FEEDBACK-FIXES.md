# Dan feedback implementation - 2026-09-20

## Implemented

- V2 V3 command input now encodes canonical `true` in field five (`payerIsUser`), retaining the six-field tuple and empty hop-floor array. The caller of the router is the vault, so Permit2 pulls vault funds. V1 is unchanged. Local fixtures now treat this field as a flag rather than an arbitrary payer address; both V2 trade directions assert its raw word is 1. The upstream Dispatcher comparison supports the shape, but does not verify Robinhood's deployed decoder: https://github.com/Uniswap/universal-router/blob/main/contracts/base/Dispatcher.sol
- Per-ticker slippage is limited to 1-500 bps in registration, updates and execution checks. Existing Chainlink registrations start at 200 bps atomically; feed updates retain the chosen setting. This cap is separate from the registry's spot/TWAP deviation setting, whose permissible range was not changed.
- Removed the two-argument mint/redeem stubs, their error, the legacy MAX_SLIPPAGE_BPS getter and unused USDG staleness reference. Only bounded, four-argument mint/redeem methods remain. The two-field priceFeeds getter and basket getter shapes remain intact.
- Renunciation explicitly reverts with OwnershipRenunciationDisabled.
- Added owner-only setTreasury and setRewardsPool: nonzero destination, previous/new address event, and existing claim accounting retained. All pending and future fees pay the destination current at claim time. No user asset withdrawal authority was added.
- Added owner-only setSequencerUptimeFeed: requires an unset feed, deployed code, plausible initialized round data and binary up/down answer. It can be enabled while down; normal downtime/grace-period checks then block operations. A feed provided in the constructor also prevents this setter. An enabled feed cannot be removed or replaced. Interface validation does not prove feed identity; deployment governance must verify it.

## Previews and code size

previewMint(basketId, usdgAmount) returns estimated basket shares (18 decimals). previewRedeem(basketId, tokenAmount) returns estimated net USDG (USDG token units). Both are view methods on V2 that call its fixed StaxVaultPreview helper. V2's constructor creates and permanently binds that helper; it has no funds, admin setters, upgrade path or delegatecall. Constructor arguments remain unchanged.

The helper uses vault oracle prices, cached token decimals and the per-basket ledger, including allocation/unit rounding, current fees, caps, genesis and virtual-share rules. Execution and previews use the same StaxShareMath source for shares. Other fixed fee/limit values are mirrored in the helper and covered by regressions; changes must keep them aligned. Read accessors getOraclePriceUsd18 and getBasketTickerDecimals(basketId,index) support these calculations.

These are oracle estimates, not ERC-4626 execution guarantees. DEX fees, price impact, fee-on-transfer behavior and later price moves are excluded. PreviewRedeem does not check wallet balance or allowance; successful preview does not prove route execution. The frontend needs an actual execution quote/simulation and explicit user tolerance, not a promise that the preview amount will be received.

Solidity 0.8.28, viaIR, optimizer runs 10, Cancun: V2 runtime 24,549 bytes (27 bytes under EIP-170); helper runtime 3,535 bytes. V2 creation bytecode is 30,631 bytes before constructor arguments; review total initcode size for the actual ticker list. No unlimited-size test setting was enabled. Further source/compiler changes require another size check.

## Review and release status

Local regression results are recorded in LOCAL-TEST-RESULTS.md. Focused self-review covered payer identity, cap bypass through registration/feed updates, recipient authorization and pending fees, one-way sequencer activation, preview rounding/shared-ledger isolation, and removed entrypoints. This is not an independent Fable/Opus audit. No access to those review sessions is connected.

Still required: real-router fork buys AND sells with exact deployed tuple decoding, every admitted ticker's round trip, the full invariant campaign, independent adversarial reviews and token-specific liquidity/volatility/manipulation modelling. TWAP stays unregistered in production until the modelling gate passes. No live deployment or administrative transaction was performed.

## Rollout and frontend handoff

At V2 launch, pause all V1 basket deposits, retain V1 redemption, and send all new deposits to V2. Do not migrate balances implicitly. Users may redeem V1 to USDG then choose to deposit into V2. Old oracle/liquidity dependencies still matter for exits.

Use configured oracle type for labels: Chainlink icon and verified feed link when CHAINLINK; TWAP label when TWAP. Do not automatically switch to TWAP on a Chainlink failure. Existing Chainlink oraclePaused compatibility checks remain.

Repository backend configuration is Vercel cron routes with Supabase persistence (project reference isewgmcdqdwxuvpvwedp). vercel.json schedules snapshot-nav at 06:00 UTC and update-leaderboard at 07:00 UTC daily. gains-leaderboard exists but is not scheduled in that file. This describes checked-in configuration, not verified live hosting or scheduler status.

Update src/routes/api/cron/snapshot-nav.ts and update-leaderboard.ts, plus src/lib/positionEvents.ts and other portfolio/history readers for both addresses and their deployment blocks. Key basket data by chain + normalized vault address + basket ID. Review database keys and backfill/idempotency rather than just extending one address constant. src/lib/vaultEvents.ts still declares the old four-field Redeemed event and ETH-named values; it needs the current five-field event ABI before it can reliably read current redemption logs. Include both vaults in balances/history without combining unrelated share quantities. Track FeeAccrued if required; current leaderboard code reads Minted/Redeemed only. No frontend code was changed in this contract revision.
