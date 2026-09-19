// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";

interface ITwapV3Pool {
    function factory() external view returns (address);
    function token0() external view returns (address);
    function token1() external view returns (address);
    function fee() external view returns (uint24);
    function liquidity() external view returns (uint128);
    function slot0() external view returns (
        uint160 sqrtPriceX96, int24 tick, uint16 observationIndex,
        uint16 observationCardinality, uint16 observationCardinalityNext,
        uint8 feeProtocol, bool unlocked
    );
    function observations(uint256 index) external view returns (
        uint32 blockTimestamp, int56 tickCumulative,
        uint160 secondsPerLiquidityCumulativeX128, bool initialized
    );
    function observe(uint32[] calldata secondsAgos) external view returns (
        int56[] memory tickCumulatives, uint160[] memory secondsPerLiquidityCumulativeX128s
    );
}

interface ITwapV3Factory {
    function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address);
}

/// @dev Solidity 0.8 adaptation of Uniswap v3-periphery OracleLibrary.consult
/// and its quote calculation (GPL-2.0-or-later):
/// https://github.com/Uniswap/v3-periphery/blob/v1.4.4/contracts/libraries/OracleLibrary.sol
/// Uses the repository's locked Solidity-0.8 Uniswap math libraries. Importing
/// shared math from v4-core DOES NOT make this an oracle for V4 pools.
/// Changes: explicit signed divisor; unchecked cumulative subtraction preserves
/// V3 accumulator wraparound; quote helper also accepts the actual spot sqrt price.
library StaxV3OracleMath {
    function consult(address pool, uint32 window) internal view returns (int24 tick, uint128 meanLiquidity) {
        require(window != 0, "Zero window");
        uint32[] memory secondsAgos = new uint32[](2);
        secondsAgos[0] = window;
        (int56[] memory ticks, uint160[] memory liquidities) = ITwapV3Pool(pool).observe(secondsAgos);
        int56 tickDelta;
        uint160 liquidityDelta;
        unchecked {
            tickDelta = ticks[1] - ticks[0];
            liquidityDelta = liquidities[1] - liquidities[0];
        }
        int56 divisor = int56(uint56(window));
        tick = int24(tickDelta / divisor);
        if (tickDelta < 0 && tickDelta % divisor != 0) tick--;
        uint192 secondsX160 = uint192(window) * type(uint160).max;
        meanLiquidity = uint128(secondsX160 / (uint192(liquidityDelta) << 32));
    }

    function quote(uint160 sqrtPriceX96, uint128 amount, bool baseIsToken0) internal pure returns (uint256) {
        if (sqrtPriceX96 <= type(uint128).max) {
            uint256 ratioX192 = uint256(sqrtPriceX96) * sqrtPriceX96;
            return baseIsToken0
                ? FullMath.mulDiv(ratioX192, amount, 1 << 192)
                : FullMath.mulDiv(1 << 192, amount, ratioX192);
        }
        uint256 ratioX128 = FullMath.mulDiv(sqrtPriceX96, sqrtPriceX96, 1 << 64);
        return baseIsToken0
            ? FullMath.mulDiv(ratioX128, amount, 1 << 128)
            : FullMath.mulDiv(1 << 128, amount, ratioX128);
    }
}

/// @notice Draft V3 TWAP quote registry. Holds no assets and executes no trades.
/// @dev NOT a Chainlink adapter or a drop-in feed for the existing StaxVault.
/// The future vault TWAP branch must convert raw USDG quotes through its existing
/// USDG/USD feed and preserve its sequencer checks. No safe parameters are implied.
contract UnifiedTwapRegistry is Ownable2Step {
    uint256 private constant BPS = 10_000;
    address public immutable usdg;
    uint8 public immutable usdgDecimals;
    address public immutable trustedFactory;

    struct SafetyParams {
        address pool;
        uint32 twapWindow;
        uint32 maxObservationAge;
        uint128 minCurrentLiquidity;
        uint128 minHarmonicLiquidity;
        uint16 maxDeviationBps;
    }

    mapping(address => SafetyParams) public tokenConfigurations;
    mapping(address => uint8) public tokenDecimals;

    error InvalidConfiguration();
    error InvalidPool();
    error UnsupportedDecimals();
    error TokenNotConfigured();
    error PoolLocked();
    error InsufficientLiquidity();
    error StaleObservation();
    error InvalidPrice();
    error ExcessiveDeviation();

    event TokenConfigured(address indexed token, SafetyParams params, uint8 decimals);
    event TokenRemoved(address indexed token);

    constructor(address initialOwner, address quoteToken, address factory) Ownable(initialOwner) {
        if (quoteToken.code.length == 0 || factory.code.length == 0) revert InvalidConfiguration();
        usdg = quoteToken;
        trustedFactory = factory;
        uint8 decimals_ = IERC20Metadata(quoteToken).decimals();
        if (decimals_ > 18) revert UnsupportedDecimals();
        usdgDecimals = decimals_;
    }

    /// @notice Register or update a reviewed token configuration; no default window.
    /// @dev Owner-selected factory must itself be independently verified before deployment.
    function configureToken(address token, SafetyParams calldata params) external onlyOwner {
        if (token == usdg || token.code.length == 0 || params.pool.code.length == 0) revert InvalidPool();
        if (params.twapWindow == 0 || params.maxObservationAge == 0 ||
            params.maxObservationAge > params.twapWindow || params.minCurrentLiquidity == 0 ||
            params.minHarmonicLiquidity == 0 || params.maxDeviationBps == 0 ||
            params.maxDeviationBps >= BPS) revert InvalidConfiguration();
        ITwapV3Pool pool = ITwapV3Pool(params.pool);
        address first = pool.token0();
        address second = pool.token1();
        if (!((first == token && second == usdg) || (first == usdg && second == token)) ||
            pool.factory() != trustedFactory ||
            ITwapV3Factory(trustedFactory).getPool(token, usdg, pool.fee()) != params.pool) revert InvalidPool();
        uint8 decimals_ = IERC20Metadata(token).decimals();
        if (decimals_ > 18) revert UnsupportedDecimals();
        // Reject insufficient history, stale observations or unsafe current state now,
        // and repeat those checks on every quote. A reverting update is atomic.
        _quote(token, decimals_, params);
        tokenConfigurations[token] = params;
        tokenDecimals[token] = decimals_;
        emit TokenConfigured(token, params, decimals_);
    }

    /// @notice Disables quotes for this token. Can also halt dependent redemptions;
    /// operational use requires the vault's reviewed emergency procedure.
    function removeToken(address token) external onlyOwner {
        if (tokenConfigurations[token].pool == address(0)) revert TokenNotConfigured();
        delete tokenConfigurations[token];
        delete tokenDecimals[token];
        emit TokenRemoved(token);
    }

    /// @return usdgAmount Raw USDG units per ONE whole token (not a USD price).
    /// @return harmonicLiquidity Time-weighted harmonic in-range liquidity, not dollar depth.
    function quoteUsdg(address token) external view returns (uint256 usdgAmount, uint128 harmonicLiquidity) {
        SafetyParams memory params = tokenConfigurations[token];
        if (params.pool == address(0)) revert TokenNotConfigured();
        return _quote(token, tokenDecimals[token], params);
    }

    function _quote(address token, uint8 decimals_, SafetyParams memory params)
        private view returns (uint256 twapQuote, uint128 harmonicLiquidity)
    {
        ITwapV3Pool pool = ITwapV3Pool(params.pool);
        (uint160 spotSqrtPrice, , uint16 index, , , , bool unlocked) = pool.slot0();
        if (!unlocked) revert PoolLocked();
        if (spotSqrtPrice < TickMath.MIN_SQRT_PRICE || spotSqrtPrice >= TickMath.MAX_SQRT_PRICE) revert InvalidPrice();
        (uint32 timestamp, , , bool initialized) = pool.observations(index);
        uint32 age;
        unchecked { age = uint32(block.timestamp) - timestamp; }
        if (!initialized || age > params.maxObservationAge) revert StaleObservation();
        if (pool.liquidity() < params.minCurrentLiquidity) revert InsufficientLiquidity();
        int24 meanTick;
        (meanTick, harmonicLiquidity) = StaxV3OracleMath.consult(params.pool, params.twapWindow);
        if (harmonicLiquidity < params.minHarmonicLiquidity) revert InsufficientLiquidity();
        uint128 baseAmount = uint128(10 ** uint256(decimals_));
        bool baseIsToken0 = token < usdg;
        twapQuote = StaxV3OracleMath.quote(TickMath.getSqrtPriceAtTick(meanTick), baseAmount, baseIsToken0);
        uint256 spotQuote = StaxV3OracleMath.quote(spotSqrtPrice, baseAmount, baseIsToken0);
        if (twapQuote == 0 || spotQuote == 0) revert InvalidPrice();
        uint256 difference = spotQuote > twapQuote ? spotQuote - twapQuote : twapQuote - spotQuote;
        if (difference > FullMath.mulDiv(twapQuote, params.maxDeviationBps, BPS)) revert ExcessiveDeviation();
    }
}
