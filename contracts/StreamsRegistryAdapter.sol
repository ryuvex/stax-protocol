// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {IStaxTwapRegistry} from "./interfaces/IStaxTwapRegistry.sol";

/// @dev Chainlink Data Streams verifier proxy (per-chain deployment).
interface IVerifierProxy {
    function verify(bytes calldata payload, bytes calldata parameterPayload) external payable returns (bytes memory);
    function s_feeManager() external view returns (address);
}

/// @dev Chainlink Data Streams fee manager (only used when the deployment bills per report).
interface IFeeManager {
    function i_rewardManager() external view returns (address);
    function i_linkAddress() external view returns (address);
}

/// @dev Chainlink AggregatorV3 subset, for the USDG/USD feed.
interface IAggregatorV3 {
    function decimals() external view returns (uint8);
    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80);
}

/// @title StreamsRegistryAdapter
/// @notice Prices tokens from Chainlink Data Streams reports while looking like a
///         Stax TWAP registry, so StaxVaultV2 can switch a TWAP-priced ticker to
///         stream pricing with the existing owner call `setTwapOracle(ticker, this, slippage)`
///         and no vault change.
///
/// How it works: anyone (our keeper, or a user before minting) calls `update(report)`
/// with a signed Data Streams report. The report is handed to Chainlink's verifier
/// proxy; only a report the verifier accepts is stored, so no one can post a fake
/// price. `quoteUsdg18` then serves that price (converted to USDG terms with the
/// same USDG/USD feed the vault uses) as long as it is fresh and the market status
/// is one the token allows.
///
/// Supports RWA report schemas v8 (RWA Standard) and v11 (RWA Advanced).
contract StreamsRegistryAdapter is IStaxTwapRegistry {
    struct TokenConfig {
        bytes32 feedId;          // Data Streams feed id for this token
        address pool;            // V3 pool the vault's route validator expects (poolFor)
        uint8 decimals;          // token decimals, cached
        uint32 maxAge;           // max seconds since observationsTimestamp
        uint32 allowedStatusMask; // bit i set => marketStatus i is accepted
    }
    struct Price {
        uint192 usd18;           // last verified mid price, 18 decimals
        uint32 observedAt;       // report observationsTimestamp
        uint32 marketStatus;
    }

    // ------------------------------------------------------------ report layouts
    struct ReportV8 {
        bytes32 feedId; uint32 validFromTimestamp; uint32 observationsTimestamp;
        uint192 nativeFee; uint192 linkFee; uint32 expiresAt;
        uint64 lastUpdateTimestamp; int192 midPrice; uint32 marketStatus;
    }
    struct ReportV11 {
        bytes32 feedId; uint32 validFromTimestamp; uint32 observationsTimestamp;
        uint192 nativeFee; uint192 linkFee; uint32 expiresAt;
        int192 mid; uint64 lastSeenTimestampNs; int192 bid; int192 bidVolume;
        int192 ask; int192 askVolume; int192 lastTradedPrice; uint32 marketStatus;
    }

    address public immutable override usdg;
    uint8 public immutable override usdgDecimals;
    IVerifierProxy public immutable verifier;
    IAggregatorV3 public immutable usdgUsdFeed;
    uint48 public immutable usdgUsdMaxStaleness;

    address public owner;
    address public pendingOwner;
    address public feeToken; // address(0) => subscription billing, empty parameterPayload

    mapping(address => TokenConfig) public configs;
    mapping(bytes32 => address) public tokenOfFeed;
    mapping(address => Price) public prices;

    event TokenConfigured(address indexed token, bytes32 indexed feedId, address pool, uint32 maxAge, uint32 allowedStatusMask);
    event PriceUpdated(address indexed token, bytes32 indexed feedId, uint192 usd18, uint32 observedAt, uint32 marketStatus);
    event FeeTokenSet(address feeToken);
    event OwnershipTransferStarted(address indexed to);
    event OwnershipTransferred(address indexed from, address indexed to);

    error NotOwner();
    error ZeroAddress();
    error UnknownFeed(bytes32 feedId);
    error UnsupportedSchema(uint16 version);
    error InvalidPrice();
    error ReportExpired();
    error ReportOlderThanStored();
    error TokenNotConfigured(address token);
    error StaleStreamPrice(address token, uint256 age);
    error MarketStatusNotAllowed(address token, uint32 status);
    error StaleUsdgFeed();

    modifier onlyOwner() { if (msg.sender != owner) revert NotOwner(); _; }

    constructor(address _verifier, address _usdg, address _usdgUsdFeed, uint48 _usdgUsdMaxStaleness) {
        if (_verifier == address(0) || _usdg == address(0) || _usdgUsdFeed == address(0)) revert ZeroAddress();
        verifier = IVerifierProxy(_verifier);
        usdg = _usdg;
        usdgDecimals = IERC20Metadata(_usdg).decimals();
        usdgUsdFeed = IAggregatorV3(_usdgUsdFeed);
        usdgUsdMaxStaleness = _usdgUsdMaxStaleness;
        owner = msg.sender;
        emit OwnershipTransferred(address(0), msg.sender);
    }

    // ------------------------------------------------------------ admin
    function setToken(address token, bytes32 feedId, address pool, uint32 maxAge, uint32 allowedStatusMask) external onlyOwner {
        if (token == address(0) || pool == address(0) || feedId == bytes32(0)) revert ZeroAddress();
        bytes32 old = configs[token].feedId;
        if (old != bytes32(0)) delete tokenOfFeed[old];
        configs[token] = TokenConfig({
            feedId: feedId, pool: pool, decimals: IERC20Metadata(token).decimals(),
            maxAge: maxAge, allowedStatusMask: allowedStatusMask
        });
        tokenOfFeed[feedId] = token;
        emit TokenConfigured(token, feedId, pool, maxAge, allowedStatusMask);
    }

    function removeToken(address token) external onlyOwner {
        delete tokenOfFeed[configs[token].feedId];
        delete configs[token];
        delete prices[token];
        emit TokenConfigured(token, bytes32(0), address(0), 0, 0);
    }

    /// @notice Per-report billing only. address(0) keeps the subscription (no fee) path.
    function setFeeToken(address token) external onlyOwner {
        feeToken = token;
        if (token != address(0)) {
            address fm = verifier.s_feeManager();
            if (fm != address(0)) IERC20(token).approve(IFeeManager(fm).i_rewardManager(), type(uint256).max);
        }
        emit FeeTokenSet(token);
    }

    function transferOwnership(address to) external onlyOwner { pendingOwner = to; emit OwnershipTransferStarted(to); }
    function acceptOwnership() external {
        if (msg.sender != pendingOwner) revert NotOwner();
        emit OwnershipTransferred(owner, msg.sender);
        owner = msg.sender; pendingOwner = address(0);
    }

    /// @notice Recover tokens sent here for fees (LINK) if billing changes.
    function sweep(address token, address to, uint256 amount) external onlyOwner { IERC20(token).transfer(to, amount); }

    // ------------------------------------------------------------ updates
    /// @notice Verify a signed Data Streams report through Chainlink's verifier and store its price.
    ///         Permissionless: a fake report fails verification, a real one can only help.
    function update(bytes calldata report) external payable {
        (, bytes memory reportData) = abi.decode(report, (bytes32[3], bytes));
        bytes32 feedId; assembly { feedId := mload(add(reportData, 32)) }
        address token = tokenOfFeed[feedId];
        if (token == address(0)) revert UnknownFeed(feedId);

        bytes memory params = feeToken == address(0) ? bytes("") : abi.encode(feeToken);
        bytes memory verified = verifier.verify{value: msg.value}(report, params);

        uint16 version = (uint16(uint8(verified[0])) << 8) | uint16(uint8(verified[1]));
        int192 mid; uint32 observedAt; uint32 expiresAt; uint32 status;
        if (version == 8) {
            ReportV8 memory r = abi.decode(verified, (ReportV8));
            (mid, observedAt, expiresAt, status) = (r.midPrice, r.observationsTimestamp, r.expiresAt, r.marketStatus);
        } else if (version == 11) {
            ReportV11 memory r = abi.decode(verified, (ReportV11));
            (mid, observedAt, expiresAt, status) = (r.mid, r.observationsTimestamp, r.expiresAt, r.marketStatus);
        } else {
            revert UnsupportedSchema(version);
        }
        if (mid <= 0) revert InvalidPrice();
        if (block.timestamp > expiresAt) revert ReportExpired();
        if (observedAt < prices[token].observedAt) revert ReportOlderThanStored();

        prices[token] = Price({usd18: uint192(mid), observedAt: observedAt, marketStatus: status});
        emit PriceUpdated(token, feedId, uint192(mid), observedAt, status);
    }

    // ------------------------------------------------------------ IStaxTwapRegistry
    function tokenDecimals(address token) external view override returns (uint8) {
        TokenConfig memory c = configs[token];
        if (c.feedId == bytes32(0)) revert TokenNotConfigured(token);
        return c.decimals;
    }

    function poolFor(address token) external view override returns (address) {
        TokenConfig memory c = configs[token];
        if (c.feedId == bytes32(0)) revert TokenNotConfigured(token);
        return c.pool;
    }

    /// @notice USDG per one whole token, 18 decimals. Liquidity is reported as max: depth
    ///         is not a concept for a stream price (execution slippage is bounded by the vault).
    function quoteUsdg18(address token) external view override returns (uint256 usdgAmount18, uint128 harmonicLiquidity) {
        TokenConfig memory c = configs[token];
        if (c.feedId == bytes32(0)) revert TokenNotConfigured(token);
        Price memory p = prices[token];
        uint256 age = block.timestamp - p.observedAt;
        if (p.usd18 == 0 || age > c.maxAge) revert StaleStreamPrice(token, age);
        if ((c.allowedStatusMask >> p.marketStatus) & 1 == 0) revert MarketStatusNotAllowed(token, p.marketStatus);

        (, int256 answer,, uint256 updatedAt,) = usdgUsdFeed.latestRoundData();
        if (answer <= 0 || block.timestamp - updatedAt > usdgUsdMaxStaleness) revert StaleUsdgFeed();
        uint256 usdgUsd18 = uint256(answer) * (10 ** (18 - usdgUsdFeed.decimals()));

        usdgAmount18 = (uint256(p.usd18) * 1e18) / usdgUsd18;
        harmonicLiquidity = type(uint128).max;
    }

    // ------------------------------------------------------------ views
    function isFresh(address token) external view returns (bool) {
        TokenConfig memory c = configs[token]; Price memory p = prices[token];
        return p.usd18 != 0 && block.timestamp - p.observedAt <= c.maxAge && ((c.allowedStatusMask >> p.marketStatus) & 1) == 1;
    }
}
