# Proposed token settings

Status: PROPOSED_FOR_REVIEW

These are proposals for single-token baskets, not listing approval. No live transactions sent.

## Recommended candidate

Among passing candidates, prefer a completed unprofitable attack test, then tighter deviation, shorter TWAP window, less historical staleness, and lower pool fee. This is a policy preference, not a safety guarantee; staleness/deviation can still block withdrawals.

```json

{
  "token": "0x980dcf6766FA79f5Cf0c4AAdb3ab477ff15a9619",
  "pool": "0x8cD848ce18b829C5c769AFf27164078bB52e0E97",
  "fee": 3000,
  "status": "PROPOSED_FOR_REVIEW",
  "params": {
    "twapWindow": 10800,
    "maxObservationAge": 10800,
    "minCurrentLiquidity": "210000000000000000",
    "minHarmonicLiquidity": "210000000000000000",
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
    "historicalStaleFraction": 0.006211526244812892,
    "latestObservationAge": 314,
    "maxGap": 12472,
    "deviationP95Bps": 97.14164306427797,
    "deviationP99Bps": 158.91136716550957,
    "deviationSamples": 1725,
    "deviationExceedanceFraction": 0.04927536231884058,
    "hourlyLiquiditySamples": 72,
    "minimumHourlyLiquidity": "218234571296954379"
  }
}

```

## All passing candidates (including alternatives)


## Pool 0x8cD848ce18b829C5c769AFf27164078bB52e0E97

```json

{
  "twapWindow": 10800,
  "maxObservationAge": 10800,
  "minCurrentLiquidity": "210000000000000000",
  "minHarmonicLiquidity": "210000000000000000",
  "maxDeviationBps": 100,
  "slippageBps": 200
}

```

Historical staleness blocking: 0.62% of retained time.

Deviation exceedances: 4.93% of observation-time samples (not uptime).

Passed round-trip sizes (USDG): 10, 100, 1000, 10000. Total basket cap: not established.

Single-token basket only; not validated for mixed baskets.

Heuristic observed-range proposal, not a safety guarantee or listing approval.

Historical withdrawal blocks are disclosed; future liquidity and availability can differ.

One upward attack path; downward attacks, sandwiches and LP-withdrawal economics are not covered.

Tested trade sizes do not establish a safe total basket cap.
