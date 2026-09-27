# Proposed token settings

Status: PROPOSED_FOR_REVIEW

These are proposals for single-token baskets, not listing approval. No live transactions sent.

## Recommended candidate

Among passing candidates, prefer a completed unprofitable attack test, then tighter deviation, shorter TWAP window, less historical staleness, and lower pool fee. This is a policy preference, not a safety guarantee; staleness/deviation can still block withdrawals.

```json

{
  "token": "0x59818904ab4cE163b3cE4FfB64f2D6Ca02c434B4",
  "pool": "0x227Bbce9A81B3694b01754298a983Be3F9E44A93",
  "fee": 3000,
  "status": "PROPOSED_FOR_REVIEW",
  "params": {
    "twapWindow": 10800,
    "maxObservationAge": 10800,
    "minCurrentLiquidity": "77000000000000000",
    "minHarmonicLiquidity": "77000000000000000",
    "maxDeviationBps": 200,
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
    "historicalStaleFraction": 0.021345407503234153,
    "latestObservationAge": 93,
    "maxGap": 14706,
    "deviationP95Bps": 198.17259638888584,
    "deviationP99Bps": 285.9511496840161,
    "deviationSamples": 1291,
    "deviationExceedanceFraction": 0.048799380325329204,
    "hourlyLiquiditySamples": 72,
    "minimumHourlyLiquidity": "77404275013005777"
  }
}

```

## All passing candidates (including alternatives)


## Pool 0x227Bbce9A81B3694b01754298a983Be3F9E44A93

```json

{
  "twapWindow": 10800,
  "maxObservationAge": 10800,
  "minCurrentLiquidity": "77000000000000000",
  "minHarmonicLiquidity": "77000000000000000",
  "maxDeviationBps": 200,
  "slippageBps": 200
}

```

Historical staleness blocking: 2.13% of retained time.

Deviation exceedances: 4.88% of observation-time samples (not uptime).

Passed round-trip sizes (USDG): 10, 100, 1000, 10000. Total basket cap: not established.

Single-token basket only; not validated for mixed baskets.

Heuristic observed-range proposal, not a safety guarantee or listing approval.

Historical withdrawal blocks are disclosed; future liquidity and availability can differ.

One upward attack path; downward attacks, sandwiches and LP-withdrawal economics are not covered.

Tested trade sizes do not establish a safe total basket cap.
