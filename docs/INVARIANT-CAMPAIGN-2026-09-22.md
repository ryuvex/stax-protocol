# Invariant campaign — 22 September 2026

## What the checkout actually contained

The pasted review described `StaxVault.invariant.t.sol.bak` as disabled. This checkout instead contains active `test/invariant/StaxVault.invariant.t.sol` and `StaxVaultHandler.sol`; no `.bak` invariant was found. The current router mock already decodes the V4 `minHopPriceX36` field and V3 six-field input. No production encoding change or file reactivation was necessary. Both existing V1 invariants passed a local 4-run × 100-depth smoke campaign.

There was no V2 invariant suite. That coverage gap was real. The review's claims about Slither and historical 512k campaigns were not independently verified during this work. Neither static analysis nor finite invariant fuzzing is a mathematical proof of safety.

## Added V2 suite

`test/invariant/StaxVaultV2.invariant.t.sol` directly deploys the immutable V2, its real share deployer/helper, real TWAP registry and real route validator. It uses mocked ERC20s, Permit2 and a configurable-rate swap router. A deterministic CREATE2 factory/pool fixture supplies constant-price V3 observations. This exercises real oracle integration and accounting but does **not** simulate real V3 depth, price manipulation or historical observation writes.

Two baskets share a TWAP-priced 18-decimal asset and each has a separate Chainlink-priced 18-decimal asset; USDG is 6 decimals. The shared token's oraclePaused flag is deliberately true, ensuring the TWAP path is not accidentally using the stock liveness gate. Three actors are funded through real vault mints in setup.

One explicit fuzz selector generates bounded mints, partial redeems, all-holder exits followed by re-entry, direct token/USDG donations, share transfers, fee claims, and intentionally impossible minimum-output transactions. Unexpected handler reverts fail the campaign. Only the intentionally rejected minimum-output call uses expectRevert; it verifies rollback of supply, USDG and pending fees. Unrelated-basket holdings are checked after every handler operation.

Combined invariant after each operation:
- Sum of the two baskets' ticker ledgers never exceeds actual vault token balance.
- USDG covers all pending burn/rewards/treasury fee obligations.
- Total share supply equals the three tracked holders plus the dead-address balance.

Per-run anti-vacuity assertions require actual post-setup mint, redeem, exit/re-entry and rejected-bound activity for runs of at least 100 calls. There are no caught unexpected failures counted as successes. A separate negative-control test mocks an insolvent token balance and verifies the invariant detects it.

## Reproduction and evidence

No Forge executable was found on PATH. These are Foundry-style Solidity tests executed by Hardhat's local EDR invariant runner. Hardhat does not read invariant settings from foundry.toml; `hardhat.invariant.config.ts` explicitly sets 512 runs, depth 1000, failOnRevert=true and seed 0x53544158. Environment overrides STAX_INVARIANT_RUNS / STAX_INVARIANT_DEPTH are available for smoke checks. No mainnet transactions are involved.

```powershell
npm run test:invariant:v2
npm run test:invariant:v1
```

Artifacts:
- `reports/invariant-campaign/smoke.txt`: V1's two invariants, V2 invariant and negative control passed at 4 × 100.
- `reports/invariant-campaign/v2-512x1000.txt`: completed successfully, exit code 0. `invariant_accounting` passed 512 runs at configured depth 1000; the insolvency negative control also passed (2 passing).
- `reports/invariant-campaign/source-hashes.json`: SHA-256 hashes of the vault, registry, validator, new test and campaign config used for this run.

512 × 1000 means **512,000 handler calls**, not 512,000 successful swaps: operations include donations, transfers, claims and explicit revert checks; the full-exit operation can perform several actual vault calls. A reproducible fixed seed is one campaign, not exhaustive coverage.

## Scope limits

Production Solidity contracts were not changed. These tests do not establish safe live TWAP parameters, a basket cap, manipulation economics, liveness under stale oracles or LP withdrawals, fee-on-transfer/rebase compatibility, or all administrative state transitions. Existing real-router fork tests and broader audits remain separate evidence. V1 was smoke-tested here; this document does not claim a fresh full V1 campaign.
