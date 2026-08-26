// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";

contract CheckOffset is Script {
    // Reconstructing the EXACT struct our contract encodes, to build the
    // identical bytes our contract actually sends.
    struct PoolKey {
        address currency0;
        address currency1;
        uint24 fee;
        int24 tickSpacing;
        address hooks;
    }

    struct ExactInputSingleParams {
        PoolKey poolKey;
        bool zeroForOne;
        uint128 amountIn;
        uint128 amountOutMinimum;
        bytes hookData;
    }

    function run() external pure {
        // Real values matching what our contract actually builds for the
        // NVDA swap -- exact same struct, exact same field values.
        PoolKey memory poolKey = PoolKey({
            currency0: 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168,
            currency1: 0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC,
            fee: 3000,
            tickSpacing: 60,
            hooks: address(0)
        });

        ExactInputSingleParams memory params = ExactInputSingleParams({
            poolKey: poolKey,
            zeroForOne: true,
            amountIn: 837900,
            amountOutMinimum: 3818928000000000,
            hookData: ""
        });

        bytes memory encoded = abi.encode(params);

        console.log("Total encoded length:", encoded.length);

        // Read the first 32 bytes (the offset word) exactly the way the
        // real decoder's assembly does: calldataload(params.offset).
        bytes32 firstWord;
        assembly {
            firstWord := mload(add(encoded, 32))
        }

        console.log("First word (offset value), as uint256:", uint256(firstWord));
        console.log("Expected (0x20 = 32):", uint256(32));

        if (uint256(firstWord) == 32) {
            console.log("MATCH -- offset is correct, this is NOT the bug.");
        } else {
            console.log("*** MISMATCH -- this IS the bug. Offset is wrong. ***");
        }
    }
}
