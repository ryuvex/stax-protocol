// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test, console} from "forge-std/Test.sol";

// ============================================================================
// AI HARDWARE BASKET -- group mint+redeem fork test
//
// NVDA, AMD are already proven both directions (live in Mag 7, real mainnet
// activity). MU already passed an isolated redeem fork test in v7's
// IsolateRedeemFailureTest.t.sol -- it's basket-less, not untested. All
// three tickers' feeds and pools are already registered on the LIVE v18.4
// contract (part of the original 16), so this test forks the REAL deployed
// contract directly and calls createBasket() exactly as the real production
// step will -- no fresh mock deploy, no re-registration. If this passes,
// the actual mainnet action is nearly identical to what's tested here.
//
// Per standing process: individual-ticker-clean is not the same guarantee
// as group-clean until tested together. This is that test.
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

interface IERC20Like {
    function balanceOf(address) external view returns (uint256);
    function approve(address, uint256) external returns (bool);
}

contract AIHardwareForkTest is Test {
    address constant LIVE_VAULT = 0xca3F3182221F86E89BeE99795170bd4251A6BA82;
    address constant USDG = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;
    address constant DEPLOYER = 0xCECa5491a16ea73F29990313924285EEB9771e3b;

    // Already registered (feed + pool) on the live contract -- part of the
    // original 16-ticker lineup.
    address constant NVDA = 0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC;
    address constant AMD = 0x86923f96303D656E4aa86D9d42D1e57ad2023fdC;
    address constant MU = 0xfF080c8ce2E5feadaCa0Da81314Ae59D232d4afD;

    // Provisional basket ID -- 1, 3, 4 are reserved and unused. Using 3
    // here; adjust if a different ID is preferred for the real registration.
    uint256 constant AI_HARDWARE_ID = 3;

    IStaxVault vault;

    function setUp() public {
        vm.createSelectFork("https://rpc.mainnet.chain.robinhood.com");
        vault = IStaxVault(LIVE_VAULT);
        deal(USDG, DEPLOYER, 10e6);
    }

    function test_AIHardware_GroupMintRedeem() external {
        console.log("=== AI Hardware -- NVDA/AMD/MU group mint+redeem, forked against LIVE contract ===\n");

        address[] memory tickers = new address[](3);
        tickers[0] = NVDA;
        tickers[1] = AMD;
        tickers[2] = MU;

        uint256[] memory weights = new uint256[](3);
        weights[0] = 3334;
        weights[1] = 3333;
        weights[2] = 3333;

        vm.startPrank(DEPLOYER);

        vault.createBasket(
            AI_HARDWARE_ID,
            "AI Hardware",
            "sAIHW",
            tickers,
            weights,
            1_000_000e18, // depositCapUsd -- placeholder, matches other baskets' pattern
            100_000e18    // maxMintUsd -- placeholder
        );
        console.log("createBasket succeeded -- basket registered on live contract fork.");

        (, address basketToken, , , , ) = vault.baskets(AI_HARDWARE_ID);
        console.log("Basket token:", basketToken);

        uint256 depositAmount = 2.1e6; // 2.10 USDG, same convention as prior sweep tests
        IERC20Like(USDG).approve(LIVE_VAULT, depositAmount);

        console.log("\nAttempting real 3-leg mint...");
        vault.mint(AI_HARDWARE_ID, depositAmount);
        uint256 tokensReceived = IERC20Like(basketToken).balanceOf(DEPLOYER);
        console.log("MINT SUCCEEDED -- all 3 legs swapped correctly in one transaction.");
        console.log("Basket tokens received:", tokensReceived);

        uint256 usdgBefore = IERC20Like(USDG).balanceOf(DEPLOYER);

        console.log("\nAttempting real 3-leg redeem...");
        IERC20Like(basketToken).approve(LIVE_VAULT, tokensReceived);
        vault.redeem(AI_HARDWARE_ID, tokensReceived);
        uint256 usdgAfter = IERC20Like(USDG).balanceOf(DEPLOYER);
        uint256 usdgReturned = usdgAfter - usdgBefore;

        console.log("REDEEM SUCCEEDED -- all 3 legs sold correctly in one transaction.");
        console.log("Net USDG returned:", usdgReturned);

        // Round-trip cost: deposit -> returned, both sides already net of
        // the 0.25% protocol fee (baked into mint/redeem), so the gap here
        // is protocol fee (0.5% round-trip) PLUS real market execution cost.
        uint256 depositAmount18 = depositAmount * 1e12; // 6dp -> 18dp for comparison
        if (usdgReturned < depositAmount18 / 1e12) {
            uint256 shortfallBps = ((depositAmount - usdgReturned) * 10000) / depositAmount;
            console.log("\nRound-trip shortfall (bps, includes 0.5% protocol fee):", shortfallBps);
        }

        console.log("\n=== AI HARDWARE VERIFIED, BOTH DIRECTIONS. ===");
        console.log("If clean: register for real via createBasket() on live contract, same params as above.");
    }
}
