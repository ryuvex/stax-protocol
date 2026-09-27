# Proposed token settings

Status: PROPOSED_FOR_REVIEW

These are proposals for single-token baskets, not listing approval. No live transactions sent.

## Recommended candidate

Among passing candidates, prefer a completed unprofitable attack test, then tighter deviation, shorter TWAP window, less historical staleness, and lower pool fee. This is a policy preference, not a safety guarantee; staleness/deviation can still block withdrawals.

```json

{
  "token": "0x5e81213613b6B86EaB4c6c50d718d34359459786",
  "pool": "0xD9Ab4b7fAe6DC2f7020134Ec744A8F53Ef3E5E24",
  "fee": 3000,
  "status": "PROPOSED_FOR_REVIEW",
  "params": {
    "twapWindow": 10800,
    "maxObservationAge": 10800,
    "minCurrentLiquidity": "46000000000000000",
    "minHarmonicLiquidity": "46000000000000000",
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
    "historicalStaleFraction": 0,
    "latestObservationAge": 102,
    "maxGap": 9682,
    "deviationP95Bps": 85.1220255862617,
    "deviationP99Bps": 166.65696719214586,
    "deviationSamples": 1758,
    "deviationExceedanceFraction": 0.03981797497155859,
    "hourlyLiquiditySamples": 72,
    "minimumHourlyLiquidity": "46513565992545963"
  }
}

```

## All passing candidates (including alternatives)


## Pool 0xD9Ab4b7fAe6DC2f7020134Ec744A8F53Ef3E5E24

```json

{
  "twapWindow": 10800,
  "maxObservationAge": 10800,
  "minCurrentLiquidity": "46000000000000000",
  "minHarmonicLiquidity": "46000000000000000",
  "maxDeviationBps": 100,
  "slippageBps": 200
}

```

Historical staleness blocking: 0.00% of retained time.

Deviation exceedances: 3.98% of observation-time samples (not uptime).

Passed round-trip sizes (USDG): 10, 100, 1000, 10000. Total basket cap: not established.

Single-token basket only; not validated for mixed baskets.

Heuristic observed-range proposal, not a safety guarantee or listing approval.

Historical withdrawal blocks are disclosed; future liquidity and availability can differ.

One upward attack path; downward attacks, sandwiches and LP-withdrawal economics are not covered.

Tested trade sizes do not establish a safe total basket cap.
