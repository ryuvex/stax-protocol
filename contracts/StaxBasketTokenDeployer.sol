// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {StaxBasketToken} from "./StaxVault.sol";

/// @notice Moves basket-token creation bytecode outside the vault's runtime.
/// @dev No registry or custody. Each token grants mint/burn rights only to its caller.
contract StaxBasketTokenDeployer {
    function deploy(string calldata name, string calldata symbol) external returns (address) {
        return address(new StaxBasketToken(name, symbol, msg.sender));
    }
}
