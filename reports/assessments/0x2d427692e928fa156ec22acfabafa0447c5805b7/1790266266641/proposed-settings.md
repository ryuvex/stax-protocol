# Proposed token settings

Status: PROPOSED_FOR_REVIEW

These are proposals for single-token baskets, not listing approval. No live transactions sent.

## Recommended candidate

Among passing candidates, prefer a completed unprofitable attack test, then tighter deviation, shorter TWAP window, less historical staleness, and lower pool fee. This is a policy preference, not a safety guarantee; staleness/deviation can still block withdrawals.

```json

{
  "token": "0x2D427692E928fa156ec22acfaBaFA0447C5805B7",
  "pool": "0xC67C2D200E0b7E5D99F4CFBede8CB09B48892f2c",
  "fee": 3000,
  "status": "PROPOSED_FOR_REVIEW",
  "params": {
    "twapWindow": 3600,
    "maxObservationAge": 3600,
    "minCurrentLiquidity": "160000000000000000",
    "minHarmonicLiquidity": "160000000000000000",
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
    "historicalStaleFraction": 0.03947422873414853,
    "latestObservationAge": 54,
    "maxGap": 7998,
    "deviationP95Bps": 193.3392945811363,
    "deviationP99Bps": 341.1164025585123,
    "deviationSamples": 1362,
    "deviationExceedanceFraction": 0.049926578560939794,
    "hourlyLiquiditySamples": 72,
    "minimumHourlyLiquidity": "165433551205244451"
  }
}

```

## All passing candidates (including alternatives)


## Pool 0xC67C2D200E0b7E5D99F4CFBede8CB09B48892f2c

```json

{
  "twapWindow": 3600,
  "maxObservationAge": 3600,
  "minCurrentLiquidity": "160000000000000000",
  "minHarmonicLiquidity": "160000000000000000",
  "maxDeviationBps": 200,
  "slippageBps": 200
}

```

Historical staleness blocking: 3.95% of retained time.

Deviation exceedances: 4.99% of observation-time samples (not uptime).

Passed round-trip sizes (USDG): 10, 100, 1000, 10000. Total basket cap: not established.

Single-token basket only; not validated for mixed baskets.

Heuristic observed-range proposal, not a safety guarantee or listing approval.

Historical withdrawal blocks are disclosed; future liquidity and availability can differ.

One upward attack path; downward attacks, sandwiches and LP-withdrawal economics are not covered.

Tested trade sizes do not establish a safe total basket cap.
