// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test, console} from "forge-std/Test.sol";

// ============================================================================
// V3 SWAP ENCODING PROOF TEST -- the fork-in-the-road for today's V3 work.
//
// Goal: prove (or disprove) that V3_SWAP_EXACT_IN through the real
// Universal Router works, in complete isolation from the vault. No
// StaxVault involved at all -- this is pure "does our hand-built encoding
// match the real deployed router's expectations."
//
// This is deliberately the same discipline that caught the missing
// minHopPriceX36 field in the V4 struct: don't trust a remembered
// interface, prove it against the real router with a real trade.
//
// Reads the real GME/USDG V3 pool's fee tier directly on-chain (fee())
// rather than trusting the sheet -- one less thing to get wrong.
//
// Command byte and path encoding below are Universal Router's public,
// documented V3 swap interface (V3_SWAP_EXACT_IN = 0x00, path = packed
// tokenIn + fee(uint24) + tokenOut, standard payerIsUser=true flow via
// Permit2). If this test fails, that is the signal this needs re-checking
// against the real router source directly -- same as the V4 fix required.
// ============================================================================

interface IUniswapV3PoolLike {
    function fee() external view returns (uint24);
    function token0() external view returns (address);
    function token1() external view returns (address);
}

interface IUniversalRouterLike {
    function execute(bytes calldata commands, bytes[] calldata inputs, uint256 deadline) external payable;
}

interface IPermit2Like {
    function approve(address token, address spender, uint160 amount, uint48 expiration) external;
}

interface IERC20Like {
    function balanceOf(address) external view returns (uint256);
    function approve(address, uint256) external returns (bool);
}

contract V3EncodingProofTest is Test {
    address constant USDG = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;
    address constant UNIVERSAL_ROUTER = 0x8876789976dEcBfCbBbe364623C63652db8C0904;
    address constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;

    // GME's real V3/USDG pool, from tonight's sheet.
    address constant GME_V3_POOL = 0xE9713f453aDB9245B19559790c96F470a18F2fDF;
    address constant GME = 0x1b0E319c6A659F002271B69dB8A7df2F911c153E;

    address trader = address(0xBEEF);

    function setUp() public {
        vm.createSelectFork("https://rpc.mainnet.chain.robinhood.com");
        deal(USDG, trader, 10e6);
    }

    function test_V3SwapEncoding_USDG_to_GME() external {
        console.log("=== V3 SWAP ENCODING PROOF: USDG -> GME via real Universal Router ===\n");

        // Read the real pool's actual params on-chain -- no guessing.
        uint24 realFee = IUniswapV3PoolLike(GME_V3_POOL).fee();
        address token0 = IUniswapV3PoolLike(GME_V3_POOL).token0();
        address token1 = IUniswapV3PoolLike(GME_V3_POOL).token1();

        console.log("Real pool fee tier:", realFee);
        console.log("token0:", token0);
        console.log("token1:", token1);

        bool usdgIsToken0 = (token0 == USDG);
        console.log("USDG is token0:", usdgIsToken0);

        uint256 amountIn = 2.1e6; // 2.10 USDG, same probe size as every other test tonight
        uint256 amountOutMinimum = 0; // proof test only -- no slippage protection needed here

        // V3 path encoding: packed tokenIn + fee(uint24) + tokenOut
        bytes memory path = abi.encodePacked(USDG, realFee, GME);

        // Universal Router V3_SWAP_EXACT_IN command = 0x00
        bytes memory commands = abi.encodePacked(bytes1(0x00));

        // CORRECTED after first run: real v3SwapExactInput on the current
        // Universal Router takes 6 params, confirmed directly from
        // Uniswap/universal-router's V3SwapRouter.sol source --
        //   (recipient, amountIn, amountOutMinimum, path, payer, minHopPriceX36)
        // The original 5-param (..., bool payerIsUser) encoding was based on
        // an older/different router pattern -- same mistake shape as the V4
        // struct bug, right down to the missing minHopPriceX36 field name.
        //
        // payer = trader (msg.sender): standard "pull via Permit2" pattern.
        // minHopPriceX36 = empty array: explicitly documented as "empty to
        // disable" the per-hop price floor -- matches the vault's existing
        // convention of passing 0 for this same field on the V4 side.
        uint256[] memory minHopPriceX36 = new uint256[](0);

        bytes[] memory inputs = new bytes[](1);
        inputs[0] = abi.encode(
            trader,           // recipient
            amountIn,         // amountIn
            amountOutMinimum, // amountOutMinimum
            path,             // packed path
            trader,           // payer -- pull from trader via Permit2
            minHopPriceX36    // empty = no per-hop price floor
        );

        vm.startPrank(trader);

        // Standard Permit2 flow: approve Permit2 to move USDG, then grant
        // Universal Router an allowance through Permit2.
        IERC20Like(USDG).approve(PERMIT2, type(uint256).max);
        IPermit2Like(PERMIT2).approve(USDG, UNIVERSAL_ROUTER, type(uint160).max, type(uint48).max);

        uint256 gmeBefore = IERC20Like(GME).balanceOf(trader);

        console.log("\nAttempting real V3 swap via Universal Router...");
        try IUniversalRouterLike(UNIVERSAL_ROUTER).execute(commands, inputs, block.timestamp + 300) {
            uint256 gmeAfter = IERC20Like(GME).balanceOf(trader);
            uint256 gmeReceived = gmeAfter - gmeBefore;
            console.log("SWAP SUCCEEDED.");
            console.log("GME received:", gmeReceived);
            console.log("\n=== V3 ENCODING CONFIRMED WORKING AGAINST REAL ROUTER. ===");
            console.log("Safe to proceed with vault V3 integration using this exact pattern.");
        } catch (bytes memory reason) {
            console.log("SWAP REVERTED.");
            if (reason.length >= 4) {
                bytes4 selector;
                assembly { selector := mload(add(reason, 32)) }
                console.log("Revert selector:");
                console.logBytes4(selector);
                console.log("Raw revert data length:", reason.length);
            } else {
                console.log("EMPTY revert data, length:", reason.length);
                console.log("(Same signature class as the V4 struct bug -- check encoding");
                console.log(" against the real Universal Router / V3 periphery source directly,");
                console.log(" don't re-guess from memory.)");
            }
            console.log("\n=== V3 ENCODING NOT YET PROVEN. Diagnose before building vault changes. ===");
        }
        vm.stopPrank();
    }
}
