// Constructor arguments for the v10 StaxVault deployment, in the exact
// order the constructor expects:
//   (address _teamWallet, address _staxToken, address _swapRouter,
//    address _weth, address _ethUsdFeed, uint48 _ethUsdMaxStaleness,
//    address _sequencerUptimeFeed)
// All addresses pulled directly from tonight's actual deploy-testnet-v10.ts
// output for StaxVault at 0x62C641739c2317b740F5A18904311f5c4aD0DDb7.
module.exports = [
    "0x375E296871a38900bbc2de32E37B2Ca181bd9d41", // _teamWallet (real team wallet, the whole reason for v10)
    "0xCECa5491a16ea73F29990313924285EEB9771e3b", // _staxToken (deployer address, placeholder)
    "0x997d56783A5F26e3c269ee01048258e8f8B65e47", // _swapRouter (MockSwapRouter)
    "0xd07051cF71F700D4e2C5f0d66662C610cb5Edb30", // _weth (MockWETH)
    "0x811Db0512b95cb09A0c6386C17ac39BA6686b822", // _ethUsdFeed (ETH/USD MockPriceOracle)
    3600,                                          // _ethUsdMaxStaleness (ONE_HOUR)
    "0xc18EE06cf28c87f1A2549ccBce2C75cdd32784a3", // _sequencerUptimeFeed
  ];
  