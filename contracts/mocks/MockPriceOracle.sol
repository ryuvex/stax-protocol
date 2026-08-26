// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Mock Chainlink-style price feed with real round history, so we
/// can test TWAP logic against multiple historical prices, not just a
/// single static value.
contract MockPriceOracle {
    struct Round {
        int256 answer;
        uint256 startedAt;
        uint256 updatedAt;
    }

    uint8 private _decimals;
    uint80 private _latestRoundId;
    mapping(uint80 => Round) private _rounds;

    constructor(int256 initialPrice, uint8 decimals_) {
        _decimals = decimals_;
        _latestRoundId = 1;
        _rounds[1] = Round({
            answer: initialPrice,
            startedAt: block.timestamp,
            updatedAt: block.timestamp
        });
    }

    function decimals() external view returns (uint8) {
        return _decimals;
    }

    function latestRoundData() external view returns (
        uint80 roundId,
        int256 answer,
        uint256 startedAt,
        uint256 updatedAt,
        uint80 answeredInRound
    ) {
        Round memory r = _rounds[_latestRoundId];
        return (_latestRoundId, r.answer, r.startedAt, r.updatedAt, _latestRoundId);
    }

    function getRoundData(uint80 _roundId) external view returns (
        uint80 roundId,
        int256 answer,
        uint256 startedAt,
        uint256 updatedAt,
        uint80 answeredInRound
    ) {
        // Mirrors real Chainlink behavior: reverts for a round that
        // doesn't exist, rather than returning zeroed-out data.
        require(_roundId > 0 && _roundId <= _latestRoundId, "MockPriceOracle: round not found");
        Round memory r = _rounds[_roundId];
        return (_roundId, r.answer, r.startedAt, r.updatedAt, _roundId);
    }

    /// @notice Simulates a new price update coming in right now — pushes a
    /// new round timestamped at the current block.
    function setPrice(int256 newPrice) external {
        _latestRoundId += 1;
        _rounds[_latestRoundId] = Round({
            answer: newPrice,
            startedAt: block.timestamp,
            updatedAt: block.timestamp
        });
    }

    /// @notice Test helper: push a round with a specific price AND a
    /// manually controlled timestamp, so tests can simulate "this price
    /// was live N minutes ago" for TWAP window testing.
    function setPriceAt(int256 newPrice, uint256 updatedAt_) external {
        _latestRoundId += 1;
        _rounds[_latestRoundId] = Round({
            answer: newPrice,
            startedAt: updatedAt_,
            updatedAt: updatedAt_
        });
    }
}
