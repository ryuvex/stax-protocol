// Constructor arguments for the v11 StaxVault deployment.
// All addresses pulled directly from tonight's deploy-testnet-v11.ts
// output for StaxVault at 0x576b931BA15B632003062403Dd194fC09eB9413c.
module.exports = [
    "0x375E296871a38900bbc2de32E37B2Ca181bd9d41", // _teamWallet
    "0xCECa5491a16ea73F29990313924285EEB9771e3b", // _staxToken (deployer placeholder)
    "0x6dC169E39587011Db1aAEDCf77561Ff6A5178c77", // _swapRouter
    "0x572566D6F47DB80ed44A6C9da45Cd60364a80c69", // _weth
    "0x631Bb33d28631Bf3d7eB9a38da520BB9d9f0E045", // _ethUsdFeed
    3600,                                          // _ethUsdMaxStaleness
    "0xf050ff4803c12B59B6651143fcF3aC1BbC8eC32d", // _sequencerUptimeFeed
  ];
  