# Proposed token settings

Status: PROPOSED_FOR_REVIEW

These are proposals for single-token baskets, not listing approval. No live transactions sent.

## Recommended candidate

Among passing candidates, prefer a completed unprofitable attack test, then tighter deviation, shorter TWAP window, less historical staleness, and lower pool fee. This is a policy preference, not a safety guarantee; staleness/deviation can still block withdrawals.

```json

{
  "token": "0x05a3d1Cd21d0C88145E82600E62e7E496e0F222B",
  "pool": "0xaA34feA710a1A737840329051D81D3B0B7C564d5",
  "fee": 3000,
  "status": "PROPOSED_FOR_REVIEW",
  "params": {
    "twapWindow": 10800,
    "maxObservationAge": 10800,
    "minCurrentLiquidity": "320000000000000000",
    "minHarmonicLiquidity": "320000000000000000",
    "maxDeviationBps": 350,
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
    "historicalStaleFraction": 0.004011349056126453,
    "latestObservationAge": 8089,
    "maxGap": 13601,
    "deviationP95Bps": 329.4988548101019,
    "deviationP99Bps": 435.5073410975419,
    "deviationSamples": 2315,
    "deviationExceedanceFraction": 0.042332613390928725,
    "hourlyLiquiditySamples": 72,
    "minimumHourlyLiquidity": "653828887067661374"
  }
}

```

## All passing candidates (including alternatives)


## Pool 0xaA34feA710a1A737840329051D81D3B0B7C564d5

```json

{
  "twapWindow": 10800,
  "maxObservationAge": 10800,
  "minCurrentLiquidity": "320000000000000000",
  "minHarmonicLiquidity": "320000000000000000",
  "maxDeviationBps": 350,
  "slippageBps": 200
}

```

Historical staleness blocking: 0.40% of retained time.

Deviation exceedances: 4.23% of observation-time samples (not uptime).

Passed round-trip sizes (USDG): 10, 100, 1000, 10000. Total basket cap: not established.

Single-token basket only; not validated for mixed baskets.

Heuristic observed-range proposal, not a safety guarantee or listing approval.

Historical withdrawal blocks are disclosed; future liquidity and availability can differ.

One upward attack path; downward attacks, sandwiches and LP-withdrawal economics are not covered.

Tested trade sizes do not establish a safe total basket cap.
