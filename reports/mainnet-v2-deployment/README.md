# Stax V2 deployed — Robinhood Chain 4663

All four deployments succeeded. Settings and ownership checked on-chain. Public source verification completed for all four contracts and the preview helper on Sourcify on 22 September 2026. Blockscout API returned HTTP 403; its own verification badge is not confirmed. No tokens or baskets registered; V1 is unchanged.

| Contract | Address | Deployment block |
|---|---|---|
| StaxBasketTokenDeployer | 0xC9F14d4e0Faefe3fD1033D84bf129D8767F4C3f9 | 68882760 |
| StaxV3RouteValidator | 0xEE85B813740730f29fa20D8b7E5ded33a08c6dd5 | 68882903 |
| UnifiedTwapRegistry | 0xDb21d05dE573C537FaF5e1dB083a90F290EB75b0 | 68883035 |
| StaxVaultV2 | 0xAda84161033C0Cc54EF21CEeF913A8fEC4239b33 | 68883165 |
| StaxVaultPreview (created by V2) | 0x7F191C0De99a30b20786FFf87B54d7a1bb0598Cc | 68883165 |

Current owner of vault and registry: 0x79F7c8aB5360c9902dD23ADf99cdAb54F2A6449D. Dan's intended future owner address: 0x2d713bbB76d08D1a94D68d944B5Eb0D163F1a524. Neither transfer has been initiated. Both require transferOwnership followed by Dan's acceptOwnership.

ABIs: [abi/](abi/). Receipts, hashes and constructor arguments: [deployment.json](deployment.json). Exact compiler outputs and contract artifacts: [build/](build/). Preview and basket-token ABIs are included; basket-token instances do not exist yet.

Source publication was initially deferred and subsequently authorized and completed on Sourcify. Fee destinations, dependencies, USDG decimals/staleness, unset sequencer feed and preview binding were checked. Additional audit and deployment rehearsal were waived by the user; this is not an audit certificate.

Remaining deployer balance after deployment: 0.003533870323242 ETH.

## Public verification

Repeat with Node 24: `npm run verify:deployed`. No private key required.

- [StaxBasketTokenDeployer](https://sourcify.dev/server/repo-ui/4663/0xC9F14d4e0Faefe3fD1033D84bf129D8767F4C3f9)
- [StaxV3RouteValidator](https://sourcify.dev/server/repo-ui/4663/0xEE85B813740730f29fa20D8b7E5ded33a08c6dd5)
- [UnifiedTwapRegistry](https://sourcify.dev/server/repo-ui/4663/0xDb21d05dE573C537FaF5e1dB083a90F290EB75b0)
- [StaxVaultV2](https://sourcify.dev/server/repo-ui/4663/0xAda84161033C0Cc54EF21CEeF913A8fEC4239b33)
- [StaxVaultPreview](https://sourcify.dev/server/repo-ui/4663/0x7F191C0De99a30b20786FFf87B54d7a1bb0598Cc)
