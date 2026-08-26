// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test, console} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";

interface IStaxVault {
    function setPriceFeed(address ticker, address feed, uint48 maxStaleness) external;
    function setTickerPool(address ticker, address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) external;
    function createBasket(uint256 basketId, string memory name, string memory symbol, address[] memory tickers, uint256[] memory weights, uint256 depositCapUsd, uint256 maxMintUsd) external;
    function mint(uint256 basketId, uint256 usdgAmount) external;
}

interface IERC20Like {
    function balanceOf(address) external view returns (uint256);
    function approve(address, uint256) external returns (bool);
}

contract RankedCostSweepTest is Test {
    address constant USDG = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;
    address constant USDG_USD_FEED = 0x61B7e5650328764B076A108EFF5fa7282a1B9aD2;
    address constant UNIVERSAL_ROUTER = 0x8876789976dEcBfCbBbe364623C63652db8C0904;
    address constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    address constant REWARDS_POOL = 0xc02F399cBbF90CEc6DD3a7c2D90fcA84C0a3a5ad;
    address constant TREASURY = 0xFF843Bc76C276086569D081E02DAC467C2aDa5cE;

    // Real Minted event signature, needed to find and decode it from the
    // recorded logs after each mint.
    event Minted(uint256 indexed basketId, address indexed user, uint256 usdgIn, uint256 valueReceivedUsd, uint256 tokensOut);

    address deployer = address(0xBEEF);
    IStaxVault vault;

    struct TickerConfig {
        string symbol;
        address token;
        address feed;
        address currency0;
        address currency1;
        uint24 fee;
        int24 tickSpacing;
    }

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

        deal(USDG, deployer, 50e6);
    }

    function _tickers() internal pure returns (TickerConfig[14] memory list) {
        // The 14 that actually succeeded in the prior sweep -- TSM and
        // MSTR already confirmed reverting, excluded here.
        list[0] = TickerConfig("NVDA", 0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC, 0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15, USDG, 0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC, 3000, 60);
        list[1] = TickerConfig("AMD", 0x86923f96303D656E4aa86D9d42D1e57ad2023fdC, 0x943A29E7ae51A4798823ca9eEd2ed533B2A22C72, USDG, 0x86923f96303D656E4aa86D9d42D1e57ad2023fdC, 10000, 200);
        list[2] = TickerConfig("AAPL", 0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9, 0x6B22A786bAa607d76728168703a39Ea9C99f2cD0, USDG, 0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9, 3000, 60);
        list[3] = TickerConfig("MSFT", 0xe93237C50D904957Cf27E7B1133b510C669c2e74, 0x45C3C877C15E6BA2EBB19eA114Ea508d14C1Af2E, USDG, 0xe93237C50D904957Cf27E7B1133b510C669c2e74, 3000, 60);
        list[4] = TickerConfig("GOOGL", 0x2e0847E8910a9732eB3fb1bb4b70a580ADAD4FE3, 0xF6f373a037c30F0e5010d854385cA89185AE638b, 0x2e0847E8910a9732eB3fb1bb4b70a580ADAD4FE3, USDG, 3000, 60);
        list[5] = TickerConfig("AMZN", 0x12f190a9F9d7D37a250758b26824B97CE941bF54, 0xD5a1508ceD74c084eBf3cBe853e2C968fB2a651C, 0x12f190a9F9d7D37a250758b26824B97CE941bF54, USDG, 3000, 60);
        list[6] = TickerConfig("META", 0xc0D6457C16Cc70d6790Dd43521C899C87ce02f35, 0x7C38C00C30BEe9378381E7B6135d7283356D71b1, USDG, 0xc0D6457C16Cc70d6790Dd43521C899C87ce02f35, 3000, 60);
        list[7] = TickerConfig("TSLA", 0x322F0929c4625eD5bAd873c95208D54E1c003b2d, 0x4A1166a659A55625345e9515b32adECea5547C38, 0x322F0929c4625eD5bAd873c95208D54E1c003b2d, USDG, 3000, 60);
        list[8] = TickerConfig("COIN", 0x6330D8C3178a418788dF01a47479c0ce7CCF450b, 0xA3a468A452940B7D6b69991207B508c609a98Ef2, USDG, 0x6330D8C3178a418788dF01a47479c0ce7CCF450b, 10000, 200);
        list[9] = TickerConfig("CRCL", 0xdF0992E440dD0be65BD8439b609d6D4366bf1CB5, 0x6652eDf64bA3731C4F2D3ce821A0Fb1f1f6b482a, USDG, 0xdF0992E440dD0be65BD8439b609d6D4366bf1CB5, 3000, 30);
        list[10] = TickerConfig("INTC", 0xc72b96e0E48ecd4DC75E1e45396e26300BC39681, 0x3f390C5C24628Ac7C489515402235FeAD71D1913, USDG, 0xc72b96e0E48ecd4DC75E1e45396e26300BC39681, 10000, 200);
        list[11] = TickerConfig("MU", 0xfF080c8ce2E5feadaCa0Da81314Ae59D232d4afD, 0x425EEFdCf05ed6526C3cE61Af99429A228a6d596, USDG, 0xfF080c8ce2E5feadaCa0Da81314Ae59D232d4afD, 10000, 200);
        list[12] = TickerConfig("SNDK", 0xB90A19fF0Af67f7779afF50A882A9CfF42446400, 0xfb133Fa4B7b385802B693a293606682Df47109A3, USDG, 0xB90A19fF0Af67f7779afF50A882A9CfF42446400, 10000, 200);
        list[13] = TickerConfig("SPCX", 0x4a0E65A3EcceC6dBe60AE065F2e7bb85Fae35eEa, 0xB265810950ba6c5C0Ff821c9963014a56fD8Bffb, 0x4a0E65A3EcceC6dBe60AE065F2e7bb85Fae35eEa, USDG, 10000, 200);
    }

    function test_RankedRealizedCost() external {
        TickerConfig[14] memory list = _tickers();
        uint256 depositUsdg = 2.1e6;
        // Expected value if the swap had ZERO execution cost beyond the
        // protocol's own stated 0.25% fee: net USDG in, USDG ~= $1.
        uint256 expectedNetUsd18 = 2094750 * 1e12; // 2.09475 scaled to 18dp

        console.log("=== RANKED REALIZED COST: real swap execution cost beyond the 0.25% protocol fee ===\n");

        for (uint256 i = 0; i < list.length; i++) {
            TickerConfig memory t = list[i];
            uint256 basketId = i + 1;

            vault.setPriceFeed(t.token, t.feed, 345600);
            vault.setTickerPool(t.token, t.currency0, t.currency1, t.fee, t.tickSpacing, address(0));

            address[] memory tickers = new address[](1);
            tickers[0] = t.token;
            uint256[] memory weights = new uint256[](1);
            weights[0] = 10000;
            vault.createBasket(basketId, t.symbol, t.symbol, tickers, weights, 1_000_000e18, 100_000e18);

            vm.startPrank(deployer);
            IERC20Like(USDG).approve(address(vault), depositUsdg);

            vm.recordLogs();
            vault.mint(basketId, depositUsdg);
            Vm.Log[] memory logs = vm.getRecordedLogs();

            uint256 valueReceivedUsd18;
            for (uint256 j = 0; j < logs.length; j++) {
                if (logs[j].topics[0] == keccak256("Minted(uint256,address,uint256,uint256,uint256)")) {
                    (, valueReceivedUsd18, ) = abi.decode(logs[j].data, (uint256, uint256, uint256));
                }
            }

            // Real realized shortfall vs the zero-execution-cost baseline.
            uint256 shortfall18 = expectedNetUsd18 > valueReceivedUsd18 ? expectedNetUsd18 - valueReceivedUsd18 : 0;
            uint256 shortfallBps = (shortfall18 * 10000) / expectedNetUsd18;

            console.log(string.concat(t.symbol, ": realized value (18dp USD):"), valueReceivedUsd18);
            console.log(string.concat(t.symbol, ": shortfall (bps beyond protocol fee):"), shortfallBps);
            console.log("");

            vm.stopPrank();
        }
    }
}
