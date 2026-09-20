// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts/proxy/utils/UUPSUpgradeable.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IPriceOracle, IPausableToken, IPermit2, IUniversalRouter, PoolKey, V3PoolConfig, ExactInputSingleParams, StaxBasketToken} from "./StaxVault.sol";
import {StaxV3RouteValidator} from "./StaxV3RouteValidator.sol";
import {StaxBasketTokenDeployer} from "./StaxBasketTokenDeployer.sol";

/// @notice Review draft for a NEW vault; never install over a V1 deployment.
/// @dev Ownable ownership is explicitly set in initialize. The locked OZ 5.6
/// guard accepts zero as not-entered; nonReentrant initialization seeds its
/// namespaced proxy storage to NOT_ENTERED on exit. Preserve storage layout
/// and dependency versions for all subsequent upgrades.
contract StaxVaultV2 is ReentrancyGuard, Ownable2Step, Initializable, UUPSUpgradeable {
    using SafeERC20 for IERC20;

    error ZeroRewardsPool();
    error ZeroTreasury();
    error ZeroUniversalRouter();
    error ZeroPermit2();
    error ZeroUsdg();
    error ZeroUsdgUsdFeed();
    error ZeroStalenessWindow();
    error FeedDecimalsTooHigh();
    error UsdgDecimalsTooHigh();
    error StaxTokenAlreadySet();
    error ZeroStaxToken();
    error ZeroTicker();
    error ZeroFeed();
    error FeedAlreadySet();
    error FeedNotSet();
    error ZeroHook();
    error TickerNotInPool();
    error IdenticalCurrencies();
    error NotPairedWithUsdg();
    error PoolAlreadySet();
    error HasV3Pool();
    error HookNotAllowlisted();
    error CurrenciesNotOrdered();
    error PoolNotSet();
    error V3PoolAlreadySet();
    error HasV4Pool();
    error NoV3Pool();
    error StaxTokenNotSet();
    error StaxPoolAlreadySet();
    error StaxTokenNotInPool();
    error StaxPoolNeedsUsdg();
    error BasketAlreadyExists();
    error EmptyBasket();
    error LengthMismatch();
    error ZeroDepositCap();
    error ZeroMaxMint();
    error NoTickerFeed();
    error TokenDecimalsTooHigh();
    error DuplicateTicker();
    error WeightsSumMismatch();
    error BasketDoesNotExist();
    error ZeroCap();
    error SequencerDown();
    error SequencerNotInit();
    error GracePeriodActive();
    error InvalidOraclePrice();
    error StaleOraclePrice();
    error NoFeed();
    error OraclePausedErr();
    error PoolNotUsdgPaired();
    error NothingToClaim();
    error MintingPaused();
    error ZeroDeposit();
    error NoUsdgReceived();
    error ExceedsMintLimit();
    error ExceedsVaultCap();
    error InitialMintTooSmall();
    error NoValueReceived();
    error SharesTooLow();
    error AmountMustBeNonzero();
    error RedeemAmountTooSmall();
    error NoSupply();
    error ZeroPayout();
    error StaxPoolNotSet();
    error NothingToBuyBurn();
    error MinStaxOutMustBeSet();
    error StaxPoolNotUsdgPaired();

    struct FeedConfig {
        address feed;
        uint48 maxStaleness;
    }

    struct Basket {
        string name;
        address token;
        address[] tickers;
        uint256[] weights;
        uint8[] tickerDecimals;
        uint256 depositCapUsd;
        uint256 maxMintUsd;
        bool mintPaused;
        bool exists;
    }

    uint256 public constant FEE_BPS = 25;
    uint256 public constant BPS_DENOMINATOR = 10_000;
    // Legacy getter retained for ABI compatibility; swaps use tickerSlippageBps.
    uint256 public constant MAX_SLIPPAGE_BPS = 200;
    uint256 public constant FEE_BURN_SHARE_BPS = 5000;     // 50%
    uint256 public constant FEE_REWARDS_SHARE_BPS = 3000;  // 30%
    uint256 public constant FEE_TREASURY_SHARE_BPS = 2000; // 20%
    uint256 public constant SEQUENCER_GRACE_PERIOD = 3600;
    uint256 public constant VIRTUAL_SHARES = 1;
    uint256 public constant MIN_INITIAL_VALUE_USD = 2e18;
    uint256 public constant MIN_TOKENS_OUT = 1e6;

    uint256 public constant MIN_TOKENS_IN = 1e6;

    uint48 public constant USDG_STALENESS_CONFIRMED_REFERENCE = 27 hours;

    address public permit2;

    address public constant DEAD_ADDRESS = 0x000000000000000000000000000000000000dEaD;

    address public rewardsPool;
    address public treasury;
    address public staxToken;
    address public universalRouter;

    address public usdg;

    uint8 public usdgDecimals;

    address public usdgUsdFeed;
    uint48 public usdgUsdMaxStaleness;
    address public sequencerUptimeFeed;

    mapping(uint256 => Basket) public baskets;
    mapping(address => FeedConfig) public priceFeeds;

    mapping(address => PoolKey) public tickerPools;

    mapping(address => V3PoolConfig) public tickerPoolsV3;

    mapping(address => bool) public tickerIsV3;

    mapping(address => bool) public allowedHooks;

    PoolKey public staxSwapPool;

    mapping(uint256 => mapping(address => uint256)) public basketTickerHoldings;

    uint256 public pendingBuyBurn;
    uint256 public pendingRewardsPool;
    uint256 public pendingTreasuryFees;

    enum OracleType { NONE, CHAINLINK, TWAP }
    struct OracleSettings { OracleType oracleType; address registry; }
    struct LegacyTicker { address ticker; address feed; uint48 maxStaleness; }
    mapping(address => OracleSettings) public oracleSettings;
    mapping(address => uint16) public tickerSlippageBps;
    StaxBasketTokenDeployer public basketTokenDeployer;
    StaxV3RouteValidator public routeValidator;
    uint256[47] private __gap;

    error InvalidOracleConfiguration();
    error InvalidSlippage();
    error UserLimitNotMet();
    error Expired();
    error UseBoundedEntryPoint();
    event OracleConfigured(address indexed ticker, OracleType oracleType, address registry);
    event TickerSlippageSet(address indexed ticker, uint16 bps);

    /// @dev Deploy with the reviewed governance owner (preferably a multisig).
    function _authorizeUpgrade(address) internal override onlyOwner {}

    function renounceOwnership() public view override onlyOwner { revert InvalidOracleConfiguration(); }

    function setTickerSlippage(address ticker, uint16 bps) external onlyOwner {
        require(oracleSettings[ticker].oracleType != OracleType.NONE, NoFeed());
        _setSlippage(ticker, bps);
    }

    function _setSlippage(address ticker, uint16 bps) private {
        require(bps > 0 && bps < BPS_DENOMINATOR, InvalidSlippage());
        tickerSlippageBps[ticker] = bps;
        emit TickerSlippageSet(ticker, bps);
    }

    function _slippage(address ticker) internal view returns (uint256 bps) {
        bps = tickerSlippageBps[ticker];
        require(bps > 0 && bps < BPS_DENOMINATOR, InvalidSlippage());
    }

    /// @notice Register crypto pricing or replace its registry. Stock registrations
    /// cannot switch to TWAP and thereby bypass their oraclePaused check.
    function setTwapOracle(address ticker, address registry, uint16 slippageBps) external onlyOwner {
        require(ticker != usdg && ticker.code.length > 0 && registry.code.length > 0, InvalidOracleConfiguration());
        require(oracleSettings[ticker].oracleType != OracleType.CHAINLINK, InvalidOracleConfiguration());
        _twapUsdg18(ticker, registry);
        oracleSettings[ticker] = OracleSettings(OracleType.TWAP, registry);
        _setSlippage(ticker, slippageBps);
        emit OracleConfigured(ticker, OracleType.TWAP, registry);
    }

    function _requireOracleConfigured(address ticker) internal view {
        OracleSettings memory settings = oracleSettings[ticker];
        if (settings.oracleType == OracleType.CHAINLINK) {
            require(priceFeeds[ticker].feed != address(0), NoTickerFeed());
        } else if (settings.oracleType == OracleType.TWAP) {
            _twapUsdg18(ticker, settings.registry);
        } else { revert NoTickerFeed(); }
        _slippage(ticker);
    }

    event PriceFeedSet(address indexed ticker, address feed, uint48 maxStaleness);
    event TickerPoolSet(address indexed ticker, address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks);
    event TickerPoolV3Set(address indexed ticker, uint24 fee);
    event StaxSwapPoolSet(address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks);
    event HookAllowlistUpdated(address indexed hook, bool allowed);
    event BasketCreated(uint256 indexed basketId, address token, string name);
    event MintPausedSet(uint256 indexed basketId, bool paused);
    event CapsSet(uint256 indexed basketId, uint256 depositCapUsd, uint256 maxMintUsd);
    event Minted(
        uint256 indexed basketId,
        address indexed user,
        uint256 usdgIn,
        uint256 valueReceivedUsd,
        uint256 tokensOut
    );
    event Redeemed(
        uint256 indexed basketId,
        address indexed user,
        uint256 tokensIn,
        uint256 usdgOut,
        uint256 valueReturnedUsd
    );
    event FeeAccrued(uint256 indexed basketId, uint256 usdgAmount);
    event FeeSplit(uint256 toBurn, uint256 toRewardsPool, uint256 toTreasury);
    event BuyBurnExecuted(uint256 usdgSpent, uint256 staxBurned);
    event RewardsPoolClaimed(uint256 amount);
    event TreasuryFeesClaimed(uint256 amount);
    event StaxTokenSet(address staxToken);

    /// @dev No usable implementation owner; proxy ownership is initialized explicitly.
    constructor() Ownable(address(1)) { _disableInitializers(); }

    /// @notice Called atomically by StaxVaultProxy's constructor. The supplied
    /// legacy ticker list registers Chainlink settings and 200 bps in one transaction.
    /// This creates fresh state; it does not copy V1 baskets or balances.
    function initialize(
        address initialOwner,
        address tokenDeployer,
        LegacyTicker[] calldata legacyTickers,
        address _rewardsPool,
        address _treasury,
        address _universalRouter,
        address _permit2,
        address _usdg,
        address _usdgUsdFeed,
        uint48 _usdgUsdMaxStaleness,
        address _sequencerUptimeFeed,
        address validator
    ) external initializer nonReentrant {
        require(initialOwner != address(0), OwnableInvalidOwner(address(0)));
        _transferOwnership(initialOwner);
        require(StaxV3RouteValidator(validator).router() == _universalRouter, InvalidOracleConfiguration());
        routeValidator = StaxV3RouteValidator(validator);
        require(tokenDeployer.code.length > 0, InvalidOracleConfiguration());
        basketTokenDeployer = StaxBasketTokenDeployer(tokenDeployer);
        require(_rewardsPool != address(0), ZeroRewardsPool());
        require(_treasury != address(0), ZeroTreasury());
        require(_universalRouter != address(0), ZeroUniversalRouter());
        require(_permit2 != address(0), ZeroPermit2());
        require(_usdg != address(0), ZeroUsdg());
        require(_usdgUsdFeed != address(0), ZeroUsdgUsdFeed());
        require(_usdgUsdMaxStaleness > 0, ZeroStalenessWindow());
        require(IPriceOracle(_usdgUsdFeed).decimals() <= 18, FeedDecimalsTooHigh());

        rewardsPool = _rewardsPool;
        treasury = _treasury;
        universalRouter = _universalRouter;
        permit2 = _permit2;
        usdg = _usdg;

        uint8 _usdgDecimals = IERC20Metadata(_usdg).decimals();
        require(_usdgDecimals <= 18, UsdgDecimalsTooHigh());
        usdgDecimals = _usdgDecimals;

        usdgUsdFeed = _usdgUsdFeed;
        usdgUsdMaxStaleness = _usdgUsdMaxStaleness;
        sequencerUptimeFeed = _sequencerUptimeFeed;
        require(_universalRouter.code.length > 0 && _permit2.code.length > 0, InvalidOracleConfiguration());
        for (uint256 i; i < legacyTickers.length; ++i) {
            LegacyTicker calldata t = legacyTickers[i];
            _registerChainlink(t.ticker, t.feed, t.maxStaleness);
        }
    }

    function setStaxToken(address _staxToken) external onlyOwner {
        require(staxToken == address(0), StaxTokenAlreadySet());
        require(_staxToken != address(0), ZeroStaxToken());
        staxToken = _staxToken;
        emit StaxTokenSet(_staxToken);
    }

    function setPriceFeed(address ticker, address feed, uint48 maxStaleness) external onlyOwner {
        _registerChainlink(ticker, feed, maxStaleness);
    }

    function _registerChainlink(address ticker, address feed, uint48 maxStaleness) private {
        require(ticker != address(0), ZeroTicker());
        require(oracleSettings[ticker].oracleType == OracleType.NONE, FeedAlreadySet());
        _writeFeed(ticker, feed, maxStaleness);
        oracleSettings[ticker] = OracleSettings(OracleType.CHAINLINK, address(0));
        _setSlippage(ticker, 200);
        emit OracleConfigured(ticker, OracleType.CHAINLINK, address(0));
    }

    function updatePriceFeed(address ticker, address feed, uint48 maxStaleness) external onlyOwner {
        require(ticker != address(0), ZeroTicker());
        require(oracleSettings[ticker].oracleType == OracleType.CHAINLINK && priceFeeds[ticker].feed != address(0), FeedNotSet());
        _writeFeed(ticker, feed, maxStaleness);
    }

    function _writeFeed(address ticker, address feed, uint48 maxStaleness) private {
        require(feed != address(0), ZeroFeed());
        require(maxStaleness > 0, ZeroStalenessWindow());
        require(IPriceOracle(feed).decimals() <= 18, FeedDecimalsTooHigh());
        priceFeeds[ticker] = FeedConfig({feed: feed, maxStaleness: maxStaleness});
        emit PriceFeedSet(ticker, feed, maxStaleness);
    }

    function setHookAllowed(address hook, bool allowed) external onlyOwner {
        require(hook != address(0), ZeroHook());
        allowedHooks[hook] = allowed;
        emit HookAllowlistUpdated(hook, allowed);
    }

    function setTickerPool(
        address ticker,
        address currency0,
        address currency1,
        uint24 fee,
        int24 tickSpacing,
        address hooks
    ) external onlyOwner {
        require(ticker != address(0), ZeroTicker());
        require(currency0 == ticker || currency1 == ticker, TickerNotInPool());
        require(currency0 != currency1, IdenticalCurrencies());
        require(currency0 == usdg || currency1 == usdg, NotPairedWithUsdg());
        require(
            tickerPools[ticker].currency0 == address(0) && tickerPools[ticker].currency1 == address(0),
            PoolAlreadySet()
        );
        require(!tickerIsV3[ticker], HasV3Pool());
        require(hooks == address(0) || allowedHooks[hooks], HookNotAllowlisted());
        require(currency0 < currency1, CurrenciesNotOrdered());

        tickerPools[ticker] = PoolKey({
            currency0: currency0,
            currency1: currency1,
            fee: fee,
            tickSpacing: tickSpacing,
            hooks: hooks
        });

        emit TickerPoolSet(ticker, currency0, currency1, fee, tickSpacing, hooks);
    }

    function updateTickerPool(
        address ticker,
        address currency0,
        address currency1,
        uint24 fee,
        int24 tickSpacing,
        address hooks
    ) external onlyOwner {
        require(ticker != address(0), ZeroTicker());
        require(
            tickerPools[ticker].currency0 != address(0) || tickerPools[ticker].currency1 != address(0),
            PoolNotSet()
        );
        require(currency0 == ticker || currency1 == ticker, TickerNotInPool());
        require(currency0 != currency1, IdenticalCurrencies());
        require(currency0 == usdg || currency1 == usdg, NotPairedWithUsdg());
        require(currency0 < currency1, CurrenciesNotOrdered());
        require(hooks == address(0) || allowedHooks[hooks], HookNotAllowlisted());

        tickerPools[ticker] = PoolKey({
            currency0: currency0,
            currency1: currency1,
            fee: fee,
            tickSpacing: tickSpacing,
            hooks: hooks
        });

        emit TickerPoolSet(ticker, currency0, currency1, fee, tickSpacing, hooks);
    }

    function setTickerPoolV3(address ticker, uint24 fee) external onlyOwner {
        require(ticker != address(0), ZeroTicker());
        require(!tickerPoolsV3[ticker].exists, V3PoolAlreadySet());
        require(
            tickerPools[ticker].currency0 == address(0) && tickerPools[ticker].currency1 == address(0),
            HasV4Pool()
        );

        _writeV3Route(ticker, fee);
    }

    function updateTickerPoolV3(address ticker, uint24 fee) external onlyOwner {
        require(ticker != address(0), ZeroTicker());
        require(tickerPoolsV3[ticker].exists, NoV3Pool());
        _writeV3Route(ticker, fee);
    }

    function _writeV3Route(address ticker, uint24 fee) private {
        if (oracleSettings[ticker].oracleType == OracleType.TWAP) {
            routeValidator.quote(ticker, usdg, usdgDecimals, fee, oracleSettings[ticker].registry);
        } else {
            routeValidator.validate(ticker, usdg, fee);
        }
        tickerPoolsV3[ticker] = V3PoolConfig({fee: fee, exists: true});
        tickerIsV3[ticker] = true;
        emit TickerPoolV3Set(ticker, fee);
    }

    function setStaxSwapPool(
        address currency0,
        address currency1,
        uint24 fee,
        int24 tickSpacing,
        address hooks
    ) external onlyOwner {
        require(staxToken != address(0), StaxTokenNotSet());
        require(
            staxSwapPool.currency0 == address(0) && staxSwapPool.currency1 == address(0),
            StaxPoolAlreadySet()
        );
        require(currency0 == staxToken || currency1 == staxToken, StaxTokenNotInPool());
        require(currency0 != currency1, IdenticalCurrencies());
        require(currency0 == usdg || currency1 == usdg, StaxPoolNeedsUsdg());
        require(currency0 < currency1, CurrenciesNotOrdered());
        require(hooks == address(0) || allowedHooks[hooks], HookNotAllowlisted());

        staxSwapPool = PoolKey({
            currency0: currency0,
            currency1: currency1,
            fee: fee,
            tickSpacing: tickSpacing,
            hooks: hooks
        });

        emit StaxSwapPoolSet(currency0, currency1, fee, tickSpacing, hooks);
    }

    function createBasket(
        uint256 basketId,
        string memory name,
        string memory symbol,
        address[] memory tickers,
        uint256[] memory weights,
        uint256 depositCapUsd,
        uint256 maxMintUsd
    ) external onlyOwner {
        require(!baskets[basketId].exists, BasketAlreadyExists());
        require(tickers.length > 0, EmptyBasket());
        require(tickers.length == weights.length, LengthMismatch());
        require(depositCapUsd > 0, ZeroDepositCap());
        require(maxMintUsd > 0, ZeroMaxMint());

        uint256 totalWeight = 0;
        uint8[] memory tickerDecimals = new uint8[](tickers.length);

        for (uint256 i = 0; i < tickers.length; i++) {
            _requireOracleConfigured(tickers[i]);
            if (tickerIsV3[tickers[i]]) routeValidator.validate(tickers[i], usdg, tickerPoolsV3[tickers[i]].fee);
            else require(tickerPools[tickers[i]].currency0 != address(0) || tickerPools[tickers[i]].currency1 != address(0), PoolNotSet());

            uint8 dec = IERC20Metadata(tickers[i]).decimals();
            require(dec <= 18, TokenDecimalsTooHigh());
            tickerDecimals[i] = dec;

            for (uint256 j = 0; j < i; j++) {
                require(tickers[i] != tickers[j], DuplicateTicker());
            }

            totalWeight += weights[i];
        }
        require(totalWeight == BPS_DENOMINATOR, WeightsSumMismatch());

        StaxBasketToken token = StaxBasketToken(basketTokenDeployer.deploy(name, symbol));
        require(token.vault() == address(this) && token.totalSupply() == 0, InvalidOracleConfiguration());

        baskets[basketId] = Basket({
            name: name,
            token: address(token),
            tickers: tickers,
            weights: weights,
            tickerDecimals: tickerDecimals,
            depositCapUsd: depositCapUsd,
            maxMintUsd: maxMintUsd,
            mintPaused: false,
            exists: true
        });

        emit BasketCreated(basketId, address(token), name);
    }

    function setMintPaused(uint256 basketId, bool paused) external onlyOwner {
        require(baskets[basketId].exists, BasketDoesNotExist());
        baskets[basketId].mintPaused = paused;
        emit MintPausedSet(basketId, paused);
    }

    function setCaps(uint256 basketId, uint256 depositCapUsd, uint256 maxMintUsd) external onlyOwner {
        require(baskets[basketId].exists, BasketDoesNotExist());
        require(depositCapUsd > 0 && maxMintUsd > 0, ZeroCap());
        baskets[basketId].depositCapUsd = depositCapUsd;
        baskets[basketId].maxMintUsd = maxMintUsd;
        emit CapsSet(basketId, depositCapUsd, maxMintUsd);
    }

    function _requireSequencerUp() internal view {
        if (sequencerUptimeFeed == address(0)) {
            return;
        }

        (, int256 answer, uint256 startedAt, , ) =
            IPriceOracle(sequencerUptimeFeed).latestRoundData();

        require(answer == 0, SequencerDown());
        require(startedAt != 0, SequencerNotInit());
        require(block.timestamp - startedAt > SEQUENCER_GRACE_PERIOD, GracePeriodActive());
    }

    function _readFeedUsd18(address feed, uint48 maxStaleness) internal view returns (uint256) {
        _requireSequencerUp();

        (, int256 answer, , uint256 updatedAt, ) = IPriceOracle(feed).latestRoundData();
        require(answer > 0, InvalidOraclePrice());
        require(block.timestamp - updatedAt <= maxStaleness, StaleOraclePrice());

        uint8 feedDecimals = IPriceOracle(feed).decimals();
        return uint256(answer) * (10 ** (18 - feedDecimals));
    }

    function _usdgUsd18() internal view returns (uint256) {
        return _readFeedUsd18(usdgUsdFeed, usdgUsdMaxStaleness);
    }

    function _tickerUsd18(address ticker) internal view returns (uint256) {
        OracleSettings memory settings = oracleSettings[ticker];
        if (settings.oracleType == OracleType.TWAP) {
            uint256 quote = _twapUsdg18(ticker, settings.registry);
            uint256 price = Math.mulDiv(quote, _usdgUsd18(), 1e18);
            require(price > 0, InvalidOraclePrice());
            return price;
        }
        require(settings.oracleType == OracleType.CHAINLINK, NoFeed());
        return _chainlinkTickerUsd18(ticker);
    }

    function _twapUsdg18(address ticker, address registry) internal view returns (uint256) {
        require(tickerIsV3[ticker], NoV3Pool());
        return routeValidator.quote(ticker, usdg, usdgDecimals, tickerPoolsV3[ticker].fee, registry);
    }

    function _chainlinkTickerUsd18(address ticker) internal view returns (uint256) {
        FeedConfig memory cfg = priceFeeds[ticker];
        require(cfg.feed != address(0), NoFeed());

        try IPausableToken(ticker).oraclePaused() returns (bool paused) {
            require(!paused, OraclePausedErr());
        } catch {
            revert OraclePausedErr();
        }

        return _readFeedUsd18(cfg.feed, cfg.maxStaleness);
    }

    function _to18(uint256 amount, uint8 tokenDecimals) internal pure returns (uint256) {
        return amount * (10 ** (18 - tokenDecimals));
    }

    function _from18(uint256 amount18, uint8 tokenDecimals) internal pure returns (uint256) {
        return amount18 / (10 ** (18 - tokenDecimals));
    }

    function getBasketNavUsd(uint256 basketId) public view returns (uint256 totalValueUsd) {
        Basket storage basket = baskets[basketId];
        require(basket.exists, BasketDoesNotExist());

        for (uint256 i = 0; i < basket.tickers.length; i++) {
            address ticker = basket.tickers[i];
            uint256 bal = basketTickerHoldings[basketId][ticker];
            if (bal == 0) continue;
            uint256 bal18 = _to18(bal, basket.tickerDecimals[i]);
            totalValueUsd += (bal18 * _tickerUsd18(ticker)) / 1e18;
        }
    }

    function getBasketComposition(uint256 basketId)
        external
        view
        returns (address[] memory tickers, uint256[] memory weights)
    {
        Basket storage basket = baskets[basketId];
        require(basket.exists, BasketDoesNotExist());
        return (basket.tickers, basket.weights);
    }

    function _approveViaPermit2(address token, uint256 amount) internal {
        IERC20(token).forceApprove(permit2, amount);
        IPermit2(permit2).approve(token, universalRouter, uint160(amount), uint48(block.timestamp + 1 hours));
    }

    function _revokeViaPermit2(address token) internal {
        IPermit2(permit2).approve(token, universalRouter, 0, 0);
        IERC20(token).forceApprove(permit2, 0);
    }

    function _executeV4Swap(
        PoolKey memory poolKey,
        bool zeroForOne,
        uint256 amountIn,
        uint256 amountOutMinimum,
        address settleCurrency,
        address takeCurrency,
        uint256 msgValue
    ) internal {
        bytes memory commands = hex"10";

        bytes memory actions = abi.encodePacked(
            uint8(0x06), // SWAP_EXACT_IN_SINGLE
            uint8(0x0c), // SETTLE_ALL
            uint8(0x0f)  // TAKE_ALL
        );

        bytes[] memory actionParams = new bytes[](3);
        actionParams[0] = abi.encode(
            ExactInputSingleParams({
                poolKey: poolKey,
                zeroForOne: zeroForOne,
                amountIn: uint128(amountIn),
                amountOutMinimum: uint128(amountOutMinimum),
                minHopPriceX36: 0,
                hookData: ""
            })
        );
        actionParams[1] = abi.encode(settleCurrency, amountIn);
        actionParams[2] = abi.encode(takeCurrency, uint256(0));

        bytes[] memory inputs = new bytes[](1);
        inputs[0] = abi.encode(actions, actionParams);

        IUniversalRouter(universalRouter).execute{value: msgValue}(commands, inputs, block.timestamp);
    }

    function _executeV3Swap(
        address tokenIn,
        address tokenOut,
        uint24 fee,
        uint256 amountIn,
        uint256 amountOutMinimum
    ) internal {
        bytes memory commands = abi.encodePacked(bytes1(0x00)); // V3_SWAP_EXACT_IN

        bytes memory path = abi.encodePacked(tokenIn, fee, tokenOut);
        uint256[] memory minHopPriceX36 = new uint256[](0);

        bytes[] memory inputs = new bytes[](1);
        inputs[0] = abi.encode(
            address(this),       // recipient -- vault receives output
            amountIn,
            amountOutMinimum,
            path,
            address(this),        // payer -- vault holds tokenIn, pulled via Permit2
            minHopPriceX36
        );

        IUniversalRouter(universalRouter).execute(commands, inputs, block.timestamp);
    }

    function _swapUsdgForTicker(address tickerOut, uint8 tickerDec, uint256 usdgAmount)
        internal returns (uint256)
    {
        uint256 expectedOut18 = (_to18(usdgAmount, usdgDecimals) * _usdgUsd18()) / _tickerUsd18(tickerOut);
        uint256 minOut18 = expectedOut18 - ((expectedOut18 * _slippage(tickerOut)) / BPS_DENOMINATOR);
        return _swapTicker(tickerOut, usdgAmount, _from18(minOut18, tickerDec), true);
    }

    function _swapTickerForUsdg(address tickerIn, uint8 tickerDec, uint256 tickerAmount)
        internal returns (uint256)
    {
        uint256 amount18 = _to18(tickerAmount, tickerDec);
        uint256 valueUsd = (amount18 * _tickerUsd18(tickerIn)) / 1e18;
        uint256 expectedUsdg18 = (valueUsd * 1e18) / _usdgUsd18();
        uint256 minOut18 = expectedUsdg18 - ((expectedUsdg18 * _slippage(tickerIn)) / BPS_DENOMINATOR);
        return _swapTicker(tickerIn, tickerAmount, _from18(minOut18, usdgDecimals), false);
    }

    // Shared approvals and balance-delta accounting avoid duplicating both venue paths.
    // Oracle/slippage arithmetic above retains the V1 operation order.
    function _swapTicker(address ticker, uint256 amount, uint256 minimum, bool buying)
        private returns (uint256)
    {
        address tokenIn = buying ? usdg : ticker;
        address tokenOut = buying ? ticker : usdg;
        _approveViaPermit2(tokenIn, amount);
        uint256 balanceBefore = IERC20(tokenOut).balanceOf(address(this));
        if (tickerIsV3[ticker]) {
            V3PoolConfig memory cfg = tickerPoolsV3[ticker];
            require(cfg.exists, NoV3Pool());
            _executeV3Swap(tokenIn, tokenOut, cfg.fee, amount, minimum);
        } else {
            PoolKey memory pool = tickerPools[ticker];
            require(pool.currency0 != address(0) || pool.currency1 != address(0), PoolNotSet());
            address quoteCurrency = pool.currency0 == ticker ? pool.currency1 : pool.currency0;
            require(quoteCurrency == usdg, PoolNotUsdgPaired());
            _executeV4Swap(pool, pool.currency0 == tokenIn, amount, minimum, tokenIn, tokenOut, 0);
        }
        _revokeViaPermit2(tokenIn);
        return IERC20(tokenOut).balanceOf(address(this)) - balanceBefore;
    }

    function _routeFee(uint256 fee) internal {
        uint256 toRewards = (fee * FEE_REWARDS_SHARE_BPS) / BPS_DENOMINATOR;
        uint256 toTreasury = (fee * FEE_TREASURY_SHARE_BPS) / BPS_DENOMINATOR;
        uint256 toBurn = fee - toRewards - toTreasury;

        pendingBuyBurn += toBurn;
        pendingRewardsPool += toRewards;
        pendingTreasuryFees += toTreasury;

        emit FeeSplit(toBurn, toRewards, toTreasury);
    }

    function claimRewardsPool() external nonReentrant {
        uint256 amount = pendingRewardsPool;
        require(amount > 0, NothingToClaim());

        pendingRewardsPool = 0;

        IERC20(usdg).safeTransfer(rewardsPool, amount);

        emit RewardsPoolClaimed(amount);
    }

    function claimTreasuryFees() external nonReentrant {
        uint256 amount = pendingTreasuryFees;
        require(amount > 0, NothingToClaim());

        pendingTreasuryFees = 0;

        IERC20(usdg).safeTransfer(treasury, amount);

        emit TreasuryFeesClaimed(amount);
    }

    /// @notice Legacy selectors remain but cannot bypass user protection.
    function mint(uint256, uint256) external pure { revert UseBoundedEntryPoint(); }
    function redeem(uint256, uint256) external pure { revert UseBoundedEntryPoint(); }

    function mint(uint256 basketId, uint256 usdgAmount, uint256 minSharesOut, uint256 deadline) external nonReentrant {
        require(block.timestamp <= deadline, Expired());
        require(minSharesOut > 0, UserLimitNotMet());
        Basket storage basket = baskets[basketId];
        require(basket.exists, BasketDoesNotExist());
        require(!basket.mintPaused, MintingPaused());
        require(usdgAmount > 0, ZeroDeposit());

        uint256 balanceBefore = IERC20(usdg).balanceOf(address(this));
        IERC20(usdg).safeTransferFrom(msg.sender, address(this), usdgAmount);
        uint256 received = IERC20(usdg).balanceOf(address(this)) - balanceBefore;
        require(received > 0, NoUsdgReceived());

        uint256 fee = (received * FEE_BPS) / BPS_DENOMINATOR;
        uint256 netDeposit = received - fee;

        uint256 depositValueUsd = (_to18(netDeposit, usdgDecimals) * _usdgUsd18()) / 1e18;
        require(depositValueUsd <= basket.maxMintUsd, ExceedsMintLimit());

        uint256 navBefore = getBasketNavUsd(basketId);
        require(navBefore + depositValueUsd <= basket.depositCapUsd, ExceedsVaultCap());

        StaxBasketToken basketToken = StaxBasketToken(basket.token);
        uint256 supplyBefore = basketToken.totalSupply();

        if (supplyBefore == 0) {
            require(depositValueUsd >= MIN_INITIAL_VALUE_USD, InitialMintTooSmall());
        }

        uint256[] memory tickerAmounts = new uint256[](basket.tickers.length);
        uint256 valueReceivedUsd = 0;

        for (uint256 i = 0; i < basket.tickers.length; i++) {
            uint256 portion = (netDeposit * basket.weights[i]) / BPS_DENOMINATOR;
            if (portion == 0) continue;
            uint256 got = _swapUsdgForTicker(basket.tickers[i], basket.tickerDecimals[i], portion);
            tickerAmounts[i] = got;

            uint256 got18 = _to18(got, basket.tickerDecimals[i]);
            valueReceivedUsd += (got18 * _tickerUsd18(basket.tickers[i])) / 1e18;
        }
        require(valueReceivedUsd > 0, NoValueReceived());

        for (uint256 i = 0; i < basket.tickers.length; i++) {
            if (tickerAmounts[i] == 0) continue;
            basketTickerHoldings[basketId][basket.tickers[i]] += tickerAmounts[i];
        }

        uint256 tokensOut;
        if (supplyBefore == 0) {
            tokensOut = valueReceivedUsd;
        } else {
            tokensOut = (valueReceivedUsd * (supplyBefore + VIRTUAL_SHARES)) / (navBefore + 1);
        }
        require(tokensOut >= MIN_TOKENS_OUT, SharesTooLow());
        require(tokensOut >= minSharesOut, UserLimitNotMet());

        basketToken.mint(msg.sender, tokensOut);

        _routeFee(fee);
        emit FeeAccrued(basketId, fee);

        emit Minted(basketId, msg.sender, received, valueReceivedUsd, tokensOut);
    }

    function redeem(uint256 basketId, uint256 tokenAmount, uint256 minUsdgOut, uint256 deadline) external nonReentrant {
        require(block.timestamp <= deadline, Expired());
        require(minUsdgOut > 0, UserLimitNotMet());
        Basket storage basket = baskets[basketId];
        require(basket.exists, BasketDoesNotExist());
        require(tokenAmount > 0, AmountMustBeNonzero());
        require(tokenAmount >= MIN_TOKENS_IN, RedeemAmountTooSmall());

        StaxBasketToken basketToken = StaxBasketToken(basket.token);
        uint256 supplyBefore = basketToken.totalSupply();
        require(supplyBefore > 0, NoSupply());

        basketToken.burn(msg.sender, tokenAmount);

        uint256[] memory tickerShares = new uint256[](basket.tickers.length);
        uint256 valueReturnedUsd = 0;

        for (uint256 i = 0; i < basket.tickers.length; i++) {
            address ticker = basket.tickers[i];
            uint256 basketBal = basketTickerHoldings[basketId][ticker];
            uint256 tickerShare = (basketBal * tokenAmount) / supplyBefore;
            if (tickerShare == 0) continue;

            tickerShares[i] = tickerShare;
            basketTickerHoldings[basketId][ticker] -= tickerShare;

            uint256 share18 = _to18(tickerShare, basket.tickerDecimals[i]);
            valueReturnedUsd += (share18 * _tickerUsd18(ticker)) / 1e18;
        }

        uint256 grossPayout = 0;
        for (uint256 i = 0; i < basket.tickers.length; i++) {
            if (tickerShares[i] == 0) continue;

            grossPayout += _swapTickerForUsdg(
                basket.tickers[i],
                basket.tickerDecimals[i],
                tickerShares[i]
            );
        }
        require(grossPayout > 0, ZeroPayout());

        uint256 fee = (grossPayout * FEE_BPS) / BPS_DENOMINATOR;
        uint256 netPayout = grossPayout - fee;
        require(netPayout >= minUsdgOut, UserLimitNotMet());

        _routeFee(fee);
        emit FeeAccrued(basketId, fee);

        IERC20(usdg).safeTransfer(msg.sender, netPayout);

        emit Redeemed(basketId, msg.sender, tokenAmount, netPayout, valueReturnedUsd);
    }

    function executeBuyBurn(uint256 minStaxOut) external onlyOwner nonReentrant {
        require(
            staxSwapPool.currency0 != address(0) || staxSwapPool.currency1 != address(0),
            StaxPoolNotSet()
        );

        uint256 amount = pendingBuyBurn;
        require(amount > 0, NothingToBuyBurn());
        require(minStaxOut > 0, MinStaxOutMustBeSet());

        pendingBuyBurn = 0;

        address quoteCurrency = (staxSwapPool.currency0 == staxToken) ? staxSwapPool.currency1 : staxSwapPool.currency0;
        require(quoteCurrency == usdg, StaxPoolNotUsdgPaired());
        bool zeroForOne = (staxSwapPool.currency0 == usdg);

        _approveViaPermit2(usdg, amount);

        uint256 balanceBefore = IERC20(staxToken).balanceOf(DEAD_ADDRESS);
        uint256 vaultBalanceBefore = IERC20(staxToken).balanceOf(address(this));

        _executeV4Swap(staxSwapPool, zeroForOne, amount, minStaxOut, usdg, staxToken, 0);

        _revokeViaPermit2(usdg);

        uint256 staxReceived = IERC20(staxToken).balanceOf(address(this)) - vaultBalanceBefore;
        IERC20(staxToken).safeTransfer(DEAD_ADDRESS, staxReceived);

        uint256 staxOut = IERC20(staxToken).balanceOf(DEAD_ADDRESS) - balanceBefore;

        emit BuyBurnExecuted(amount, staxOut);
    }
}
