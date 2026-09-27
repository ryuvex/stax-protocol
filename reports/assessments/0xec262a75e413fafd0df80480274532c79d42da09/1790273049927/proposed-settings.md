# Proposed token settings

Status: PROPOSED_FOR_REVIEW

These are proposals for single-token baskets, not listing approval. No live transactions sent.

## Recommended candidate

Chainlink candidate passed feed/token checks, measured round-history staleness and V2 fork round trips. Feed identity, basket composition and caps still require review.

```json

{
  "token": "0xec262a75e413fAfD0dF80480274532C79D42da09",
  "pool": "0x17578C0e0D15da44f31677263114F71aE76653EA",
  "fee": 10000,
  "status": "PROPOSED_FOR_REVIEW",
  "params": {
    "feed": "0x396118bdFB181e6240E74D243F266B061c0edc3D",
    "maxStaleness": 345600,
    "route": {
      "venue": "v3",
      "fee": 10000,
      "pool": "0x17578C0e0D15da44f31677263114F71aE76653EA",
      "source": "STAX_FORCE_V3_POOL override"
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
  "feed": "0x396118bdFB181e6240E74D243F266B061c0edc3D",
  "maxStaleness": 345600,
  "route": {
    "venue": "v3",
    "fee": 10000,
    "pool": "0x17578C0e0D15da44f31677263114F71aE76653EA",
    "source": "STAX_FORCE_V3_POOL override"
  },
  "slippageBps": 200
}

```

Measured feed history: 1250 rounds over 30.0 days; largest update gap 74.0h; proposed maxStaleness 96h.

Passed round-trip sizes (USDG): 10, 100, 1000, 10000. Total basket cap: not established.

Feed identity is inferred from the configured source vault or the public directory; confirm against Chainlink's official listing.

Staleness proposal is measured from a finite window of round history and floored at V1's 96h; longer market closures can still block mint/redeem.

Round trips prove integration at tested sizes only; they do not establish a safe basket cap.

V4 routes are executed on the fork but not depth-probed by direct router trades.
