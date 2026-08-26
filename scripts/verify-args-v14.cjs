// Constructor arguments for the confirmed v14 StaxVault deployment.
// All addresses pulled directly from the single continuous deploy log
// pasted into chat -- StaxVault at
// 0xA87E5C6C972cb680F59c24D9AA6136B0955478e8.
//
// Note: v14's constructor argument ORDER differs from v13 -- permit2
// was inserted right after universalRouter (not appended at the end),
// per the real contract definition. Order here must match exactly:
// teamWallet, staxToken, universalRouter, permit2, weth, ethUsdFeed,
// ethUsdMaxStaleness, sequencerUptimeFeed.
module.exports = [
    "0x375E296871a38900bbc2de32E37B2Ca181bd9d41", // _teamWallet
    "0xCECa5491a16ea73F29990313924285EEB9771e3b", // _staxToken (deployer placeholder)
    "0xf978C84a593b2E0185e3F2910358538292d53964", // _universalRouter
    "0x5b281a7ec69100dAE2d3b7AB6B73bF305E754A2a", // _permit2
    "0x4a427f852c2371c30F773368035E19050b23F1AC", // _weth
    "0x459e34d51e32e300340f613eaE0CBba938f7B7a4", // _ethUsdFeed
    3600,                                          // _ethUsdMaxStaleness
    "0xa84494BaE09f588c036439eBBe21839300EA0fEC", // _sequencerUptimeFeed
  ];
  