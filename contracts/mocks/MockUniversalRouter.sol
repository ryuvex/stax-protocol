// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IMockPermit2ForRouter {
    function transferFrom(address from, address to, uint160 amount, address token) external;
}

/// @notice Test-only configurable-rate router, not a substitute for real-router fork tests.
/// @dev V3 input field five is a payerIsUser flag. Decoding its word as uint256 models
/// the upstream assembly decoder's nonzero semantics, allowing unchanged V1 regression
/// comparisons. V2 must emit exactly 1; LocalV3Flow tests assert that separately.
/// V4 decoding includes minHopPriceX36. Rates do not model real pool depth or fees.
contract MockUniversalRouter {
    struct PoolKey {
        address currency0;
        address currency1;
        uint24 fee;
        int24 tickSpacing;
        address hooks;
    }

    struct ExactInputSingleParams {
        PoolKey poolKey;
        bool zeroForOne;
        uint128 amountIn;
        uint128 amountOutMinimum;
        uint256 minHopPriceX36; // v18.3 fix: matches the real struct's corrected shape
        bytes hookData;
    }

    address public immutable permit2;
    address public immutable weth;

    // currencyIn => currencyOut => rate (18-decimal fixed point, same
    // convention as the old V3-era mock: amountOut = amountIn * rate / 1e18)
    // v19: shared by both venues -- a test configures one rate per pair
    // regardless of whether that ticker swaps via V4 or V3.
    mapping(address => mapping(address => uint256)) public rates;
    // Test instrumentation: capture the exact vault-supplied execution minimum.
    uint256 public lastMinimum;

    constructor(address _permit2, address _weth) {
        permit2 = _permit2;
        weth = _weth;
    }

    function setRate(address currencyIn, address currencyOut, uint256 rate) external {
        rates[currencyIn][currencyOut] = rate;
    }

    receive() external payable {}

    /// @notice v19: now dispatches on the command byte instead of
    /// hardcoding V4_SWAP -- mirrors the real router's own dispatch
    /// pattern (read the command, branch to the right handler).
    function execute(bytes calldata commands, bytes[] calldata inputs, uint256 /* deadline */)
        external
        payable
    {
        require(commands.length == 1, "MockUniversalRouter: expected exactly 1 command");
        require(inputs.length == 1, "MockUniversalRouter: expected exactly 1 input");

        uint8 command = uint8(commands[0]);

        if (command == 0x10) {
            _executeV4(inputs[0]);
        } else if (command == 0x00) {
            _executeV3(inputs[0]);
        } else {
            revert("MockUniversalRouter: unsupported command (expected V4_SWAP=0x10 or V3_SWAP_EXACT_IN=0x00)");
        }
    }

    /// @notice Unchanged from the pre-v19 mock -- byte-identical logic,
    /// only extracted into its own function so execute() can dispatch
    /// to it alongside the new V3 path.
    function _executeV4(bytes memory input) internal {
        (bytes memory actions, bytes[] memory actionParams) = abi.decode(input, (bytes, bytes[]));

        require(actions.length == 3, "MockUniversalRouter: unexpected action count");
        require(
            uint8(actions[0]) == 0x06 && uint8(actions[1]) == 0x0c && uint8(actions[2]) == 0x0f,
            "MockUniversalRouter: unexpected action sequence (expected SWAP_EXACT_IN_SINGLE, SETTLE_ALL, TAKE_ALL)"
        );

        ExactInputSingleParams memory swapParams = abi.decode(actionParams[0], (ExactInputSingleParams));
        lastMinimum = swapParams.amountOutMinimum;
        (address settleCurrency, uint256 settleAmount) = abi.decode(actionParams[1], (address, uint256));
        (address takeCurrency, uint256 takeMinAmount) = abi.decode(actionParams[2], (address, uint256));

        // Pull the real input.
        if (settleCurrency == address(0)) {
            require(msg.value == settleAmount, "MockUniversalRouter: msg.value must match settleAmount for native ETH input");
        } else {
            require(msg.value == 0, "MockUniversalRouter: unexpected ETH sent for ERC20 input");
            IMockPermit2ForRouter(permit2).transferFrom(msg.sender, address(this), uint160(settleAmount), settleCurrency);
        }

        // Compute output using the configured rate.
        uint256 rate = rates[settleCurrency][takeCurrency];
        require(rate > 0, "MockUniversalRouter: no rate configured for this pair");
        uint256 amountOut = (settleAmount * rate) / 1e18;

        // Real slippage check, matching the manipulation-defense tests'
        // expectations -- swapParams.amountOutMinimum is what StaxVault
        // itself computed and expects to be enforced.
        require(amountOut >= swapParams.amountOutMinimum, "MockUniversalRouter: slippage too high");
        require(amountOut >= takeMinAmount, "MockUniversalRouter: slippage too high");

        // Pay out the real output.
        if (takeCurrency == address(0)) {
            (bool sent, ) = msg.sender.call{value: amountOut}("");
            require(sent, "MockUniversalRouter: ETH payout failed");
        } else {
            require(IERC20(takeCurrency).transfer(msg.sender, amountOut), "MockUniversalRouter: token payout failed");
        }
    }

    /// @dev Single-hop test decoder: recipient, amount, minimum, path, payer flag, hop floors.
    function _executeV3(bytes memory input) internal {
        (
            address recipient,
            uint256 amountIn,
            uint256 amountOutMinimum,
            bytes memory path,
            uint256 payerWord,
            uint256[] memory minHopPriceX36
        ) = abi.decode(input, (address, uint256, uint256, bytes, uint256, uint256[]));
        lastMinimum = amountOutMinimum;

        // Single-hop V3 path length: token(20) + fee(3) + token(20) = 43.
        // minHopPriceX36 isn't used by this mock's rate-based pricing --
        // decoded and left unused deliberately, same as the vault always
        // passing an empty array to disable it.
        minHopPriceX36;
        require(path.length == 43, "MockUniversalRouter: only single-hop V3 paths supported in mock");

        (address tokenIn, uint24 fee, address tokenOut) = _decodeV3SingleHopPath(path);
        fee; // fee tier itself doesn't affect mock pricing -- the configured rate already represents the effective price

        IMockPermit2ForRouter(permit2).transferFrom(payerWord != 0 ? msg.sender : address(this), address(this), uint160(amountIn), tokenIn);

        uint256 rate = rates[tokenIn][tokenOut];
        require(rate > 0, "MockUniversalRouter: no rate configured for this pair");
        uint256 amountOut = (amountIn * rate) / 1e18;

        require(amountOut >= amountOutMinimum, "MockUniversalRouter: slippage too high");

        require(IERC20(tokenOut).transfer(recipient, amountOut), "MockUniversalRouter: token payout failed");
    }

    /// @notice Decodes a packed V3 path (tokenIn, fee, tokenOut) using
    /// the same byte-slicing pattern the real Uniswap/universal-router
    /// Dispatcher.sol uses internally via BytesLib -- copied from the
    /// real, widely-audited standard (this exact assembly pattern
    /// appears in thousands of production contracts) rather than
    /// invented, since a subtly-wrong offset here would silently
    /// decode garbage addresses/fees and defeat the entire point of
    /// this mock existing.
    function _decodeV3SingleHopPath(bytes memory path)
        internal
        pure
        returns (address tokenIn, uint24 fee, address tokenOut)
    {
        require(path.length == 43, "MockUniversalRouter: bad V3 path length");

        assembly {
            // tokenIn: first 20 bytes of the packed data.
            tokenIn := div(mload(add(path, 0x20)), 0x1000000000000000000000000)
            // fee: next 3 bytes, starting at offset 20.
            fee := mload(add(path, 0x23))
            // tokenOut: final 20 bytes, starting at offset 23.
            tokenOut := div(mload(add(path, 0x37)), 0x1000000000000000000000000)
        }
    }
}
