# Proposed token settings

Status: PROPOSED_FOR_REVIEW

These are proposals for single-token baskets, not listing approval. No live transactions sent.

## Recommended candidate

Chainlink candidate passed feed/token checks, measured round-history staleness and V2 fork round trips. Feed identity, basket composition and caps still require review.

```json

{
  "token": "0xdF0992E440dD0be65BD8439b609d6D4366bf1CB5",
  "pool": "0x654E4143e82a5824445Ade0824351C2A9ACD95a8",
  "fee": 3000,
  "status": "PROPOSED_FOR_REVIEW",
  "params": {
    "feed": "0x6652eDf64bA3731C4F2D3ce821A0Fb1f1f6b482a",
    "maxStaleness": 349200,
    "route": {
      "venue": "v3",
      "fee": 3000,
      "pool": "0x654E4143e82a5824445Ade0824351C2A9ACD95a8",
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
  "feed": "0x6652eDf64bA3731C4F2D3ce821A0Fb1f1f6b482a",
  "maxStaleness": 349200,
  "route": {
    "venue": "v3",
    "fee": 3000,
    "pool": "0x654E4143e82a5824445Ade0824351C2A9ACD95a8",
    "source": "STAX_FORCE_V3_POOL override"
  },
  "slippageBps": 200
}

```

Measured feed history: 1352 rounds over 30.0 days; largest update gap 77.4h; proposed maxStaleness 97h.

Passed round-trip sizes (USDG): 10, 100, 1000, 10000. Total basket cap: not established.

Feed identity is inferred from the configured source vault or the public directory; confirm against Chainlink's official listing.

Staleness proposal is measured from a finite window of round history and floored at V1's 96h; longer market closures can still block mint/redeem.

Round trips prove integration at tested sizes only; they do not establish a safe basket cap.

V4 routes are executed on the fork but not depth-probed by direct router trades.
