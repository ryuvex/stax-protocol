# Proposed token settings

Status: PROPOSED_FOR_REVIEW

These are proposals for single-token baskets, not listing approval. No live transactions sent.

## Recommended candidate

Among passing candidates, prefer a completed unprofitable attack test, then tighter deviation, shorter TWAP window, less historical staleness, and lower pool fee. This is a policy preference, not a safety guarantee; staleness/deviation can still block withdrawals.

```json

{
  "token": "0x92FD66527192E3e61d4DDd13322Aa222DE86F9B5",
  "pool": "0xfAb520051f96F4D2a32c22B6a3dD7fFfdf231bFe",
  "fee": 3000,
  "status": "PROPOSED_FOR_REVIEW",
  "params": {
    "twapWindow": 10800,
    "maxObservationAge": 10800,
    "minCurrentLiquidity": "51000000000000000000",
    "minHarmonicLiquidity": "51000000000000000000",
    "maxDeviationBps": 50,
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
    "historicalStaleFraction": 0.016610094612105778,
    "latestObservationAge": 2345,
    "maxGap": 19255,
    "deviationP95Bps": 6.6189883794187665,
    "deviationP99Bps": 17.930046177090375,
    "deviationSamples": 1759,
    "deviationExceedanceFraction": 0,
    "hourlyLiquiditySamples": 72,
    "minimumHourlyLiquidity": "51032940383412189270"
  }
}

```

## All passing candidates (including alternatives)


## Pool 0xfAb520051f96F4D2a32c22B6a3dD7fFfdf231bFe

```json

{
  "twapWindow": 10800,
  "maxObservationAge": 10800,
  "minCurrentLiquidity": "51000000000000000000",
  "minHarmonicLiquidity": "51000000000000000000",
  "maxDeviationBps": 50,
  "slippageBps": 200
}

```

Historical staleness blocking: 1.66% of retained time.

Deviation exceedances: 0.00% of observation-time samples (not uptime).

Passed round-trip sizes (USDG): 10, 100, 1000, 10000. Total basket cap: not established.

Single-token basket only; not validated for mixed baskets.

Heuristic observed-range proposal, not a safety guarantee or listing approval.

Historical withdrawal blocks are disclosed; future liquidity and availability can differ.

One upward attack path; downward attacks, sandwiches and LP-withdrawal economics are not covered.

Tested trade sizes do not establish a safe total basket cap.
