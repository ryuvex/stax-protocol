# Proposed token settings

Status: PROPOSED_FOR_REVIEW

These are proposals for single-token baskets, not listing approval. No live transactions sent.

## Recommended candidate

Chainlink candidate passed feed/token checks, measured round-history staleness and V2 fork round trips. Feed identity, basket composition and caps still require review.

```json

{
  "token": "0x9D9c6684F596F66a64C030B93A886D51Fd4D7931",
  "pool": null,
  "fee": 9900,
  "status": "PROPOSED_FOR_REVIEW",
  "params": {
    "feed": "0xE1D87B116Ba0fe898998f1D140339D1fA1E09705",
    "maxStaleness": 345600,
    "route": {
      "venue": "v4",
      "currency0": "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
      "currency1": "0x9D9c6684F596F66a64C030B93A886D51Fd4D7931",
      "fee": 9900,
      "tickSpacing": 99,
      "hooks": "0x0000000000000000000000000000000000000000",
      "source": "deepest hookless V4 USDG pool (355,242 USDG at current tick) 0x7c2f9ce1214ba9baf56d1b6a1fc640c1b63e9a711172c0c7d10e5a9c4a3d4f0c"
    },
    "slippageBps": 200
  },
  "listingApproved": false,
  "passedRoundTripSizesUsdg": [
    10,
    100,
    1000
  ],
  "oracleType": "CHAINLINK",
  "totalBasketCap": null,
  "limitations": [
    "Feed identity is inferred from the configured source vault or the public directory; confirm against Chainlink's official listing.",
    "Staleness proposal is measured from a finite window of round history and floored at V1's 96h; longer market closures can still block mint/redeem.",
    "Round trips prove integration at tested sizes only; they do not establish a safe basket cap.",
    "V4 routes are executed on the fork but not depth-probed by direct router trades."
  ]
}

```

## All passing candidates (including alternatives)


## Chainlink route (v4)

```json

{
  "feed": "0xE1D87B116Ba0fe898998f1D140339D1fA1E09705",
  "maxStaleness": 345600,
  "route": {
    "venue": "v4",
    "currency0": "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
    "currency1": "0x9D9c6684F596F66a64C030B93A886D51Fd4D7931",
    "fee": 9900,
    "tickSpacing": 99,
    "hooks": "0x0000000000000000000000000000000000000000",
    "source": "deepest hookless V4 USDG pool (355,242 USDG at current tick) 0x7c2f9ce1214ba9baf56d1b6a1fc640c1b63e9a711172c0c7d10e5a9c4a3d4f0c"
  },
  "slippageBps": 200
}

```

Measured feed history: 1034 rounds over 28.4 days; largest update gap 53.1h; proposed maxStaleness 96h.

Passed round-trip sizes (USDG): 10, 100, 1000. Total basket cap: not established.

Feed identity is inferred from the configured source vault or the public directory; confirm against Chainlink's official listing.

Staleness proposal is measured from a finite window of round history and floored at V1's 96h; longer market closures can still block mint/redeem.

Round trips prove integration at tested sizes only; they do not establish a safe basket cap.

V4 routes are executed on the fork but not depth-probed by direct router trades.
