# Proposed token settings

Status: PROPOSED_FOR_REVIEW

These are proposals for single-token baskets, not listing approval. No live transactions sent.

## Recommended candidate

Among passing candidates, prefer a completed unprofitable attack test, then tighter deviation, shorter TWAP window, less historical staleness, and lower pool fee. This is a policy preference, not a safety guarantee; staleness/deviation can still block withdrawals.

```json

{
  "token": "0x4e62068525Ab11FE768e29dfD00ef909B9803016",
  "pool": "0x0F4227D27082B3BCA6818381b9ea6460275e49f4",
  "fee": 3000,
  "status": "PROPOSED_FOR_REVIEW",
  "params": {
    "twapWindow": 10800,
    "maxObservationAge": 10800,
    "minCurrentLiquidity": "180000000000000000",
    "minHarmonicLiquidity": "180000000000000000",
    "maxDeviationBps": 150,
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
    "historicalStaleFraction": 0.013385263518770027,
    "latestObservationAge": 82,
    "maxGap": 15700,
    "deviationP95Bps": 148.93387030118222,
    "deviationP99Bps": 207.96459560336268,
    "deviationSamples": 1596,
    "deviationExceedanceFraction": 0.04949874686716792,
    "hourlyLiquiditySamples": 72,
    "minimumHourlyLiquidity": "182810826915276518"
  }
}

```

## All passing candidates (including alternatives)


## Pool 0x0F4227D27082B3BCA6818381b9ea6460275e49f4

```json

{
  "twapWindow": 10800,
  "maxObservationAge": 10800,
  "minCurrentLiquidity": "180000000000000000",
  "minHarmonicLiquidity": "180000000000000000",
  "maxDeviationBps": 150,
  "slippageBps": 200
}

```

Historical staleness blocking: 1.34% of retained time.

Deviation exceedances: 4.95% of observation-time samples (not uptime).

Passed round-trip sizes (USDG): 10, 100, 1000, 10000. Total basket cap: not established.

Single-token basket only; not validated for mixed baskets.

Heuristic observed-range proposal, not a safety guarantee or listing approval.

Historical withdrawal blocks are disclosed; future liquidity and availability can differ.

One upward attack path; downward attacks, sandwiches and LP-withdrawal economics are not covered.

Tested trade sizes do not establish a safe total basket cap.
