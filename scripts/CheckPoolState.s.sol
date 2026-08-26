// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {StateLibrary} from "v4-core/libraries/StateLibrary.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "v4-core/types/PoolId.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";

contract CheckPoolState is Script {
    using StateLibrary for IPoolManager;
    using PoolIdLibrary for PoolKey;

    IPoolManager constant POOL_MANAGER = IPoolManager(0x8366a39CC670B4001A1121B8F6A443A643e40951);
    address constant USDG = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;

    // The exact registered pool configs for AI Infrastructure's 3 tickers,
    // matching exactly what setTickerPool was called with in the deploy script.
    function run() external view {
        checkPool("NVDA", USDG, 0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC, 3000, 60);
        checkPool("AMD", USDG, 0x86923f96303D656E4aa86D9d42D1e57ad2023fdC, 10000, 200);
        // TSM is registered with reversed currency order (TSM as currency0)
        checkPool("TSM", 0x58FfE4a942d3885bAa22D7520691F611EF09e7AA, USDG, 400000, 8000);
    }

    function checkPool(
        string memory symbol,
        address currency0,
        address currency1,
        uint24 fee,
        int24 tickSpacing
    ) internal view {
        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(currency0),
            currency1: Currency.wrap(currency1),
            fee: fee,
            tickSpacing: tickSpacing,
            hooks: IHooks(address(0))
        });

        PoolId poolId = key.toId();

        (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee) = POOL_MANAGER.getSlot0(poolId);

        console.log("=== %s ===", symbol);
        console.log("  currency0:", currency0);
        console.log("  currency1:", currency1);
        console.log("  fee:", fee);
        console.log("  tickSpacing:", uint256(int256(tickSpacing)));
        console.log("  sqrtPriceX96:", sqrtPriceX96);
        console.log("  tick:", int256(tick));
        console.log("  lpFee:", lpFee);
        if (sqrtPriceX96 == 0) {
            console.log("  *** UNINITIALIZED -- this pool does NOT exist at this exact key ***");
        } else {
            console.log("  OK -- genuinely initialized");
        }
        console.log("");
    }
}
