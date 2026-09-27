# Proposed token settings

Status: PROPOSED_FOR_REVIEW

These are proposals for single-token baskets, not listing approval. No live transactions sent.

## Recommended candidate

Chainlink candidate passed feed/token checks, measured round-history staleness and V2 fork round trips. Feed identity, basket composition and caps still require review.

```json

{
  "token": "0xa30FA36Db767ad9eD3f7a60fC79526fB4d56D344",
  "pool": "0x02175608F1b5E6b5ed221cCFdC7Be197D111D915",
  "fee": 3000,
  "status": "PROPOSED_FOR_REVIEW",
  "params": {
    "feed": "0x75a9c76Ef439e2C7c2E5a34Ab105EcFe3766431c",
    "maxStaleness": 345600,
    "route": {
      "venue": "v3",
      "fee": 3000,
      "pool": "0x02175608F1b5E6b5ed221cCFdC7Be197D111D915",
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


## Chainlink route (v3)

```json

{
  "feed": "0x75a9c76Ef439e2C7c2E5a34Ab105EcFe3766431c",
  "maxStaleness": 345600,
  "route": {
    "venue": "v3",
    "fee": 3000,
    "pool": "0x02175608F1b5E6b5ed221cCFdC7Be197D111D915",
    "source": "0x13045d3dab253fdb15181c16f135d612fa8546e6"
  },
  "slippageBps": 200
}

```

Measured feed history: 459 rounds over 30.0 days; largest update gap 75.4h; proposed maxStaleness 96h.

Passed round-trip sizes (USDG): 10, 100, 1000, 10000. Total basket cap: not established.

Feed identity is inferred from the configured source vault or the public directory; confirm against Chainlink's official listing.

Staleness proposal is measured from a finite window of round history and floored at V1's 96h; longer market closures can still block mint/redeem.

Round trips prove integration at tested sizes only; they do not establish a safe basket cap.

V4 routes are executed on the fork but not depth-probed by direct router trades.
