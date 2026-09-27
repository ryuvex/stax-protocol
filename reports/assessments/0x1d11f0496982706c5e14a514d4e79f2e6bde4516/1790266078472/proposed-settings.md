# Proposed token settings

Status: PROPOSED_FOR_REVIEW

These are proposals for single-token baskets, not listing approval. No live transactions sent.

## Recommended candidate

Among passing candidates, prefer a completed unprofitable attack test, then tighter deviation, shorter TWAP window, less historical staleness, and lower pool fee. This is a policy preference, not a safety guarantee; staleness/deviation can still block withdrawals.

```json

{
  "token": "0x1D11f0496982706C5e14A514D4E79F2e6BdE4516",
  "pool": "0x31a89afd92F9397465649AD03226c52292fc1ae5",
  "fee": 10000,
  "status": "PROPOSED_FOR_REVIEW",
  "params": {
    "twapWindow": 1800,
    "maxObservationAge": 1800,
    "minCurrentLiquidity": "1400000000000000000",
    "minHarmonicLiquidity": "1400000000000000000",
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
    "historicalStaleFraction": 0.028440444654110872,
    "latestObservationAge": 1295,
    "maxGap": 3872,
    "deviationP95Bps": 50.44708087373895,
    "deviationP99Bps": 76.10565444764904,
    "deviationSamples": 1795,
    "deviationExceedanceFraction": 0,
    "hourlyLiquiditySamples": 72,
    "minimumHourlyLiquidity": "1448983584254708933"
  }
}

```

## All passing candidates (including alternatives)


## Pool 0x31a89afd92F9397465649AD03226c52292fc1ae5

```json

{
  "twapWindow": 1800,
  "maxObservationAge": 1800,
  "minCurrentLiquidity": "1400000000000000000",
  "minHarmonicLiquidity": "1400000000000000000",
  "maxDeviationBps": 100,
  "slippageBps": 200
}

```

Historical staleness blocking: 2.84% of retained time.

Deviation exceedances: 0.00% of observation-time samples (not uptime).

Passed round-trip sizes (USDG): 10, 100, 1000, 10000. Total basket cap: not established.

Single-token basket only; not validated for mixed baskets.

Heuristic observed-range proposal, not a safety guarantee or listing approval.

Historical withdrawal blocks are disclosed; future liquidity and availability can differ.

One upward attack path; downward attacks, sandwiches and LP-withdrawal economics are not covered.

Tested trade sizes do not establish a safe total basket cap.


## Pool 0x31a89afd92F9397465649AD03226c52292fc1ae5

```json

{
  "twapWindow": 3600,
  "maxObservationAge": 3600,
  "minCurrentLiquidity": "1400000000000000000",
  "minHarmonicLiquidity": "1400000000000000000",
  "maxDeviationBps": 100,
  "slippageBps": 200
}

```

Historical staleness blocking: 0.07% of retained time.

Deviation exceedances: 1.45% of observation-time samples (not uptime).

Passed round-trip sizes (USDG): 10, 100, 1000, 10000. Total basket cap: not established.

Single-token basket only; not validated for mixed baskets.

Heuristic observed-range proposal, not a safety guarantee or listing approval.

Historical withdrawal blocks are disclosed; future liquidity and availability can differ.

One upward attack path; downward attacks, sandwiches and LP-withdrawal economics are not covered.

Tested trade sizes do not establish a safe total basket cap.


## Pool 0x31a89afd92F9397465649AD03226c52292fc1ae5

```json

{
  "twapWindow": 10800,
  "maxObservationAge": 10800,
  "minCurrentLiquidity": "1400000000000000000",
  "minHarmonicLiquidity": "1400000000000000000",
  "maxDeviationBps": 150,
  "slippageBps": 200
}

```

Historical staleness blocking: 0.00% of retained time.

Deviation exceedances: 3.04% of observation-time samples (not uptime).

Passed round-trip sizes (USDG): 10, 100, 1000, 10000. Total basket cap: not established.

Single-token basket only; not validated for mixed baskets.

Heuristic observed-range proposal, not a safety guarantee or listing approval.

Historical withdrawal blocks are disclosed; future liquidity and availability can differ.

One upward attack path; downward attacks, sandwiches and LP-withdrawal economics are not covered.

Tested trade sizes do not establish a safe total basket cap.
