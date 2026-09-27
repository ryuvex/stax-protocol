# Proposed token settings

Status: PROPOSED_FOR_REVIEW

These are proposals for single-token baskets, not listing approval. No live transactions sent.

## Recommended candidate

Chainlink candidate passed feed/token checks, measured round-history staleness and V2 fork round trips. Feed identity, basket composition and caps still require review.

```json

{
  "token": "0xad25Ac6C84D497db898fa1E8387bf6Af3532a1c4",
  "pool": "0xa57ab582b310dd6f9e934EA1EEEa152741545E6A",
  "fee": 3000,
  "status": "PROPOSED_FOR_REVIEW",
  "params": {
    "feed": "0x62Cc8F9b5f56a33c9C8A60c8B92779f523c4E984",
    "maxStaleness": 367200,
    "route": {
      "venue": "v3",
      "fee": 3000,
      "pool": "0xa57ab582b310dd6f9e934EA1EEEa152741545E6A",
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
  "feed": "0x62Cc8F9b5f56a33c9C8A60c8B92779f523c4E984",
  "maxStaleness": 367200,
  "route": {
    "venue": "v3",
    "fee": 3000,
    "pool": "0xa57ab582b310dd6f9e934EA1EEEa152741545E6A",
    "source": "deepest canonical V3 USDG pool (raw liquidity, not USD depth)"
  },
  "slippageBps": 200
}

```

Measured feed history: 308 rounds over 30.0 days; largest update gap 80.8h; proposed maxStaleness 102h.

Passed round-trip sizes (USDG): 10, 100, 1000, 10000. Total basket cap: not established.

Feed identity is inferred from the configured source vault or the public directory; confirm against Chainlink's official listing.

Staleness proposal is measured from a finite window of round history and floored at V1's 96h; longer market closures can still block mint/redeem.

Round trips prove integration at tested sizes only; they do not establish a safe basket cap.

V4 routes are executed on the fork but not depth-probed by direct router trades.
