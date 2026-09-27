# Proposed token settings

Status: PROPOSED_FOR_REVIEW

These are proposals for single-token baskets, not listing approval. No live transactions sent.

## Recommended candidate

Chainlink candidate passed feed/token checks, measured round-history staleness and V2 fork round trips. Feed identity, basket composition and caps still require review.

```json

{
  "token": "0x322F0929c4625eD5bAd873c95208D54E1c003b2d",
  "pool": null,
  "fee": 3000,
  "status": "PROPOSED_FOR_REVIEW",
  "params": {
    "feed": "0x4A1166a659A55625345e9515b32adECea5547C38",
    "maxStaleness": 352800,
    "route": {
      "venue": "v4",
      "currency0": "0x322F0929c4625eD5bAd873c95208D54E1c003b2d",
      "currency1": "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
      "fee": 3000,
      "tickSpacing": 60,
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
  "feed": "0x4A1166a659A55625345e9515b32adECea5547C38",
  "maxStaleness": 352800,
  "route": {
    "venue": "v4",
    "currency0": "0x322F0929c4625eD5bAd873c95208D54E1c003b2d",
    "currency1": "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
    "fee": 3000,
    "tickSpacing": 60,
    "hooks": "0x0000000000000000000000000000000000000000",
    "source": "0x13045d3dab253fdb15181c16f135d612fa8546e6"
  },
  "slippageBps": 200
}

```

Measured feed history: 356 rounds over 29.9 days; largest update gap 77.8h; proposed maxStaleness 98h.

Passed round-trip sizes (USDG): 10, 100, 1000, 10000. Total basket cap: not established.

Feed identity is inferred from the configured source vault or the public directory; confirm against Chainlink's official listing.

Staleness proposal is measured from a finite window of round history and floored at V1's 96h; longer market closures can still block mint/redeem.

Round trips prove integration at tested sizes only; they do not establish a safe basket cap.

V4 routes are executed on the fork but not depth-probed by direct router trades.
