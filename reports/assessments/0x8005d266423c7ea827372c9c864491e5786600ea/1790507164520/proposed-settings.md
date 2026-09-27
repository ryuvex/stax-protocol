# Proposed token settings

Status: PROPOSED_FOR_REVIEW

These are proposals for single-token baskets, not listing approval. No live transactions sent.

## Recommended candidate

Among passing candidates, prefer a completed unprofitable attack test, then tighter deviation, shorter TWAP window, less historical staleness, and lower pool fee. This is a policy preference, not a safety guarantee; staleness/deviation can still block withdrawals.

```json

{
  "token": "0x8005d266423c7ea827372c9c864491e5786600ea",
  "pool": "0xF212D02146a897F5F686E9d629F6A73da534324a",
  "fee": 500,
  "status": "PROPOSED_FOR_REVIEW",
  "params": {
    "twapWindow": 10800,
    "maxObservationAge": 10800,
    "minCurrentLiquidity": "210000000000000000",
    "minHarmonicLiquidity": "210000000000000000",
    "maxDeviationBps": 250,
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
    "historicalStaleFraction": 0,
    "latestObservationAge": 454,
    "maxGap": 4287,
    "deviationP95Bps": 225.00985373778758,
    "deviationP99Bps": 269.81463684723207,
    "deviationSamples": 2246,
    "deviationExceedanceFraction": 0.017809439002671415,
    "hourlyLiquiditySamples": 72,
    "minimumHourlyLiquidity": "215138770893027445"
  }
}

```

## All passing candidates (including alternatives)


## Pool 0xF212D02146a897F5F686E9d629F6A73da534324a

```json

{
  "twapWindow": 10800,
  "maxObservationAge": 10800,
  "minCurrentLiquidity": "210000000000000000",
  "minHarmonicLiquidity": "210000000000000000",
  "maxDeviationBps": 250,
  "slippageBps": 200
}

```

Historical staleness blocking: 0.00% of retained time.

Deviation exceedances: 1.78% of observation-time samples (not uptime).

Passed round-trip sizes (USDG): 10, 100, 1000, 10000. Total basket cap: not established.

Single-token basket only; not validated for mixed baskets.

Heuristic observed-range proposal, not a safety guarantee or listing approval.

Historical withdrawal blocks are disclosed; future liquidity and availability can differ.

One upward attack path; downward attacks, sandwiches and LP-withdrawal economics are not covered.

Tested trade sizes do not establish a safe total basket cap.
