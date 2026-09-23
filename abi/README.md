# Deployed Stax V2 ABIs

Robinhood Chain mainnet (4663). Exported from the build deployed on 21 September 2026.

Frontend essentials: StaxVaultV2.json, StaxBasketToken.json, UnifiedTwapRegistry.json. Retain the existing V1 ABI and standard ERC20 ABI for USDG.

- V2 vault: 0xAda84161033C0Cc54EF21CEeF913A8fEC4239b33
- TWAP registry: 0xDb21d05dE573C537FaF5e1dB083a90F290EB75b0
- Route validator: 0xEE85B813740730f29fa20D8b7E5ded33a08c6dd5
- Basket token deployer: 0xC9F14d4e0Faefe3fD1033D84bf129D8767F4C3f9
- Preview helper: 0x7F191C0De99a30b20786FFf87B54d7a1bb0598Cc

Basket share-token instance addresses become available when baskets are created. The basket-token ABI alone does not identify a deployed share token.

## User-created baskets V2 (deployed 24 September 2026)

- Factory (StaxUserBasketFactoryV2.json): 0x1de6a6bD0C62097A7559A29a76e41985558f9918 — deploy block 70863402
- Basket clone (StaxUserBasketV2.json): every basket the factory creates; implementation 0x897513814ff94683A9Bca00E5d61993b90AAdc95 (never called directly)
- Share token (StaxUserBasketToken.json): plain ERC20, one per basket, address from BasketCreated.token or clone.token()

List baskets by indexing BasketCreated(clone, token, creator, name, symbol, tickers, weights) on the factory from block 70863402.
