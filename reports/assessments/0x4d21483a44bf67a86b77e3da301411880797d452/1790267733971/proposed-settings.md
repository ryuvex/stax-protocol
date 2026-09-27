# Proposed token settings

Status: PROPOSED_FOR_REVIEW

These are proposals for single-token baskets, not listing approval. No live transactions sent.

## Recommended candidate

Among passing candidates, prefer a completed unprofitable attack test, then tighter deviation, shorter TWAP window, less historical staleness, and lower pool fee. This is a policy preference, not a safety guarantee; staleness/deviation can still block withdrawals.

```json

{
  "token": "0x4D21483a44Bf67a86b77E3dA301411880797D452",
  "pool": "0xc6517047b189c72D3bAa9eF37D1d28F27a63638a",
  "fee": 3000,
  "status": "PROPOSED_FOR_REVIEW",
  "params": {
    "twapWindow": 10800,
    "maxObservationAge": 10800,
    "minCurrentLiquidity": "160000000000000000",
    "minHarmonicLiquidity": "160000000000000000",
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
    "historicalStaleFraction": 0.007899052728888774,
    "latestObservationAge": 1066,
    "maxGap": 15679,
    "deviationP95Bps": 111.69052380357591,
    "deviationP99Bps": 169.9238445053408,
    "deviationSamples": 1328,
    "deviationExceedanceFraction": 0.02108433734939759,
    "hourlyLiquiditySamples": 72,
    "minimumHourlyLiquidity": "167387256957979736"
  }
}

```

## All passing candidates (including alternatives)


## Pool 0xc6517047b189c72D3bAa9eF37D1d28F27a63638a

```json

{
  "twapWindow": 10800,
  "maxObservationAge": 10800,
  "minCurrentLiquidity": "160000000000000000",
  "minHarmonicLiquidity": "160000000000000000",
  "maxDeviationBps": 150,
  "slippageBps": 200
}

```

Historical staleness blocking: 0.79% of retained time.

Deviation exceedances: 2.11% of observation-time samples (not uptime).

Passed round-trip sizes (USDG): 10, 100, 1000, 10000. Total basket cap: not established.

Single-token basket only; not validated for mixed baskets.

Heuristic observed-range proposal, not a safety guarantee or listing approval.

Historical withdrawal blocks are disclosed; future liquidity and availability can differ.

One upward attack path; downward attacks, sandwiches and LP-withdrawal economics are not covered.

Tested trade sizes do not establish a safe total basket cap.
