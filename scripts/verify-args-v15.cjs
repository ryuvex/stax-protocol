// Constructor arguments for the confirmed v15 StaxVault deployment.
// All values read DIRECTLY from the live on-chain contract via its
// public immutable getters (scripts/read-v15-constructor-args.ts),
// not from a deploy log -- ground truth, not transcription.
//
// FLAG: sequencerUptimeFeed is NOT address(0) here, despite the
// contract's own design note stating v13+ deploys should pass
// address(0) since Chainlink has not published a sequencer feed for
// Robinhood Chain. This needs resolving before mainnet -- see chat.
module.exports = [
    "0x375E296871a38900bbc2de32E37B2Ca181bd9d41", // _teamWallet
    "0xCECa5491a16ea73F29990313924285EEB9771e3b", // _staxToken (deployer placeholder)
    "0xd706bc07fe71549FE45EF48771C8cd2b567bce0d", // _universalRouter
    "0xa7b01a2e966d0DfAD87b1cEF9f0273683a5EFA02", // _permit2
    "0xe822B51B7e78c5B7B029F14174a161678d4f813B", // _weth
    "0x3d39F6fBB5ddDA1A3eAD7e56A09b7b4647d7cFfe", // _ethUsdFeed
    3600,                                          // _ethUsdMaxStaleness
    "0x0952621d4a4eEF3Aa659edBd98669dF2689DBEaA", // _sequencerUptimeFeed
  ];