// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/*//////////////////////////////////////////////////////////////////////////
                              DESIGN NOTES (v17)

  ==========================================================================
  v17 MIGRATION — ETH deposits replaced entirely with USDG deposits.

  Discovered via real mainnet liquidity data: Robinhood Chain's actual
  liquidity backbone is USDG (Paxos-issued native stablecoin, "the first
  stablecoin natively issued on Robinhood Chain"), not WETH. All 20 real
  basket tickers have healthy, hookless, real liquidity paired against
  USDG; WETH-paired pools are sparse-to-nonexistent for most tickers, and
  where they did exist for a couple tickers, they turned out to be
  paired against SPY (a stock token) or a Doppler-launch numeraire pool
  for an unrelated token -- neither usable by this contract's swap logic.

  This is a full replacement, not an additional deposit option:
  - mint() is no longer payable; it pulls USDG via safeTransferFrom.
  - receive() is removed entirely -- the vault holds no native ETH.
  - redeem() pays out via USDG safeTransfer, not a raw ETH .call.
  - All ticker pools are now expected to be USDG-paired directly
    (enforced at registration time in setTickerPool/updateTickerPool).
  - Fee accounting (pendingBuyBurn, pendingRewardsPool,
    pendingTreasuryFees) is USDG-denominated.
  - Oracle pricing reads USDG/USD instead of ETH/USD.
  - weth, IWETH, and all native-ETH/WETH-wrap branches in the swap
    helpers are removed -- there is now exactly one deposit/quote
    currency (USDG) instead of two (native ETH + WETH-wrapped).

  DECIMALS: USDG uses 6 decimals, not 18 (confirmed on-chain: decimals()
  == 6 for the real deployed USDG contract). This is read LIVE at
  construction via IERC20Metadata(_usdg).decimals() and stored as an
  immutable, validated the same way basket ticker decimals already are
  in createBasket -- never hardcoded. Every USD-value calculation on a
  raw USDG amount MUST go through _to18(amount, usdgDecimals) before
  being multiplied against a usd18 price; skipping this conversion is
  exactly the kind of decimals bug that passes happy-path tests and
  fails on real value math. Basket token accounting itself is
  unaffected -- basket tokens remain 18-decimal and tokensOut is always
  computed in usd18 terms, which was already decimals-agnostic.

  TRUST-MODEL NOTE (accepted, not hidden): USDG is issuer-controlled
  (Paxos) -- has pause and mint/burn authority via a SupplyControl
  contract, per Paxos's own public USDG contract repo. This is a
  material change from permissionless native ETH. Given the entire
  chain's liquidity and the chain's own flagship lending product
  (Robinhood Earn) already run on USDG, this is treated as an accepted,
  conscious part of the vault's trust surface -- not a reason to avoid
  the migration, but not silently assumed either.

  RESOLVED (was an open item, now confirmed): USDG/USD feed heartbeat
  was empirically measured directly from the feed's own on-chain round
  history -- 60 rounds walked back via getRoundData, spanning a full 60
  days. Every observed gap fell between 86,401-86,429 seconds (a tight,
  deterministic ~24h heartbeat). The real _usdgUsdMaxStaleness passed at
  deploy is 27h (measured max + buffer) -- stronger than Chainlink's
  published heartbeat would have been, since it's the feed's actual
  observed behavior, not a documented guarantee. Feed address and live
  price ($1.0001 at last check) confirmed on-chain.

  DE-PEG BEHAVIOR (decision made): price USDG at its real oracle value
  always, with standard positive-price + staleness guards -- same
  discipline as every other price read in this contract. No artificial
  sanity bound on top of the oracle. A genuine USDG de-peg is expected
  to flow through to NAV math accurately rather than being masked.
  ==========================================================================

  Accounting unit: USD, 18 decimals, internally ("usd18").

  Oracle-manipulation defense: hard oracle-derived amountOutMinimum on
  every swap, plus per-feed staleness checks. L2 sequencer check on every
  price read.

  v7 fix (still in effect): genesis (supplyBefore == 0) unconditionally
  sets tokensOut = valueReceivedUsd, regardless of any residual dust NAV
  from a prior full exit. MIN_TOKENS_OUT floors every mint's granularity.
  Unaffected by the USDG migration -- this constant governs basket-token
  (18-decimal) granularity, not deposit-asset decimals.

  Fee routing: v18 -- team takes zero. 50% auto-burn (STAX flywheel),
  30% to a rewards pool, 20% to treasury, all pull-pattern
  (claimRewardsPool / claimTreasuryFees / executeBuyBurn), so redemption
  never depends on any external address's state. Integer-division
  remainder from the 30/20 split lands on the burn share (the largest
  bucket), guaranteeing the three shares always sum to exactly the fee
  collected -- no dust ever stranded. USDG-denominated throughout.

  Admin surface: price feeds are set-once. Ticker pools are set-once and
  must be USDG-paired (enforced at registration). Owner can pause
  MINTING per basket, but can never block REDEMPTION, change feeds, or
  move funds.

  Scope: USDG deposits only, v17+. Native ETH is no longer accepted or
  handled anywhere in this contract.
  ==========================================================================

  v19 ADDITION — V3 SWAP SUPPORT.

  Real liquidity for most post-launch candidate tickers (Commodities,
  Entertainment, Consumer themes) lives on Uniswap V3, not V4 -- a
  full-registry V4 pool scan came back clean on zero of 31 new
  candidates (every result was a non-standard-fee decoy pattern), while
  a manual liquidity search found real, standard-fee, healthy V3 pools
  for many of the same names (GME, USO, SLV, GLD, PLTR, RBLX, and
  others).

  Each ticker now lives on exactly one venue -- V4 (existing) or V3
  (new) -- tracked via tickerIsV3, enforced mutually exclusive at
  registration (setTickerPool / setTickerPoolV3 both check the other
  hasn't already claimed the ticker). mint()/redeem() call sites are
  UNCHANGED; the venue routing happens inside _swapUsdgForTicker /
  _swapTickerForUsdg, which now branch to either the original V4 logic
  (renamed ...V4, byte-identical to what shipped in v18.4) or the new
  V3 sibling.

  V3's pool config is deliberately simpler than V4's PoolKey: no
  tickSpacing, no hooks concept, no currency-ordering requirement --
  V3 swaps use a directional path encoding (tokenIn, fee, tokenOut),
  not an ordered PoolId. USDG is always the implicit other side,
  enforced the same way V4 pools already enforce USDG-pairing.

  Swap encoding CONFIRMED against real mainnet infrastructure before
  being written here (V3EncodingProofTest.t.sol, real GME/USDG V3 pool,
  real Universal Router) -- v3SwapExactInput takes 6 params:
  (recipient, amountIn, amountOutMinimum, path, payer, minHopPriceX36).
  An initial 5-param attempt based on an older router pattern reverted
  with SliceOutOfBounds() -- confirmed wrong against the real
  Uniswap/universal-router source (not re-guessed) before this version
  was written. Same missing-field shape as the v18.3 V4 struct bug,
  right down to minHopPriceX36 being the exact field that was missing
  both times.

  v19.1 -- EIP-170 SIZE FIX, PERMANENT VERSION. Adding V3 support pushed
  the contract to 25,750 bytes (1,174 over the 24,576 limit). A first
  attempt trimmed the 14 longest revert strings -- not enough margin,
  and it repeated the same whack-a-mole pattern already seen twice
  before (v18.1: runs 200->50; v18.2: 12 more string trims after
  updatePriceFeed). Every one of those fixes bought back just enough
  room for the LAST feature, not headroom for the next one.

  Real, permanent fix: every require() revert string converted to a
  custom error, using Solidity 0.8.26+'s require(condition,
  CustomError()) syntax -- same require() call shape as before (so the
  diff is a mechanical string-to-error swap, not a rewritten control
  flow), but a custom error costs ~4 bytes at the revert site instead
  of the full ABI-encoded string. This is what the compiler's own
  warning was pointing at ("consider... turning off revert strings").
  Behavior is identical -- same conditions revert, same call sites --
  only the encoding of *why* changed. Existing tests asserting exact
  revert STRING text (revertedWith("StaxVault: ...")) will need to
  switch to revertedWithCustomError(vault, "ErrorName") instead.
//////////////////////////////////////////////////////////////////////////*/

interface IPriceOracle {
    function decimals() external view returns (uint8);

    function latestRoundData() external view returns (
        uint80 roundId,
        int256 answer,
        uint256 startedAt,
        uint256 updatedAt,
        uint80 answeredInRound
    );
}

// v14 fix (per adversarial review): Robinhood's own docs confirm real
// stock tokens expose oraclePaused() -- a flag that can be true during
// corporate actions (splits, dividends) while the underlying price feed
// may still return a value with a FRESH timestamp, meaning the existing
// staleness check alone cannot catch this state. Reviewed frequency
// estimate: roughly weekly across a 21-ticker basket (dividends,
// mainly) -- a routine condition to guard against, not a rare edge case.
interface IPausableToken {
    function oraclePaused() external view returns (bool);
}

// v14: replaces the V3-style ISwapRouter entirely. Real liquidity on
// this chain lives on Uniswap V4, not V3. V4 swaps route through this
// Universal Router, using its documented command/action encoding
// pattern -- confirmed correct by decoding a REAL, successful mainnet
// transaction's actual calldata.
//
// v19: this same router also handles V3 swaps (command 0x00) -- see
// _executeV3Swap below. No new router dependency, just a different
// command/input encoding through the identical entrypoint.
interface IUniversalRouter {
    function execute(bytes calldata commands, bytes[] calldata inputs, uint256 deadline)
        external
        payable;
}

// Minimal PoolKey shape, matches Uniswap V4's real struct exactly.
struct PoolKey {
    address currency0;
    address currency1;
    uint24 fee;
    int24 tickSpacing;
    address hooks;
}

// v19: V3 pool config -- deliberately simpler than V4's PoolKey above.
// V3 swaps use a directional path encoding (tokenIn, fee, tokenOut),
// not a currency0/currency1-ordered PoolId the way V4 requires -- so
// there is no ordering constraint to enforce, and no tickSpacing/hooks
// concept at all. USDG is always the implicit other side of the pool
// (enforced at registration, same discipline as setTickerPool's
// USDG-pairing check for V4).
struct V3PoolConfig {
    uint24 fee;
    bool exists;
}

// V4Router's real swap params struct.
// v18.3 CRITICAL FIX (found after extensive live-mainnet debugging):
// this struct was missing the minHopPriceX36 field entirely, and
// hookData was in the wrong position. The REAL IV4Router struct is:
// (PoolKey poolKey, bool zeroForOne, uint128 amountIn, uint128
// amountOutMinimum, uint256 minHopPriceX36, bytes hookData) -- 6
// fields, hookData LAST. Our 5-field version shifted every field
// after amountOutMinimum out of alignment, causing the real router's
// strict decoder to read garbage for every field, then revert with
// empty data once it tried to read the (now wrongly-located) dynamic
// hookData field out of bounds. Confirmed via direct test against the
// real, official v4-periphery CalldataDecoder library, not inferred --
// the 6-field version decodes every field correctly; the 5-field
// version does not. minHopPriceX36 = 0 means "no per-hop price floor
// enforced", the correct default for a plain single-hop swap.
struct ExactInputSingleParams {
    PoolKey poolKey;
    bool zeroForOne;
    uint128 amountIn;
    uint128 amountOutMinimum;
    uint256 minHopPriceX36;
    bytes hookData;
}

// Canonical Permit2 -- same address on every chain that has it deployed.
interface IPermit2 {
    function approve(address token, address spender, uint160 amount, uint48 expiration) external;
}

contract StaxBasketToken is ERC20 {
    error NotVault();
    error ZeroVault();

    address public immutable vault;

    modifier onlyVault() {
        if (msg.sender != vault) revert NotVault();
        _;
    }

    constructor(string memory name_, string memory symbol_, address vault_)
        ERC20(name_, symbol_)
    {
        require(vault_ != address(0), ZeroVault());
        vault = vault_;
    }

    function mint(address to, uint256 amount) external onlyVault {
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external onlyVault {
        _burn(from, amount);
    }
}

contract StaxVault is ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;

    // v19.1: all revert reasons as custom errors -- see design notes
    // above. Grouped roughly by the function(s) that use them; several
    // are shared across multiple functions (e.g. ZeroTicker,
    // BasketDoesNotExist) exactly as their string predecessors were.
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
    uint256 public constant MAX_SLIPPAGE_BPS = 200;
    // v18: 3-way fee split (team-zero) -- see design notes below.
    uint256 public constant FEE_BURN_SHARE_BPS = 5000;     // 50%
    uint256 public constant FEE_REWARDS_SHARE_BPS = 3000;  // 30%
    uint256 public constant FEE_TREASURY_SHARE_BPS = 2000; // 20%
    uint256 public constant SEQUENCER_GRACE_PERIOD = 3600;
    uint256 public constant VIRTUAL_SHARES = 1;
    uint256 public constant MIN_INITIAL_VALUE_USD = 2e18;
    uint256 public constant MIN_TOKENS_OUT = 1e6;

    // v17 fix (Opus review, Finding #2): mirrors MIN_TOKENS_OUT's role
    // on the mint side. Without this, a sufficiently small redeem could
    // have every per-ticker share floor to zero (basketBal * tokenAmount
    // / supplyBefore rounding down), producing a zero grossPayout that
    // reverts only at the very end -- after burn, ledger debits, and
    // swap attempts already ran (harmlessly, since it's all one atomic
    // transaction that rolls back cleanly, but with a late, confusing
    // revert instead of an immediate clear one). This checks the
    // degenerate case up front, before any state change or swap gas is
    // spent.
    uint256 public constant MIN_TOKENS_IN = 1e6;

    // v18.1: RESOLVED, not a placeholder anymore -- empirically
    // measured from 60 days of the feed's real on-chain round history
    // (see design notes above). Passed into the constructor as
    // _usdgUsdMaxStaleness, NOT hardcoded here -- this constant is kept
    // only as a documented reference for what's actually deployed.
    uint48 public constant USDG_STALENESS_CONFIRMED_REFERENCE = 27 hours;

    address public immutable permit2;

    address public constant DEAD_ADDRESS = 0x000000000000000000000000000000000000dEaD;

    // v18: teamWallet removed entirely. Team takes zero -- fee routing
    // now goes to three destinations: burn (STAX flywheel), a rewards
    // pool, and treasury. No address in the contract represents "the
    // team" collecting fees at all; team upside is solely via holding
    // STAX, same story the buy-burn flywheel already told.
    address public immutable rewardsPool;
    address public immutable treasury;
    // v18.1 fix (Opus review): staxToken is NO LONGER immutable or set
    // at construction. It used to be an immutable set to a "deployer
    // placeholder" address since STAX hasn't launched yet -- but
    // immutable means permanent, and once STAX genuinely launches with
    // a real address, an immutable placeholder would permanently brick
    // buy-burn on this deployment with no way to ever fix it. Now a
    // plain, owner-settable-once state variable (see setStaxToken
    // below), starting at address(0) until STAX actually exists.
    address public staxToken;
    address public immutable universalRouter;

    // v17: replaces `weth`. USDG is the vault's sole deposit and quote
    // currency -- every ticker pool is USDG-paired, buy-burn is
    // USDG-paired, fees are USDG-denominated. No native ETH or WETH
    // handling exists anywhere in this contract anymore.
    address public immutable usdg;

    // v17: read LIVE from the real USDG contract at construction, never
    // hardcoded -- same discipline already used for basket ticker
    // decimals in createBasket. Confirmed on-chain to currently be 6.
    uint8 public immutable usdgDecimals;

    address public immutable usdgUsdFeed;
    uint48 public immutable usdgUsdMaxStaleness;
    address public immutable sequencerUptimeFeed;

    mapping(uint256 => Basket) public baskets;
    mapping(address => FeedConfig) public priceFeeds;

    /// @notice v17: every ticker's pool MUST be paired against usdg --
    /// enforced in setTickerPool/updateTickerPool at registration time,
    /// not just assumed at swap time. This closes off, at the source,
    /// the entire class of bug discovered tonight (a pool silently
    /// paired against the wrong currency, like SPY or a Doppler
    /// numeraire token, passing liquidity checks but being structurally
    /// unusable by the vault's swap logic).
    mapping(address => PoolKey) public tickerPools;

    /// @notice v19: per-ticker V3 pool config, parallel to tickerPools
    /// (V4) above. A ticker lives on exactly one venue -- enforced by
    /// cross-checks in setTickerPool/setTickerPoolV3 below, so
    /// mint()/redeem() never have to guess which one applies.
    mapping(address => V3PoolConfig) public tickerPoolsV3;

    /// @notice v19: true if this ticker swaps via V3, false (default,
    /// including every existing v18.4 ticker) for the existing V4 path.
    /// Checked inside _swapUsdgForTicker/_swapTickerForUsdg to route to
    /// the correct venue -- the mint()/redeem() call sites themselves
    /// are completely unchanged.
    mapping(address => bool) public tickerIsV3;

    /// @notice v14 fix (per adversarial review + Slither): a hook can
    /// arbitrarily alter swap behavior mid-call. Default-deny: every
    /// non-zero hook must be explicitly vetted and allowlisted first.
    mapping(address => bool) public allowedHooks;

    /// @notice v17: STAX buy-and-burn pool must be paired against usdg
    /// directly (enforced in setStaxSwapPool) -- no more wrap-native-ETH
    /// branch, since the vault never holds native ETH. Unset by default;
    /// v18.1: staxToken itself is no longer even set at construction
    /// (see setStaxToken) -- this pool can only be registered once
    /// staxToken is genuinely set to STAX's real address.
    PoolKey public staxSwapPool;

    /// @notice v8: per-basket internal ledger, single source of truth
    /// for NAV, mint pricing, and redeem payouts. Unaffected by the
    /// USDG migration -- this tracks ticker holdings, not deposit-asset
    /// accounting.
    mapping(uint256 => mapping(address => uint256)) public basketTickerHoldings;

    uint256 public pendingBuyBurn;
    uint256 public pendingRewardsPool;
    uint256 public pendingTreasuryFees;

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

    constructor(
        address _rewardsPool,
        address _treasury,
        address _universalRouter,
        address _permit2,
        address _usdg,
        address _usdgUsdFeed,
        uint48 _usdgUsdMaxStaleness,
        address _sequencerUptimeFeed
    ) Ownable(msg.sender) {
        require(_rewardsPool != address(0), ZeroRewardsPool());
        require(_treasury != address(0), ZeroTreasury());
        require(_universalRouter != address(0), ZeroUniversalRouter());
        require(_permit2 != address(0), ZeroPermit2());
        require(_usdg != address(0), ZeroUsdg());
        require(_usdgUsdFeed != address(0), ZeroUsdgUsdFeed());
        require(_usdgUsdMaxStaleness > 0, ZeroStalenessWindow());
        require(IPriceOracle(_usdgUsdFeed).decimals() <= 18, FeedDecimalsTooHigh());

        // v13: _sequencerUptimeFeed is DELIBERATELY allowed to be
        // address(0) -- Robinhood Chain does not yet have a published
        // Chainlink L2 Sequencer Uptime Feed. See prior design notes;
        // unchanged by this migration.

        rewardsPool = _rewardsPool;
        treasury = _treasury;
        universalRouter = _universalRouter;
        permit2 = _permit2;
        usdg = _usdg;

        // v17: read live, validated the same way ticker decimals are
        // validated in createBasket -- never hardcoded.
        uint8 _usdgDecimals = IERC20Metadata(_usdg).decimals();
        require(_usdgDecimals <= 18, UsdgDecimalsTooHigh());
        usdgDecimals = _usdgDecimals;

        usdgUsdFeed = _usdgUsdFeed;
        usdgUsdMaxStaleness = _usdgUsdMaxStaleness;
        sequencerUptimeFeed = _sequencerUptimeFeed;
    }

    /// @notice v18.1 fix (Opus review): staxToken is set here, once, by
    /// the owner -- NOT at construction. This must only be called once
    /// STAX has genuinely launched with a real, live token address.
    /// Calling this with a placeholder (like the deployer's own address)
    /// defeats the entire point of the fix -- the set-once guard means
    /// whatever address goes in here is just as permanent as the old
    /// immutable was. Only call this with the real STAX address.
    function setStaxToken(address _staxToken) external onlyOwner {
        require(staxToken == address(0), StaxTokenAlreadySet());
        require(_staxToken != address(0), ZeroStaxToken());
        staxToken = _staxToken;
        emit StaxTokenSet(_staxToken);
    }

    // v17: receive() REMOVED. The vault never holds or handles native
    // ETH anywhere -- deposits, redemption payouts, fees, and buy-burn
    // are all USDG (ERC-20). Without a receive()/fallback, any plain
    // ETH transfer to this contract reverts by default, which is
    // exactly the desired behavior now (no accidental ETH lock-up).

    function setPriceFeed(address ticker, address feed, uint48 maxStaleness) external onlyOwner {
        require(ticker != address(0), ZeroTicker());
        require(feed != address(0), ZeroFeed());
        require(maxStaleness > 0, ZeroStalenessWindow());
        require(priceFeeds[ticker].feed == address(0), FeedAlreadySet());
        require(IPriceOracle(feed).decimals() <= 18, FeedDecimalsTooHigh());

        priceFeeds[ticker] = FeedConfig({feed: feed, maxStaleness: maxStaleness});
        emit PriceFeedSet(ticker, feed, maxStaleness);
    }

    /// @notice v18.2 addition (Opus review, post-mainnet-deploy): a
    /// mis-calibrated staleness value previously required a full
    /// redeploy to fix, since setPriceFeed is set-once by design (an
    /// intentional "admin can't silently redirect a feed" property).
    /// Tonight's real finding -- equity feeds have a fundamentally
    /// different, bimodal update cadence (frequent during market
    /// hours, then a long deterministic silence overnight/weekends)
    /// that a single guessed value can get badly wrong -- showed the
    /// real cost of having no correction path. This mirrors
    /// updateTickerPool's exact validation discipline: requires the
    /// feed to already exist (can't be used to silently backdoor an
    /// initial set), and re-validates the new feed the same way the
    /// original set did, so the owner can recalibrate a genuinely
    /// hard-to-predict safety parameter without being able to point a
    /// ticker at an arbitrary unvalidated oracle.
    function updatePriceFeed(address ticker, address feed, uint48 maxStaleness) external onlyOwner {
        require(ticker != address(0), ZeroTicker());
        require(priceFeeds[ticker].feed != address(0), FeedNotSet());
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

    /// @notice v17 fix: now ALSO requires the non-ticker side of the
    /// pool to equal `usdg` exactly. Previously any second currency was
    /// accepted as long as the ticker was one side -- tonight's session
    /// found real, high-liquidity pools that passed every existing
    /// check (liquidity, fee sanity, hook safety) while being paired
    /// against SPY or an unrelated Doppler-launch numeraire, both
    /// structurally unusable by this contract's swap logic. Enforcing
    /// the USDG pairing HERE, at registration, makes that entire bug
    /// class unrepresentable rather than something swap-time code has
    /// to defend against.
    /// @notice v19 addition: also requires the ticker not already be
    /// registered on the V3 venue -- a ticker must live on exactly one
    /// venue, or mint()/redeem() would have no unambiguous answer for
    /// which swap path to take.
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

    /// @notice v14 fix (adversarial review): tickerPools can be
    /// repointed to a new pool if the original degrades or turns
    /// hostile -- redemption must never be permanently blockable.
    /// v17: same USDG-pairing enforcement as setTickerPool, for the
    /// same reason -- a repointed pool must not silently reintroduce
    /// the wrong-currency bug class.
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

    /// @notice v19: registers a ticker on the V3 venue. Mirrors
    /// setTickerPool's exact validation discipline -- set-once guard,
    /// cross-venue exclusivity check against the V4 mapping. No
    /// currency0/currency1/tickSpacing/hooks needed: USDG is always the
    /// implicit other side of the pool (this is what makes V3
    /// registration simpler than V4's), and V3 path encoding is
    /// directional, not PoolId-ordered.
    function setTickerPoolV3(address ticker, uint24 fee) external onlyOwner {
        require(ticker != address(0), ZeroTicker());
        require(!tickerPoolsV3[ticker].exists, V3PoolAlreadySet());
        require(
            tickerPools[ticker].currency0 == address(0) && tickerPools[ticker].currency1 == address(0),
            HasV4Pool()
        );

        tickerPoolsV3[ticker] = V3PoolConfig({fee: fee, exists: true});
        tickerIsV3[ticker] = true;

        emit TickerPoolV3Set(ticker, fee);
    }

    /// @notice v19: mirrors updateTickerPool -- lets a V3 pool be
    /// repointed (different fee tier, or if a pool degrades) without
    /// needing a redeploy, same "redemption must never be permanently
    /// blockable" reasoning as the V4 version.
    function updateTickerPoolV3(address ticker, uint24 fee) external onlyOwner {
        require(ticker != address(0), ZeroTicker());
        require(tickerPoolsV3[ticker].exists, NoV3Pool());

        tickerPoolsV3[ticker] = V3PoolConfig({fee: fee, exists: true});

        emit TickerPoolV3Set(ticker, fee);
    }

    /// @notice v16 fix (Finding #4): set-once guard, dedicated event.
    /// v17 fix: ALSO requires the non-STAX side to equal `usdg` --
    /// pendingBuyBurn is accumulated in USDG, and the vault no longer
    /// has any native-ETH-wrap fallback, so the buy-burn pool must be
    /// directly USDG-paired or executeBuyBurn cannot function. Must
    /// only be called once STAX has genuinely launched with real
    /// USDG-paired liquidity -- never set to a placeholder or guessed
    /// pool.
    function setStaxSwapPool(
        address currency0,
        address currency1,
        uint24 fee,
        int24 tickSpacing,
        address hooks
    ) external onlyOwner {
        // v18.1 fix (Opus review): staxToken must be genuinely set
        // (via setStaxToken, once STAX has really launched) before this
        // can be called at all -- prevents accidentally registering a
        // pool against address(0) or any other unintended state.
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
            require(priceFeeds[tickers[i]].feed != address(0), NoTickerFeed());

            uint8 dec = IERC20Metadata(tickers[i]).decimals();
            require(dec <= 18, TokenDecimalsTooHigh());
            tickerDecimals[i] = dec;

            for (uint256 j = 0; j < i; j++) {
                require(tickers[i] != tickers[j], DuplicateTicker());
            }

            totalWeight += weights[i];
        }
        require(totalWeight == BPS_DENOMINATOR, WeightsSumMismatch());

        StaxBasketToken token = new StaxBasketToken(name, symbol, address(this));

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

    /// @notice v17: replaces _ethUsd18(). Reads the USDG/USD feed
    /// instead of ETH/USD. De-peg behavior: priced at real oracle
    /// value always, no artificial sanity bound -- see design notes.
    function _usdgUsd18() internal view returns (uint256) {
        return _readFeedUsd18(usdgUsdFeed, usdgUsdMaxStaleness);
    }

    function _tickerUsd18(address ticker) internal view returns (uint256) {
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

    /// @notice v18.1 addition (Opus review): the auto-generated public
    /// getter for the baskets mapping silently omits dynamic-array
    /// members (tickers, weights, tickerDecimals) -- this is standard
    /// Solidity behavior for struct getters, not a bug, but it means
    /// there was previously NO way to read a basket's actual ticker
    /// composition back from chain at all. Added specifically to make
    /// real deploy-time verification possible: confirm a freshly-created
    /// basket's on-chain tickers/weights match what was intended, not
    /// just that createBasket() didn't revert.
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

    /// @notice v19: V3 swap via the Universal Router. Encoding
    /// CONFIRMED against real mainnet infrastructure (real GME/USDG V3
    /// pool, real Universal Router, V3EncodingProofTest.t.sol) before
    /// being written here -- v3SwapExactInput takes 6 params:
    /// (recipient, amountIn, amountOutMinimum, path, payer,
    /// minHopPriceX36). NOT the older 5-param (..., bool payerIsUser)
    /// pattern -- that reverted with SliceOutOfBounds() when tried
    /// first, confirmed wrong against the real Uniswap/universal-router
    /// source before this version was written.
    ///
    /// payer = address(this): the vault already holds tokenIn at this
    /// point, and _approveViaPermit2 has already granted the router a
    /// Permit2 allowance to pull from the vault -- same underlying
    /// Permit2 pattern the V4 path already uses.
    ///
    /// minHopPriceX36 = empty array: matches the existing V4 path's
    /// minHopPriceX36: 0 convention (no per-hop price floor beyond the
    /// already-enforced amountOutMinimum).
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

        IUniversalRouter(universalRouter).execute(commands, inputs, block.timestamp + 300);
    }

    /// @notice v17: replaces _swapEthForTicker. USDG is always a plain
    /// ERC20 -- no native-ETH branch, no WETH wrap, msgValue is always
    /// 0. quoteCurrency is derived from the pool but is guaranteed to
    /// equal usdg by setTickerPool's registration-time enforcement;
    /// the require below is defense-in-depth, not the primary guard.
    /// @notice v19: now a thin venue router. mint() calls this exactly
    /// as before -- unchanged call site, zero risk to the already-proven
    /// V4 path for existing tickers.
    function _swapUsdgForTicker(
        address tickerOut,
        uint8 tickerDec,
        uint256 usdgAmount
    ) internal returns (uint256 amountOut) {
        if (tickerIsV3[tickerOut]) {
            return _swapUsdgForTickerV3(tickerOut, tickerDec, usdgAmount);
        }
        return _swapUsdgForTickerV4(tickerOut, tickerDec, usdgAmount);
    }

    /// @notice v17/v19: unchanged logic from the live v18.4 contract,
    /// only renamed from _swapUsdgForTicker to _swapUsdgForTickerV4.
    function _swapUsdgForTickerV4(
        address tickerOut,
        uint8 tickerDec,
        uint256 usdgAmount
    ) internal returns (uint256 amountOut) {
        PoolKey memory poolKey = tickerPools[tickerOut];
        require(poolKey.currency0 != address(0) || poolKey.currency1 != address(0), PoolNotSet());

        address quoteCurrency = (poolKey.currency0 == tickerOut) ? poolKey.currency1 : poolKey.currency0;
        require(quoteCurrency == usdg, PoolNotUsdgPaired());
        bool zeroForOne = (poolKey.currency0 == usdg);

        uint256 expectedOut18 = (_to18(usdgAmount, usdgDecimals) * _usdgUsd18()) / _tickerUsd18(tickerOut);
        uint256 minOut18 = expectedOut18 - ((expectedOut18 * MAX_SLIPPAGE_BPS) / BPS_DENOMINATOR);
        uint256 minOut = _from18(minOut18, tickerDec);

        _approveViaPermit2(usdg, usdgAmount);

        uint256 balanceBefore = IERC20(tickerOut).balanceOf(address(this));

        _executeV4Swap(poolKey, zeroForOne, usdgAmount, minOut, usdg, tickerOut, 0);

        _revokeViaPermit2(usdg);

        amountOut = IERC20(tickerOut).balanceOf(address(this)) - balanceBefore;
    }

    /// @notice v19: new V3 sibling. Same slippage math, same Permit2
    /// approve/revoke pattern, same measured-balance-delta discipline as
    /// the V4 version above -- only the executor call differs.
    function _swapUsdgForTickerV3(
        address tickerOut,
        uint8 tickerDec,
        uint256 usdgAmount
    ) internal returns (uint256 amountOut) {
        V3PoolConfig memory cfg = tickerPoolsV3[tickerOut];
        require(cfg.exists, NoV3Pool());

        uint256 expectedOut18 = (_to18(usdgAmount, usdgDecimals) * _usdgUsd18()) / _tickerUsd18(tickerOut);
        uint256 minOut18 = expectedOut18 - ((expectedOut18 * MAX_SLIPPAGE_BPS) / BPS_DENOMINATOR);
        uint256 minOut = _from18(minOut18, tickerDec);

        _approveViaPermit2(usdg, usdgAmount);

        uint256 balanceBefore = IERC20(tickerOut).balanceOf(address(this));

        _executeV3Swap(usdg, tickerOut, cfg.fee, usdgAmount, minOut);

        _revokeViaPermit2(usdg);

        amountOut = IERC20(tickerOut).balanceOf(address(this)) - balanceBefore;
    }

    /// @notice v17: replaces _swapTickerForEth. Always outputs USDG,
    /// measured via balance delta -- no native-ETH unwrap branch needed
    /// at all, since USDG is a plain ERC20 on both sides of every swap.
    /// @notice v19: now a thin venue router. redeem() calls this exactly
    /// as before -- unchanged call site.
    function _swapTickerForUsdg(
        address tickerIn,
        uint8 tickerDec,
        uint256 tickerAmount
    ) internal returns (uint256 usdgOut) {
        if (tickerIsV3[tickerIn]) {
            return _swapTickerForUsdgV3(tickerIn, tickerDec, tickerAmount);
        }
        return _swapTickerForUsdgV4(tickerIn, tickerDec, tickerAmount);
    }

    /// @notice v17/v19: unchanged logic from the live v18.4 contract,
    /// only renamed from _swapTickerForUsdg to _swapTickerForUsdgV4.
    function _swapTickerForUsdgV4(
        address tickerIn,
        uint8 tickerDec,
        uint256 tickerAmount
    ) internal returns (uint256 usdgOut) {
        PoolKey memory poolKey = tickerPools[tickerIn];
        require(poolKey.currency0 != address(0) || poolKey.currency1 != address(0), PoolNotSet());

        address quoteCurrency = (poolKey.currency0 == tickerIn) ? poolKey.currency1 : poolKey.currency0;
        require(quoteCurrency == usdg, PoolNotUsdgPaired());
        bool zeroForOne = (poolKey.currency0 == tickerIn);

        uint256 amount18 = _to18(tickerAmount, tickerDec);
        uint256 valueUsd = (amount18 * _tickerUsd18(tickerIn)) / 1e18;
        uint256 expectedUsdg18 = (valueUsd * 1e18) / _usdgUsd18();
        uint256 minOut18 = expectedUsdg18 - ((expectedUsdg18 * MAX_SLIPPAGE_BPS) / BPS_DENOMINATOR);
        uint256 minOut = _from18(minOut18, usdgDecimals);

        _approveViaPermit2(tickerIn, tickerAmount);

        uint256 balanceBefore = IERC20(usdg).balanceOf(address(this));

        _executeV4Swap(poolKey, zeroForOne, tickerAmount, minOut, tickerIn, usdg, 0);

        _revokeViaPermit2(tickerIn);

        usdgOut = IERC20(usdg).balanceOf(address(this)) - balanceBefore;
    }

    /// @notice v19: new V3 sibling. Same value/slippage math, same
    /// Permit2 pattern, same measured-delta discipline as the V4
    /// version above.
    function _swapTickerForUsdgV3(
        address tickerIn,
        uint8 tickerDec,
        uint256 tickerAmount
    ) internal returns (uint256 usdgOut) {
        V3PoolConfig memory cfg = tickerPoolsV3[tickerIn];
        require(cfg.exists, NoV3Pool());

        uint256 amount18 = _to18(tickerAmount, tickerDec);
        uint256 valueUsd = (amount18 * _tickerUsd18(tickerIn)) / 1e18;
        uint256 expectedUsdg18 = (valueUsd * 1e18) / _usdgUsd18();
        uint256 minOut18 = expectedUsdg18 - ((expectedUsdg18 * MAX_SLIPPAGE_BPS) / BPS_DENOMINATOR);
        uint256 minOut = _from18(minOut18, usdgDecimals);

        _approveViaPermit2(tickerIn, tickerAmount);

        uint256 balanceBefore = IERC20(usdg).balanceOf(address(this));

        _executeV3Swap(tickerIn, usdg, cfg.fee, tickerAmount, minOut);

        _revokeViaPermit2(tickerIn);

        usdgOut = IERC20(usdg).balanceOf(address(this)) - balanceBefore;
    }

    /// @notice v18: 3-way fee split (team-zero). Rewards and treasury
    /// shares are computed precisely via bps math; burn (the largest
    /// share, and already the "team upside" bucket via the STAX
    /// flywheel) absorbs any integer-division remainder via
    /// subtraction, guaranteeing toBurn + toRewards + toTreasury always
    /// sums to exactly `fee` -- no dust is ever stranded or unaccounted
    /// for. This was flagged explicitly in review: a naive three-way
    /// bps split (computing all three shares independently via
    /// multiplication/division) can leave 1-2 wei unallocated on every
    /// single fee, forever, which would silently break any
    /// sum-of-pending-balances invariant.
    function _routeFee(uint256 fee) internal {
        uint256 toRewards = (fee * FEE_REWARDS_SHARE_BPS) / BPS_DENOMINATOR;
        uint256 toTreasury = (fee * FEE_TREASURY_SHARE_BPS) / BPS_DENOMINATOR;
        uint256 toBurn = fee - toRewards - toTreasury;

        pendingBuyBurn += toBurn;
        pendingRewardsPool += toRewards;
        pendingTreasuryFees += toTreasury;

        emit FeeSplit(toBurn, toRewards, toTreasury);
    }

    /// @notice v18: replaces claimTeamFees. Same pull pattern, same
    /// atomicity reasoning (a reverting transfer -- e.g. a frozen
    /// recipient -- rolls back the whole call including the
    /// pendingRewardsPool = 0 write, no partial state survives).
    /// Unrestricted caller, same as the original: anyone can trigger the
    /// pull, funds always go to the fixed rewardsPool address regardless
    /// of who calls it -- no admin can redirect or block this.
    function claimRewardsPool() external nonReentrant {
        uint256 amount = pendingRewardsPool;
        require(amount > 0, NothingToClaim());

        pendingRewardsPool = 0;

        IERC20(usdg).safeTransfer(rewardsPool, amount);

        emit RewardsPoolClaimed(amount);
    }

    /// @notice v18: mirrors claimRewardsPool exactly, for the treasury
    /// destination.
    function claimTreasuryFees() external nonReentrant {
        uint256 amount = pendingTreasuryFees;
        require(amount > 0, NothingToClaim());

        pendingTreasuryFees = 0;

        IERC20(usdg).safeTransfer(treasury, amount);

        emit TreasuryFeesClaimed(amount);
    }

    /// @notice v17: no longer payable. Pulls exactly usdgAmount of USDG
    /// via safeTransferFrom, then measures the ACTUAL received delta
    /// and uses that for every downstream calculation -- not the
    /// nominal argument. Protects against any unexpected transfer-time
    /// behavior (fee-on-transfer, etc.) even though USDG is confirmed a
    /// plain, standard ERC20 -- same "trust the balance, not the claim"
    /// discipline already used throughout the swap helpers.
    function mint(uint256 basketId, uint256 usdgAmount) external nonReentrant {
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

        // v17 CRITICAL: netDeposit is a raw usdgDecimals-scale amount,
        // NOT an 18-decimal amount the way ETH's wei always was. Must
        // convert via _to18 before pricing -- this exact site is the
        // decimals bug Opus flagged as the one most likely to pass
        // happy-path tests and be wrong.
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

        basketToken.mint(msg.sender, tokensOut);

        _routeFee(fee);
        emit FeeAccrued(basketId, fee);

        emit Minted(basketId, msg.sender, received, valueReceivedUsd, tokensOut);
    }

    /// @notice v17: payout is USDG via safeTransfer instead of a raw
    /// ETH .call. Two-pass CEI structure unchanged from v9 -- still
    /// debits the full ledger before any swap executes.
    function redeem(uint256 basketId, uint256 tokenAmount) external nonReentrant {
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

        _routeFee(fee);
        emit FeeAccrued(basketId, fee);

        IERC20(usdg).safeTransfer(msg.sender, netPayout);

        emit Redeemed(basketId, msg.sender, tokenAmount, netPayout, valueReturnedUsd);
    }

    /// @notice v17: input is always USDG directly -- no wrap-native-ETH
    /// branch. staxSwapPool is enforced USDG-paired at registration
    /// (setStaxSwapPool), so quoteCurrency here is guaranteed usdg; the
    /// require is defense-in-depth.
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
