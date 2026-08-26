// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Like MockERC20, but with a configurable decimals count, so we
/// can test the vault's decimal-normalization logic (_to18/_from18) against
/// a token that isn't 18 decimals — e.g. a 6-decimal stablecoin-style token.
contract MockERC20Decimals is ERC20 {
    uint8 private immutable _customDecimals;

    // v14 fix: same oraclePaused() addition as MockERC20 -- see that
    // file's comment for why. Kept identical here so the 6-decimal
    // ticker test path behaves consistently with every other ticker.
    bool public oraclePaused;

    constructor(string memory name_, string memory symbol_, uint8 decimals_)
        ERC20(name_, symbol_)
    {
        _customDecimals = decimals_;
    }

    function decimals() public view override returns (uint8) {
        return _customDecimals;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function setOraclePaused(bool paused) external {
        oraclePaused = paused;
    }
}
