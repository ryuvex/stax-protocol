# V2 token onboarding

Assess a token and its V3 USDG pools with no vault setup, then optionally prepare an admin registration plan after deployment and review. All modes read live state and write JSON files; **none signs or broadcasts live transactions**. Assessment deploys contracts and exercises baskets only on a disposable local fork. It does not change live contracts, funds, baskets or frontend configuration. Current scope is V3 execution with either Chainlink or TWAP pricing. V4-only pools are unsupported by this script; this does not remove existing Chainlink/V4 support in the vault.

## Normal use: automated assessment from the token address

```text
npm run onboard -- 0xTOKEN_ADDRESS
```

The default command runs **discovery, Robinhood Chainlink directory lookup, hourly history/deployment checks, and local-fork router/V2 probes**, saving one assessment report under `reports/assessments/<token>/<run>/assessment.json`. It does not read project.json or need a deployed V2. V2 is deployed temporarily only inside the simulated fork. It needs an RPC that serves the pinned block. No private key is used.

Use `npm run onboard -- 0xTOKEN_ADDRESS --discover` for the lightweight discovery-only report. This mode **does not read project.json or need V2**. It uses bundled Robinhood Chain discovery starting points and the public RPC. `STAX_RPC_URL` is an optional endpoint override. Node 24 and installed repository dependencies are required. Discovery verifies chain ID, deployed code, token/USDG decimals and factory/pool metadata on-chain. It reports pools at fee tiers 100/500/3000/10000, raw active liquidity, observation cardinality, available history and latest-observation age. Results are printed and saved under `discovery/` in this folder. A pool with zero active liquidity is reported honestly, not hidden or approved.

An optional read of the existing V1 priceFeeds mapping reports known feed candidates; lookup failure is reported separately from not-configured. This is NOT an exhaustive Chainlink search. Pool enumeration covers the listed factory/tiers, not all V3 factories, custom fee tiers or V4 pools. Available history is the time since the oldest initialized observation, not proof of meaningful trading or economic safety. Token symbols are display metadata only.

Neither assessment nor discovery generates live registration transactions. Assessment uses prominently labelled trial parameters (30-minute window, 5% deviation, minimal liquidity floors, 2% execution slippage) to test plumbing, not approve listing. It probes 10/100/1,000/10,000/50,000/100,000 USDG direct swaps and 10/100/1,000/10,000 USDG vault round trips. These sizes are diagnostic, not client-approved deposit caps. Isolated 30-minute manipulation scenarios omit competing arbitrage and extracted vault profit; they must not be treated as complete risk modelling.

The pipeline stops for Chainlink candidate review instead of selecting TWAP automatically; every active unlocked candidate pool is assessed independently, with separate snapshots and fork results under `pools/<pool-address>/`. A failed candidate does not prevent the others from being assessed. The combined report compares tested sizes, failures, depth and manipulation results; it does not automatically approve a pool. Deployment evidence mismatches block that candidate. Feed-directory failure is a blocker, not proof of no feed. No default run can approve listing or fabricate production safety settings, even if a project/approval file exists. Public RPC errors stop with a nonzero exit; missing V2 settings do not block discovery.

## Automatic proposed configurations

The default command also writes **`proposed-settings.json`** and a readable **`proposed-settings.md`** in the run folder, and prints proposed values at the end. These apply only to a single-token basket. They are not automatically copied into approval files or registered on-chain.

For each active V3 pool the command reads its complete retained observation ring, derives hourly harmonic liquidity, estimates tick-level spot/TWAP deviations, and measures stale intervals. At least 24 complete hours and 100 initialized observations are required. Unavailable RPC evidence does not become an invented configuration.

The declared heuristic policy tests 30-minute, 1-hour and 3-hour windows (at most three candidate forks per pool). Liquidity floors round the lowest measured hourly harmonic liquidity down to two significant digits. Maximum observation age equals the window. The deviation proposal rounds the observed 95th percentile up to 50-bps increments, with a 50-bps minimum and 200-bps policy ceiling. Execution slippage stays at 200 bps. Candidates exceeding 5% historical staleness blocking are rejected. These are explicit engineering proposal rules, not universally safe parameters; both the policy and measured trade-offs are included in the JSON.

Each surviving candidate is tested with its exact configuration: mint/redeem, one upward price-manipulation path, current/harmonic liquidity boundaries and stale-observation rejection. A proposal requires successful 10/100/1,000 USDG round trips, all three protection checks, and an unprofitable non-diluting completed attack or a recognized oracle rejection before attacker mint. A failed 10,000 USDG trial remains visible in the full report. Test sizes never become an automatic basket cap.

The final status is **`PROPOSED_FOR_REVIEW`**, **`INSUFFICIENT_EVIDENCE`**, or **`CHAINLINK_REVIEW_REQUIRED`**. Multiple qualifying pool/window alternatives are shown rather than silently choosing one. Historical staleness is time-based; deviation exceedances are observation samples and must not be interpreted as uptime. `listingApproved` stays false, and total basket cap stays unset. Chainlink candidates require feed verification; they are not silently routed to TWAP.

Run proposal regression checks with `node --test scripts/assessment/assessment.test.ts scripts/assessment/propose-settings.test.ts`.

## Registration planning is a separate explicit step

```text
npm run onboard -- 0xTOKEN_ADDRESS --plan
```

Only this mode requires one-time operator setup: copy `project.example.json` to `project.json`, fill independently reviewed V2 deployment addresses/hash/owner, USDG, router/factory/pool hash, optional TWAP registry and candidate sources, and set `STAX_RPC_URL`. V2 has not been deployed by this work; placeholders prevent accidental use of V1. `STAX_ONBOARDING_PROJECT` optionally selects another saved project file.

Plan mode searches configured fee tiers and saved feed catalogs/source vaults. For a new token it writes an unapproved draft and exits with code 2 (`NEEDS_REVIEW`). It never selects between multiple valid pools or infers TWAP from missing feed candidates. An authorized reviewer fills the generated `approval.json` with reviewed slippage, pricing/risk settings and evidence, then sets `approved` to true. Run the same `--plan` command again to recheck live state and export transactions. This is a local operational approval, not an on-chain signature or automated audit.

Files are stored beside the saved project configuration:

```text
tokens/<chain-id>/<vault>/<token>/approval.json
tokens/<chain-id>/<vault>/<token>/run-<timestamp>/discovery.json
tokens/<chain-id>/<vault>/<token>/run-<timestamp>/plan.json
tokens/<chain-id>/<vault>/<token>/run-<timestamp>/batch-1.safe.json
```

The normal owner can sign the raw calls in plan.json with their usual wallet. Safe files are optional exports, not a multisig requirement. No mode signs or sends transactions. Existing approval files are never overwritten; project settings and generated outputs are ignored by Git.

## Advanced explicit configuration

The original planner remains available: `npm run onboard:plan -- CONFIG.json [OUTPUT.json]`. Chainlink/TWAP example JSON files show the complete approved schema. They contain no production TWAP defaults. TWAP approvals use the registry/owner from the saved project; copy the safety object shape from `twap.example.json`. Liquidity floors are raw V3 liquidity, not dollar depth. Slippage is 1-500 bps; TWAP deviation is separate. RPC credentials stay in the environment; no private key is needed.

Outputs:

- A complete plan with the checked block/hash, inputs, review references, owner-labelled transactions and limitations.
- One `OUTPUT.batch-N.safe.json` file per consecutive owner batch, suitable for importing into Safe Transaction Builder. Check chain, destination owner/Safe and calldata before approval. An EOA owner can use the same raw transactions with its normal signing workflow; this script does not take a private key.

Execute batches in order. If registry and vault have different owners, the registry batch must confirm before vault activation. Re-run preflight against fresh state and fork-simulate the complete sequence before signing. No live onboarding has been performed or approved by generating a plan.

## Checks and ordering

The script pins reads to one block, checks chain ID, V2 bytecode, ownership, USDG and live/cached decimals, helper binding, validator deployment inputs, and the canonical V3 execution pool. USDG pricing must be available, including the vault's configured sequencer checks.

For Chainlink it checks feed freshness/positive answer/decimals and the token's oraclePaused method; tokens without that method are not compatible with the current Chainlink branch. Order: register pool, register feed (atomically sets 200 bps), optionally set reviewed nondefault slippage.

For TWAP it checks registry owner/quote asset/factory/settings and calls the actual registry configureToken through eth_call with its owner as `from`. This executes current history, observation age, liquidity and deviation validation without saving state. Order: configure registry, register pool, activate TWAP in V2. It is not an economic model or a full sequence simulation.

Identical existing steps are skipped so a partial registration can resume. Conflicting routes, oracle types, registry thresholds, feeds or existing slippage abort instead of overwriting shared configuration. If a Chainlink run stopped after registration at 200 bps but before its nondefault slippage step, finish the already-reviewed remaining step or review the conflict explicitly; the script does not assume that an existing slippage setting is accidental. No automatic Chainlink-to-TWAP fallback is provided.

## Manual gates remain

Review references are required in the config for token behaviour, router deployment, full real-chain round trips, Chainlink feed search and risk parameters. Nonempty references are operator attestations, **not proof that a review happened**. Verify the evidence before approving anything. TWAP must remain unregistered in production until per-token manipulation modelling and required reviews pass.

A successful current quote is not a guarantee of future redemption, price safety, depth at realistic sizes, or compatibility with transfer-tax/rebasing tokens. The generated dependent calls must be fork-simulated together. After registration, create a separately reviewed basket and add its vault/address/oracle metadata to the frontend; existing basket compositions are fixed.

## Local verification

```text
npm run typecheck:onboarding
npm run typecheck:assessment
node --test scripts/assessment/assessment.test.ts
npm run test:v2
```

The local onboarding tests assert that planning sends nothing, execute the exact generated calldata on the simulated chain for Chainlink and TWAP, resume partial registrations, reject unsafe/conflicting input and preserve owner-batch order. They include a subsequent local mint/redeem. They are not real Robinhood fork tests.
# Broadcast a recommended TWAP listing

Use Node.js 24. From the repository root, preview the transactions:

```powershell
npm run onboard:broadcast -- "PATH/TO/proposed-settings.json" --basket-id 1 --name "Stax AMC" --symbol sAMC --cap-usd 5000
```

This reads `recommendedSetting` and its adjacent pool snapshot, plus the archived V2 deployment manifest. It does not choose an alternative or invent a recommendation for older reports. The cap is in dollars; the script calculates a 15% per-deposit maximum and converts both to 18 decimals. Supply the agreed cap explicitly; this command does not calculate pool TVL.

To send, append `--broadcast`. The runner reads `../deployer-private-key.txt` in the parent Stax folder only when broadcasting; it never prints the key. An optional `STAX_PRIVATE_KEY` environment variable takes precedence. Optional `STAX_RPC_URL` overrides the Robinhood mainnet RPC. Never put the key in a command argument or commit it. Both contract owners must match the deployment manifest's deployer; ownership changes deliberately stop this runner.

The runner configures the existing registry, registers the existing V3 pool, enables TWAP, then creates the single-token basket. It rechecks live conditions and waits for each receipt. It records submitted/confirmed hashes beside the proposal. On interruption, check any pending hash before rerunning; confirmed matching steps are skipped, while conflicting settings or basket IDs stop execution. Dry-run mode checks preconditions but does not simulate the whole transaction sequence. An automated recommendation remains a review candidate, not listing approval.
