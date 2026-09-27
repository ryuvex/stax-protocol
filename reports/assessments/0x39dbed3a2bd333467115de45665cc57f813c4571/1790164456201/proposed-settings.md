# Proposed token settings

Status: PROPOSED_FOR_REVIEW

These are proposals for single-token baskets, not listing approval. No live transactions sent.

## Recommended candidate

Among passing candidates, prefer a completed unprofitable attack test, then tighter deviation, shorter TWAP window, less historical staleness, and lower pool fee. This is a policy preference, not a safety guarantee; staleness/deviation can still block withdrawals.

```json

{
  "token": "0x39dBED3a2bd333467115dE45665cC57F813C4571",
  "pool": "0x7A192E71564ec66eE0763e328a3Ac274942dE4e1",
  "fee": 10000,
  "status": "PROPOSED_FOR_REVIEW",
  "params": {
    "twapWindow": 3600,
    "maxObservationAge": 3600,
    "minCurrentLiquidity": "2000000000000000000",
    "minHarmonicLiquidity": "2000000000000000000",
    "maxDeviationBps": 300,
    "slippageBps": 200
  },
  "listingApproved": false,
  "passedRoundTripSizesUsdg": [
    10,
    100,
    1000,
    10000
  ],
  "attackOutcome": "TESTED_PATH_UNPROFITABLE",
  "totalBasketCap": null,
  "limitations": [
    "Single-token basket only; not validated for mixed baskets.",
    "Heuristic observed-range proposal, not a safety guarantee or listing approval.",
    "Historical withdrawal blocks are disclosed; future liquidity and availability can differ.",
    "One upward attack path; downward attacks, sandwiches and LP-withdrawal economics are not covered.",
    "Tested trade sizes do not establish a safe total basket cap."
  ],
  "statistics": {
    "historicalStaleFraction": 0.009445740381772184,
    "latestObservationAge": 127,
    "maxGap": 5321,
    "deviationP95Bps": 297.99487740282405,
    "deviationP99Bps": 394.38312036477186,
    "deviationSamples": 1755,
    "deviationExceedanceFraction": 0.04786324786324787,
    "hourlyLiquiditySamples": 50,
    "minimumHourlyLiquidity": "4061197525299359997"
  }
}

```

## All passing candidates (including alternatives)


## Pool 0x7A192E71564ec66eE0763e328a3Ac274942dE4e1

```json

{
  "twapWindow": 3600,
  "maxObservationAge": 3600,
  "minCurrentLiquidity": "2000000000000000000",
  "minHarmonicLiquidity": "2000000000000000000",
  "maxDeviationBps": 300,
  "slippageBps": 200
}

```

Historical staleness blocking: 0.94% of retained time.

Deviation exceedances: 4.79% of observation-time samples (not uptime).

Passed round-trip sizes (USDG): 10, 100, 1000, 10000. Total basket cap: not established.

Single-token basket only; not validated for mixed baskets.

Heuristic observed-range proposal, not a safety guarantee or listing approval.

Historical withdrawal blocks are disclosed; future liquidity and availability can differ.

One upward attack path; downward attacks, sandwiches and LP-withdrawal economics are not covered.

Tested trade sizes do not establish a safe total basket cap.
