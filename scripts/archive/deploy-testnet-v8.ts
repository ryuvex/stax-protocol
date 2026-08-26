import { network } from "hardhat";

const ONE_HOUR = 3600;
const ETH_USD_DOLLARS = 3000n;

function feedPrice(dollars: bigint, decimals = 8): bigint {
  return dollars * 10n ** BigInt(decimals);
}

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
      ["NVDA", 150n, 1429],
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
      ["TSM", 200n, 2000],
      ["ASML", 700n, 2000],
      ["SNDK", 50n, 2000],
    ],
  },
];

async function main() {
  const { ethers } = await network.connect();
  const [deployer] = await ethers.getSigners();

  console.log("Deploying (v8, ledger-only) with account:", deployer.address);
  console.log("Balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "ETH");
  console.log("");

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

  const sequencerFeed = await MockPriceOracle.deploy(0, 8);
  await sequencerFeed.waitForDeployment();
  await (await sequencerFeed.setPriceAt(0, 1)).wait();
  console.log("  Sequencer MockPriceOracle:", await sequencerFeed.getAddress());

  await (await deployer.sendTransaction({
    to: await weth.getAddress(),
    value: ethers.parseEther("0.001"),
  })).wait();

  console.log("");
  console.log("Deploying StaxVault (v8, ledger-only accounting)...");

  const StaxVault = await ethers.getContractFactory("StaxVault");
  const vault = await StaxVault.deploy(
    deployer.address,
    deployer.address,
    await router.getAddress(),
    await weth.getAddress(),
    await ethUsdOracle.getAddress(),
    ONE_HOUR,
    await sequencerFeed.getAddress()
  );
  await vault.waitForDeployment();
  console.log("  StaxVault (v8):", await vault.getAddress());
  console.log("");

  // NOTE: this loop already dedupes by ticker symbol (the `if
  // (tickerAddresses[symbol]) continue` below), so a ticker referenced by
  // more than one basket -- NVDA (AI Infrastructure + Mag 7), TSM (AI
  // Infrastructure + Broad Semiconductors) -- is deployed and registered
  // exactly once and its address is reused across every basket that
  // includes it. This is exactly the shape the v8 ledger-only fix expects:
  // one real ERC20 + one price feed per ticker, with each basket's
  // createBasket call just referencing the same token address. Per-basket
  // isolation is handled entirely on-chain by basketTickerHoldings, not by
  // deploying separate token instances per basket.
  console.log("Deploying ticker mocks and registering feeds...");
  const tickerAddresses: Record<string, string> = {};

  for (const basket of BASKETS) {
    for (const [symbol, priceDollars] of basket.tickers as [string, bigint, number][]) {
      if (tickerAddresses[symbol]) continue;

      const MockERC20 = await ethers.getContractFactory("MockERC20");
      const token = await MockERC20.deploy(`Mock ${symbol}`, `m${symbol}`);
      await token.waitForDeployment();
      const tokenAddress = await token.getAddress();
      tickerAddresses[symbol] = tokenAddress;

      const oracle = await MockPriceOracle.deploy(feedPrice(priceDollars), 8);
      await oracle.waitForDeployment();

      await (await vault.setPriceFeed(tokenAddress, await oracle.getAddress(), ONE_HOUR)).wait();
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
      ethers.parseUnits("1000000", 18),
      ethers.parseUnits("100000", 18)
    )).wait();

    console.log(`  Basket ${basket.id} (${basket.name} / ${basket.symbol}) created`);
  }

  console.log("");
  console.log("=== V8 DEPLOYMENT COMPLETE ===");
  console.log("NEW StaxVault address:", await vault.getAddress());
  console.log("Update VAULT_ADDRESS in src/lib/vault.ts to this new address.");
  console.log("Update VAULT_DEPLOY_BLOCK in src/lib/vault.ts to the current block height.");
  console.log("");
  console.log("Shared tickers in this deployment (single token/feed, reused across baskets):");
  console.log("  NVDA -> basket 1 (AI Infrastructure), basket 2 (Mag 7)");
  console.log("  TSM  -> basket 1 (AI Infrastructure), basket 6 (Broad Semiconductors)");
  console.log("Per-basket isolation for these is enforced by basketTickerHoldings on-chain,");
  console.log("not by this script -- verify with basketTickerHoldings(basketId, tickerAddress)");
  console.log("after seeding real mints.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
