# Proposed token settings

Status: PROPOSED_FOR_REVIEW

These are proposals for single-token baskets, not listing approval. No live transactions sent.

## Recommended candidate

Among passing candidates, prefer a completed unprofitable attack test, then tighter deviation, shorter TWAP window, less historical staleness, and lower pool fee. This is a policy preference, not a safety guarantee; staleness/deviation can still block withdrawals.

```json

{
  "token": "0x7066A64c24e4206CD62E83bf198c1E7EB361F51e",
  "pool": "0xC7d573Fcda6D2107C97fb582ae18411F9Db32E7f",
  "fee": 3000,
  "status": "PROPOSED_FOR_REVIEW",
  "params": {
    "twapWindow": 10800,
    "maxObservationAge": 10800,
    "minCurrentLiquidity": "370000000000000000",
    "minHarmonicLiquidity": "370000000000000000",
    "maxDeviationBps": 100,
    "slippageBps": 200
  },
  "listingApproved": false,
  "passedRoundTripSizesUsdg": [
    10,
    100,
    1000,
    10000
  ],
  "attackOutcome": "TESTED_PATH_BLOCKED",
  "totalBasketCap": null,
  "limitations": [
    "Single-token basket only; not validated for mixed baskets.",
    "Heuristic observed-range proposal, not a safety guarantee or listing approval.",
    "Historical withdrawal blocks are disclosed; future liquidity and availability can differ.",
    "One upward attack path; downward attacks, sandwiches and LP-withdrawal economics are not covered.",
    "Tested trade sizes do not establish a safe total basket cap."
  ],
  "statistics": {
    "historicalStaleFraction": 0.03885854619408808,
    "latestObservationAge": 93,
    "maxGap": 34911,
    "deviationP95Bps": 93.61656217106051,
    "deviationP99Bps": 147.39703160704164,
    "deviationSamples": 1384,
    "deviationExceedanceFraction": 0.03901734104046243,
    "hourlyLiquiditySamples": 72,
    "minimumHourlyLiquidity": "371695243123444974"
  }
}

```

## All passing candidates (including alternatives)


## Pool 0xC7d573Fcda6D2107C97fb582ae18411F9Db32E7f

```json

{
  "twapWindow": 10800,
  "maxObservationAge": 10800,
  "minCurrentLiquidity": "370000000000000000",
  "minHarmonicLiquidity": "370000000000000000",
  "maxDeviationBps": 100,
  "slippageBps": 200
}

```

Historical staleness blocking: 3.89% of retained time.

Deviation exceedances: 3.90% of observation-time samples (not uptime).

Passed round-trip sizes (USDG): 10, 100, 1000, 10000. Total basket cap: not established.

Single-token basket only; not validated for mixed baskets.

Heuristic observed-range proposal, not a safety guarantee or listing approval.

Historical withdrawal blocks are disclosed; future liquidity and availability can differ.

One upward attack path; downward attacks, sandwiches and LP-withdrawal economics are not covered.

Tested trade sizes do not establish a safe total basket cap.
