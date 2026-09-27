# AMC-only basket: focused risk check

21 September 2026. Scope limited to keep time/cost bounded. No live registration or configuration changes.

Pool: `0xaA34feA710a1A737840329051D81D3B0B7C564d5` (AMC/USDG V3, 0.3%). User confirmed an AMC-only basket. Results must not be reused for a mixed basket.

## Evidence

Earlier assessment: 72 hourly TWAP samples; hourly log-return standard deviation about 0.151%, maximum absolute hourly log return about 0.580%. These averages smooth intrahour moves. Mint/redeem passed at 10, 100, 1,000 and 10,000 USDG on that snapshot. A 10,000 USDG direct buy moved spot about 0.247%; 100,000 USDG moved it about 4.067%. These are snapshot measurements, not guaranteed future depth.

Fresh targeted fork: block **68900915**. The older snapshot's additional storage reads failed because the public RPC no longer served that historical state; those incomplete attempts are archived separately.

Three scenarios used 15-, 30- and 60-minute windows, a 1% deviation limit, and maximum observation age equal to the window. Liquidity floors remained at the trial value of 1 to isolate price/ownership effects; these are explicitly not production floors.

Each scenario seeded a victim's AMC-only basket with 10,000 USDG, then had an attacker buy 100,000 USDG of AMC, hold the changed price for the window, refresh observations with another 1,000 USDG trade, deposit 1,000 USDG, unwind the external AMC inventory, and attempt redemption. If immediate redemption reverted, the script waited another window and refreshed observations before retrying. Small refresh trades and their fees are included in the final cash balance.

| Result | 15 minutes | 30 minutes | 60 minutes |
|---|---:|---:|---:|
| Change in victim's underlying AMC claim at attacker mint | 0 | 0 | 0 |
| Attacker net USDG profit, excluding gas | -615.744543 | -615.744543 | -615.744543 |
| Immediate attacker redemption after price unwind | Reverted | Reverted | Reverted |
| Redemption after waiting and refreshing observations | Passed | Passed | Passed |

Victim ultimately redeemed 9,891.247464 USDG in each scenario. This is cash after trading/vault costs and changed pool state; the measured zero change in underlying claim is the evidence against dilution in this specific attack.

## Interpretation and limits

In an AMC-only basket, the same token price enters the value of newly acquired tokens and existing basket NAV. With the same price, those price factors cancel in the share ratio apart from virtual-unit/rounding terms. The exact tested attack did not dilute the victim's AMC claim and was unprofitable. This is materially different from a mixed basket.

All windows produced identical cash outcomes because the isolated simulation had no external arbitrage, financing costs or independent price changes while waiting. It does not establish that the windows have equal real-world security. A 1% deviation limit also temporarily blocked redemption after the price unwind: tighter limits have an availability cost.

This bounded check did not cover downward attacks, sandwiches, repeated/adaptive strategies, adversarial LP withdrawal, prolonged quiet markets, or the full invariant campaign. User minimum outputs were 1 for diagnostic execution, not proposed UI limits. No profitable attack in three scenarios is not proof of general safety.

## Listing decision

AMC is a viable candidate for further configuration work; it is **not automatically cleared** by these results. There is not yet enough evidence to select final liquidity floors or observation-age availability limits. Do not register using the trial floors. A tested trade size is not automatically a justified total basket cap. Final settings/caps remain unset.

Raw results: [fork-results.json](../reports/amc-focused-risk/fork-results.json). Fresh pinned inputs: [snapshot.json](../reports/amc-focused-risk/snapshot.json).

Dan's separate Chainlink expansion: use authenticated Chainlink feeds where available, check supported execution liquidity, and require token-specific mint/redeem checks before listing. Chainlink presence does not by itself establish token/interface compatibility or sell-side liquidity. It does not require choosing TWAP parameters for those tokens.
