# Proposed token settings

Status: PROPOSED_FOR_REVIEW

These are proposals for single-token baskets, not listing approval. No live transactions sent.

## Recommended candidate

Chainlink candidate passed feed/token checks, measured round-history staleness and V2 fork round trips. Feed identity, basket composition and caps still require review.

```json

{
  "token": "0xC9a981FEE1F9DEc688bb123ccDeCc63D0deBFC4e",
  "pool": "0xBA2f1ed4cEB2169D538d1e614D847E83C5A55913",
  "fee": 500,
  "status": "PROPOSED_FOR_REVIEW",
  "params": {
    "feed": "0x470A51258068043bd43dC0a56245625C9fE86eB0",
    "maxStaleness": 345600,
    "route": {
      "venue": "v3",
      "fee": 500,
      "pool": "0xBA2f1ed4cEB2169D538d1e614D847E83C5A55913",
      "source": "deepest canonical V3 USDG pool (raw liquidity, not USD depth)"
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
  "feed": "0x470A51258068043bd43dC0a56245625C9fE86eB0",
  "maxStaleness": 345600,
  "route": {
    "venue": "v3",
    "fee": 500,
    "pool": "0xBA2f1ed4cEB2169D538d1e614D847E83C5A55913",
    "source": "deepest canonical V3 USDG pool (raw liquidity, not USD depth)"
  },
  "slippageBps": 200
}

```

Measured feed history: 14 rounds over 5.0 days; largest update gap 24.0h; proposed maxStaleness 96h.

Passed round-trip sizes (USDG): 10, 100, 1000, 10000. Total basket cap: not established.

Feed identity is inferred from the configured source vault or the public directory; confirm against Chainlink's official listing.

Staleness proposal is measured from a finite window of round history and floored at V1's 96h; longer market closures can still block mint/redeem.

Round trips prove integration at tested sizes only; they do not establish a safe basket cap.

V4 routes are executed on the fork but not depth-probed by direct router trades.
