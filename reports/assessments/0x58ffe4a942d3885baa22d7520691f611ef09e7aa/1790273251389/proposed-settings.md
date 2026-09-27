# Proposed token settings

Status: PROPOSED_FOR_REVIEW

These are proposals for single-token baskets, not listing approval. No live transactions sent.

## Recommended candidate

Chainlink candidate passed feed/token checks, measured round-history staleness and V2 fork round trips. Feed identity, basket composition and caps still require review.

```json

{
  "token": "0x58FfE4a942d3885bAa22D7520691F611EF09e7AA",
  "pool": "0x07e8Ea83D4C1340774c8965125e26e12bf943bf1",
  "fee": 10000,
  "status": "PROPOSED_FOR_REVIEW",
  "params": {
    "feed": "0x874cF94aa8eC88Fd9560094dD065f2fB3E41Fc2F",
    "maxStaleness": 356400,
    "route": {
      "venue": "v3",
      "fee": 10000,
      "pool": "0x07e8Ea83D4C1340774c8965125e26e12bf943bf1",
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
  "feed": "0x874cF94aa8eC88Fd9560094dD065f2fB3E41Fc2F",
  "maxStaleness": 356400,
  "route": {
    "venue": "v3",
    "fee": 10000,
    "pool": "0x07e8Ea83D4C1340774c8965125e26e12bf943bf1",
    "source": "STAX_FORCE_V3_POOL override"
  },
  "slippageBps": 200
}

```

Measured feed history: 197 rounds over 30.2 days; largest update gap 79.1h; proposed maxStaleness 99h.

Passed round-trip sizes (USDG): 10, 100, 1000, 10000. Total basket cap: not established.

Feed identity is inferred from the configured source vault or the public directory; confirm against Chainlink's official listing.

Staleness proposal is measured from a finite window of round history and floored at V1's 96h; longer market closures can still block mint/redeem.

Round trips prove integration at tested sizes only; they do not establish a safe basket cap.

V4 routes are executed on the fork but not depth-probed by direct router trades.
