// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Quotes 18-decimal USDG prices per one whole underlying token.
interface IStaxTwapRegistry {
    function usdg() external view returns (address);
    function usdgDecimals() external view returns (uint8);
    function tokenDecimals(address token) external view returns (uint8);
    function poolFor(address token) external view returns (address);
    function quoteUsdg18(address token) external view returns (uint256 usdgAmount18, uint128 harmonicLiquidity);
}
