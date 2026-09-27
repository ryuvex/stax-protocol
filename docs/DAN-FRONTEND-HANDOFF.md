# Stax frontend handoff for Dan

21 September 2026 — frontend work can start against the local V2 ABI. V2 has not been deployed by this work; its production address and deployment block are pending.

## 1. Keep both vaults in the app

- Robinhood Chain: **4663**. Current V1 address: `0x13045D3Dab253fDB15181C16f135D612fa8546E6` (repository configuration; verify at rollout).
- At V2 launch, pause V1 deposits on-chain and label its baskets **Withdraw only**. Keep balances, redemption and history available. V1 exits still depend on working pricing and liquidity.
- All new deposits go to V2 baskets. Existing shares do not migrate automatically; users can withdraw USDG from V1 and choose to deposit into V2.
- Identify each basket by **chain ID + vault address + basket ID**. Keep separate V1/V2 ABIs and share-token addresses; do not simply replace the current global vault address.

## 2. Deposit and withdrawal screens

- Deposit: approve USDG to the selected V2 vault, then call `mint(basketId, usdgAmount, minSharesOut, deadline)`.
- Withdraw: call `redeem(basketId, sharesAmount, minUsdgOut, deadline)`. V2 burns the user's basket shares directly; no basket-token approval is required.
- Use `previewMint` and `previewRedeem` for estimates. They include the 0.25% vault fee per direction, but exclude DEX fees and price impact. Obtain an execution quote/simulation before setting user-approved minimums and a short expiry; do not use zero/one minimums as UI defaults.
- USDG uses 6 decimals; basket shares use 18. Read and verify token decimals and use integer amounts. Read caps and mint-paused state; show useful errors for expired quotes, unavailable pricing, insufficient liquidity and minimum-output failures.
- User minimum-output tolerance is separate from the vault's owner-configured per-token swap slippage.

## 3. Show the actual pricing source

- Read V2 `oracleSettings(token)`: `NONE = 0`, `CHAINLINK = 1`, `TWAP = 2`.
- Chainlink: show its icon and a verified feed link using `priceFeeds(token).feed`.
- TWAP: show a TWAP badge and the configured V3 pool link. Mixed baskets need per-token labels. Do not infer pricing from whether a token is a stock or crypto asset.
- V4 TWAP is deferred. A token without a Chainlink feed is only eligible for TWAP after a supported pool and safe configuration are approved.

## 4. Portfolio and backend tracking

- Start with `src/lib/vault.ts`, `positionEvents.ts`, `vaultEvents.ts`, and the cron routes `snapshot-nav.ts` / `update-leaderboard.ts`.
- Watch both vault addresses from their respective deployment blocks. Update database keys, backfill and duplicate handling; never merge unrelated shares by basket ID alone.
- Use current event ABIs: `Minted`, five-field `Redeemed`, and `FeeAccrued` where needed. `vaultEvents.ts` currently has an outdated four-field redemption definition.
- The repo uses **Vercel cron routes + Supabase**. `vercel.json` schedules NAV snapshots at 06:00 UTC and leaderboard updates at 07:00 UTC. Live hosting, scheduler status and credentials still need operator verification.

## 5. What remains before launch

Supply the verified V2 address, deployment block, final ABI, basket/share-token addresses and approved oracle metadata. Keep V2 transactions disabled until these are configured and release checks pass.

Token assessment now runs with `npm run onboard -- 0xTOKEN_ADDRESS`. It gathers discovery, history, depth and local-fork evidence; it does not list tokens automatically. CASHCAT passed tested mint/redeem sizes on the latest fork snapshot, but trial settings accepted sustained manipulation. CASHCAT/PONS must not be presented as approved listings; production risk settings and required reviews remain pending.
