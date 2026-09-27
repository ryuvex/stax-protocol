# Stax V2 adversarial code review

Historical review of the earlier upgradeable draft. V2 has since had the audit fixes applied and been converted to non-upgradeable direct deployment. Upgrade-authority findings below describe the earlier version; current behavior is in [V2-CONTRACT-REVIEW.md](V2-CONTRACT-REVIEW.md).

**Revision status:** A-01/A-02/A-03 have subsequently been remediated in the local draft; see [V2-AUDIT-FIXES.md](V2-AUDIT-FIXES.md). The six reproduction results, line references, verdict and source hashes below describe the **pre-fix revision** and are retained as audit history. The audit test file now contains fix regressions. The remaining design risks and release gates still apply.

Date: 2026-09-20. Verdict: **do not deploy this revision until A-01 is fixed and the remaining findings are resolved or explicitly accepted.**

This is a fresh adversarial review by the same assistant that implemented the draft, not an independent external audit or Dan's separate Opus review. Prior passing tests were not treated as evidence that the design is secure. Production contracts were not changed during this review.

## Scope and evidence

Reviewed `StaxVaultV2.sol`, `Twap.sol`, `StaxVaultProxy.sol`, `StaxBasketTokenDeployer.sol`, `interfaces/IStaxTwapRegistry.sol`, the imported V1 basket token/interfaces, and the installed OpenZeppelin ownership, initialization, reentrancy and UUPS code. Reviewed pricing, registration, swap limits, mint/redeem accounting, fee liabilities, token creation and upgrade authority.

Added `test/StaxVaultV2.audit.test.ts`: **six local reproductions passed**. Passing means the undesirable behavior was reproduced, not fixed. Pool cases use official Uniswap V3 core bytecode with local tokens and a callback/router connector. Scoped test type-check passed. No real-chain verification or attack-profitability analysis was performed.

Run `npm run test:audit` with Node 24; `npm run typecheck:v2` checks both local test files. These audit assertions intentionally describe current vulnerable behavior and must be inverted/reworked into regression assertions when fixes are implemented.

| ID | Severity | Finding | Classification |
| --- | --- | --- | --- |
| A-01 | High, conditional on token unit price | Early quote rounding defeats deviation and execution protections | New TWAP implementation defect |
| A-02 | Medium | Users cannot enforce a minimum result or transaction expiry | Inherited V1 interface/design gap |
| A-03 | Low | Execution-pool configuration is not validated against a real reviewed route | Inherited configuration gap, newly relevant to TWAP integration |

Severity is based on reachable impact and required conditions. No claim is made that A-01 currently affects CASHCAT/PONS, that these examples are economically profitable, or that absence of another reported issue proves safety.

## A-01 — Early rounding defeats the price safety checks

**Locations:** `contracts/Twap.sol:174–180`; downstream `contracts/StaxVaultV2.sol:551–559`, buy/sell minimum calculations.

The registry quotes exactly one whole token in raw USDG units and floors the result. With 6-decimal USDG, 0.0000011 USDG and 0.0000018 USDG both become integer `1`. Deviation is calculated only after this information has been discarded. The vault then multiplies the rounded result into 18-decimal USD pricing; this does not restore lost precision.

This is distinct from ordinary lag or sustained manipulation: a large, abrupt spot move passes even while the window still represents the earlier price. The example uses a trusted canonical V3 factory, sufficient history, substantial current/historical liquidity, 500 bps deviation and 200 bps swap slippage. It needs no admin change after token admission.

**Reproductions:**

1. Start at 0.0000011 USDG/token and move the real pool's spot price by **6,516 bps (65.16%)**. The configured deviation limit is 500 bps. `quoteUsdg` nevertheless succeeds and returns `1`, because both spot and TWAP raw quotes floor to `1`.
2. A stable, deep pool at 0.0000015 USDG/token registers successfully, yet a normal 100 USDG mint at 200 bps slippage reverts. The vault prices the token at 0.000001 USDG and demands about 50% more tokens than the fair pre-fee output.
3. Mint while the low-priced token is executable, allow a higher price to mature into the TWAP, then abruptly sell into the pool. A redemption succeeds after a greater-than-25% spot fall despite the 5% deviation and 2% slippage settings. Independently computed pre-manipulation spot asset value was **167.545505 USDG**; the accepted payout was **116.523355 USDG**, approximately 30.45% lower, including execution/vault fees. This proves weakened protection and execution, not net attacker profit.

**Impact:** tokens below one raw USDG unit cannot quote at all; nearby low-priced tokens can register but fail normal buys; coarse quote buckets can bypass the intended deviation limit and weaken sell minimums. Mixed-basket valuations can also be distorted, although a mixed-basket theft was not demonstrated here. Absolute impact depends on token price, balances, configured limits and attack economics.

**Fix:** retain high precision through both price comparison and vault valuation. For example, quote into an explicitly documented 18-decimal USDG price using scaled base amounts and full-precision math, or compare spot/mean ratios before rounding. Convert to raw output-token units only at the final swap-boundary calculation. Simply scaling the already-rounded result or widening slippage does not fix this issue. Add tests for sub-micro prices, both address orderings, quote bucket boundaries, and real mint/redeem minimums.

## A-02 — No user minimum payout/shares or expiry

**Locations:** `contracts/StaxVaultV2.sol:839`, `:891`, `:901`, `:939–947`, and `:676`.

`mint(basketId, usdgAmount)` accepts no minimum shares; `redeem(basketId, tokenAmount)` accepts no minimum USDG payout. Neither takes a user-selected deadline. The global `MIN_TOKENS_OUT` is a dust floor, not the user's accepted exchange rate. The router deadline is created from the execution-time timestamp, so a delayed transaction always gets a new deadline.

**Reproduction:** encode a redemption when the basket NAV is approximately **99.44 USD**, then simulate a market fall and wait for its TWAP to mature. Submitting the exact previously encoded calldata succeeds and pays **50.548091 USDG**. The contract has no way to enforce the original user's minimum expectation or expiry.

This does not show theft caused by price manipulation alone: the pool and oracle reflect the new market in this example. It demonstrates that an outstanding transaction cannot express the user's execution consent. Current oracle-relative slippage is not a substitute for a user-relative result bound.

**Fix:** accept and enforce `minSharesOut`/`minUsdgOut` and a user-supplied `deadline`; use that deadline for router execution. Update client submissions. If old signatures are preserved for compatibility, explicitly decide whether they remain opt-in unbounded market-order routes or are disabled for new usage; adding safer overloads alone does not protect callers of the old functions.

## A-03 — An execution route can be invalid while the oracle remains valid

**Locations:** `contracts/StaxVaultV2.sol:406–426`, `:198–210`, `:462–478`; registry pool validation in `contracts/Twap.sol:126–132`.

The registry validates its oracle pool against a trusted factory. The vault stores only an independently selected V3 fee and never checks that the execution pool exists, belongs to the expected router factory, or is the reviewed liquidity venue. Basket creation validates oracle settings but not an executable route.

**Reproduction:** mint through a real 3000-fee pool, then call `updateTickerPoolV3(token, 10000)` where the same factory has no such pool. Configuration succeeds; the registry still quotes normally; redemption fails. Restoring fee 3000 restores redemption.

**Impact/conditions:** a privileged configuration error can block all affected baskets' swaps. A different existing fee/factory may also execute against liquidity that was never included in the oracle risk assessment. This is not an unprivileged admin bypass. Independent oracle/execution pools can be intentional, but their independence and liquidity must be explicitly reviewed rather than inferred from configuration success.

**Fix:** validate the execution pool against the actual router's verified V3 factory and token pair at initial registration and updates. Bind reviewed route metadata to the token's risk configuration. Either enforce the chosen oracle/execution pool relationship or explicitly support separately reviewed pools. Validate complete routes before enabling basket minting.

## Material design and operational risks

**R-01 — Same-pool sustained manipulation.** The prior local suite already proves a held price can become the accepted TWAP. Current/harmonic liquidity are not dollar-depth or attack-cost measurements; concentrated liquidity outside the active tick range matters. No economically justified token parameters or capacity limits have been established. Do not characterize this as equivalent to an independent Chainlink feed. This is a release gate, not a newly discovered arithmetic bug or proof of a profitable exploit.

**R-02 — Observation age is not age of independent price discovery.** A local reproduction lets an observation become stale, then adds one unit of liquidity without a swap. The freshness gate passes again with the same quote. V3 liquidity changes can write observations. This behavior is consistent with the source but means the gate proves only recent observation activity. Conversely, an idle otherwise valid pool can block mint/redeem until a separate activity refreshes it. Define the intended liveness guarantee, keeper policy and stale-market model; do not describe this as proof of a recent meaningful trade.

**R-03 — Exit availability is tied to every oracle.** An unhealthy or removed registry token blocks proportional redemption of a basket that holds it. Mint pause does not provide a separate oracle-independent exit. This fail-closed behavior is intentional in the current design but requires an explicit operational recovery policy. An in-kind emergency exit would be a separate security-sensitive design, not a casual bypass of oracle checks.

**R-04 — Governance is fully trusted.** The owner can upgrade the vault and change oracle/slippage settings without a built-in delay. A two-step ownership transfer protects handover; it does not constrain the incumbent owner's upgrades. Registry control is a separate trust boundary. Multisig/timelock addresses and monitoring remain unspecified. Treat this as a disclosed governance assumption, not an unprivileged critical exploit.

**R-05 — Integration and token admission are unproven.** Local tests do not verify Robinhood's deployed Universal Router command ABI/factory, Permit2, actual CASHCAT/PONS token behavior, mutable metadata, transfer taxes/rebases, or current liquidity. Registration is not proof of plain-ERC20 compatibility. Real-chain full round trips and reviewed token implementations remain required. Cached decimals assume stable metadata.

## Checks that did not produce a confirmed finding

- The proxy requires atomic initialization; implementation initialization is disabled. UUPS authorization is owner-only, and OpenZeppelin checks the proxy context and upgrade UUID. No public initializer/upgrade takeover was identified.
- Explicit proxy ownership initialization and the installed namespaced reentrancy guard's zero-state behavior were reviewed. The nonReentrant initializer seeds the guard on exit. No storage collision was identified in this initial V2 layout; future upgrades still need layout validation.
- Basket mint/burn is limited to its immutable vault, and the deployer binds it to the calling proxy. Fee claims use fixed recipients and effects-before-transfer.
- Per-basket holdings, not shared raw balances, determine NAV and proportional redemptions. Donation and seeded local shared-token checks passed; this is not a complete invariant proof.
- Stock oracle pause/freshness behavior is retained; zero/unset slippage fails closed. V1/V2 local minimum-output comparisons passed for stock V3 and mock V4 paths.
- The adapted consult math matches the relevant upstream signed rounding and harmonic-liquidity formulas; cumulative wrap vectors passed. This does not validate every extreme-price input.

## Sources, provenance and remaining review

The comparison used [Uniswap's OracleLibrary](https://github.com/Uniswap/v3-periphery/blob/main/contracts/libraries/OracleLibrary.sol) and [V3 pool implementation](https://github.com/Uniswap/v3-core/blob/main/contracts/UniswapV3Pool.sol), plus the installed OpenZeppelin sources. The versioned `v1.4.4` OracleLibrary URL in `Twap.sol` returned 404 during this review; replace it with a verified commit reference for reproducible provenance. The local V3 artifact dependency is pinned to 1.0.1.

Required before release: fix and regression-test A-01; decide/fix A-02 and A-03; re-run all local suites; complete real-chain fork mint/redeem and invariant fuzzing; model manipulation/lag economics; review governance and upgrade storage; obtain Dan's separate design and pre-deploy Opus reviews.

Audited source SHA-256 fingerprints:

```text
StaxVaultV2.sol              1F0A11723E294777484B49A0EA373637BB0BD89BF283ABBF483EACA3BAF9F9DD
Twap.sol                     357FD9EA5374C5CD550B5D13D6357ED1E5BFA1999D04D58356D5ABEF33071944
StaxVaultProxy.sol           64423312DF9B552AF819B6AC87F5EF561F41F004FD453BE7E1F431CFB3CB5079
StaxBasketTokenDeployer.sol  4D6100006255A7976E40D36FABF249FF6696962D3B974EB552D258FBCCABB57D
IStaxTwapRegistry.sol        9BB204E9B5068511F5EAEF5E8C938F8F339EAD6616C33848C61AB4FC4E8B2C18
```
