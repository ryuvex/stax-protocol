import { network } from "hardhat";

const ONE_HOUR = 3600;
const ETH_USD_DOLLARS = 3000n;

function feedPrice(dollars: bigint, decimals = 8): bigint {
  return dollars * 10n ** BigInt(decimals);
}

// Basket configs: name, symbol, per-ticker [symbol, priceInDollars, weightBps]
const BASKETS = [
  {
    id: 1,
    name: "AI Infrastructure",
    symbol: "sAI",
    tickers: [
      ["NVDA", 150n, 4000],
      ["AMD", 100n, 3000],
      ["TSM", 200n, 3000],
    ],
  },
  {
    id: 2,
    name: "Mag 7",
    symbol: "sMAG7",
    tickers: [
      ["AAPL", 200n, 1429],
      ["MSFT", 400n, 1429],
      ["GOOGL", 150n, 1429],
      ["AMZN", 180n, 1429],
      ["NVDA", 150n, 1429], // shared with AI Infrastructure — deploy script skips redeploying
      ["META", 500n, 1429],
      ["TSLA", 300n, 1426],
    ],
  },
  {
    id: 3,
    name: "Crypto Proxy Equities",
    symbol: "sCRYPTO",
    tickers: [
      ["COIN", 250n, 2500],
      ["MSTR", 300n, 2500],
      ["CLSK", 10n, 2500],
      ["CRCL", 150n, 2500],
    ],
  },
  {
    id: 4,
    name: "Quantum Computing",
    symbol: "sQNT",
    tickers: [
      ["IONQ", 30n, 5000],
      ["RGTI", 10n, 5000],
    ],
  },
  {
    id: 5,
    name: "New Space",
    symbol: "sSPACE",
    tickers: [
      ["RKLB", 20n, 5000],
      ["SPCX", 50n, 5000],
    ],
  },
  {
    id: 6,
    name: "Broad Semiconductors",
    symbol: "sSEMI",
    tickers: [
      ["INTC", 25n, 2000],
      ["MU", 100n, 2000],
      ["TSM", 200n, 2000], // shared with AI Infrastructure
      ["ASML", 700n, 2000],
      ["SNDK", 50n, 2000],
    ],
  },
];

async function main() {
  const { ethers } = await network.connect();
  const [deployer] = await ethers.getSigners();

  console.log("Deploying with account:", deployer.address);
  console.log("Account balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "ETH");
  console.log("");

  // ---------------------------------------------------------------------
  // Shared infrastructure
  // ---------------------------------------------------------------------
  console.log("Deploying shared infrastructure...");

  const MockWETH = await ethers.getContractFactory("MockWETH");
  const weth = await MockWETH.deploy();
  await weth.waitForDeployment();
  console.log("  MockWETH:", await weth.getAddress());

  const MockSwapRouter = await ethers.getContractFactory("MockSwapRouter");
  const router = await MockSwapRouter.deploy();
  await router.waitForDeployment();
  console.log("  MockSwapRouter:", await router.getAddress());

  const MockPriceOracle = await ethers.getContractFactory("MockPriceOracle");

  const ethUsdOracle = await MockPriceOracle.deploy(feedPrice(ETH_USD_DOLLARS), 8);
  await ethUsdOracle.waitForDeployment();
  console.log("  ETH/USD MockPriceOracle:", await ethUsdOracle.getAddress());

  const sequencerFeed = await MockPriceOracle.deploy(0, 8); // 0 = up
  await sequencerFeed.waitForDeployment();
  await (await sequencerFeed.setPriceAt(0, 1)).wait(); // up, started long ago -> grace period clear
  console.log("  Sequencer MockPriceOracle:", await sequencerFeed.getAddress());

  // Fund WETH so it can honor withdraw() calls during redeems.
  await (await deployer.sendTransaction({
    to: await weth.getAddress(),
    value: ethers.parseEther("0.001"),
  })).wait();

  console.log("");
  console.log("Deploying StaxVault...");

  const StaxVault = await ethers.getContractFactory("StaxVault");
  const vault = await StaxVault.deploy(
    deployer.address, // teamWallet -- same as deployer for testnet simplicity
    deployer.address, // staxToken stand-in -- no real STAX token needed for mint/redeem testing
    await router.getAddress(),
    await weth.getAddress(),
    await ethUsdOracle.getAddress(),
    ONE_HOUR, // ETH/USD staleness window
    await sequencerFeed.getAddress()
  );
  await vault.waitForDeployment();
  console.log("  StaxVault:", await vault.getAddress());
  console.log("");

  // ---------------------------------------------------------------------
  // Per-ticker mocks: deploy once per unique symbol, reuse across baskets
  // ---------------------------------------------------------------------
  console.log("Deploying ticker mocks and registering feeds...");

  const tickerAddresses: Record<string, string> = {};
  const tickerDecimals: Record<string, number> = {};

  for (const basket of BASKETS) {
    for (const [symbol, priceDollars] of basket.tickers as [string, bigint, number][]) {
      if (tickerAddresses[symbol]) continue; // already deployed for an earlier basket

      const MockERC20 = await ethers.getContractFactory("MockERC20");
      const token = await MockERC20.deploy(`Mock ${symbol}`, `m${symbol}`);
      await token.waitForDeployment();
      const tokenAddress = await token.getAddress();
      tickerAddresses[symbol] = tokenAddress;
      tickerDecimals[symbol] = 18;

      const oracle = await MockPriceOracle.deploy(feedPrice(priceDollars), 8);
      await oracle.waitForDeployment();

      await (await vault.setPriceFeed(tokenAddress, await oracle.getAddress(), ONE_HOUR)).wait();

      // Fund the router so it can pay out swaps, and set fair rates both
      // directions so real mint/redeem calls don't trip the slippage check.
      await (await token.mint(await router.getAddress(), ethers.parseUnits("1000000", 18))).wait();

      const ethUsd18 = ETH_USD_DOLLARS * 10n ** 18n;
      const tokenUsd18 = priceDollars * 10n ** 18n;
      const rateEthToToken = (ethUsd18 * 10n ** 18n) / tokenUsd18;
      const rateTokenToEth = (tokenUsd18 * 10n ** 18n) / ethUsd18;

      await (await router.setRate(await weth.getAddress(), tokenAddress, rateEthToToken)).wait();
      await (await router.setRate(tokenAddress, await weth.getAddress(), rateTokenToEth)).wait();

      console.log(`  ${symbol}: token=${tokenAddress} feed=${await oracle.getAddress()} ($${priceDollars})`);
    }
  }

  console.log("");
  console.log("Creating baskets...");

  for (const basket of BASKETS) {
    const tickerAddrs = (basket.tickers as [string, bigint, number][]).map(([symbol]) => tickerAddresses[symbol]);
    const weights = (basket.tickers as [string, bigint, number][]).map(([, , weight]) => weight);

    await (await vault.createBasket(
      basket.id,
      basket.name,
      basket.symbol,
      tickerAddrs,
      weights,
      ethers.parseUnits("1000000", 18), // depositCapUsd: $1,000,000
      ethers.parseUnits("100000", 18)   // maxMintUsd: $100,000 per tx
    )).wait();

    console.log(`  Basket ${basket.id} (${basket.name} / ${basket.symbol}) created`);
  }

  console.log("");
  console.log("=== DEPLOYMENT COMPLETE ===");
  console.log("StaxVault address:", await vault.getAddress());
  console.log("Save this address — you'll need it for the frontend and for verification.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
