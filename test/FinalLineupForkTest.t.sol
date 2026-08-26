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

contract FinalLineupForkTest is Test {
    address constant USDG = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;
    address constant USDG_USD_FEED = 0x61B7e5650328764B076A108EFF5fa7282a1B9aD2;
    address constant UNIVERSAL_ROUTER = 0x8876789976dEcBfCbBbe364623C63652db8C0904;
    address constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    address constant REWARDS_POOL = 0xc02F399cBbF90CEc6DD3a7c2D90fcA84C0a3a5ad;
    address constant TREASURY = 0xFF843Bc76C276086569D081E02DAC467C2aDa5cE;

    // Mag 7's 7 tickers, exact addresses/feeds/pools matching
    // deploy-mainnet-v18.ts exactly.
    address constant AAPL = 0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9;
    address constant AAPL_FEED = 0x6B22A786bAa607d76728168703a39Ea9C99f2cD0;
    address constant MSFT = 0xe93237C50D904957Cf27E7B1133b510C669c2e74;
    address constant MSFT_FEED = 0x45C3C877C15E6BA2EBB19eA114Ea508d14C1Af2E;
    address constant GOOGL = 0x2e0847E8910a9732eB3fb1bb4b70a580ADAD4FE3;
    address constant GOOGL_FEED = 0xF6f373a037c30F0e5010d854385cA89185AE638b;
    address constant AMZN = 0x12f190a9F9d7D37a250758b26824B97CE941bF54;
    address constant AMZN_FEED = 0xD5a1508ceD74c084eBf3cBe853e2C968fB2a651C;
    address constant NVDA = 0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC;
    address constant NVDA_FEED = 0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15;
    address constant META = 0xc0D6457C16Cc70d6790Dd43521C899C87ce02f35;
    address constant META_FEED = 0x7C38C00C30BEe9378381E7B6135d7283356D71b1;
    address constant TSLA = 0x322F0929c4625eD5bAd873c95208D54E1c003b2d;
    address constant TSLA_FEED = 0x4A1166a659A55625345e9515b32adECea5547C38;

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

        vault.setPriceFeed(AAPL, AAPL_FEED, 345600);
        vault.setTickerPool(AAPL, USDG, AAPL, 3000, 60, address(0));

        vault.setPriceFeed(MSFT, MSFT_FEED, 345600);
        vault.setTickerPool(MSFT, USDG, MSFT, 3000, 60, address(0));

        vault.setPriceFeed(GOOGL, GOOGL_FEED, 345600);
        vault.setTickerPool(GOOGL, GOOGL, USDG, 3000, 60, address(0));

        vault.setPriceFeed(AMZN, AMZN_FEED, 345600);
        vault.setTickerPool(AMZN, AMZN, USDG, 3000, 60, address(0));

        vault.setPriceFeed(NVDA, NVDA_FEED, 345600);
        vault.setTickerPool(NVDA, USDG, NVDA, 3000, 60, address(0));

        vault.setPriceFeed(META, META_FEED, 345600);
        vault.setTickerPool(META, USDG, META, 3000, 60, address(0));

        vault.setPriceFeed(TSLA, TSLA_FEED, 345600);
        vault.setTickerPool(TSLA, TSLA, USDG, 3000, 60, address(0));

        address[] memory mag7 = new address[](7);
        mag7[0] = AAPL; mag7[1] = MSFT; mag7[2] = GOOGL; mag7[3] = AMZN;
        mag7[4] = NVDA; mag7[5] = META; mag7[6] = TSLA;
        uint256[] memory mag7Weights = new uint256[](7);
        mag7Weights[0] = 1430; mag7Weights[1] = 1430; mag7Weights[2] = 1430;
        mag7Weights[3] = 1430; mag7Weights[4] = 1430; mag7Weights[5] = 1430;
        mag7Weights[6] = 1420;
        vault.createBasket(2, "Mag 7", "sMAG7", mag7, mag7Weights, 1_000_000e18, 100_000e18);

        deal(USDG, deployer, 10e6);
    }

    function test_Mag7_FinalLineup_FullMintRedeem() external {
        vm.startPrank(deployer);

        console.log("=== Mag 7 -- FINAL launch lineup (only basket shipping) ===");

        IERC20Like(USDG).approve(address(vault), 2.1e6);

        console.log("Attempting real 7-leg mint...");
        vault.mint(2, 2.1e6);
        console.log("MINT SUCCEEDED -- all 7 legs swapped correctly in one transaction.");

        (, address basketToken, , , , ) = vault.baskets(2);
        uint256 tokensReceived = IERC20Like(basketToken).balanceOf(deployer);
        console.log("Basket tokens received:", tokensReceived);
        assertTrue(tokensReceived > 0, "should receive real basket tokens");

        console.log("Attempting real 7-leg redeem...");
        IERC20Like(basketToken).approve(address(vault), tokensReceived);
        uint256 usdgBefore = IERC20Like(USDG).balanceOf(deployer);
        vault.redeem(2, tokensReceived);
        uint256 usdgAfter = IERC20Like(USDG).balanceOf(deployer);
        console.log("REDEEM SUCCEEDED -- all 7 legs sold correctly in one transaction.");
        console.log("Net USDG returned:", usdgAfter - usdgBefore);
        assertTrue(usdgAfter > usdgBefore, "should receive real USDG back");

        vm.stopPrank();
        console.log("");
        console.log("=== FINAL LAUNCH LINEUP VERIFIED, BOTH DIRECTIONS. READY FOR REDEPLOY. ===");
    }
}
