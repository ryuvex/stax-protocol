// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import {IPermit2, IUniversalRouter, PoolKey, ExactInputSingleParams} from "./StaxVault.sol";

/*//////////////////////////////////////////////////////////////////////////
StaxUserBasketV2 -- EIP-1167 clone implementation for user-created baskets,
bound to the immutable StaxVaultV2. Successor to the V1-bound StaxUserBasket.

What changed versus the V1-bound implementation (decisions by Dan, 2026-09-23):
- Bound to StaxVaultV2. Tickers are accepted when V2 has an oracle type
  (CHAINLINK or TWAP) and an execution route for them. TWAP tokens are allowed.
- Prices come from V2's getOraclePriceUsd18(): Chainlink/TWAP branch, stock
  oraclePaused check, sequencer check and USDG/USD conversion are all V2's.
  This contract never reads feeds or registries itself, so it cannot drift.
- Swap slippage floor is V2's per-ticker tickerSlippageBps, not a constant.
- mint/redeem take a user minimum and a deadline (V2 audit finding A-02).
- DEPOSIT_CAP_USD lowered to 25,000 USD per user basket.
- V3 router input encodes payerIsUser = true (the V1-bound version encoded
  address(this) in that slot).
- Fee handling unchanged: 50/30/20 recorded, burn share paid to treasury and
  tracked in pendingBuyBurnInformational until a burn path exists.
- Treasury and rewards destinations are read from V2 at claim time, so they
  follow V2's owner (a compromised recipient can be rotated once, for all clones).
- initialize() is callable only by the factory that deployed the implementation,
  so every clone is fee-paying and appears in the factory's BasketCreated log.
- Creation requires every ticker to be priceable at that moment.
- redeemInKind(shares): oracle-free, swap-free, fee-free exit that pays each
  underlying token pro rata from the ledger. Guarantees holders can always leave
  even if a ticker's oracle is gone for good (no owner exists to intervene).
- Still no owner, no pause, no settable parameters. One clone per basket.

Inherited caveat: V2's owner controls feeds, TWAP settings, routes and
slippage for every ticker; user baskets follow those settings live.
//////////////////////////////////////////////////////////////////////////*/

interface IStaxVaultV2Config {
    function usdg() external view returns (address);
    function usdgDecimals() external view returns (uint8);
    function universalRouter() external view returns (address);
    function permit2() external view returns (address);
    function oracleSettings(address ticker) external view returns (uint8 oracleType, address registry);
    function tickerSlippageBps(address ticker) external view returns (uint16);
    function tickerIsV3(address ticker) external view returns (bool);
    function tickerPoolsV3(address ticker) external view returns (uint24 fee, bool exists);
    function tickerPools(address ticker)
        external view returns (address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks);
    function getOraclePriceUsd18(address token) external view returns (uint256);
    function treasury() external view returns (address);
    function rewardsPool() external view returns (address);
}

contract StaxUserBasketV2 is Initializable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    error ZeroDeposit();
    error NoUsdgReceived();
    error ExceedsVaultCap();
    error InitialMintTooSmall();
    error NoValueReceived();
    error SharesTooLow();
    error AmountMustBeNonzero();
    error RedeemAmountTooSmall();
    error NoSupply();
    error ZeroPayout();
    error PoolNotSet();
    error PoolNotUsdgPaired();
    error NoV3Pool();
    error InvalidSlippage();
    error TickerNotRegisteredOnMainVault();
    error DuplicateTicker();
    error WeightsSumMismatch();
    error TooManyLegs();
    error EmptyBasket();
    error LengthMismatch();
    error TokenDecimalsTooHigh();
    error NothingToClaim();
    error UserLimitNotMet();
    error Expired();
    error ZeroAddress();
    error OnlyFactory();

    address public immutable mainVault;
    address public immutable usdg;
    uint8 public immutable usdgDecimals;
    address public immutable universalRouter;
    address public immutable permit2;
    /// @notice The factory that deployed this implementation; the only address allowed to initialize clones.
    address public immutable factory;

    uint256 public constant FEE_BPS = 25;
    uint256 public constant BPS_DENOMINATOR = 10_000;
    uint256 public constant SLIPPAGE_CAP_BPS = 500;
    uint256 public constant FEE_BURN_SHARE_BPS = 5000;
    uint256 public constant FEE_REWARDS_SHARE_BPS = 3000;
    uint256 public constant FEE_TREASURY_SHARE_BPS = 2000;
    uint256 public constant VIRTUAL_SHARES = 1;
    uint256 public constant MIN_INITIAL_VALUE_USD = 2e18;
    uint256 public constant MIN_TOKENS_OUT = 1e6;
    uint256 public constant MIN_TOKENS_IN = 1e6;
    uint8 public constant MAX_LEGS = 10;
    /// @notice Protocol-wide cap per user basket (18-decimal USD). Not creator-configurable.
    uint256 public constant DEPOSIT_CAP_USD = 25_000e18;

    string public name;
    address public token;
    address[] public tickers;
    uint256[] public weights;
    uint8[] public tickerDecimals;
    address public creator;

    mapping(address => uint256) public basketTickerHoldings;

    /// @notice Owed-to-burn total (transparency only). The USDG itself is in pendingTreasuryFees.
    uint256 public pendingBuyBurnInformational;
    uint256 public pendingRewardsPool;
    uint256 public pendingTreasuryFees;

    event Minted(address indexed user, uint256 usdgIn, uint256 tokensOut, uint256 valueReceivedUsd);
    event Redeemed(address indexed user, uint256 tokensIn, uint256 usdgOut, uint256 valueReturnedUsd);
    event RedeemedInKind(address indexed user, uint256 tokensIn, address[] tickers, uint256[] amounts);
    event FeeSplit(uint256 toBurn, uint256 toRewards, uint256 toTreasury);
    event RewardsPoolClaimed(uint256 amount);
    event TreasuryFeesClaimed(uint256 amount);

    /// @dev Deployed BY the factory (msg.sender). USDG, router and Permit2 are read from the vault
    /// so a clone can never disagree with it.
    constructor(address _mainVault) {
        require(_mainVault != address(0), ZeroAddress());
        IStaxVaultV2Config v = IStaxVaultV2Config(_mainVault);
        mainVault = _mainVault;
        usdg = v.usdg();
        usdgDecimals = v.usdgDecimals();
        universalRouter = v.universalRouter();
        permit2 = v.permit2();
        factory = msg.sender;
        _disableInitializers();
    }

    function treasury() public view returns (address) { return IStaxVaultV2Config(mainVault).treasury(); }
    function rewardsPool() public view returns (address) { return IStaxVaultV2Config(mainVault).rewardsPool(); }

    function initialize(
        string memory _name,
        string memory _symbol,
        address[] memory _tickers,
        uint256[] memory _weights,
        address _creator
    ) external initializer {
        require(msg.sender == factory, OnlyFactory());
        require(_tickers.length > 0, EmptyBasket());
        require(_tickers.length <= MAX_LEGS, TooManyLegs());
        require(_tickers.length == _weights.length, LengthMismatch());

        uint256 totalWeight = 0;
        for (uint256 i = 0; i < _tickers.length; i++) {
            address ticker = _tickers[i];
            _requireRegistered(ticker);
            for (uint256 j = 0; j < i; j++) require(_tickers[j] != ticker, DuplicateTicker());
            uint8 dec = IERC20Metadata(ticker).decimals();
            require(dec <= 18, TokenDecimalsTooHigh());
            tickerDecimals.push(dec);
            totalWeight += _weights[i];
        }
        require(totalWeight == BPS_DENOMINATOR, WeightsSumMismatch());

        name = _name;
        tickers = _tickers;
        weights = _weights;
        creator = _creator;
        token = address(new StaxUserBasketToken(_name, _symbol, address(this)));
    }

    /// @dev Registered = V2 prices it (CHAINLINK or TWAP), has a usable slippage and an execution route.
    function _requireRegistered(address ticker) internal view {
        IStaxVaultV2Config v = IStaxVaultV2Config(mainVault);
        require(ticker != usdg, TickerNotRegisteredOnMainVault());
        (uint8 oracleType,) = v.oracleSettings(ticker);
        require(oracleType != 0, TickerNotRegisteredOnMainVault());
        _slippage(ticker);
        // Must be priceable right now: a basket that cannot be valued at creation cannot mint either.
        _tickerUsd18(ticker);
        if (v.tickerIsV3(ticker)) {
            (, bool exists) = v.tickerPoolsV3(ticker);
            require(exists, TickerNotRegisteredOnMainVault());
        } else {
            (address c0, address c1,,,) = v.tickerPools(ticker);
            require(c0 != address(0) || c1 != address(0), TickerNotRegisteredOnMainVault());
        }
    }

    /// @param minSharesOut Minimum basket shares (18 decimals) the caller accepts; must be nonzero.
    /// @param deadline Unix timestamp after which the call reverts.
    function mint(uint256 usdgAmount, uint256 minSharesOut, uint256 deadline) external nonReentrant {
        require(block.timestamp <= deadline, Expired());
        require(minSharesOut > 0, UserLimitNotMet());
        require(usdgAmount > 0, ZeroDeposit());

        uint256 balanceBefore = IERC20(usdg).balanceOf(address(this));
        IERC20(usdg).safeTransferFrom(msg.sender, address(this), usdgAmount);
        uint256 received = IERC20(usdg).balanceOf(address(this)) - balanceBefore;
        require(received > 0, NoUsdgReceived());

        uint256 fee = (received * FEE_BPS) / BPS_DENOMINATOR;
        uint256 netDeposit = received - fee;
        uint256 depositValueUsd = (_to18(netDeposit, usdgDecimals) * _usdgUsd18()) / 1e18;
        uint256 navBefore = getBasketNavUsd();
        require(navBefore + depositValueUsd <= DEPOSIT_CAP_USD, ExceedsVaultCap());

        StaxUserBasketToken basketToken = StaxUserBasketToken(token);
        uint256 supplyBefore = basketToken.totalSupply();
        if (supplyBefore == 0) require(depositValueUsd >= MIN_INITIAL_VALUE_USD, InitialMintTooSmall());

        uint256[] memory tickerAmounts = new uint256[](tickers.length);
        uint256 valueReceivedUsd = 0;
        for (uint256 i = 0; i < tickers.length; i++) {
            uint256 portion = (netDeposit * weights[i]) / BPS_DENOMINATOR;
            if (portion == 0) continue;
            uint256 got = _swapUsdgForTicker(tickers[i], tickerDecimals[i], portion);
            tickerAmounts[i] = got;
            valueReceivedUsd += (_to18(got, tickerDecimals[i]) * _tickerUsd18(tickers[i])) / 1e18;
        }
        require(valueReceivedUsd > 0, NoValueReceived());
        for (uint256 i = 0; i < tickers.length; i++) {
            if (tickerAmounts[i] == 0) continue;
            basketTickerHoldings[tickers[i]] += tickerAmounts[i];
        }

        uint256 tokensOut = supplyBefore == 0
            ? valueReceivedUsd
            : (valueReceivedUsd * (supplyBefore + VIRTUAL_SHARES)) / (navBefore + 1);
        require(tokensOut >= MIN_TOKENS_OUT, SharesTooLow());
        require(tokensOut >= minSharesOut, UserLimitNotMet());

        basketToken.mint(msg.sender, tokensOut);
        _routeFee(fee);
        emit Minted(msg.sender, received, tokensOut, valueReceivedUsd);
    }

    /// @param minUsdgOut Minimum net USDG (raw units) the caller accepts; must be nonzero.
    function redeem(uint256 tokenAmount, uint256 minUsdgOut, uint256 deadline) external nonReentrant {
        require(block.timestamp <= deadline, Expired());
        require(minUsdgOut > 0, UserLimitNotMet());
        require(tokenAmount > 0, AmountMustBeNonzero());
        require(tokenAmount >= MIN_TOKENS_IN, RedeemAmountTooSmall());

        StaxUserBasketToken basketToken = StaxUserBasketToken(token);
        uint256 supplyBefore = basketToken.totalSupply();
        require(supplyBefore > 0, NoSupply());
        basketToken.burn(msg.sender, tokenAmount);

        uint256[] memory tickerShares = new uint256[](tickers.length);
        uint256 valueReturnedUsd = 0;
        for (uint256 i = 0; i < tickers.length; i++) {
            address ticker = tickers[i];
            uint256 tickerShare = (basketTickerHoldings[ticker] * tokenAmount) / supplyBefore;
            if (tickerShare == 0) continue;
            tickerShares[i] = tickerShare;
            basketTickerHoldings[ticker] -= tickerShare;
            valueReturnedUsd += (_to18(tickerShare, tickerDecimals[i]) * _tickerUsd18(ticker)) / 1e18;
        }

        uint256 grossPayout = 0;
        for (uint256 i = 0; i < tickers.length; i++) {
            if (tickerShares[i] == 0) continue;
            grossPayout += _swapTickerForUsdg(tickers[i], tickerDecimals[i], tickerShares[i]);
        }
        require(grossPayout > 0, ZeroPayout());

        uint256 fee = (grossPayout * FEE_BPS) / BPS_DENOMINATOR;
        uint256 netPayout = grossPayout - fee;
        require(netPayout >= minUsdgOut, UserLimitNotMet());

        _routeFee(fee);
        IERC20(usdg).safeTransfer(msg.sender, netPayout);
        emit Redeemed(msg.sender, tokenAmount, netPayout, valueReturnedUsd);
    }

    /// @notice Emergency/in-kind exit: burns shares and transfers each underlying token pro rata.
    /// @dev Touches NO oracle, NO swap and charges NO fee, so it works when pricing is unavailable.
    /// Uses the same ledger arithmetic as redeem(); the two paths can be mixed freely.
    function redeemInKind(uint256 tokenAmount) external nonReentrant {
        require(tokenAmount > 0, AmountMustBeNonzero());
        require(tokenAmount >= MIN_TOKENS_IN, RedeemAmountTooSmall());
        StaxUserBasketToken basketToken = StaxUserBasketToken(token);
        uint256 supplyBefore = basketToken.totalSupply();
        require(supplyBefore > 0, NoSupply());
        basketToken.burn(msg.sender, tokenAmount);

        uint256[] memory amounts = new uint256[](tickers.length);
        for (uint256 i = 0; i < tickers.length; i++) {
            address ticker = tickers[i];
            uint256 amount = (basketTickerHoldings[ticker] * tokenAmount) / supplyBefore;
            if (amount == 0) continue;
            basketTickerHoldings[ticker] -= amount;
            amounts[i] = amount;
        }
        for (uint256 i = 0; i < tickers.length; i++) {
            if (amounts[i] != 0) IERC20(tickers[i]).safeTransfer(msg.sender, amounts[i]);
        }
        emit RedeemedInKind(msg.sender, tokenAmount, tickers, amounts);
    }

    function getBasketNavUsd() public view returns (uint256 totalValueUsd) {
        for (uint256 i = 0; i < tickers.length; i++) {
            uint256 bal = basketTickerHoldings[tickers[i]];
            if (bal == 0) continue;
            totalValueUsd += (_to18(bal, tickerDecimals[i]) * _tickerUsd18(tickers[i])) / 1e18;
        }
    }

    function getComposition() external view returns (address[] memory, uint256[] memory) {
        return (tickers, weights);
    }

    function claimRewardsPool() external nonReentrant {
        uint256 amount = pendingRewardsPool;
        require(amount > 0, NothingToClaim());
        pendingRewardsPool = 0;
        IERC20(usdg).safeTransfer(rewardsPool(), amount);
        emit RewardsPoolClaimed(amount);
    }

    function claimTreasuryFees() external nonReentrant {
        uint256 amount = pendingTreasuryFees;
        require(amount > 0, NothingToClaim());
        pendingTreasuryFees = 0;
        IERC20(usdg).safeTransfer(treasury(), amount);
        emit TreasuryFeesClaimed(amount);
    }

    function _routeFee(uint256 fee) internal {
        uint256 toRewards = (fee * FEE_REWARDS_SHARE_BPS) / BPS_DENOMINATOR;
        uint256 toTreasury = (fee * FEE_TREASURY_SHARE_BPS) / BPS_DENOMINATOR;
        uint256 toBurn = fee - toRewards - toTreasury;
        pendingBuyBurnInformational += toBurn;
        pendingRewardsPool += toRewards;
        pendingTreasuryFees += toTreasury + toBurn;
        emit FeeSplit(toBurn, toRewards, toTreasury);
    }

    // ---- pricing: delegated entirely to V2 ----
    function _usdgUsd18() internal view returns (uint256) {
        return IStaxVaultV2Config(mainVault).getOraclePriceUsd18(usdg);
    }
    function _tickerUsd18(address ticker) internal view returns (uint256) {
        return IStaxVaultV2Config(mainVault).getOraclePriceUsd18(ticker);
    }
    function _slippage(address ticker) internal view returns (uint256 bps) {
        bps = IStaxVaultV2Config(mainVault).tickerSlippageBps(ticker);
        require(bps > 0 && bps <= SLIPPAGE_CAP_BPS, InvalidSlippage());
    }

    function _to18(uint256 amount, uint8 dec) internal pure returns (uint256) { return amount * (10 ** (18 - dec)); }
    function _from18(uint256 amount18, uint8 dec) internal pure returns (uint256) { return amount18 / (10 ** (18 - dec)); }

    function _approveViaPermit2(address tok, uint256 amount) internal {
        IERC20(tok).forceApprove(permit2, amount);
        IPermit2(permit2).approve(tok, universalRouter, uint160(amount), uint48(block.timestamp + 1 hours));
    }
    function _revokeViaPermit2(address tok) internal {
        IPermit2(permit2).approve(tok, universalRouter, 0, 0);
        IERC20(tok).forceApprove(permit2, 0);
    }

    function _swapUsdgForTicker(address tickerOut, uint8 tickerDec, uint256 usdgAmount) internal returns (uint256) {
        uint256 expectedOut18 = (_to18(usdgAmount, usdgDecimals) * _usdgUsd18()) / _tickerUsd18(tickerOut);
        uint256 minOut18 = expectedOut18 - ((expectedOut18 * _slippage(tickerOut)) / BPS_DENOMINATOR);
        return _swapTicker(tickerOut, usdgAmount, _from18(minOut18, tickerDec), true);
    }

    function _swapTickerForUsdg(address tickerIn, uint8 tickerDec, uint256 tickerAmount) internal returns (uint256) {
        uint256 valueUsd = (_to18(tickerAmount, tickerDec) * _tickerUsd18(tickerIn)) / 1e18;
        uint256 expectedUsdg18 = (valueUsd * 1e18) / _usdgUsd18();
        uint256 minOut18 = expectedUsdg18 - ((expectedUsdg18 * _slippage(tickerIn)) / BPS_DENOMINATOR);
        return _swapTicker(tickerIn, tickerAmount, _from18(minOut18, usdgDecimals), false);
    }

    /// @dev Route selection mirrors StaxVaultV2._swapTicker; balance-delta accounting.
    function _swapTicker(address ticker, uint256 amount, uint256 minimum, bool buying) private returns (uint256) {
        IStaxVaultV2Config v = IStaxVaultV2Config(mainVault);
        address tokenIn = buying ? usdg : ticker;
        address tokenOut = buying ? ticker : usdg;
        _approveViaPermit2(tokenIn, amount);
        uint256 balanceBefore = IERC20(tokenOut).balanceOf(address(this));
        if (v.tickerIsV3(ticker)) {
            (uint24 fee, bool exists) = v.tickerPoolsV3(ticker);
            require(exists, NoV3Pool());
            _executeV3Swap(tokenIn, tokenOut, fee, amount, minimum);
        } else {
            (address c0, address c1, uint24 fee, int24 tickSpacing, address hooks) = v.tickerPools(ticker);
            require(c0 != address(0) || c1 != address(0), PoolNotSet());
            address quoteCurrency = c0 == ticker ? c1 : c0;
            require(quoteCurrency == usdg, PoolNotUsdgPaired());
            _executeV4Swap(PoolKey(c0, c1, fee, tickSpacing, hooks), c0 == tokenIn, amount, minimum, tokenIn, tokenOut);
        }
        _revokeViaPermit2(tokenIn);
        return IERC20(tokenOut).balanceOf(address(this)) - balanceBefore;
    }

    function _executeV4Swap(
        PoolKey memory poolKey, bool zeroForOne, uint256 amountIn, uint256 amountOutMinimum,
        address settleCurrency, address takeCurrency
    ) internal {
        bytes memory commands = hex"10";
        bytes memory actions = abi.encodePacked(uint8(0x06), uint8(0x0c), uint8(0x0f));
        bytes[] memory actionParams = new bytes[](3);
        actionParams[0] = abi.encode(ExactInputSingleParams({
            poolKey: poolKey, zeroForOne: zeroForOne, amountIn: uint128(amountIn),
            amountOutMinimum: uint128(amountOutMinimum), minHopPriceX36: 0, hookData: ""
        }));
        actionParams[1] = abi.encode(settleCurrency, amountIn);
        actionParams[2] = abi.encode(takeCurrency, uint256(0));
        bytes[] memory inputs = new bytes[](1);
        inputs[0] = abi.encode(actions, actionParams);
        IUniversalRouter(universalRouter).execute(commands, inputs, block.timestamp);
    }

    function _executeV3Swap(address tokenIn, address tokenOut, uint24 fee, uint256 amountIn, uint256 amountOutMinimum) internal {
        bytes memory commands = abi.encodePacked(bytes1(0x00)); // V3_SWAP_EXACT_IN
        bytes memory path = abi.encodePacked(tokenIn, fee, tokenOut);
        uint256[] memory minHopPriceX36 = new uint256[](0);
        bytes[] memory inputs = new bytes[](1);
        // payerIsUser = true: the clone pays through Permit2, exactly as StaxVaultV2 encodes it.
        inputs[0] = abi.encode(address(this), amountIn, amountOutMinimum, path, true, minHopPriceX36);
        IUniversalRouter(universalRouter).execute(commands, inputs, block.timestamp);
    }
}

/// @notice Share token for a user-created basket; mint/burn restricted to its clone.
contract StaxUserBasketToken is ERC20 {
    error ZeroVault();
    error OnlyVault();
    address public immutable vault;
    modifier onlyVault() { require(msg.sender == vault, OnlyVault()); _; }
    constructor(string memory name_, string memory symbol_, address vault_) ERC20(name_, symbol_) {
        require(vault_ != address(0), ZeroVault());
        vault = vault_;
    }
    function mint(address to, uint256 amount) external onlyVault { _mint(to, amount); }
    function burn(address from, uint256 amount) external onlyVault { _burn(from, amount); }
}
