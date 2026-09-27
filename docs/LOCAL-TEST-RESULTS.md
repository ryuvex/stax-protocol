# Local V2 test results — 2026-09-20

Latest feedback revision: **92 passing, 0 failing** (50 V1, 30 V2 local-flow tests, 12 audit regressions). Scoped TypeScript checking passes. V2 runtime is **24,549 bytes**, helper runtime **3,535 bytes**; only **27 bytes** of V2 EIP-170 headroom remain. Tests ran with normal deployment-size enforcement. No real-chain fork or external-model review was run. See [DAN-FEEDBACK-FIXES.md](DAN-FEEDBACK-FIXES.md) for current APIs, risk limitations and rollout policy.

The earlier immutable-conversion results below are historical.

Current immutable V2 result: **85 passing, 0 failing** (50 existing V1 tests, 23 V2 tests, 12 audit regressions), with Solidity compilation and scoped TypeScript checking passed. Runtime: **23,519 bytes**, leaving **1,057 bytes** under the 24,576-byte limit. Validator runtime: 2,324 bytes. Solidity 0.8.28, viaIR, optimizer runs 10, EVM Cancun.

V2 now deploys directly using constructor arguments. The proxy and upgrade fixture were removed. Tests verify constructor validation and atomic 200 bps legacy registration, absence of initializer/upgrade ABI methods, reverted owner and user upgrade attempts with active holdings, unchanged code and holdings, successful redemption, and two-step ownership. The first run had one obsolete test-matcher syntax failure; after correcting the assertion, the complete suite passed. No live deployment or real-chain fork was performed.

## Reproduce

Use Node 24 (tested with 24.19.0), install dependencies from the lockfile, then run:

```text
npm run test:local
npm run typecheck:v2
```

For V2 alone: `npm run test:v2`. Hardhat may need to download Solidity 0.8.28 on the first run. These commands use an in-process local chain; they do not read a mainnet private key, fork Robinhood, or send live-chain transactions. The system Node 20 is too old for the installed Hardhat/EDR versions; this run used the available bundled Node 24.

## What was exercised

- Direct deployment, constructor validation, fixed dependencies and absence of initializer/upgrade methods.
- Deploy factory/pool, provide liquidity, accumulate history, configure registry, register crypto, create basket, deposit USDG, buy assets, mint shares, burn shares, sell assets, return USDG, and claim treasury/rewards fees.
- Crypto with both 6 and 18 decimals and no `oraclePaused()` method. USDG uses 6 decimals; a USDG price of $0.80 checks the USD conversion independently.
- Stock pause checks on both mint and redeem. Stock-to-TWAP reclassification is rejected.
- V1/V2 stock NAV, minted shares, and exact buy/sell minimums from identical local V3 pool state. V4 stock round-trip minimums are also compared using the existing configurable router mock.
- Mixed stock/crypto baskets using Chainlink/V4 execution and TWAP/V3 execution through the router mock.
- Real V3 insufficient-history (`OLD`) failure, quote during locked pool callback, stale observation, thin current liquidity, thin harmonic liquidity after replenishment, and abrupt spot deviation.
- Independent signed rounding/wraparound accumulator vectors, invalid pool/factory/configuration, access control, and zero/out-of-range slippage.
- Actual V3 execution slippage on both mint and redeem; failed calls roll back user transfers, share burns and ledger changes.
- USDG feed staleness, sequencer downtime and recovery grace, registry replacement/removal/recovery.
- Owner and user upgrade attempts rejected with active baskets and pending fees; code/state checks, full redemption and two-step ownership transfer.
- A deterministic 30-operation sequence of deposits and partial redemptions across two baskets/users sharing one token, plus an uncredited donation. After each action, verify the other basket's ledger is unchanged, token holdings match summed ledgers plus donation, and USDG covers exactly the pending fee liabilities. Exit all users at the end.

## Pool fidelity and limitations

The tests deploy official `@uniswap/v3-core` **1.0.1** factory/pool bytecode, as described in the [Uniswap V3 repository](https://github.com/Uniswap/v3-core). The actual pool handles swaps, fees, tick movement, observations and liquidity. This avoids inventing a substitute observation-history model.

`LocalV3Flow` is a TEST-ONLY router/callback connector; it is not the deployed Universal Router. Tokens and Permit2 are mocks. V4 and mixed-routing cases use the repository's configurable-rate router mock, not a real V4 PoolManager. The exact deployed Robinhood router/Permit2 interfaces, CASHCAT/PONS transfer behavior and real liquidity remain unverified by these local tests. None of the unrestricted fixtures belongs in a production deployment.

The tests intentionally use artificial deep liquidity, 600-second history windows and trial thresholds. They are not recommended CASHCAT/PONS settings.

One test explicitly demonstrates the security limitation: an abrupt manipulated price initially fails the deviation check, but after it remains in place for a full window, a refreshed observation allows the now-manipulated TWAP quote. This passing test documents a weakness of the same-pool security model; it does not certify manipulation resistance.

The full repository `tsc --noEmit` is blocked by pre-existing malformed script files, including console-log text in `scripts/deploy-testnet-v17.ts` and JSX in `scripts/seed-mag7.ts`. The scoped `tsconfig.v2-tests.json` includes the Hardhat plugin types and the new test suite and passes without suppressing its errors.

Remaining release gates: real-chain mint AND redeem fork tests, live decimals/pool/router verification, full invariant fuzz campaign, economic manipulation/lag analysis, defensible token parameters, and Dan's design/final Opus reviews.
