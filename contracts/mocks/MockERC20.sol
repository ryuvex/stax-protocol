// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockERC20 is ERC20 {
    // v14 fix: real Robinhood stock tokens expose oraclePaused() -- a
    // flag the vault now checks before trusting a price (see
    // StaxVault._tickerUsd18). Defaults to false (normal, unpaused
    // state) so every existing test continues to work unchanged; the
    // setter lets a dedicated test flip this to true to prove the
    // paused-but-fresh-oracle case is actually caught.
    bool public oraclePaused;

    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function setOraclePaused(bool paused) external {
        oraclePaused = paused;
    }
}
