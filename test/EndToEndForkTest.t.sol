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
    function baskets(uint256) external view returns (string memory, address, uint256, uint256, bool, bool);
}

interface IERC20Like {
    function balanceOf(address) external view returns (uint256);
    function approve(address, uint256) external returns (bool);
}

contract EndToEndForkTest is Test {
    address constant USDG = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;
    address constant USDG_USD_FEED = 0x61B7e5650328764B076A108EFF5fa7282a1B9aD2;
    address constant UNIVERSAL_ROUTER = 0x8876789976dEcBfCbBbe364623C63652db8C0904;
    address constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    address constant REWARDS_POOL = 0xc02F399cBbF90CEc6DD3a7c2D90fcA84C0a3a5ad;
    address constant TREASURY = 0xFF843Bc76C276086569D081E02DAC467C2aDa5cE;

    address constant NVDA_TOKEN = 0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC;
    address constant NVDA_FEED = 0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15;

    address deployer = address(0xBEEF);

    function test_RealEndToEndMint() external {
        // Fork REAL current mainnet state.
        vm.createSelectFork("https://rpc.mainnet.chain.robinhood.com");

        // Deploy the FIXED contract fresh on the fork -- using the
        // compiled StaxVault.sol from contracts/, which now has the
        // corrected 6-field ExactInputSingleParams struct.
        bytes memory bytecode = abi.encodePacked(
            vm.getCode("StaxVault.sol:StaxVault"),
            abi.encode(
                REWARDS_POOL,
                TREASURY,
                UNIVERSAL_ROUTER,
                PERMIT2,
                USDG,
                USDG_USD_FEED,
                uint48(97200), // real measured USDG staleness
                address(0) // no sequencer feed
            )
        );
        address vaultAddr;
        assembly {
            vaultAddr := create(0, add(bytecode, 0x20), mload(bytecode))
        }
        require(vaultAddr != address(0), "deploy failed");
        IStaxVault vault = IStaxVault(vaultAddr);

        console.log("Fresh vault deployed on fork at:", vaultAddr);

        // Register NVDA's real feed and real pool -- exact same values
        // used in the actual mainnet deploy.
        vault.setPriceFeed(NVDA_TOKEN, NVDA_FEED, 345600); // real 96h corrected staleness
        vault.setTickerPool(NVDA_TOKEN, USDG, NVDA_TOKEN, 3000, 60, address(0));

        // Create a simple single-ticker basket for a clean, focused test.
        address[] memory tickers = new address[](1);
        tickers[0] = NVDA_TOKEN;
        uint256[] memory weights = new uint256[](1);
        weights[0] = 10000;
        vault.createBasket(1, "Test NVDA", "tNVDA", tickers, weights, 1_000_000e18, 100_000e18);

        console.log("Basket created.");

        // Give ourselves real USDG on the fork via Foundry's deal
        // cheatcode -- no need to actually acquire it, this directly
        // sets the real token's balance in the fork's storage.
        deal(USDG, deployer, 10e6); // 10 USDG (6 decimals)

        vm.startPrank(deployer);
        IERC20Like(USDG).approve(vaultAddr, 2.1e6); // 2.10 USDG, matching tonight's real attempt

        console.log("Attempting the REAL mint against the REAL router on the fork...");
        vault.mint(1, 2.1e6);
        console.log("=== MINT SUCCEEDED ===");

        vm.stopPrank();

        // Confirm real basket state changed -- not just "didn't revert."
        (, address basketToken, , , , ) = vault.baskets(1);
        uint256 tokenBalance = IERC20Like(basketToken).balanceOf(deployer);
        console.log("Basket tokens received:", tokenBalance);
        assertTrue(tokenBalance > 0, "should have received real basket tokens");

        uint256 nvdaBalance = IERC20Like(NVDA_TOKEN).balanceOf(vaultAddr);
        console.log("Real NVDA acquired by vault:", nvdaBalance);
        assertTrue(nvdaBalance > 0, "vault should genuinely hold real NVDA now");
    }
}
