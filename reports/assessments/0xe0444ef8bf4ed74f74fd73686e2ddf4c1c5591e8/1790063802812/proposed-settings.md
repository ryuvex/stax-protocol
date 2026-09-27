# Proposed token settings

Status: PROPOSED_FOR_REVIEW

These are proposals for single-token baskets, not listing approval. No live transactions sent.

## Recommended candidate

Among passing candidates, prefer a completed unprofitable attack test, then tighter deviation, shorter TWAP window, less historical staleness, and lower pool fee. This is a policy preference, not a safety guarantee; staleness/deviation can still block withdrawals.

```json

{
  "token": "0xE0444EF8BF4eD74f74FD73686e2ddF4C1c5591E8",
  "pool": "0x59895C0302F41aEaa129D2fa2442CEc01E7eF45E",
  "fee": 3000,
  "status": "PROPOSED_FOR_REVIEW",
  "params": {
    "twapWindow": 3600,
    "maxObservationAge": 3600,
    "minCurrentLiquidity": "150000000000000000",
    "minHarmonicLiquidity": "150000000000000000",
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
    "historicalStaleFraction": 0.0484912688377815,
    "latestObservationAge": 44,
    "maxGap": 7850,
    "deviationP95Bps": 90.53004409035114,
    "deviationP99Bps": 193.49210117660775,
    "deviationSamples": 1724,
    "deviationExceedanceFraction": 0.04118329466357309,
    "hourlyLiquiditySamples": 72,
    "minimumHourlyLiquidity": "154380880806405413"
  }
}

```

## All passing candidates (including alternatives)


## Pool 0x59895C0302F41aEaa129D2fa2442CEc01E7eF45E

```json

{
  "twapWindow": 3600,
  "maxObservationAge": 3600,
  "minCurrentLiquidity": "150000000000000000",
  "minHarmonicLiquidity": "150000000000000000",
  "maxDeviationBps": 100,
  "slippageBps": 200
}

```

Historical staleness blocking: 4.85% of retained time.

Deviation exceedances: 4.12% of observation-time samples (not uptime).

Passed round-trip sizes (USDG): 10, 100, 1000, 10000. Total basket cap: not established.

Single-token basket only; not validated for mixed baskets.

Heuristic observed-range proposal, not a safety guarantee or listing approval.

Historical withdrawal blocks are disclosed; future liquidity and availability can differ.

One upward attack path; downward attacks, sandwiches and LP-withdrawal economics are not covered.

Tested trade sizes do not establish a safe total basket cap.


## Pool 0x59895C0302F41aEaa129D2fa2442CEc01E7eF45E

```json

{
  "twapWindow": 10800,
  "maxObservationAge": 10800,
  "minCurrentLiquidity": "150000000000000000",
  "minHarmonicLiquidity": "150000000000000000",
  "maxDeviationBps": 200,
  "slippageBps": 200
}

```

Historical staleness blocking: 0.00% of retained time.

Deviation exceedances: 2.92% of observation-time samples (not uptime).

Passed round-trip sizes (USDG): 10, 100, 1000, 10000. Total basket cap: not established.

Single-token basket only; not validated for mixed baskets.

Heuristic observed-range proposal, not a safety guarantee or listing approval.

Historical withdrawal blocks are disclosed; future liquidity and availability can differ.

One upward attack path; downward attacks, sandwiches and LP-withdrawal economics are not covered.

Tested trade sizes do not establish a safe total basket cap.
