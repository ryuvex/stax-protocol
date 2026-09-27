# Proposed token settings

Status: PROPOSED_FOR_REVIEW

These are proposals for single-token baskets, not listing approval. No live transactions sent.

## Recommended candidate

Among passing candidates, prefer a completed unprofitable attack test, then tighter deviation, shorter TWAP window, less historical staleness, and lower pool fee. This is a policy preference, not a safety guarantee; staleness/deviation can still block withdrawals.

```json

{
  "token": "0x25C288E6D899b9BC30160965aD9644c67e73bE0C",
  "pool": "0x4dbAC19E895322ac5b93abad9008691632bFFC05",
  "fee": 3000,
  "status": "PROPOSED_FOR_REVIEW",
  "params": {
    "twapWindow": 10800,
    "maxObservationAge": 10800,
    "minCurrentLiquidity": "440000000000000000",
    "minHarmonicLiquidity": "440000000000000000",
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
    "historicalStaleFraction": 0.029072716041370725,
    "latestObservationAge": 1204,
    "maxGap": 18984,
    "deviationP95Bps": 187.14837070551658,
    "deviationP99Bps": 289.70273438864604,
    "deviationSamples": 1356,
    "deviationExceedanceFraction": 0.04498525073746313,
    "hourlyLiquiditySamples": 72,
    "minimumHourlyLiquidity": "447853583280924253"
  }
}

```

## All passing candidates (including alternatives)


## Pool 0x4dbAC19E895322ac5b93abad9008691632bFFC05

```json

{
  "twapWindow": 10800,
  "maxObservationAge": 10800,
  "minCurrentLiquidity": "440000000000000000",
  "minHarmonicLiquidity": "440000000000000000",
  "maxDeviationBps": 200,
  "slippageBps": 200
}

```

Historical staleness blocking: 2.91% of retained time.

Deviation exceedances: 4.50% of observation-time samples (not uptime).

Passed round-trip sizes (USDG): 10, 100, 1000, 10000. Total basket cap: not established.

Single-token basket only; not validated for mixed baskets.

Heuristic observed-range proposal, not a safety guarantee or listing approval.

Historical withdrawal blocks are disclosed; future liquidity and availability can differ.

One upward attack path; downward attacks, sandwiches and LP-withdrawal economics are not covered.

Tested trade sizes do not establish a safe total basket cap.
