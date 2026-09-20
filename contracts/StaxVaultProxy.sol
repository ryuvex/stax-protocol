// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {StaxVaultV2} from "./StaxVaultV2.sol";

/// @notice New V2 vault address. Initialization must occur in the deployment transaction.
contract StaxVaultProxy is ERC1967Proxy {
    constructor(address implementation, bytes memory initialization)
        ERC1967Proxy(implementation, initialization)
    {
        require(initialization.length >= 4 && bytes4(initialization) == StaxVaultV2.initialize.selector,
            "Initialization required");
    }
}
