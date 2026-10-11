# Proposed token settings

Status: PROPOSED_FOR_REVIEW

These are proposals for single-token baskets, not listing approval. No live transactions sent.

## Recommended candidate

Chainlink candidate passed feed/token checks, measured round-history staleness and V2 fork round trips. Feed identity, basket composition and caps still require review.

```json

{
  "token": "0xb0992820E760d836549ba69BC7598b4af75dEE03",
  "pool": null,
  "fee": 10000,
  "status": "PROPOSED_FOR_REVIEW",
  "params": {
    "feed": "0x0e6a64a2B58A6693a531E6c555f3A5d042eEA844",
    "maxStaleness": 345600,
    "route": {
      "venue": "v4",
      "currency0": "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
      "currency1": "0xb0992820E760d836549ba69BC7598b4af75dEE03",
      "fee": 10000,
      "tickSpacing": 200,
      "hooks": "0x0000000000000000000000000000000000000000",
      "source": "deepest hookless V4 USDG pool (808,331 USDG at current tick) 0xc2ce4784e1e72cf0221b51b30c8aaadf6c0b12863cf03ab3687854fb7b1d850a"
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
  "feed": "0x0e6a64a2B58A6693a531E6c555f3A5d042eEA844",
  "maxStaleness": 345600,
  "route": {
    "venue": "v4",
    "currency0": "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
    "currency1": "0xb0992820E760d836549ba69BC7598b4af75dEE03",
    "fee": 10000,
    "tickSpacing": 200,
    "hooks": "0x0000000000000000000000000000000000000000",
    "source": "deepest hookless V4 USDG pool (808,331 USDG at current tick) 0xc2ce4784e1e72cf0221b51b30c8aaadf6c0b12863cf03ab3687854fb7b1d850a"
  },
  "slippageBps": 200
}

```

Measured feed history: 526 rounds over 28.6 days; largest update gap 52.7h; proposed maxStaleness 96h.

Passed round-trip sizes (USDG): 10, 100, 1000. Total basket cap: not established.

Feed identity is inferred from the configured source vault or the public directory; confirm against Chainlink's official listing.

Staleness proposal is measured from a finite window of round history and floored at V1's 96h; longer market closures can still block mint/redeem.

Round trips prove integration at tested sizes only; they do not establish a safe basket cap.

V4 routes are executed on the fork but not depth-probed by direct router trades.
