# Proposed token settings

Status: PROPOSED_FOR_REVIEW

These are proposals for single-token baskets, not listing approval. No live transactions sent.

## Recommended candidate

Among passing candidates, prefer a completed unprofitable attack test, then tighter deviation, shorter TWAP window, less historical staleness, and lower pool fee. This is a policy preference, not a safety guarantee; staleness/deviation can still block withdrawals.

```json

{
  "token": "0xF0C4BF4C582cb3836e98394b1d4e7B7281101bE8",
  "pool": "0x2ef5945cd5664876b6481FdacFaA2942995a4DA8",
  "fee": 10000,
  "status": "PROPOSED_FOR_REVIEW",
  "params": {
    "twapWindow": 10800,
    "maxObservationAge": 10800,
    "minCurrentLiquidity": "130000000000000000",
    "minHarmonicLiquidity": "130000000000000000",
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
    "historicalStaleFraction": 0.02614323274779867,
    "latestObservationAge": 691,
    "maxGap": 15867,
    "deviationP95Bps": 170.74649171037626,
    "deviationP99Bps": 234.40131684716593,
    "deviationSamples": 1775,
    "deviationExceedanceFraction": 0.023098591549295774,
    "hourlyLiquiditySamples": 72,
    "minimumHourlyLiquidity": "139109235848658641"
  }
}

```

## All passing candidates (including alternatives)


## Pool 0x2ef5945cd5664876b6481FdacFaA2942995a4DA8

```json

{
  "twapWindow": 10800,
  "maxObservationAge": 10800,
  "minCurrentLiquidity": "130000000000000000",
  "minHarmonicLiquidity": "130000000000000000",
  "maxDeviationBps": 200,
  "slippageBps": 200
}

```

Historical staleness blocking: 2.61% of retained time.

Deviation exceedances: 2.31% of observation-time samples (not uptime).

Passed round-trip sizes (USDG): 10, 100, 1000, 10000. Total basket cap: not established.

Single-token basket only; not validated for mixed baskets.

Heuristic observed-range proposal, not a safety guarantee or listing approval.

Historical withdrawal blocks are disclosed; future liquidity and availability can differ.

One upward attack path; downward attacks, sandwiches and LP-withdrawal economics are not covered.

Tested trade sizes do not establish a safe total basket cap.
