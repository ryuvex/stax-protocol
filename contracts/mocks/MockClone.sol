// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
/// @dev Test-only: deploys a bare EIP-1167 clone of any implementation, bypassing the factory.
contract MockClone {
    address public immutable clone;
    constructor(address implementation) { clone = Clones.clone(implementation); }
}
