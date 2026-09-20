// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IPreviewVault {
    function baskets(uint256 id) external view returns (string memory, address, uint256, uint256, bool, bool);
    function getBasketComposition(uint256 id) external view returns (address[] memory, uint256[] memory);
    function getBasketTickerDecimals(uint256 id, uint256 index) external view returns (uint8);
    function getOraclePriceUsd18(address token) external view returns (uint256);
    function getBasketNavUsd(uint256 id) external view returns (uint256);
    function basketTickerHoldings(uint256 id, address token) external view returns (uint256);
    function usdg() external view returns (address);
    function usdgDecimals() external view returns (uint8);
}
interface IPreviewShares { function totalSupply() external view returns (uint256); }

/// @dev Shared by execution and previews; keeps the share conversion in one source definition.
library StaxShareMath {
    function shares(uint256 value, uint256 supply, uint256 nav) internal pure returns (uint256) {
        return supply == 0 ? value : (value * (supply + 1)) / (nav + 1);
    }
}

/// @notice Read-only, non-upgradeable oracle estimates. No swaps, custody or administrative setters.
/// @dev Created by V2's constructor and permanently bound to that vault. Constants mirror V2's fixed rules.
contract StaxVaultPreview {
    IPreviewVault public immutable vault;
    error BasketDoesNotExist();
    error MintingPaused();
    error ZeroDeposit();
    error ExceedsMintLimit();
    error ExceedsVaultCap();
    error InitialMintTooSmall();
    error SharesTooLow();
    error RedeemAmountTooSmall();
    error NoSupply();
    error ZeroPayout();
    constructor() { vault = IPreviewVault(msg.sender); }

    /// @notice Estimated shares at oracle prices, after vault fee and allocation/unit rounding.
    /// @dev Excludes DEX fees, price impact, transfer taxes and price movement; not a minimum guarantee.
    function previewMint(uint256 id, uint256 amount) external view returns (uint256 output) {
        (,address token,uint256 cap,uint256 maximum,bool paused,bool exists) = vault.baskets(id);
        require(exists, BasketDoesNotExist());
        require(!paused, MintingPaused());
        require(amount > 0, ZeroDeposit());
        uint256 net = amount - amount * 25 / 10000;
        uint256 usd = vault.getOraclePriceUsd18(vault.usdg());
        uint256 scale = 10 ** (18 - vault.usdgDecimals());
        uint256 value = net * scale * usd / 1e18;
        require(value <= maximum, ExceedsMintLimit());
        uint256 nav = vault.getBasketNavUsd(id);
        require(nav + value <= cap, ExceedsVaultCap());
        uint256 supply = IPreviewShares(token).totalSupply();
        if (supply == 0) require(value >= 2e18, InitialMintTooSmall());
        (address[] memory tickers,uint256[] memory weights) = vault.getBasketComposition(id);
        uint256 acquired;
        for (uint256 i; i < tickers.length; ++i) {
            uint256 portion = net * weights[i] / 10000;
            if (portion == 0) continue;
            uint256 price = vault.getOraclePriceUsd18(tickers[i]);
            uint256 tickerScale = 10 ** (18 - vault.getBasketTickerDecimals(id, i));
            uint256 units = (portion * scale * usd / price) / tickerScale;
            acquired += units * tickerScale * price / 1e18;
        }
        output = StaxShareMath.shares(acquired, supply, nav);
        require(output >= 1e6, SharesTooLow());
    }

    /// @notice Estimated net USDG at oracle prices. No wallet-balance or execution guarantee.
    function previewRedeem(uint256 id, uint256 amount) external view returns (uint256 output) {
        (,address token,,,,bool exists) = vault.baskets(id);
        require(exists, BasketDoesNotExist());
        require(amount >= 1e6, RedeemAmountTooSmall());
        uint256 supply = IPreviewShares(token).totalSupply();
        require(supply > 0 && amount <= supply, NoSupply());
        uint256 usd = vault.getOraclePriceUsd18(vault.usdg());
        uint256 scale = 10 ** (18 - vault.usdgDecimals());
        (address[] memory tickers,) = vault.getBasketComposition(id);
        uint256 gross;
        for (uint256 i; i < tickers.length; ++i) {
            uint256 units = vault.basketTickerHoldings(id, tickers[i]) * amount / supply;
            if (units == 0) continue;
            uint256 value = units * (10 ** (18 - vault.getBasketTickerDecimals(id, i))) * vault.getOraclePriceUsd18(tickers[i]) / 1e18;
            gross += (value * 1e18 / usd) / scale;
        }
        require(gross > 0, ZeroPayout());
        output = gross - gross * 25 / 10000;
    }
}
