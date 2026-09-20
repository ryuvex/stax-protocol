// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {IStaxTwapRegistry} from "./interfaces/IStaxTwapRegistry.sol";

interface IStaxV3Factory {
    function getPool(address a, address b, uint24 fee) external view returns (address);
}
interface IStaxV3Pool {
    function factory() external view returns (address);
    function token0() external view returns (address);
    function token1() external view returns (address);
    function fee() external view returns (uint24);
    function liquidity() external view returns (uint128);
}

/// @notice Immutable route validation and TWAP/execution pool binding for V2.
/// @dev Router factory/hash are internal immutables in Universal Router. These
/// deployment inputs MUST be checked against its verified deployment before use.
contract StaxV3RouteValidator {
    address public immutable router;
    address public immutable factory;
    bytes32 public immutable poolInitCodeHash;
    error InvalidExecutionPool();
    error OraclePoolMismatch();
    error InvalidRegistry();

    constructor(address router_, address factory_, bytes32 poolInitCodeHash_) {
        if (router_.code.length == 0 || factory_.code.length == 0 || poolInitCodeHash_ == 0)
            revert InvalidExecutionPool();
        router = router_;
        factory = factory_;
        poolInitCodeHash = poolInitCodeHash_;
    }

    function validate(address token, address usdg, uint24 fee) public view returns (address pool) {
        (address a, address b) = token < usdg ? (token, usdg) : (usdg, token);
        pool = IStaxV3Factory(factory).getPool(a, b, fee);
        address expected = address(uint160(uint256(keccak256(abi.encodePacked(
            hex"ff", factory, keccak256(abi.encode(a, b, fee)), poolInitCodeHash
        )))));
        if (pool.code.length == 0 || pool != expected || a == b) revert InvalidExecutionPool();
        IStaxV3Pool p = IStaxV3Pool(pool);
        if (p.factory() != factory || p.token0() != a || p.token1() != b || p.fee() != fee || p.liquidity() == 0)
            revert InvalidExecutionPool();
    }

    function quote(address token, address usdg, uint8 usdgDecimals, uint24 fee, address registry)
        external view returns (uint256 price18)
    {
        address pool = validate(token, usdg, fee);
        IStaxTwapRegistry r = IStaxTwapRegistry(registry);
        if (r.poolFor(token) != pool) revert OraclePoolMismatch();
        if (r.usdg() != usdg || r.usdgDecimals() != usdgDecimals ||
            r.tokenDecimals(token) != IERC20Metadata(token).decimals()) revert InvalidRegistry();
        (price18,) = r.quoteUsdg18(token);
        if (price18 == 0) revert InvalidRegistry();
    }
}
