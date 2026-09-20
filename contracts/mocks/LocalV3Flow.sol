// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {StaxVaultV2} from "../StaxVaultV2.sol";
import {StaxV3OracleMath} from "../Twap.sol";
import {IStaxTwapRegistry} from "../interfaces/IStaxTwapRegistry.sol";

// Test only: deliberately does not implement oraclePaused().
contract LocalCryptoToken is ERC20 {
    uint8 private immutable precision;
    constructor(uint8 d) ERC20("Local crypto", "CRYPTO") { precision = d; }
    function decimals() public view override returns (uint8) { return precision; }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

interface ILocalPool {
    function token0() external view returns (address);
    function token1() external view returns (address);
    function mint(address recipient, int24 lower, int24 upper, uint128 amount, bytes calldata data) external returns (uint256, uint256);
    function burn(int24 lower, int24 upper, uint128 amount) external returns (uint256, uint256);
    function swap(address recipient, bool zeroForOne, int256 amount, uint160 limit, bytes calldata data) external returns (int256, int256);
}
interface ILocalFactory { function getPool(address a, address b, uint24 fee) external view returns (address); }
interface ILocalPermit { function transferFrom(address from, address to, uint160 amount, address token) external; }

/// @notice Test-only connector to real local V3 pools, not a Universal Router replacement.
/// V3 core handles swaps, observations and liquidity. This fixture handles callbacks.
contract LocalV3Flow {
    address public immutable factory;
    address public immutable permit2;
    address private activePool;
    uint256 public lastMinimum;
    uint256 public lastOutput;

    constructor(address f, address p) { factory = f; permit2 = p; }

    function provide(address pool, uint128 amount) external {
        activePool = pool;
        ILocalPool(pool).mint(address(this), -887220, 887220, amount, "");
        activePool = address(0);
    }
    function remove(address pool, uint128 amount) external { ILocalPool(pool).burn(-887220, 887220, amount); }
    function provideAndQuote(address pool, address registry, address token) external {
        activePool = pool;
        ILocalPool(pool).mint(address(this), -887220, 887220, 1, abi.encode(registry, token));
        activePool = address(0);
    }
    function uniswapV3MintCallback(uint256 amount0, uint256 amount1, bytes calldata data) external {
        require(msg.sender == activePool, "callback");
        if (data.length > 0) {
            (address registry, address token) = abi.decode(data, (address, address));
            IStaxTwapRegistry(registry).quoteUsdg18(token);
        }
        IERC20(ILocalPool(msg.sender).token0()).transfer(msg.sender, amount0);
        IERC20(ILocalPool(msg.sender).token1()).transfer(msg.sender, amount1);
    }
    function execute(bytes calldata commands, bytes[] calldata inputs, uint256 deadline) external payable {
        require(msg.value == 0 && block.timestamp <= deadline && commands.length == 1 && commands[0] == 0 && inputs.length == 1, "command");
        (address recipient, uint256 amount, uint256 minimum, bytes memory path, address payer, uint256[] memory floors) =
            abi.decode(inputs[0], (address, uint256, uint256, bytes, address, uint256[]));
        require(path.length == 43 && payer == msg.sender && floors.length == 0, "path");
        address input;
        address output;
        uint24 fee;
        assembly {
            input := shr(96, mload(add(path, 32)))
            fee := shr(232, mload(add(path, 52)))
            output := shr(96, mload(add(path, 55)))
        }
        address pool = ILocalFactory(factory).getPool(input, output, fee);
        lastMinimum = minimum;
        lastOutput = _swap(pool, recipient, input < output, amount, payer, true);
        require(lastOutput >= minimum, "slippage");
    }
    function trade(address pool, bool zeroForOne, uint256 amount) external {
        _swap(pool, msg.sender, zeroForOne, amount, msg.sender, false);
    }
    function _swap(address pool, address recipient, bool zeroForOne, uint256 amount, address payer, bool permit)
        private returns (uint256)
    {
        require(amount <= uint256(type(int256).max), "amount");
        activePool = pool;
        (int256 a, int256 b) = ILocalPool(pool).swap(recipient, zeroForOne, int256(amount),
            zeroForOne ? 4295128740 : 1461446703485210103287273052203988822378723970341, abi.encode(payer, permit));
        activePool = address(0);
        return uint256(-(zeroForOne ? b : a));
    }
    function uniswapV3SwapCallback(int256 a, int256 b, bytes calldata data) external {
        require(msg.sender == activePool, "callback");
        (address payer, bool permit) = abi.decode(data, (address, bool));
        address token = a > 0 ? ILocalPool(msg.sender).token0() : ILocalPool(msg.sender).token1();
        uint256 amount = uint256(a > 0 ? a : b);
        if (permit) ILocalPermit(permit2).transferFrom(payer, msg.sender, uint160(amount), token);
        else IERC20(token).transferFrom(payer, msg.sender, amount);
    }
}

contract LocalVaultUpgrade is StaxVaultV2 {
    function revision() external pure returns (uint256) { return 2; }
}

/// @dev Explicit accumulator vectors only; not used as a simulated V3 pool.
contract LocalOracleVectors {
    int56 public startTick;
    int56 public endTick;
    uint160 public startLiquidity;
    uint160 public endLiquidity;
    function set(int56 a, int56 b, uint160 c, uint160 d) external {
        startTick = a; endTick = b; startLiquidity = c; endLiquidity = d;
    }
    function observe(uint32[] calldata) external view returns (int56[] memory t, uint160[] memory l) {
        t = new int56[](2); l = new uint160[](2);
        t[0] = startTick; t[1] = endTick; l[0] = startLiquidity; l[1] = endLiquidity;
    }
    function consult(address pool, uint32 window) external view returns (int24, uint128) {
        return StaxV3OracleMath.consult(pool, window);
    }
}
