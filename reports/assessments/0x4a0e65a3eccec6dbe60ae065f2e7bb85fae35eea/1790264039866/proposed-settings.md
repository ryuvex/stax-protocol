# Proposed token settings

Status: PROPOSED_FOR_REVIEW

These are proposals for single-token baskets, not listing approval. No live transactions sent.

## Recommended candidate

Chainlink candidate passed feed/token checks, measured round-history staleness and V2 fork round trips. Feed identity, basket composition and caps still require review.

```json

{
  "token": "0x4a0E65A3EcceC6dBe60AE065F2e7bb85Fae35eEa",
  "pool": null,
  "fee": 10000,
  "status": "PROPOSED_FOR_REVIEW",
  "params": {
    "feed": "0xB265810950ba6c5C0Ff821c9963014a56fD8Bffb",
    "maxStaleness": 345600,
    "route": {
      "venue": "v4",
      "currency0": "0x4a0E65A3EcceC6dBe60AE065F2e7bb85Fae35eEa",
      "currency1": "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
      "fee": 10000,
      "tickSpacing": 200,
      "hooks": "0x0000000000000000000000000000000000000000",
      "source": "0x13045d3dab253fdb15181c16f135d612fa8546e6"
    },
    "slippageBps": 200
  },
  "listingApproved": false,
  "passedRoundTripSizesUsdg": [
    10,
    100,
    1000,
    10000
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
  "feed": "0xB265810950ba6c5C0Ff821c9963014a56fD8Bffb",
  "maxStaleness": 345600,
  "route": {
    "venue": "v4",
    "currency0": "0x4a0E65A3EcceC6dBe60AE065F2e7bb85Fae35eEa",
    "currency1": "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
    "fee": 10000,
    "tickSpacing": 200,
    "hooks": "0x0000000000000000000000000000000000000000",
    "source": "0x13045d3dab253fdb15181c16f135d612fa8546e6"
  },
  "slippageBps": 200
}

```

Measured feed history: 494 rounds over 30.0 days; largest update gap 76.1h; proposed maxStaleness 96h.

Passed round-trip sizes (USDG): 10, 100, 1000, 10000. Total basket cap: not established.

Feed identity is inferred from the configured source vault or the public directory; confirm against Chainlink's official listing.

Staleness proposal is measured from a finite window of round history and floored at V1's 96h; longer market closures can still block mint/redeem.

Round trips prove integration at tested sizes only; they do not establish a safe basket cap.

V4 routes are executed on the fork but not depth-probed by direct router trades.
