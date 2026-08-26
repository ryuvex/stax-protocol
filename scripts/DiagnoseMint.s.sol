// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";

interface IStaxVaultMint {
    function mint(uint256 basketId, uint256 usdgAmount) external;
}

contract DiagnoseMint is Script {
    address constant VAULT = 0x420943e5A26efFfaD91eD968cC4C4322a19306b2;
    address constant DEPLOYER = 0xCECa5491a16ea73F29990313924285EEB9771e3b;

    function run() external {
        vm.startPrank(DEPLOYER);

        console.log("Attempting mint, capturing RAW revert bytes manually...");

        try IStaxVaultMint(VAULT).mint(1, 2_100_000) {
            console.log("SUCCEEDED (unexpected)");
        } catch (bytes memory reason) {
            console.log("=== RAW REVERT BYTES ===");
            console.logBytes(reason);
            console.log("Length:", reason.length);

            if (reason.length >= 4) {
                bytes4 selector;
                assembly {
                    selector := mload(add(reason, 32))
                }
                console.log("First 4 bytes (potential selector):");
                console.logBytes4(selector);
            } else {
                console.log("Reason is shorter than 4 bytes -- genuinely empty or malformed, not a standard custom error.");
            }
        }

        vm.stopPrank();
    }
}
