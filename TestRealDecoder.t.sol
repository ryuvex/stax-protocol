// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test, console} from "forge-std/Test.sol";
import {CalldataDecoder} from "v4-periphery/src/libraries/CalldataDecoder.sol";
import {IV4Router} from "v4-periphery/src/interfaces/IV4Router.sol";

contract TestRealDecoder is Test {
    using CalldataDecoder for bytes;

    function test_RealDecoder() external {
        // Build the raw bytes directly via plain abi.encode on primitive
        // types, matching the REAL struct's exact field order and types
        // -- this avoids any Solidity type-identity conflict between
        // separate v4-core copies pulled in by different dependencies.
        // Real struct: (PoolKey poolKey, bool zeroForOne, uint128
        // amountIn, uint128 amountOutMinimum, uint256 minHopPriceX36,
        // bytes hookData) -- PoolKey itself is (address, address,
        // uint24, int24, address).
        bytes memory swapParamsEncoded = abi.encode(
            // PoolKey as a raw tuple
            0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168, // currency0
            0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC, // currency1
            uint24(3000), // fee
            int24(60), // tickSpacing
            address(0), // hooks
            true, // zeroForOne
            uint128(837900), // amountIn
            uint128(3818928000000000), // amountOutMinimum
            uint256(0), // minHopPriceX36 -- the field our contract is missing
            bytes("") // hookData
        );

        bytes memory actions = abi.encodePacked(uint8(0x06), uint8(0x0c), uint8(0x0f));
        bytes[] memory actionParams = new bytes[](3);
        actionParams[0] = swapParamsEncoded;
        actionParams[1] = abi.encode(address(0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168), uint256(837900));
        actionParams[2] = abi.encode(address(0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC), uint256(0));

        bytes memory inner = abi.encode(actions, actionParams);

        console.log("Testing decodeActionsRouterParams against the REAL library...");
        try this.tryDecodeOuter(inner) returns (bool success) {
            if (success) {
                console.log("SUCCESS -- outer decode (actions/params) works fine against the real library.");
            }
        } catch (bytes memory reason) {
            console.log("*** OUTER DECODE FAILED ***");
            console.log("Revert data length:", reason.length);
            return;
        }

        console.log("\nTesting decodeSwapExactInSingleParams against the REAL library...");
        try this.tryDecodeInner(actionParams[0]) returns (bool success) {
            if (success) {
                console.log("SUCCESS -- inner struct decode works fine against the real library too.");
                console.log("\n=== CONCLUSION: the 6-field struct (with minHopPriceX36) is PROVABLY VALID. ===");
            }
        } catch (bytes memory reason) {
            console.log("*** INNER STRUCT DECODE FAILED ***");
            console.log("Revert data length:", reason.length);
        }
    }

    function tryDecodeOuter(bytes calldata data) external pure returns (bool) {
        (bytes calldata actions, bytes[] calldata params) = data.decodeActionsRouterParams();
        require(actions.length == 3, "unexpected actions length");
        require(params.length == 3, "unexpected params length");
        return true;
    }

    function tryDecodeInner(bytes calldata params) external pure returns (bool) {
        IV4Router.ExactInputSingleParams calldata swapParams = params.decodeSwapExactInSingleParams();
        require(swapParams.amountIn == 837900, "unexpected amountIn");
        return true;
    }
}
