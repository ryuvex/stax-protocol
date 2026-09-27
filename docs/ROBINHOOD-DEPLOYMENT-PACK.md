# Robinhood empty V2 deployment pack

Deployment completed 21 September 2026 under explicit user authorization. See [deployed addresses, ABIs and receipts](../reports/mainnet-v2-deployment/README.md). The preparation notes below are historical; no tokens or baskets were registered. Additional audit and rehearsal were explicitly waived.

## Wallets

- New deployer: `0x79F7c8aB5360c9902dD23ADf99cdAb54F2A6449D`.
- Dan's owner address: pending; user will supply before handover. The deployer remains owner until Dan accepts ownership of both vault and registry. No public launch before handover completes.
- Treasury observed on V1: `0xFF843Bc76C276086569D081E02DAC467C2aDa5cE` — confirmed by user for V2.
- Rewards observed on V1: `0xc02F399cBbF90CEc6DD3a7c2D90fcA84C0a3a5ad` — confirmed by user for V2.

The deployer encrypted JSON is in `C:/Users/GNG/Desktop/Stax/.deployment-wallet`, outside the repositories, restricted to the isolated Windows signing account (CodexSandboxOffline). Its encryption password is protected by Windows DPAPI in `unlock.dpapi`; no private key or seed was printed. Recovery currently depends on that isolated Windows account/profile. Signing uses that account; network broadcasting uses the regular account. Arrange a recoverable secure backup before funding. Dan's owner key never enters our tooling.

## Network and dependency inputs

Robinhood mainnet chain ID **4663**, RPC `https://rpc.mainnet.chain.robinhood.com`, gas currency **ETH**. [Official wallet settings](https://docs.robinhood.com/chain/add-network-to-wallet/).

Read-only evidence at block **68871652**, including block hash, code hashes, feed data and constructors: [evidence.json](../reports/deployment-preparation/evidence.json).

| Input | Value / status |
|---|---|
| Universal Router | `0x8876789976dEcBfCbBbe364623C63652db8C0904` |
| Permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` |
| USDG | `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168`; 6 decimals checked |
| USDG/USD feed | `0x61B7e5650328764B076A108EFF5fa7282a1B9aD2`; 8 decimals; directory proxy match |
| USDG maximum staleness | 97,200 seconds (27 hours), existing V1 value; directory heartbeat is 86,400 seconds |
| V3 factory | `0x1f7d7550B1b028f7571E69A784071F0205FD2EfA` |
| V3 pool init-code hash | `0xe34f199b19b2b4f47f68442619d555527d244f78a3297ea89325f843f87b8b54` |
| Sequencer feed | V1 is zero; proposed V2 zero subject to documented risk decision |

USDG feed answer was 99,999,143 with 8 decimals; age 82,633 seconds, within V1's staleness limit at the recorded block. Refresh at deployment. Directory identity and heartbeat are recorded in evidence; observing V1 does not authenticate every dependency.

Router/factory/hash inputs CONFIRMED at Robinhood block 68878528. Live router runtime exactly matches the Sourcify verified runtime. Source AST reproduced using Solidity 0.8.26 maps immutable IDs to UNISWAP_V3_FACTORY and UNISWAP_V3_POOL_INIT_CODE_HASH; their exact live bytecode values match the inputs above. Verified recompiled runtime matches live runtime after immutable substitution. CREATE2 derivations match three deployed factory pools (fees 500, 3000, 10000). Evidence: [confirmed-inputs.json](../reports/deployment-preparation/provenance/confirmed-inputs.json). Sourcify lacks the original creation transaction; the values are confirmed from deployed immutable bytes, not a recovered constructor transaction. This closes input correspondence verification, not a full dependency audit.

[Chainlink's sequencer documentation](https://docs.chain.link/data-feeds/l2-sequencer-feeds) does not list Robinhood and now says expansion to additional networks has stopped. Do not promise a future Chainlink feed. The existing set-once setter can enable a separately authenticated compatible feed later; zero means sequencer protection is absent.

## Deployment order and exact constructor inputs

1. `StaxBasketTokenDeployer()` — no owner.
2. `StaxV3RouteValidator(router, factory, poolInitCodeHash)` — no owner; verify immutable inputs first.
3. `UnifiedTwapRegistry(deployer, USDG, factory)` — empty registry.
4. `StaxVaultV2(deployer, tokenDeployer, [], rewards, treasury, router, permit2, USDG, USDG_USD_FEED, 97200, sequencerFeed, validator)` — empty legacy ticker array; no baskets. Constructor creates its own fixed preview helper.
5. On each of registry and vault: deployer calls `transferOwnership(Dan)`; Dan calls `acceptOwnership()`. Verify both owners equal Dan and both pending owners are zero.

Four deployment transactions plus two transfer initiations and two acceptance transactions. No token registration, basket creation, STAX buy-burn setup, V1 pause, or public source publication in this phase. Fund deployer and Dan's accepting wallet with chain-local ETH after estimating the exact transactions; no amount is guessed here. Do not run the old v19 deployment script: it registers tokens and baskets.

## Build and frontend deliverables

Compilation passed: Solidity 0.8.28, viaIR, optimizer 10 runs, Cancun. Runtime bytes: V2 24,549 (only 27 bytes below EIP-170); registry 6,970; validator 2,324; basket deployer 3,405; preview helper 3,535.

Current compiled ABI JSON files are in [abi/](../reports/deployment-preparation/abi/), including the future basket share-token interface. They are local-build ABIs, not evidence of deployed contracts. Archive the reviewed build and refresh ABI/size evidence after any source change.

After deployment, record receipts, actual addresses, block numbers, runtime hashes, constructor inputs, preview binding and ownership acceptance. Supply these plus ABIs to Dan. Basket IDs and share addresses are supplied only when baskets are later created. Public explorer source publication can wait; local deployment verification cannot.

## Still needed before broadcast

- Treasury/rewards confirmed. Dan supplies ownership destination before handover.
- User explicitly waived the additional audit; no new audit approval is claimed. Router/factory/hash input verification completed as recorded above.
- Confirm sequencer-zero risk decision and USDG staleness setting.
- Freeze reviewed build, rehearse the exact empty deployment/handover, estimate fees and verify wallet funding. Those exact deployment rehearsal/fee checks have not been performed in this preparation step.
- Token-specific modelling and full-size mint/redeem checks remain separate gates before later registrations.
