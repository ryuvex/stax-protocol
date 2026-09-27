# Proposed token settings

Status: PROPOSED_FOR_REVIEW

These are proposals for single-token baskets, not listing approval. No live transactions sent.

## Recommended candidate

Chainlink candidate passed feed/token checks, measured round-history staleness and V2 fork round trips. Feed identity, basket composition and caps still require review.

```json

{
  "token": "0x47F93d52cBeC7C6D2CfC080e154002370a60dAEA",
  "pool": "0xedb22516B14Eb2d1C86927Db373B0E8bF70F5cD1",
  "fee": 10000,
  "status": "PROPOSED_FOR_REVIEW",
  "params": {
    "feed": "0xB4106147E8cce40b7d46124090d373A71b70f87D",
    "maxStaleness": 345600,
    "route": {
      "venue": "v3",
      "fee": 10000,
      "pool": "0xedb22516B14Eb2d1C86927Db373B0E8bF70F5cD1",
      "source": "deepest canonical V3 USDG pool (raw liquidity, not USD depth)"
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


## Chainlink route (v3)

```json

{
  "feed": "0xB4106147E8cce40b7d46124090d373A71b70f87D",
  "maxStaleness": 345600,
  "route": {
    "venue": "v3",
    "fee": 10000,
    "pool": "0xedb22516B14Eb2d1C86927Db373B0E8bF70F5cD1",
    "source": "deepest canonical V3 USDG pool (raw liquidity, not USD depth)"
  },
  "slippageBps": 200
}

```

Measured feed history: 356 rounds over 29.9 days; largest update gap 76.2h; proposed maxStaleness 96h.

Passed round-trip sizes (USDG): 10, 100, 1000. Total basket cap: not established.

Feed identity is inferred from the configured source vault or the public directory; confirm against Chainlink's official listing.

Staleness proposal is measured from a finite window of round history and floored at V1's 96h; longer market closures can still block mint/redeem.

Round trips prove integration at tested sizes only; they do not establish a safe basket cap.

V4 routes are executed on the fork but not depth-probed by direct router trades.
