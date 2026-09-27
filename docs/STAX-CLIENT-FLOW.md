# Stax V2 — client flow

## What is being built

Stax V2 is a new, non-upgradeable vault for new baskets on Robinhood Chain (chain ID 4663). At V2 launch, pause deposits into every V1 basket and keep V1 redemption available. Existing balances remain on V1; nothing migrates automatically. The frontend labels V1 withdrawals only and sends all new deposits to V2. Oracle and liquidity failures can still prevent a redemption from executing.

## Depositing and redeeming

1. **Deposit:** The user selects a basket, approves USDG spending by its vault, and submits a deposit with a minimum number of basket tokens and an expiry.
2. **Buy assets:** V2 checks basket limits, pricing and swap protections, deducts its 0.25% deposit fee, and buys the basket assets according to the configured weights.
3. **Receive shares:** The vault issues basket tokens based on the value actually acquired. An internal ledger records each basket's holdings, including when multiple baskets hold the same asset.
4. **Redeem:** The user submits basket tokens with a minimum USDG payout and an expiry. The vault burns those shares, sells their proportional holdings, deducts its 0.25% redemption fee, and pays USDG. Failed checks revert the whole transaction. DEX fees and network gas are additional costs.

## How prices are checked

Oracle selection follows approved feed availability, not asset class: assets with suitable Chainlink feeds use Chainlink; approved assets without them can use TWAP after validation. The current Chainlink branch retains its token oraclePaused check, so a feed alone does not establish compatibility. A separate TWAP registry that reads historical observations from a Uniswap V3 USDG pool. USDG/USD pricing converts this into dollar value; USDG is not assumed to remain exactly $1.

TWAP checks include sufficient history, observation freshness, current and historical liquidity, and spot-price deviation. Each token also has a configurable swap-slippage limit, capped at 5%; Chainlink registration defaults to 2%. These checks can block both deposits and redemptions. They do not eliminate sustained manipulation when pricing and execution use the same pool.

## What immutable means

V2 is deployed directly, without a proxy or upgrade function. Its code cannot be replaced at that address. The TWAP registry is also non-upgradeable. A code change requires a new contract deployment. Treasury and rewards destinations can be changed by the owner, including where accrued, unclaimed fees are paid. A sequencer feed can be enabled once if unset, then cannot be replaced or disabled.

The authorized owners still manage token registrations, feeds, TWAP parameters (including deviation limits), per-token slippage, approved routes, new baskets, caps and mint pauses. V2 can select a replacement registry for a TWAP token. Therefore, fixed code does not mean fixed pricing settings or removal of administrator trust. Incorrect oracle configuration can prevent redemption.

The preview views estimate shares or net USDG from oracle prices and the internal ledger. They include vault fees and rounding, but exclude DEX fees, price impact and future price changes. The frontend must combine these with execution quotes/simulation; they are not guaranteed minimums.

## Adding a token and launch status

First validate available feeds, token decimals, the real V3 USDG pool, observation history and liquidity/manipulation data. Establish reviewed risk parameters, configure its registry and vault route, then register pricing and create a basket. CASHCAT and PONS are the initial intended integrations, subject to those checks. V4 TWAP is deferred; existing V4 swap support is separate.

This is a local implementation, not a live deployment. Real-chain mint/redeem tests, token-specific risk validation, Dan's design and final Opus reviews, and frontend integration remain required before rollout.
