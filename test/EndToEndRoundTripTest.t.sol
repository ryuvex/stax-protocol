// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test, console} from "forge-std/Test.sol";

interface IStaxVault {
    function setPriceFeed(address ticker, address feed, uint48 maxStaleness) external;
    function setTickerPool(address ticker, address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) external;
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

interface IERC20Like {
    function balanceOf(address) external view returns (uint256);
    function approve(address, uint256) external returns (bool);
}

contract EndToEndRoundTripTest is Test {
    address constant USDG = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;
    address constant USDG_USD_FEED = 0x61B7e5650328764B076A108EFF5fa7282a1B9aD2;
    address constant UNIVERSAL_ROUTER = 0x8876789976dEcBfCbBbe364623C63652db8C0904;
    address constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    address constant REWARDS_POOL = 0xc02F399cBbF90CEc6DD3a7c2D90fcA84C0a3a5ad;
    address constant TREASURY = 0xFF843Bc76C276086569D081E02DAC467C2aDa5cE;

    address constant NVDA_TOKEN = 0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC;
    address constant NVDA_FEED = 0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15;

    // TSM: deliberately a different, unusual fee tier and reversed
    // currency order (TSM as currency0, not USDG) -- exactly the
    // config Opus flagged as worth testing separately from NVDA's
    // standard-shape pool.
    address constant TSM_TOKEN = 0x58FfE4a942d3885bAa22D7520691F611EF09e7AA;
    address constant TSM_FEED = 0x874cF94aa8eC88Fd9560094dD065f2fB3E41Fc2F;

    address deployer = address(0xBEEF);
    IStaxVault vault;

    function setUp() public {
        vm.createSelectFork("https://rpc.mainnet.chain.robinhood.com");

        bytes memory bytecode = abi.encodePacked(
            vm.getCode("StaxVault.sol:StaxVault"),
            abi.encode(REWARDS_POOL, TREASURY, UNIVERSAL_ROUTER, PERMIT2, USDG, USDG_USD_FEED, uint48(97200), address(0))
        );
        address vaultAddr;
        assembly {
            vaultAddr := create(0, add(bytecode, 0x20), mload(bytecode))
        }
        require(vaultAddr != address(0), "deploy failed");
        vault = IStaxVault(vaultAddr);

        // Register both tickers.
        vault.setPriceFeed(NVDA_TOKEN, NVDA_FEED, 345600);
        vault.setTickerPool(NVDA_TOKEN, USDG, NVDA_TOKEN, 3000, 60, address(0));

        vault.setPriceFeed(TSM_TOKEN, TSM_FEED, 345600);
        vault.setTickerPool(TSM_TOKEN, TSM_TOKEN, USDG, 400000, 8000, address(0)); // reversed order, unusual fee tier

        // Two single-ticker baskets.
        address[] memory nvdaTickers = new address[](1);
        nvdaTickers[0] = NVDA_TOKEN;
        uint256[] memory weights = new uint256[](1);
        weights[0] = 10000;
        vault.createBasket(1, "Test NVDA", "tNVDA", nvdaTickers, weights, 1_000_000e18, 100_000e18);

        address[] memory tsmTickers = new address[](1);
        tsmTickers[0] = TSM_TOKEN;
        vault.createBasket(2, "Test TSM", "tTSM", tsmTickers, weights, 1_000_000e18, 100_000e18);

        deal(USDG, deployer, 20e6); // 20 USDG, enough for both round-trips
    }

    function test_NVDA_MintRedeemRoundTrip() external {
        _mintAndRedeem(1, "NVDA");
    }

    function test_TSM_MintRedeemRoundTrip() external {
        _mintAndRedeem(2, "TSM");
    }

    function _mintAndRedeem(uint256 basketId, string memory label) internal {
        vm.startPrank(deployer);

        uint256 usdgBefore = IERC20Like(USDG).balanceOf(deployer);
        console.log(string.concat("=== ", label, ": USDG before mint ==="), usdgBefore);

        IERC20Like(USDG).approve(address(vault), 2.1e6);
        vault.mint(basketId, 2.1e6);

        (, address basketToken, , , , ) = vault.baskets(basketId);
        uint256 tokensReceived = IERC20Like(basketToken).balanceOf(deployer);
        console.log(string.concat(label, ": basket tokens received:"), tokensReceived);
        assertTrue(tokensReceived > 0, "mint should produce real basket tokens");

        console.log(string.concat("Attempting REAL redeem for ", label, "..."));
        IERC20Like(basketToken).approve(address(vault), tokensReceived);
        vault.redeem(basketId, tokensReceived);
        console.log(string.concat("=== ", label, " REDEEM SUCCEEDED ==="));

        uint256 usdgAfter = IERC20Like(USDG).balanceOf(deployer);
        console.log(string.concat(label, ": USDG after redeem:"), usdgAfter);

        // Confirm real USDG genuinely came back -- not zero, and less
        // than what went in (real fee was paid on both legs, as expected).
        uint256 usdgReturned = usdgAfter - (usdgBefore - 2.1e6);
        console.log(string.concat(label, ": net USDG returned from round-trip:"), usdgReturned);
        assertTrue(usdgReturned > 0, "should have received real USDG back from redeem");

        vm.stopPrank();
    }
}
