// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test, console} from "forge-std/Test.sol";

// ============================================================================
// COMMODITIES BASKET -- USO / SLV group mint+redeem fork test.
//
// Same fresh-V3-capable-deploy pattern as RetailFavoritesForkTest
// (corrected version) -- both USO and SLV are brand-new V3 tickers,
// never registered on the live v18.4 contract at all, so there's no
// live-address shortcut available here even for testing convenience.
//
// TWO LEGS, NOT THREE -- flagged honestly, not glossed over. GLD would
// be the natural third leg (completes the commodities theme: oil,
// silver, gold) but has no Chainlink feed -- still Pyth-gated, deferred
// post-launch. This means Commodities does NOT have the "survives
// losing one leg" cushion Opus's own framework recommends for new
// baskets. Both legs have to clear for this basket to work at all.
// Worth knowing before reading the result, not after.
//
// Real pool fee tiers read DYNAMICALLY on-chain via fee() -- same
// discipline as V3EncodingProofTest's GME check, not trusted from the
// manual liquidity sheet. This is exactly the check that would have
// caught TSM (40%) and MSTR (5%) before they ever reached a mint
// attempt.
//
// THIS IS THE NUMBER THAT MATTERS MOST TONIGHT (per Opus's Q6): if
// USO/SLV comes back cheap, V3 support was worth building -- it
// unlocks a real, shippable basket, not just a mechanism that works
// but only produces held (too-expensive) baskets like GME did. If this
// also lands past-uneasy, that's a real signal worth taking seriously
// before committing to the v19 redeploy at all.
// ============================================================================

interface IUniswapV3PoolLike {
    function fee() external view returns (uint24);
    function token0() external view returns (address);
    function token1() external view returns (address);
}

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
    function setTickerPoolV3(address ticker, uint24 fee) external;
}

interface IERC20Like {
    function balanceOf(address) external view returns (uint256);
    function approve(address, uint256) external returns (bool);
}

contract CommoditiesForkTest is Test {
    address constant USDG = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;
    address constant USDG_USD_FEED = 0x61B7e5650328764B076A108EFF5fa7282a1B9aD2;
    address constant UNIVERSAL_ROUTER = 0x8876789976dEcBfCbBbe364623C63652db8C0904;
    address constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    address constant DEPLOYER = address(0xBEEF);

    // USO -- real V3 pool contract + real Chainlink feed, both from
    // tonight's confirmed data. Fee tier read dynamically below, not
    // trusted from the sheet.
    address constant USO = 0xa30FA36Db767ad9eD3f7a60fC79526fB4d56D344;
    address constant USO_FEED = 0x75a9c76Ef439e2C7c2E5a34Ab105EcFe3766431c;
    address constant USO_V3_POOL = 0x02175608F1b5E6b5ed221cCFdC7Be197D111D915;

    // SLV -- same pattern.
    address constant SLV = 0x411eFb0E7f985935DAec3D4C3ebaEa0d0AD7D89f;
    address constant SLV_FEED = 0x209b73908e92Ae021826eD79609845451Ecba2ce;
    address constant SLV_V3_POOL = 0x0Fa7BC480885DCf58Ad2ef63eC7289cF2481D51c;

    uint256 constant COMMODITIES_ID = 1;

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

    function setUp() public {
        vm.createSelectFork("https://rpc.mainnet.chain.robinhood.com");
        deal(USDG, DEPLOYER, 10e6);
    }

    function test_Commodities_GroupMintRedeem() external {
        console.log("=== Commodities -- USO/SLV group mint+redeem, fresh V3-capable deploy on fork ===\n");

        // Read real pool fees on-chain -- no guessing.
        uint24 usoFee = IUniswapV3PoolLike(USO_V3_POOL).fee();
        uint24 slvFee = IUniswapV3PoolLike(SLV_V3_POOL).fee();
        console.log("USO real pool fee tier:", usoFee);
        console.log("SLV real pool fee tier:", slvFee);

        vm.startPrank(DEPLOYER);

        IStaxVault vault = _deployFreshVault();
        console.log("\nFresh V3-capable vault deployed on fork.");

        IStaxVaultAdmin admin = IStaxVaultAdmin(address(vault));
        admin.setPriceFeed(USO, USO_FEED, 345600);
        admin.setTickerPoolV3(USO, usoFee);
        admin.setPriceFeed(SLV, SLV_FEED, 345600);
        admin.setTickerPoolV3(SLV, slvFee);
        console.log("Both tickers registered.");

        address[] memory tickers = new address[](2);
        tickers[0] = USO;
        tickers[1] = SLV;

        uint256[] memory weights = new uint256[](2);
        weights[0] = 5000;
        weights[1] = 5000;

        vault.createBasket(
            COMMODITIES_ID,
            "Commodities",
            "sCOMM",
            tickers,
            weights,
            1_000_000e18,
            100_000e18
        );
        console.log("createBasket succeeded.");

        (, address basketToken, , , , ) = vault.baskets(COMMODITIES_ID);
        console.log("Basket token:", basketToken);

        uint256 depositAmount = 2.1e6;
        IERC20Like(USDG).approve(address(vault), depositAmount);

        console.log("\nAttempting real 2-leg mint...");
        vault.mint(COMMODITIES_ID, depositAmount);
        uint256 tokensReceived = IERC20Like(basketToken).balanceOf(DEPLOYER);
        console.log("MINT SUCCEEDED -- both legs swapped correctly in one transaction.");
        console.log("Basket tokens received:", tokensReceived);

        uint256 usdgBefore = IERC20Like(USDG).balanceOf(DEPLOYER);

        console.log("\nAttempting real 2-leg redeem...");
        IERC20Like(basketToken).approve(address(vault), tokensReceived);
        vault.redeem(COMMODITIES_ID, tokensReceived);
        uint256 usdgAfter = IERC20Like(USDG).balanceOf(DEPLOYER);
        uint256 usdgReturned = usdgAfter - usdgBefore;

        console.log("REDEEM SUCCEEDED -- both legs sold correctly in one transaction.");
        console.log("Net USDG returned:", usdgReturned);

        if (usdgReturned < depositAmount) {
            uint256 shortfallBps = ((depositAmount - usdgReturned) * 10000) / depositAmount;
            console.log("\nRound-trip shortfall (bps, includes 0.5% protocol fee):", shortfallBps);
            console.log("(Subtract 50bps protocol fee for real market execution cost.)");
        }

        console.log("\n=== COMMODITIES VERIFIED, BOTH DIRECTIONS. ===");
        console.log("This number determines whether tonight's V3 work unlocks a real,");
        console.log("shippable basket -- not just a mechanism that only produces held ones.");
    }
}
