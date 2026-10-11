# Proposed token settings

Status: PROPOSED_FOR_REVIEW

These are proposals for single-token baskets, not listing approval. No live transactions sent.

## Recommended candidate

Chainlink candidate passed feed/token checks, measured round-history staleness and V2 fork round trips. Feed identity, basket composition and caps still require review.

```json

{
  "token": "0x5f10A1C971B69e47e059e1dC91901B59b3fB49C3",
  "pool": null,
  "fee": 9000,
  "status": "PROPOSED_FOR_REVIEW",
  "params": {
    "feed": "0xe1b3aABCAFAd1c94708dc1367dcfF8Aa4407487C",
    "maxStaleness": 345600,
    "route": {
      "venue": "v4",
      "currency0": "0x5f10A1C971B69e47e059e1dC91901B59b3fB49C3",
      "currency1": "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
      "fee": 9000,
      "tickSpacing": 90,
      "hooks": "0x0000000000000000000000000000000000000000",
      "source": "deepest hookless V4 USDG pool (305,007 USDG at current tick) 0x237014478f7ef98afbe7412ac35b6a3f96b8fb111de48b7c4dbf49dba4bd9c4b"
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
  "feed": "0xe1b3aABCAFAd1c94708dc1367dcfF8Aa4407487C",
  "maxStaleness": 345600,
  "route": {
    "venue": "v4",
    "currency0": "0x5f10A1C971B69e47e059e1dC91901B59b3fB49C3",
    "currency1": "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
    "fee": 9000,
    "tickSpacing": 90,
    "hooks": "0x0000000000000000000000000000000000000000",
    "source": "deepest hookless V4 USDG pool (305,007 USDG at current tick) 0x237014478f7ef98afbe7412ac35b6a3f96b8fb111de48b7c4dbf49dba4bd9c4b"
  },
  "slippageBps": 200
}

```

Measured feed history: 958 rounds over 28.4 days; largest update gap 52.4h; proposed maxStaleness 96h.

Passed round-trip sizes (USDG): 10, 100, 1000. Total basket cap: not established.

Feed identity is inferred from the configured source vault or the public directory; confirm against Chainlink's official listing.

Staleness proposal is measured from a finite window of round history and floored at V1's 96h; longer market closures can still block mint/redeem.

Round trips prove integration at tested sizes only; they do not establish a safe basket cap.

V4 routes are executed on the fork but not depth-probed by direct router trades.
