
[hardhat-keystore] Enter the password: *********
Deploying StaxVault v17 (USDG migration) to testnet
  Full replacement of ETH deposits with USDG deposits, matching
  Robinhood Chain's real liquidity backbone -- confirmed via real
  mainnet data tonight that all 21 basket tickers have healthy,
  hookless liquidity paired against USDG, while WETH-paired pools
  were sparse-to-nonexistent or paired against the wrong asset
  entirely (SPY, unrelated Doppler-launch tokens).
  Uses a FRESH MOCK USDG for testnet (see design note above) --
  mainnet deploy MUST use the real confirmed mainnet USDG
  (0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168) and real feed
  (0x61B7e5650328764B076A108EFF5fa7282a1B9aD2), never this pattern.
with account: 0xCECa5491a16ea73F29990313924285EEB9771e3b
ETH balance: 0.998299649604589 ETH

Deploying shared infrastructure...
  Mock USDG (testnet): 0x60d07CaF6178283241Ba3f54F3681BBCdCE3B5Be
  MockPermit2: 0x6e1829278681ed7E6E20546C85Af41d58e849466
  MockUniversalRouter: 0xB378f8e096Fe40166F4BAE9a5afc36FE879Cc590
  USDG/USD MockPriceOracle (testnet-only): 0x5eee0ca0f3a0A71c65f45B8Fe945Aa9d18E3e584
  Sequencer MockPriceOracle: 0x6C65500A05e01b168c69Fb41c20B4c48f9E5aC58

Deploying StaxVault (v17)...
  StaxVault (v17): 0xDFdc474f54ECfDEBcEd8D79A6EF49E99197130F7

Seeding router with mock USDG for swap liquidity...
  Minted 1000000.0 USDG to router
  Minted 100000.0 USDG to deployer for testing

Deploying ticker mocks, registering feeds and pools...
  NVDA: token=0xd39F0Cfa70d6E18E51B8e762768C69216BfCCF08 feed=0x7c7c382E5b44d0c34539A0864F706B85078Ff23D ($150)
  AMD: token=0xf2EDC0abB5426AD527A2841548812BdaA212f371 feed=0x713c8de750Db9C53cB99cc3dC0d3ad63951A6C3c ($100)
  TSM: token=0xc59269298A9129DfCd25220d8B0aF39dC62487ab feed=0x73E9fC1f813329B42655EFbf1502d8364163F3d9 ($200)
  AAPL: token=0x5e8D4d0c2EDf4b90eDF2beB469d3f736Ce3DD293 feed=0xb9403F96c03240a908b8C1088C513FA752AB8Ebf ($200)
  MSFT: token=0xE9fcADfCaCA44ca5837f7D47359f5AAa320B4D7F feed=0x0E731cBA84B0b93F50FE6874d97228Fea0D61A28 ($400)
  GOOGL: token=0x3aA239927F206E7C949aECeF47AD7d215C4D302A feed=0x7A5d7b17bDaE339beae393f217E2Fd4FE61C6670 ($150)
  AMZN: token=0x7Faab086A983E5d56AA9C41DfA3Cb7AcDcB31fbf feed=0x0c259dFFd95A5e373eF13bF904cFdD217f7f7509 ($180)
  META: token=0x24973D521621699bc4CCDEcf4Ad9F8a3B52eE7e7 feed=0x1270E6A7D212992aF616b0453820fDe558C94Ba0 ($500)
  TSLA: token=0x38afB0f730Bb80f000D923c23372B86945e46346 feed=0x01bB94CBD754c21913597c329d79A750c8400da8 ($300)
  COIN: token=0x3F4f38a0F10607be5f172c92a57e8cb1A9D05DC5 feed=0x9175d02dd28493389fF39e58F7715362782a2127 ($250)
  MSTR: token=0x7E3633207A03268316Ca42b9447F6289F10072F1 feed=0x3C8b611DC6b537Ea7798A12C29BF03F9517a93ED ($300)
  CLSK: token=0xc53066d63E2d515099e23A0D2c45175eBB676047 feed=0xA2802B30405327a3914057178bcD85dBDc53c1AB ($10)
  CRCL: token=0x9f1E404a6a0572819f41441C45F52727aE8AbFe8 feed=0xee9165CDbc5BA1204f21722b66881665605C771F ($150)
  IONQ: token=0xB7049b1D0974Dc0239BbA15a7a4a308069366d36 feed=0x47e97202840199A1FF2520B0d456289a8E44c61f ($30)
  RGTI: token=0x827653dC201838eAB56a5F23abfA50a50716Ef03 feed=0x7A89E749b27a183825f583430309ad2CF06a9E11 ($10)
  RKLB: token=0xCDf47271b35Dc2a491Ba47C3f6aCAcf1bCE428Eb feed=0x44c869Bc5deb30048b331140c0B6Bd2a40f29593 ($20)
  SPCX: token=0xD11Ea056b0C898b579b8aDB35EBf2fe0981cf254 feed=0xca8397D72Bb68C454546eaEB8cBe08f5944765aC ($50)
  INTC: token=0xe570bB2D48fb74626e0dbCc42B565d431Ae43B07 feed=0xE10e11d8CeD13cB8c4697291230313080AD1f74E ($25)
  MU: token=0x7d18a8d1eC802e965dd35b331B7fA1f99C11E10A feed=0x6dd24F24c9b505bF5Cb3aCD3F8cD8666E8ECB877 ($100)
  ASML: token=0x0F329e8Cdc5F66dEE9e2700e1A663eFB43840100 feed=0xeB6c1CC7CC3Fa1daC07b0028370C16C3C53cA1c8 ($700)
  SNDK: token=0x7BE1abBED098F3dB017fc62476342825Dc02D110 feed=0xd0752d5C84e8079221062cdC8B4383D041362689 ($50)

Creating baskets...
  Basket 1 (AI Infrastructure / sAI) created
  Basket 2 (Mag 7 / sMAG7) created
  Basket 3 (Crypto Proxy Equities / sCRYPTO) created
  Basket 4 (Quantum Computing / sQNT) created
  Basket 5 (New Space / sSPACE) created
  Basket 6 (Broad Semiconductors / sSEMI) created

=== V17 TESTNET DEPLOYMENT COMPLETE ===
NEW StaxVault address: 0xDFdc474f54ECfDEBcEd8D79A6EF49E99197130F7

Changes in this version vs v15:
  - FULL deposit-asset migration: ETH -> real testnet USDG.
    mint() is no longer payable -- pulls USDG via
    approve/transferFrom. redeem() pays out USDG via safeTransfer.
  - receive() removed entirely -- vault holds no native ETH.
  - setTickerPool/updateTickerPool/setStaxSwapPool now enforce
    USDG-pairing at registration time (closes the wrong-currency
    pool bug class found during mainnet pool resolution tonight).
  - USDG decimals (6) read live at construction, validated the
    same way ticker decimals already were -- never hardcoded.
  - MIN_TOKENS_IN added on redeem, mirroring MIN_TOKENS_OUT.
  - Fee accounting, oracle reads, buy-burn all USDG-denominated.

Carried over, unchanged:
  - Two-pass deferred-credit CEI on both mint() and redeem()
  - oraclePaused() check, sequencer-optional pattern
  - Redeemed emits valueReturnedUsd; Minted emits usdgIn

Update VAULT_ADDRESS in src/lib/vault.ts to this new address.
Update VAULT_DEPLOY_BLOCK to the current block height.
Frontend deposit flow needs the approve-then-mint rework --
  still outstanding, separate from this contract deploy.
PS C:\Users\ASUS\Desktop\stax-protocol> 