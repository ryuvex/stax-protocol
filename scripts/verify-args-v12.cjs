// Constructor arguments for the confirmed v12 StaxVault deployment.
// All addresses pulled directly from the single continuous deploy log
// pasted into chat -- StaxVault at
// 0xF3cE0386FEf1cE4493bEd00caDE0A00D783666a6.
module.exports = [
    "0x375E296871a38900bbc2de32E37B2Ca181bd9d41", // _teamWallet
    "0xCECa5491a16ea73F29990313924285EEB9771e3b", // _staxToken (deployer placeholder)
    "0xEBdc8D2B4A08f37a0038Ebefba5b3BE63bb22D24", // _swapRouter
    "0xF9269C6E71a3af9B2384D7C11eA90D3DC828252D", // _weth
    "0x11dAbCa0373adB4DeA4582f3873E0C7E74434eDA", // _ethUsdFeed
    3600,                                          // _ethUsdMaxStaleness
    "0x4902e1CA5172A012EdB35Af5538c10C619F99083", // _sequencerUptimeFeed
  ];
  