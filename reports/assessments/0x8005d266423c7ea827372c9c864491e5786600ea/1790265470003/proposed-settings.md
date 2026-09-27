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
    "twapWindow": 1800,
    "maxObservationAge": 1800,
    "minCurrentLiquidity": "180000000000000000",
    "minHarmonicLiquidity": "180000000000000000",
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
    "historicalStaleFraction": 0.006768301364847548,
    "latestObservationAge": 20,
    "maxGap": 2345,
    "deviationP95Bps": 101.63798446552352,
    "deviationP99Bps": 144.04093923397588,
    "deviationSamples": 2349,
    "deviationExceedanceFraction": 0.004257130693912303,
    "hourlyLiquiditySamples": 54,
    "minimumHourlyLiquidity": "185008050823471857"
  }
}

```

## All passing candidates (including alternatives)


## Pool 0xF212D02146a897F5F686E9d629F6A73da534324a

```json

{
  "twapWindow": 1800,
  "maxObservationAge": 1800,
  "minCurrentLiquidity": "180000000000000000",
  "minHarmonicLiquidity": "180000000000000000",
  "maxDeviationBps": 150,
  "slippageBps": 200
}

```

Historical staleness blocking: 0.68% of retained time.

Deviation exceedances: 0.43% of observation-time samples (not uptime).

Passed round-trip sizes (USDG): 10, 100, 1000, 10000. Total basket cap: not established.

Single-token basket only; not validated for mixed baskets.

Heuristic observed-range proposal, not a safety guarantee or listing approval.

Historical withdrawal blocks are disclosed; future liquidity and availability can differ.

One upward attack path; downward attacks, sandwiches and LP-withdrawal economics are not covered.

Tested trade sizes do not establish a safe total basket cap.


## Pool 0xF212D02146a897F5F686E9d629F6A73da534324a

```json

{
  "twapWindow": 3600,
  "maxObservationAge": 3600,
  "minCurrentLiquidity": "180000000000000000",
  "minHarmonicLiquidity": "180000000000000000",
  "maxDeviationBps": 200,
  "slippageBps": 200
}

```

Historical staleness blocking: 0.00% of retained time.

Deviation exceedances: 0.04% of observation-time samples (not uptime).

Passed round-trip sizes (USDG): 10, 100, 1000, 10000. Total basket cap: not established.

Single-token basket only; not validated for mixed baskets.

Heuristic observed-range proposal, not a safety guarantee or listing approval.

Historical withdrawal blocks are disclosed; future liquidity and availability can differ.

One upward attack path; downward attacks, sandwiches and LP-withdrawal economics are not covered.

Tested trade sizes do not establish a safe total basket cap.
