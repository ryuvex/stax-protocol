// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";

/// @notice Tiny, view-only helper for reading REAL, live V4 pool liquidity
/// safely, via Uniswap's own official StateLibrary rather than hand-derived
/// storage slot arithmetic. Holds no funds, has no owner, no admin
/// functions -- purely a read lens. Cheap and safe to deploy.
///
/// V4's PoolManager deliberately doesn't expose simple public getters for
/// pool state (gas optimization via extsload), so this exists purely to
/// make that data easily readable from an off-chain script without
/// re-deriving StateLibrary's internal slot-computation logic from memory
/// -- which would be a dangerous guess to get wrong given this data
/// drives a real routing decision.
contract V4PoolLens {
    using StateLibrary for IPoolManager;

    IPoolManager public immutable poolManager;

    constructor(address _poolManager) {
        poolManager = IPoolManager(_poolManager);
    }

    /// @notice Returns the real, current active liquidity for a given pool.
    /// A higher number here means a deeper, more real pool -- this is the
    /// actual metric to compare across a ticker's candidate pools, not
    /// just "does an Initialize event exist."
    function getLiquidity(bytes32 poolId) external view returns (uint128 liquidity) {
        return poolManager.getLiquidity(PoolId.wrap(poolId));
    }

    /// @notice Batch version -- check many candidate pools in one call,
    /// far cheaper than one transaction per pool given how many
    /// candidates tonight's scan turned up.
    function getLiquidityBatch(bytes32[] calldata poolIds) external view returns (uint128[] memory) {
        uint128[] memory results = new uint128[](poolIds.length);
        for (uint256 i = 0; i < poolIds.length; i++) {
            results[i] = poolManager.getLiquidity(PoolId.wrap(poolIds[i]));
        }
        return results;
    }
}
