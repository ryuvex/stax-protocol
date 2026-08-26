// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test, console} from "forge-std/Test.sol";

interface IStaxVault {
    function setPriceFeed(address ticker, address feed, uint48 maxStaleness) external;
    function setTickerPool(address ticker, address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) external;
    function createBasket(uint256 basketId, string memory name, string memory symbol, address[] memory tickers, uint256[] memory weights, uint256 depositCapUsd, uint256 maxMintUsd) external;
    function mint(uint256 basketId, uint256 usdgAmount) external;
    function redeem(uint256 basketId, uint256 tokenAmount) external;
    function baskets(uint256) external view returns (string memory, address, uint256, uint256, bool, bool);
}

interface IERC20Like {
    function balanceOf(address) external view returns (uint256);
    function approve(address, uint256) external returns (bool);
}

contract IsolateRedeemFailureTest is Test {
    address constant USDG = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;
    address constant USDG_USD_FEED = 0x61B7e5650328764B076A108EFF5fa7282a1B9aD2;
    address constant UNIVERSAL_ROUTER = 0x8876789976dEcBfCbBbe364623C63652db8C0904;
    address constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    address constant REWARDS_POOL = 0xc02F399cBbF90CEc6DD3a7c2D90fcA84C0a3a5ad;
    address constant TREASURY = 0xFF843Bc76C276086569D081E02DAC467C2aDa5cE;

    address constant COIN = 0x6330D8C3178a418788dF01a47479c0ce7CCF450b;
    address constant COIN_FEED = 0xA3a468A452940B7D6b69991207B508c609a98Ef2;
    address constant CRCL = 0xdF0992E440dD0be65BD8439b609d6D4366bf1CB5;
    address constant CRCL_FEED = 0x6652eDf64bA3731C4F2D3ce821A0Fb1f1f6b482a;
    address constant INTC = 0xc72b96e0E48ecd4DC75E1e45396e26300BC39681;
    address constant INTC_FEED = 0x3f390C5C24628Ac7C489515402235FeAD71D1913;
    address constant MU = 0xfF080c8ce2E5feadaCa0Da81314Ae59D232d4afD;
    address constant MU_FEED = 0x425EEFdCf05ed6526C3cE61Af99429A228a6d596;

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

        vault.setPriceFeed(COIN, COIN_FEED, 345600);
        vault.setTickerPool(COIN, USDG, COIN, 10000, 200, address(0));
        vault.setPriceFeed(CRCL, CRCL_FEED, 345600);
        vault.setTickerPool(CRCL, USDG, CRCL, 3000, 30, address(0));
        vault.setPriceFeed(INTC, INTC_FEED, 345600);
        vault.setTickerPool(INTC, USDG, INTC, 10000, 200, address(0));
        vault.setPriceFeed(MU, MU_FEED, 345600);
        vault.setTickerPool(MU, USDG, MU, 10000, 200, address(0));

        address[] memory tickers = new address[](1);
        uint256[] memory weights = new uint256[](1);
        weights[0] = 10000;

        tickers[0] = COIN;
        vault.createBasket(101, "T-COIN", "tCOIN", tickers, weights, 1_000_000e18, 100_000e18);
        tickers[0] = CRCL;
        vault.createBasket(102, "T-CRCL", "tCRCL", tickers, weights, 1_000_000e18, 100_000e18);
        tickers[0] = INTC;
        vault.createBasket(103, "T-INTC", "tINTC", tickers, weights, 1_000_000e18, 100_000e18);
        tickers[0] = MU;
        vault.createBasket(104, "T-MU", "tMU", tickers, weights, 1_000_000e18, 100_000e18);

        deal(USDG, deployer, 20e6);
    }

    function test_COIN_isolated() external { _check(101, "COIN"); }
    function test_CRCL_isolated() external { _check(102, "CRCL"); }
    function test_INTC_isolated() external { _check(103, "INTC"); }
    function test_MU_isolated() external { _check(104, "MU"); }

    function _check(uint256 basketId, string memory label) internal {
        vm.startPrank(deployer);
        IERC20Like(USDG).approve(address(vault), 2.1e6);

        console.log(string.concat("=== ", label, " isolated (same $2.10 size as the failing multi-leg test) ==="));
        vault.mint(basketId, 2.1e6);
        console.log("Mint OK.");

        (, address basketToken, , , , ) = vault.baskets(basketId);
        uint256 tokensReceived = IERC20Like(basketToken).balanceOf(deployer);

        IERC20Like(basketToken).approve(address(vault), tokensReceived);

        try vault.redeem(basketId, tokensReceived) {
            console.log(string.concat(label, ": REDEEM SUCCEEDED in isolation."));
        } catch (bytes memory reason) {
            console.log(string.concat(label, ": REDEEM FAILED even in isolation."));
            if (reason.length >= 4) {
                bytes4 selector;
                assembly { selector := mload(add(reason, 32)) }
                console.log("  selector:");
                console.logBytes4(selector);
            }
        }
        vm.stopPrank();
        console.log("");
    }
}
