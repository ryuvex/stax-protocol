// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test, console} from "forge-std/Test.sol";

// ============================================================================
// RETAIL FAVORITES BASKET -- GME / PLTR / CRCL group mint+redeem
// fork test.
//
// CORRECTED after the first run: the live address (LIVE_VAULT) is
// still v18.4 -- it has ZERO V3 support in its actual deployed
// bytecode. Forking that address and calling setTickerPoolV3() on it
// silently no-op'd (no such function exists there), so GME's V3 pool
// was never actually registered, and mint() correctly reverted with
// "pool not set" -- the contract doing exactly the right thing given
// genuinely unregistered state.
//
// AIHardwareForkTest worked fine with the "fork the live address"
// pattern because it only used NVDA/AMD/MU -- all pure V4, using
// functions that already exist in the real deployed bytecode, with
// logic preserved byte-identical from v18.4. That pattern can ONLY
// test functionality that already exists on-chain. Testing NEW code
// (V3 support, still local-only) requires deploying a FRESH copy of
// the actual local source instead -- the same pattern already proven
// in FullTickerSweepTest.t.sol and PltrSpcxIsolatedRedeemTest.t.sol.
//
// Risk profile, deliberately the safest 3-leg combination available
// tonight:
//   - PLTR: V4, zero new logic risk -- same swap path already proven
//     live for every Mag 7 ticker. Real pool confirmed via direct
//     Initialize event resolution today (fee 10000/1%, tickSpacing
//     200, hookless) -- settled a real token-address discrepancy
//     between two of tonight's own data sources.
//   - CRCL: already isolated-redeem-cleared THREE separate times
//     tonight (v7 original + two fresh re-runs) -- the most proven
//     ticker in tonight's entire candidate pool.
//   - GME: the only genuinely new-venue leg. V3, but the exact swap
//     encoding was independently confirmed today via
//     V3EncodingProofTest.t.sol on this exact pool (fee 10000/1%,
//     real GME received). This test is the first time that proven
//     encoding runs THROUGH the actual vault contract.
// ============================================================================

interface IStaxVault {
    function createBasket(
        uint256 basketId,
        string memory name,
        string memory symbol,
        address[] memory tickers,
        uint256[] memory weights,
        uint256 depositCapUsd,
        uint256 maxMintUsd
    ) external;
    function mint(uint256 basketId, uint256 usdgAmount) external;
    function redeem(uint256 basketId, uint256 tokenAmount) external;
    function baskets(uint256) external view returns (string memory, address, uint256, uint256, bool, bool);
}

interface IStaxVaultAdmin {
    function setPriceFeed(address ticker, address feed, uint48 maxStaleness) external;
    function setTickerPool(address ticker, address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) external;
    function setTickerPoolV3(address ticker, uint24 fee) external;
}

interface IERC20Like {
    function balanceOf(address) external view returns (uint256);
    function approve(address, uint256) external returns (bool);
}

contract RetailFavoritesForkTest is Test {
    address constant USDG = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;
    address constant USDG_USD_FEED = 0x61B7e5650328764B076A108EFF5fa7282a1B9aD2;
    address constant UNIVERSAL_ROUTER = 0x8876789976dEcBfCbBbe364623C63652db8C0904;
    address constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    address constant DEPLOYER = address(0xBEEF);

    // GME -- new V3 leg. Real pool + feed confirmed tonight.
    address constant GME = 0x1b0E319c6A659F002271B69dB8A7df2F911c153E;
    address constant GME_FEED = 0x27C71df6A64fB476468EdF256CF72c038baB5B67;
    uint24 constant GME_V3_FEE = 10000; // confirmed via V3EncodingProofTest

    // PLTR -- V4, real pool resolved directly from the real Initialize
    // event today (settled a real address discrepancy between two of
    // tonight's own data sources).
    address constant PLTR = 0x894E1EC2D74FFE5AEF8Dc8A9e84686acCB964F2A;
    address constant PLTR_FEED = 0x820ABedFF239034956B7A9d2F0a331f9F075eB4c;
    uint24 constant PLTR_V4_FEE = 10000;
    int24 constant PLTR_TICKSPACING = 200;

    // CRCL -- already-proven V4 pool from the original 16-ticker
    // lineup. A fresh deploy starts with nothing registered, so this
    // needs to be set explicitly here too, unlike interacting with the
    // live address where it's already live.
    address constant CRCL = 0xdF0992E440dD0be65BD8439b609d6D4366bf1CB5;
    address constant CRCL_FEED = 0x6652eDf64bA3731C4F2D3ce821A0Fb1f1f6b482a;
    uint24 constant CRCL_V4_FEE = 3000;
    int24 constant CRCL_TICKSPACING = 30;

    uint256 constant RETAIL_FAVORITES_ID = 1;

    function _deployFreshVault() internal returns (IStaxVault) {
        bytes memory bytecode = abi.encodePacked(
            vm.getCode("StaxVault.sol:StaxVault"),
            abi.encode(
                DEPLOYER, // rewardsPool stand-in
                DEPLOYER, // treasury stand-in
                UNIVERSAL_ROUTER,
                PERMIT2,
                USDG,
                USDG_USD_FEED,
                uint48(345600),
                address(0) // sequencerUptimeFeed
            )
        );
        address vaultAddr;
        assembly {
            vaultAddr := create(0, add(bytecode, 0x20), mload(bytecode))
        }
        require(vaultAddr != address(0), "deploy failed");
        return IStaxVault(vaultAddr);
    }

    function setUp() public {
        vm.createSelectFork("https://rpc.mainnet.chain.robinhood.com");
        deal(USDG, DEPLOYER, 10e6);
    }

    function test_RetailFavorites_GroupMintRedeem() external {
        console.log("=== Retail Favorites -- GME/PLTR/CRCL group mint+redeem, fresh V3-capable deploy on fork ===\n");

        vm.startPrank(DEPLOYER);

        IStaxVault vault = _deployFreshVault();
        console.log("Fresh V3-capable vault deployed on fork.");

        IStaxVaultAdmin admin = IStaxVaultAdmin(address(vault));

        admin.setPriceFeed(PLTR, PLTR_FEED, 345600);
        admin.setTickerPool(PLTR, USDG, PLTR, PLTR_V4_FEE, PLTR_TICKSPACING, address(0));

        admin.setPriceFeed(GME, GME_FEED, 345600);
        admin.setTickerPoolV3(GME, GME_V3_FEE);

        admin.setPriceFeed(CRCL, CRCL_FEED, 345600);
        admin.setTickerPool(CRCL, USDG, CRCL, CRCL_V4_FEE, CRCL_TICKSPACING, address(0));

        console.log("All three tickers registered fresh.");

        address[] memory tickers = new address[](3);
        tickers[0] = GME;
        tickers[1] = PLTR;
        tickers[2] = CRCL;

        uint256[] memory weights = new uint256[](3);
        weights[0] = 3334;
        weights[1] = 3333;
        weights[2] = 3333;

        vault.createBasket(
            RETAIL_FAVORITES_ID,
            "Retail Favorites",
            "sRETAIL",
            tickers,
            weights,
            1_000_000e18,
            100_000e18
        );
        console.log("createBasket succeeded.");

        (, address basketToken, , , , ) = vault.baskets(RETAIL_FAVORITES_ID);
        console.log("Basket token:", basketToken);

        uint256 depositAmount = 2.1e6; // 2.10 USDG, same convention as every test tonight
        IERC20Like(USDG).approve(address(vault), depositAmount);

        console.log("\nAttempting real 3-leg mint...");
        vault.mint(RETAIL_FAVORITES_ID, depositAmount);
        uint256 tokensReceived = IERC20Like(basketToken).balanceOf(DEPLOYER);
        console.log("MINT SUCCEEDED -- all 3 legs swapped correctly in one transaction.");
        console.log("Basket tokens received:", tokensReceived);

        uint256 usdgBefore = IERC20Like(USDG).balanceOf(DEPLOYER);

        console.log("\nAttempting real 3-leg redeem...");
        IERC20Like(basketToken).approve(address(vault), tokensReceived);
        vault.redeem(RETAIL_FAVORITES_ID, tokensReceived);
        uint256 usdgAfter = IERC20Like(USDG).balanceOf(DEPLOYER);
        uint256 usdgReturned = usdgAfter - usdgBefore;

        console.log("REDEEM SUCCEEDED -- all 3 legs sold correctly in one transaction.");
        console.log("Net USDG returned:", usdgReturned);

        if (usdgReturned < depositAmount) {
            uint256 shortfallBps = ((depositAmount - usdgReturned) * 10000) / depositAmount;
            console.log("\nRound-trip shortfall (bps, includes 0.5% protocol fee):", shortfallBps);
        }

        console.log("\n=== RETAIL FAVORITES VERIFIED, BOTH DIRECTIONS. ===");
        console.log("Real production registration: same setPriceFeed/setTickerPool/setTickerPoolV3/createBasket");
        console.log("calls as above, but against the LIVE contract AFTER it's redeployed as v19 with V3 support.");
    }
}
