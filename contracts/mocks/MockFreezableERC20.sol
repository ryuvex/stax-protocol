// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Standalone mock, separate from the shared MockERC20Decimals,
/// used ONLY in the frozen-recipient redeem test (Opus review, Finding
/// #5). Mimics the one property of real USDG's trust model that
/// matters for this specific test: Paxos can freeze/block an address,
/// after which transfers TO that address revert. Everything else about
/// this mock is a plain, standard ERC20 -- no other special behavior,
/// keeping the test focused on exactly the one property under test.
contract MockFreezableERC20 is ERC20 {
    uint8 private immutable _decimals;
    mapping(address => bool) public frozen;

    constructor(string memory name_, string memory symbol_, uint8 decimals_) ERC20(name_, symbol_) {
        _decimals = decimals_;
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    /// @notice Mirrors Paxos's real freeze capability at the interface
    /// level (owner/supply-controller-gated in the real contract; open
    /// here since this mock exists solely to be driven by test code,
    /// not to model real-world access control).
    function setFrozen(address account, bool isFrozen) external {
        frozen[account] = isFrozen;
    }

    /// @dev Both _update override points (covers transfer, transferFrom,
    /// mint, and burn under OZ v5's unified internal transfer function)
    /// -- checking the RECIPIENT specifically, since that's the
    /// property this test needs: a redeem payout reverting because the
    /// REDEEMER is frozen, not because the sender is.
    function _update(address from, address to, uint256 value) internal override {
        if (to != address(0)) {
            require(!frozen[to], "MockFreezableERC20: recipient is frozen");
        }
        super._update(from, to, value);
    }
}
