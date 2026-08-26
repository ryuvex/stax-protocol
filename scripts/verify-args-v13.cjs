// Constructor arguments for the confirmed v13 StaxVault deployment.
// All addresses pulled directly from the single continuous deploy log
// pasted into chat -- StaxVault at
// 0xE5c681cF88F6E0B0c9a033059A2eD6511Fb60aeb.
module.exports = [
    "0x375E296871a38900bbc2de32E37B2Ca181bd9d41", // _teamWallet
    "0xCECa5491a16ea73F29990313924285EEB9771e3b", // _staxToken (deployer placeholder)
    "0x90fF8b547800b7A06358670Ae6eFdC50A8C18C91", // _swapRouter
    "0x90B01ddC38110Ed0D591b200040792688fd8B0FB", // _weth
    "0xaa68d422c4365e98680686045a0D6A7864B4488D", // _ethUsdFeed
    3600,                                          // _ethUsdMaxStaleness
    "0xce07C22723E8200e242FCe234407E3026d2D49a0", // _sequencerUptimeFeed (real mock, this deploy -- v13 makes address(0) ALLOWED, doesn't require this specific deploy to use it)
  ];
  