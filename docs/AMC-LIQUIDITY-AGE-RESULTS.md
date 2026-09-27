# AMC liquidity and observation-age checks

Measured on Robinhood block 68904009. No live token registration was performed.

## Tested candidate (AMC-only basket)

| Setting | Value |
|---|---:|
| TWAP window | 3,600 seconds |
| Maximum observation age | 3,600 seconds |
| Minimum current liquidity | 3,900,000,000,000,000,000 raw V3 liquidity units |
| Minimum harmonic liquidity | 3,900,000,000,000,000,000 raw V3 liquidity units |
| Maximum deviation | 150 bps (1.5%) |
| Execution slippage | 200 bps (2%) |

These are measured and tested candidate limits, not a guarantee against all attacks or future withdrawal failures. The liquidity values are not token balances or USD amounts. No total basket cap has been validated by this check.

## Basis

All 2,400 retained initialized observations were read, covering about 5.49 days. Median gap was 15 seconds, 95th percentile 962 seconds, 99th percentile 2,872 seconds, maximum 8,895 seconds. A one-hour limit exceeds the observed 99th percentile gap, but longer gaps still occur.

Current liquidity was 4.858e18. The lowest hourly harmonic liquidity over 72 hours was 3.912e18. The 3.9e18 floors round just below that measured low, and reject a fall of about 20% from the measured current liquidity. This is a conservative observed-range threshold, not proof that raw liquidity always corresponds to safe executable depth across ticks. LP positions can change.

Tick-level reconstructed spot-versus-one-hour-TWAP deviations had a 95th percentile of 131.9 bps and 99th percentile of 222.3 bps. A 150 bps limit covers the observed 95th percentile while deliberately rejecting larger moves. 91 of 2,385 observation-time samples exceeded it. These samples are not time-weighted uptime estimates, and tick-level reconstruction is not continuous spot-price coverage.

## Exact-setting fork results

- Mint and full redeem passed at 10, 100, 1,000 and 10,000 USDG on the pinned state.
- Current liquidity below its floor, harmonic liquidity below its floor, and observation age above its limit each produced the intended rejection.
- The tested 100,000 USDG upward-manipulation scenario stopped with `InsufficientLiquidity` before attacker mint. It did not complete a profitable or unprofitable cycle under these settings; it demonstrates rejection of that path only.
- The current-liquidity boundary check used local storage injection, not a realistic LP withdrawal sequence. No live state was modified.

## Material availability trade-off

Historical intervals beyond one hour account for about **4.07%** of the retained observation timespan. During those portions, this age rule alone would block quotes, including withdrawals. The deviation rule can cause additional blocks. This is historical, not a forecast.

A three-hour candidate also passed the tested ordinary flows and guard boundaries, and covered the observed maximum gap, but its lag exceeded 150 bps at 348 of 2,368 sampled observation times. Merely lengthening the window does not solve availability. The registry also requires maxObservationAge <= twapWindow, so those values cannot be separated arbitrarily in the deployed code.

These focused checks are complete. Registration remains a release decision with the above withdrawal trade-off visible; the short check is not a full economic safety proof. Downward/adaptive attacks, sandwiches, LP-removal economics and future quiet-market conditions remain outside its tested scope. Do not reuse these limits for mixed baskets without analysis.

[Measurements](../reports/amc-liquidity-age/measurements.json) · [Exact-setting fork results](../reports/amc-liquidity-age/fork-results.json) · [Candidate JSON](../reports/amc-liquidity-age/candidate-params.json)
