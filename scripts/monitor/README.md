# Stax basket monitor

Read-only. Every 2 minutes it prices every leg of every basket (official V2 baskets + user-basket clones) through `StaxVaultV2.getOraclePriceUsd18` and posts to Slack **only when a basket changes state**:

- 🔴 `<basket> blocked` — failing tokens with the decoded error, the live numbers behind it, and the `registry:floor` command that would unblock it (re-assess before broadcasting).
- 🟢 `<basket> recovered after N min`
- ⚠️ once if the RPC is unreachable 3 ticks in a row, 🟢 once when it's back.
- 👀 one line on first start.

No warnings, no per-tick messages. Mint-paused baskets are skipped (set `STAX_MONITOR_INCLUDE_PAUSED=1` to include).

## Run
```
cp scripts/monitor/.env.example .env    # or add the vars to the existing .env
npm run monitor                          # foreground
pm2 start scripts/monitor/ecosystem.config.cjs && pm2 save   # 24/7
```
Env: `STAX_RPC_URL`; Slack one of: `STAX_SLACK_WEBHOOK`, or `STAX_SLACK_BOT_TOKEN`+`STAX_SLACK_CHANNEL`, or a rotating OAuth token (`.slack-tokens.local.json` with `access_token`/`refresh_token`, plus `STAX_SLACK_CLIENT_ID`/`STAX_SLACK_CLIENT_SECRET`/`STAX_SLACK_CHANNEL` — the script refreshes and rewrites the file); optional `STAX_MONITOR_INTERVAL_SEC` (default 120), `STAX_MONITOR_STATE` (default `reports/monitor/state.json`).

State survives restarts (`reports/monitor/state.json`), so a restart does not re-alert already-known blocked baskets.
