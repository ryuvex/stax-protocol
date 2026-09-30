// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Test double for Chainlink's verifier proxy: returns the report data
///         unchanged, or reverts when told to (simulating a bad signature).
contract MockStreamsVerifier {
    bool public rejectAll;
    address public s_feeManager;
    uint256 public calls;

    function setRejectAll(bool v) external { rejectAll = v; }

    function verify(bytes calldata payload, bytes calldata) external payable returns (bytes memory) {
        require(!rejectAll, "MockVerifier: bad signature");
        calls++;
        (, bytes memory reportData) = abi.decode(payload, (bytes32[3], bytes));
        return reportData;
    }
}
