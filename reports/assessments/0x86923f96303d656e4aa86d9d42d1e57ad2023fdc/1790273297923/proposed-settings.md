# Proposed token settings

Status: PROPOSED_FOR_REVIEW

These are proposals for single-token baskets, not listing approval. No live transactions sent.

## Recommended candidate

Chainlink candidate passed feed/token checks, measured round-history staleness and V2 fork round trips. Feed identity, basket composition and caps still require review.

```json

{
  "token": "0x86923f96303D656E4aa86D9d42D1e57ad2023fdC",
  "pool": "0x48D284A2A4d3DC1b3Da08231Fe44317e7e7Aa51f",
  "fee": 3000,
  "status": "PROPOSED_FOR_REVIEW",
  "params": {
    "feed": "0x943A29E7ae51A4798823ca9eEd2ed533B2A22C72",
    "maxStaleness": 345600,
    "route": {
      "venue": "v3",
      "fee": 3000,
      "pool": "0x48D284A2A4d3DC1b3Da08231Fe44317e7e7Aa51f",
      "source": "STAX_FORCE_V3_POOL override"
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
  "feed": "0x943A29E7ae51A4798823ca9eEd2ed533B2A22C72",
  "maxStaleness": 345600,
  "route": {
    "venue": "v3",
    "fee": 3000,
    "pool": "0x48D284A2A4d3DC1b3Da08231Fe44317e7e7Aa51f",
    "source": "STAX_FORCE_V3_POOL override"
  },
  "slippageBps": 200
}

```

Measured feed history: 513 rounds over 30.0 days; largest update gap 76.1h; proposed maxStaleness 96h.

Passed round-trip sizes (USDG): 10, 100, 1000. Total basket cap: not established.

Feed identity is inferred from the configured source vault or the public directory; confirm against Chainlink's official listing.

Staleness proposal is measured from a finite window of round history and floored at V1's 96h; longer market closures can still block mint/redeem.

Round trips prove integration at tested sizes only; they do not establish a safe basket cap.

V4 routes are executed on the fork but not depth-probed by direct router trades.
