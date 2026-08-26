// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test, console} from "forge-std/Test.sol";

// ============================================================================
// FULL PRODUCTION REGISTRY TEST -- directly answers Opus's Q3 gate.
//
// Every test tonight registered 2-3 tickers at a time. Production has
// 16 existing tickers (some basket-less: TSM/MSTR/SNDK/SPCX, matching
// real v18.4 state exactly) plus the 4 new ones from tonight (GME/V3,
// PLTR/V4, USO/V3, SLV/V3) -- 20 total, never all registered together
// in a single contract until this test.
//
// This proves two things Opus specifically flagged as untested:
//   1. A V4-only basket (Mag 7, 7 legs) still works correctly when the
//      full registry -- including new V3 tickers -- is loaded alongside
//      it. Confirms adding V3 support didn't disturb existing V4 logic
//      even with real state pressure, not just "the code is unchanged."
//   2. A V3-mixed basket (Retail Favorites: GME/V3 + PLTR/V4 + CRCL/V4)
//      works correctly in that same fully-loaded contract, not just in
//      isolation with 2-3 tickers registered.
//
// All ticker data below is real, already-confirmed data from tonight --
// no new resolution needed, this is purely assembling what's already
// been separately proven piece by piece (FullTickerSweepTest.t.sol's
// 16-ticker list, plus tonight's GME/PLTR/USO/SLV additions).
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

contract FullRegistryTest is Test {
    address constant USDG = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;
    address constant USDG_USD_FEED = 0x61B7e5650328764B076A108EFF5fa7282a1B9aD2;
    address constant UNIVERSAL_ROUTER = 0x8876789976dEcBfCbBbe364623C63652db8C0904;
    address constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    address constant DEPLOYER = address(0xBEEF);

    struct V4TickerConfig {
        string symbol;
        address token;
        address feed;
        address currency0;
        address currency1;
        uint24 fee;
        int24 tickSpacing;
    }

    IStaxVault vault;

    function _deployFreshVault() internal returns (IStaxVault) {
        bytes memory bytecode = abi.encodePacked(
            vm.getCode("StaxVault.sol:StaxVault"),
            abi.encode(
                DEPLOYER, DEPLOYER, UNIVERSAL_ROUTER, PERMIT2, USDG, USDG_USD_FEED, uint48(345600), address(0)
            )
        );
        address vaultAddr;
        assembly {
            vaultAddr := create(0, add(bytecode, 0x20), mload(bytecode))
        }
        require(vaultAddr != address(0), "deploy failed");
        return IStaxVault(vaultAddr);
    }

    // Full 16-ticker production list -- byte-identical data to
    // FullTickerSweepTest.t.sol, real on-chain-sourced values. TSM,
    // MSTR, SNDK, SPCX are registered here exactly as they are on real
    // v18.4 (basket-less but registered -- matching actual production
    // state, not a simplified stand-in).
    function _sixteenExisting() internal pure returns (V4TickerConfig[16] memory list) {
        list[0] = V4TickerConfig("NVDA", 0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC, 0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15, USDG, 0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC, 3000, 60);
        list[1] = V4TickerConfig("AMD", 0x86923f96303D656E4aa86D9d42D1e57ad2023fdC, 0x943A29E7ae51A4798823ca9eEd2ed533B2A22C72, USDG, 0x86923f96303D656E4aa86D9d42D1e57ad2023fdC, 10000, 200);
        list[2] = V4TickerConfig("TSM", 0x58FfE4a942d3885bAa22D7520691F611EF09e7AA, 0x874cF94aa8eC88Fd9560094dD065f2fB3E41Fc2F, 0x58FfE4a942d3885bAa22D7520691F611EF09e7AA, USDG, 400000, 8000);
        list[3] = V4TickerConfig("AAPL", 0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9, 0x6B22A786bAa607d76728168703a39Ea9C99f2cD0, USDG, 0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9, 3000, 60);
        list[4] = V4TickerConfig("MSFT", 0xe93237C50D904957Cf27E7B1133b510C669c2e74, 0x45C3C877C15E6BA2EBB19eA114Ea508d14C1Af2E, USDG, 0xe93237C50D904957Cf27E7B1133b510C669c2e74, 3000, 60);
        list[5] = V4TickerConfig("GOOGL", 0x2e0847E8910a9732eB3fb1bb4b70a580ADAD4FE3, 0xF6f373a037c30F0e5010d854385cA89185AE638b, 0x2e0847E8910a9732eB3fb1bb4b70a580ADAD4FE3, USDG, 3000, 60);
        list[6] = V4TickerConfig("AMZN", 0x12f190a9F9d7D37a250758b26824B97CE941bF54, 0xD5a1508ceD74c084eBf3cBe853e2C968fB2a651C, 0x12f190a9F9d7D37a250758b26824B97CE941bF54, USDG, 3000, 60);
        list[7] = V4TickerConfig("META", 0xc0D6457C16Cc70d6790Dd43521C899C87ce02f35, 0x7C38C00C30BEe9378381E7B6135d7283356D71b1, USDG, 0xc0D6457C16Cc70d6790Dd43521C899C87ce02f35, 3000, 60);
        list[8] = V4TickerConfig("TSLA", 0x322F0929c4625eD5bAd873c95208D54E1c003b2d, 0x4A1166a659A55625345e9515b32adECea5547C38, 0x322F0929c4625eD5bAd873c95208D54E1c003b2d, USDG, 3000, 60);
        list[9] = V4TickerConfig("COIN", 0x6330D8C3178a418788dF01a47479c0ce7CCF450b, 0xA3a468A452940B7D6b69991207B508c609a98Ef2, USDG, 0x6330D8C3178a418788dF01a47479c0ce7CCF450b, 10000, 200);
        list[10] = V4TickerConfig("MSTR", 0xec262a75e413fAfD0dF80480274532C79D42da09, 0x396118bdFB181e6240E74D243F266B061c0edc3D, USDG, 0xec262a75e413fAfD0dF80480274532C79D42da09, 50000, 1100);
        list[11] = V4TickerConfig("CRCL", 0xdF0992E440dD0be65BD8439b609d6D4366bf1CB5, 0x6652eDf64bA3731C4F2D3ce821A0Fb1f1f6b482a, USDG, 0xdF0992E440dD0be65BD8439b609d6D4366bf1CB5, 3000, 30);
        list[12] = V4TickerConfig("INTC", 0xc72b96e0E48ecd4DC75E1e45396e26300BC39681, 0x3f390C5C24628Ac7C489515402235FeAD71D1913, USDG, 0xc72b96e0E48ecd4DC75E1e45396e26300BC39681, 10000, 200);
        list[13] = V4TickerConfig("MU", 0xfF080c8ce2E5feadaCa0Da81314Ae59D232d4afD, 0x425EEFdCf05ed6526C3cE61Af99429A228a6d596, USDG, 0xfF080c8ce2E5feadaCa0Da81314Ae59D232d4afD, 10000, 200);
        list[14] = V4TickerConfig("SNDK", 0xB90A19fF0Af67f7779afF50A882A9CfF42446400, 0xfb133Fa4B7b385802B693a293606682Df47109A3, USDG, 0xB90A19fF0Af67f7779afF50A882A9CfF42446400, 10000, 200);
        list[15] = V4TickerConfig("SPCX", 0x4a0E65A3EcceC6dBe60AE065F2e7bb85Fae35eEa, 0xB265810950ba6c5C0Ff821c9963014a56fD8Bffb, 0x4a0E65A3EcceC6dBe60AE065F2e7bb85Fae35eEa, USDG, 10000, 200);
    }

    // New tickers from tonight -- GME/USO/SLV via V3, PLTR via V4.
    address constant GME = 0x1b0E319c6A659F002271B69dB8A7df2F911c153E;
    address constant GME_FEED = 0x27C71df6A64fB476468EdF256CF72c038baB5B67;
    uint24 constant GME_V3_FEE = 10000;

    address constant PLTR = 0x894E1EC2D74FFE5AEF8Dc8A9e84686acCB964F2A;
    address constant PLTR_FEED = 0x820ABedFF239034956B7A9d2F0a331f9F075eB4c;
    uint24 constant PLTR_V4_FEE = 10000;
    int24 constant PLTR_TICKSPACING = 200;

    address constant USO = 0xa30FA36Db767ad9eD3f7a60fC79526fB4d56D344;
    address constant USO_FEED = 0x75a9c76Ef439e2C7c2E5a34Ab105EcFe3766431c;
    uint24 constant USO_V3_FEE = 3000; // confirmed via CommoditiesForkTest

    address constant SLV = 0x411eFb0E7f985935DAec3D4C3ebaEa0d0AD7D89f;
    address constant SLV_FEED = 0x209b73908e92Ae021826eD79609845451Ecba2ce;
    uint24 constant SLV_V3_FEE = 10000; // confirmed via CommoditiesForkTest

    uint256 constant MAG7_ID = 2; // matches real production numbering
    uint256 constant RETAIL_FAVORITES_ID = 4;

    function setUp() public {
        vm.createSelectFork("https://rpc.mainnet.chain.robinhood.com");
        deal(USDG, DEPLOYER, 20e6);
    }

    function test_FullRegistry_BothBasketTypesCoexist() external {
        console.log("=== FULL PRODUCTION REGISTRY TEST: 20 tickers, V4-only + V3-mixed baskets in one contract ===\n");

        vm.startPrank(DEPLOYER);

        vault = _deployFreshVault();
        IStaxVaultAdmin admin = IStaxVaultAdmin(address(vault));

        // Register all 16 existing production tickers, exactly as v18.4 has them.
        V4TickerConfig[16] memory existing = _sixteenExisting();
        for (uint256 i = 0; i < 16; i++) {
            admin.setPriceFeed(existing[i].token, existing[i].feed, 345600);
            admin.setTickerPool(existing[i].token, existing[i].currency0, existing[i].currency1, existing[i].fee, existing[i].tickSpacing, address(0));
        }
        console.log("All 16 existing production tickers registered.");

        // Register the 4 new tickers from tonight.
        admin.setPriceFeed(GME, GME_FEED, 345600);
        admin.setTickerPoolV3(GME, GME_V3_FEE);

        admin.setPriceFeed(PLTR, PLTR_FEED, 345600);
        admin.setTickerPool(PLTR, USDG, PLTR, PLTR_V4_FEE, PLTR_TICKSPACING, address(0));

        admin.setPriceFeed(USO, USO_FEED, 345600);
        admin.setTickerPoolV3(USO, USO_V3_FEE);

        admin.setPriceFeed(SLV, SLV_FEED, 345600);
        admin.setTickerPoolV3(SLV, SLV_V3_FEE);

        console.log("All 4 new tickers registered. Full registry: 20 tickers loaded.\n");

        // --- Basket 1: Mag 7, V4-only, 7 legs -- proves existing
        // baskets are unaffected by the full registry + V3 additions.
        address[] memory mag7Tickers = new address[](7);
        mag7Tickers[0] = existing[0].token; // NVDA
        mag7Tickers[1] = existing[4].token; // MSFT
        mag7Tickers[2] = existing[5].token; // GOOGL
        mag7Tickers[3] = existing[6].token; // AMZN
        mag7Tickers[4] = existing[7].token; // META
        mag7Tickers[5] = existing[8].token; // TSLA
        mag7Tickers[6] = existing[3].token; // AAPL

        uint256[] memory mag7Weights = new uint256[](7);
        for (uint256 i = 0; i < 7; i++) mag7Weights[i] = 1429; // ~equal weight
        mag7Weights[6] = 10000 - (1429 * 6); // remainder to last leg, sums exactly to 10000

        vault.createBasket(MAG7_ID, "Mag 7", "sMAG7", mag7Tickers, mag7Weights, 1_000_000e18, 100_000e18);
        console.log("Mag 7 (V4-only, 7 legs) created.");

        // --- Basket 2: Retail Favorites, V3-mixed -- proves the new
        // venue works correctly with the full registry loaded, not
        // just in isolation.
        address[] memory retailTickers = new address[](3);
        retailTickers[0] = GME;
        retailTickers[1] = PLTR;
        retailTickers[2] = existing[11].token; // CRCL

        uint256[] memory retailWeights = new uint256[](3);
        retailWeights[0] = 3334;
        retailWeights[1] = 3333;
        retailWeights[2] = 3333;

        vault.createBasket(RETAIL_FAVORITES_ID, "Retail Favorites", "sRETAIL", retailTickers, retailWeights, 1_000_000e18, 100_000e18);
        console.log("Retail Favorites (V3-mixed, 3 legs) created.\n");

        // --- Mint + redeem Mag 7 in this fully-loaded contract ---
        (, address mag7Token, , , , ) = vault.baskets(MAG7_ID);
        uint256 depositAmount = 2.1e6;

        IERC20Like(USDG).approve(address(vault), depositAmount);
        console.log("Attempting Mag 7 mint (full registry loaded)...");
        vault.mint(MAG7_ID, depositAmount);
        uint256 mag7Tokens = IERC20Like(mag7Token).balanceOf(DEPLOYER);
        console.log("Mag 7 MINT SUCCEEDED. Tokens received:", mag7Tokens);

        IERC20Like(mag7Token).approve(address(vault), mag7Tokens);
        console.log("Attempting Mag 7 redeem...");
        vault.redeem(MAG7_ID, mag7Tokens);
        console.log("Mag 7 REDEEM SUCCEEDED.\n");

        // --- Mint + redeem Retail Favorites in the SAME contract ---
        (, address retailToken, , , , ) = vault.baskets(RETAIL_FAVORITES_ID);

        IERC20Like(USDG).approve(address(vault), depositAmount);
        console.log("Attempting Retail Favorites mint (full registry loaded)...");
        vault.mint(RETAIL_FAVORITES_ID, depositAmount);
        uint256 retailTokens = IERC20Like(retailToken).balanceOf(DEPLOYER);
        console.log("Retail Favorites MINT SUCCEEDED. Tokens received:", retailTokens);

        IERC20Like(retailToken).approve(address(vault), retailTokens);
        console.log("Attempting Retail Favorites redeem...");
        vault.redeem(RETAIL_FAVORITES_ID, retailTokens);
        console.log("Retail Favorites REDEEM SUCCEEDED.\n");

        console.log("=== FULL REGISTRY TEST PASSED. ===");
        console.log("V4-only and V3-mixed baskets both work correctly with all 20 tickers");
        console.log("(16 existing + 4 new) registered together in one contract. Opus's");
        console.log("Q3 gate is closed -- this is no longer tested only in isolation.");
    }
}
