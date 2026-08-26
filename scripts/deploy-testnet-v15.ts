import { network } from "hardhat";

function feedPrice(dollars: bigint, decimals = 8): bigint {
  return dollars * 10n ** BigInt(decimals);
}

const TICKERS = [
  { symbol: "NVDA", price: 150n },
  { symbol: "AMD", price: 100n },
  { symbol: "TSM", price: 200n },
  { symbol: "AAPL", price: 200n },
  { symbol: "MSFT", price: 400n },
  { symbol: "GOOGL", price: 150n },
  { symbol: "AMZN", price: 180n },
  { symbol: "META", price: 500n },
  { symbol: "TSLA", price: 300n },
  { symbol: "COIN", price: 250n },
  { symbol: "MSTR", price: 300n },
  { symbol: "CLSK", price: 10n },
  { symbol: "CRCL", price: 150n },
  { symbol: "IONQ", price: 30n },
  { symbol: "RGTI", price: 10n },
  { symbol: "RKLB", price: 20n },
  { symbol: "SPCX", price: 50n },
  { symbol: "INTC", price: 25n },
  { symbol: "MU", price: 100n },
  { symbol: "ASML", price: 700n },
  { symbol: "SNDK", price: 50n },
];

async function main() {
  const { ethers } = await network.connect();
  const [deployer] = await ethers.getSigners();

  console.log("Deploying (v15: adds oraclePaused() check -- Robinhood's own docs");
  console.log("  confirm real stock tokens can enter a paused state during");
  console.log("  corporate actions (splits, dividends), where the feed may");
  console.log("  still return a value with a FRESH timestamp -- staleness checks");
  console.log("  alone cannot catch this. Adversarial review estimated this");
  console.log("  fires roughly weekly across a 21-ticker basket -- a routine");
  console.log("  condition, not a rare edge case. Check lives in _tickerUsd18,");
  console.log("  the single chokepoint for every ticker price read, with a");
  console.log("  defensive try/catch treating an unreadable flag as paused.");
  console.log("  Also fixes: setTickerPool now enforces canonical currency");
  console.log("  ordering (was present on updateTickerPool/setStaxSwapPool but");
  console.log("  missed on the original setter -- Fable review finding).)");
  console.log("with account:", deployer.address);
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Balance:", ethers.formatEther(balance), "ETH");

  console.log("\nDeploying shared infrastructure...");

  const MockWETH = await ethers.getContractFactory("MockWETH");
  const weth = await MockWETH.deploy();
  console.log("  MockWETH:", await weth.getAddress());

  const MockPermit2 = await ethers.getContractFactory("MockPermit2");
  const permit2 = await MockPermit2.deploy();
  console.log("  MockPermit2:", await permit2.getAddress());

  const MockUniversalRouter = await ethers.getContractFactory("MockUniversalRouter");
  const router = await MockUniversalRouter.deploy(await permit2.getAddress(), await weth.getAddress());
  console.log("  MockUniversalRouter:", await router.getAddress());

  const MockPriceOracle = await ethers.getContractFactory("MockPriceOracle");
  const ethUsdOracle = await MockPriceOracle.deploy(feedPrice(3000n), 8);
  console.log("  ETH/USD MockPriceOracle:", await ethUsdOracle.getAddress());

  const sequencerFeed = await MockPriceOracle.deploy(0, 8);
  await sequencerFeed.setPriceAt(0, 1);
  console.log("  Sequencer MockPriceOracle:", await sequencerFeed.getAddress());

  console.log("\nDeploying StaxVault (v14)...");
  const StaxVault = await ethers.getContractFactory("StaxVault");
  const vault = await StaxVault.deploy(
    "0x375E296871a38900bbc2de32E37B2Ca181bd9d41", // real team wallet
    deployer.address, // staxToken placeholder -- not launched yet
    await router.getAddress(),
    await permit2.getAddress(),
    await weth.getAddress(),
    await ethUsdOracle.getAddress(),
    3600,
    await sequencerFeed.getAddress()
  );
  console.log("  StaxVault (v15):", await vault.getAddress());

  console.log("\nDeploying ticker mocks, registering feeds and pools...");

  const wethAddr = await weth.getAddress();
  const MockERC20 = await ethers.getContractFactory("MockERC20");
  const tickerInfo: Record<string, { token: string; feed: string }> = {};

  for (const { symbol, price } of TICKERS) {
    const token = await MockERC20.deploy(`Mock ${symbol}`, `m${symbol}`);
    const tokenAddr = await token.getAddress();

    const feed = await MockPriceOracle.deploy(feedPrice(price), 8);
    const feedAddr = await feed.getAddress();

    await vault.setPriceFeed(tokenAddr, feedAddr, 3600);

    // Real, resolved hookless pool config -- matches the confirmed real
    // pattern (NVDA/AMD's real mainnet pools are hookless, fee=3000-ish
    // tier). Testnet keeps every ticker hookless and WETH-paired for
    // simplicity and predictability -- mainnet will use each ticker's
    // REAL resolved pool config from last night's on-chain research.
    const [currency0, currency1] =
      wethAddr.toLowerCase() < tokenAddr.toLowerCase() ? [wethAddr, tokenAddr] : [tokenAddr, wethAddr];
    await vault.setTickerPool(tokenAddr, currency0, currency1, 3000, 60, ethers.ZeroAddress);

    // Fund the router so it can pay out both directions, and set a real rate.
    await token.mint(await router.getAddress(), ethers.parseUnits("1000000", 18));
    const ethUsd18 = 3000n * 10n ** 18n;
    const tokenUsd18 = price * 10n ** 18n;
    await router.setRate(wethAddr, tokenAddr, (ethUsd18 * 10n ** 18n) / tokenUsd18);
    await router.setRate(tokenAddr, wethAddr, (tokenUsd18 * 10n ** 18n) / ethUsd18);

    tickerInfo[symbol] = { token: tokenAddr, feed: feedAddr };
    console.log(`  ${symbol}: token=${tokenAddr} feed=${feedAddr} ($${price})`);
  }

  console.log("\nCreating baskets...");

  const baskets = [
    { id: 1, name: "AI Infrastructure", symbol: "sAI", tickers: ["NVDA", "AMD", "TSM"], weights: [4000, 3000, 3000] },
    { id: 2, name: "Mag 7", symbol: "sMAG7", tickers: ["AAPL", "MSFT", "GOOGL", "AMZN", "NVDA", "META", "TSLA"], weights: [1430, 1430, 1430, 1430, 1430, 1430, 1420] },
    { id: 3, name: "Crypto Proxy Equities", symbol: "sCRYPTO", tickers: ["COIN", "MSTR", "CLSK", "CRCL"], weights: [2500, 2500, 2500, 2500] },
    { id: 4, name: "Quantum Computing", symbol: "sQNT", tickers: ["IONQ", "RGTI"], weights: [5000, 5000] },
    { id: 5, name: "New Space", symbol: "sSPACE", tickers: ["RKLB", "SPCX"], weights: [5000, 5000] },
    { id: 6, name: "Broad Semiconductors", symbol: "sSEMI", tickers: ["INTC", "MU", "TSM", "ASML", "SNDK"], weights: [2000, 2000, 2000, 2000, 2000] },
  ];

  for (const basket of baskets) {
    const tokenAddrs = basket.tickers.map((s) => tickerInfo[s].token);
    await vault.createBasket(
      basket.id,
      basket.name,
      basket.symbol,
      tokenAddrs,
      basket.weights,
      ethers.parseUnits("1000000", 18),
      ethers.parseUnits("100000", 18)
    );
    console.log(`  Basket ${basket.id} (${basket.name} / ${basket.symbol}) created`);
  }

  console.log("\n=== V15 DEPLOYMENT COMPLETE ===");
  console.log("NEW StaxVault address:", await vault.getAddress());
  console.log("Changes in this version vs v14:");
  console.log("  - Entire swap path rewritten: routes through the real Uniswap");
  console.log("    V4 Universal Router (command/action encoding confirmed by");
  console.log("    decoding a genuine successful mainnet transaction), not the");
  console.log("    old V3-style ISwapRouter.");
  console.log("  - Per-ticker pool storage (setTickerPool) replaces the single");
  console.log("    global router/fee -- real liquidity lives in different real");
  console.log("    pools per ticker, with different fees/hooks confirmed via");
  console.log("    on-chain research.");
  console.log("  - Permit2 integration for ERC20 approvals (replaces plain");
  console.log("    approve()) -- constructor-injected, not hardcoded, after");
  console.log("    finding the hardcoded mainnet address silently broke any");
  console.log("    non-mainnet deployment.");
  console.log("  - Permit2 allowances explicitly revoked after every swap");
  console.log("    (adversarial review fix -- closes a standing-allowance");
  console.log("    exposure).");
  console.log("  - TAKE_ALL parameter corrected to match the real, confirmed");
  console.log("    mainnet pattern (0, not a redundant minimum).");
  console.log("  Carried over from v13 (unchanged):");
  console.log("  - Sequencer feed remains optional (address(0) allowed)");
  console.log("  - mint()/redeem() both use two-pass deferred-credit CEI");
  console.log("  - Redeemed emits valueReturnedUsd (real USD realized P&L)");
  console.log("  - teamWallet = real team wallet");
  console.log("  - MIN_INITIAL_VALUE_USD = $2 (genesis mint floor)");
  console.log("\nUpdate VAULT_ADDRESS in src/lib/vault.ts to this new address.");
  console.log("Update VAULT_DEPLOY_BLOCK in src/lib/vault.ts to the current block height.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
