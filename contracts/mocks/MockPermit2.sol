// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Minimal mock of Permit2's allowance-transfer flow -- mimics
/// the real, canonical Permit2 contract's approve()/transferFrom()
/// signatures exactly, since StaxVault now calls these for real (see
/// _approveViaPermit2 in StaxVault.sol). This is NOT the full real
/// Permit2 (no actual permit/signature verification, no expiration
/// enforcement) -- it's scoped to exactly what our contract's real usage
/// pattern needs: a working approve-then-pull flow that a router mock
/// can rely on, matching the real interface shape so test coverage is
/// meaningful for how our contract actually calls it.
contract MockPermit2 {
    // owner => token => spender => amount
    mapping(address => mapping(address => mapping(address => uint160))) public allowance;

    function approve(address token, address spender, uint160 amount, uint48 /* expiration */) external {
        allowance[msg.sender][token][spender] = amount;
    }

    /// @notice Real Permit2's actual transferFrom signature -- called by
    /// routers (here, MockUniversalRouter) to pull previously-approved
    /// tokens on the owner's behalf.
    function transferFrom(address from, address to, uint160 amount, address token) external {
        uint160 current = allowance[from][token][msg.sender];
        require(current >= amount, "MockPermit2: insufficient allowance");
        allowance[from][token][msg.sender] = current - amount;

        require(IERC20(token).transferFrom(from, to, amount), "MockPermit2: transfer failed");
    }
}
