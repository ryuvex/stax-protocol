# Proposed token settings

Status: PROPOSED_FOR_REVIEW

These are proposals for single-token baskets, not listing approval. No live transactions sent.

## Recommended candidate

Among passing candidates, prefer a completed unprofitable attack test, then tighter deviation, shorter TWAP window, less historical staleness, and lower pool fee. This is a policy preference, not a safety guarantee; staleness/deviation can still block withdrawals.

```json

{
  "token": "0x05b37Fb53A299a1b874A619e1c4C404D52C36F4C",
  "pool": "0xa8744E76aED23B05F0126335E7BD38f7935D19fe",
  "fee": 10000,
  "status": "PROPOSED_FOR_REVIEW",
  "params": {
    "twapWindow": 10800,
    "maxObservationAge": 10800,
    "minCurrentLiquidity": "880000000000000000",
    "minHarmonicLiquidity": "880000000000000000",
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
    "historicalStaleFraction": 0.029106992757842596,
    "latestObservationAge": 588,
    "maxGap": 25239,
    "deviationP95Bps": 195.05306092725493,
    "deviationP99Bps": 257.41881408313014,
    "deviationSamples": 1631,
    "deviationExceedanceFraction": 0.04291845493562232,
    "hourlyLiquiditySamples": 72,
    "minimumHourlyLiquidity": "880520079974327576"
  }
}

```

## All passing candidates (including alternatives)


## Pool 0xa8744E76aED23B05F0126335E7BD38f7935D19fe

```json

{
  "twapWindow": 10800,
  "maxObservationAge": 10800,
  "minCurrentLiquidity": "880000000000000000",
  "minHarmonicLiquidity": "880000000000000000",
  "maxDeviationBps": 200,
  "slippageBps": 200
}

```

Historical staleness blocking: 2.91% of retained time.

Deviation exceedances: 4.29% of observation-time samples (not uptime).

Passed round-trip sizes (USDG): 10, 100, 1000, 10000. Total basket cap: not established.

Single-token basket only; not validated for mixed baskets.

Heuristic observed-range proposal, not a safety guarantee or listing approval.

Historical withdrawal blocks are disclosed; future liquidity and availability can differ.

One upward attack path; downward attacks, sandwiches and LP-withdrawal economics are not covered.

Tested trade sizes do not establish a safe total basket cap.
