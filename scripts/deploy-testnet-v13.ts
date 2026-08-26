import { network } from "hardhat";

const ONE_HOUR = 3600;
const ETH_USD_DOLLARS = 3000n;

function feedPrice(dollars: bigint, decimals = 8): bigint {
  return dollars * 10n ** BigInt(decimals);
}

// Retries a network call up to `retries` times with backoff, on top of
// whatever this attempt already provides. This testnet RPC has been
// dropping connections mid-run (ECONNRESET / deadline exceeded) partway
// through deploys tonight -- three failed full attempts in a row, each
// burning real gas on tokens that then get discarded when the whole
// script dies. This wraps every network call so a single transient blip
// gets retried automatically instead of killing an otherwise-successful
// run 18 tickers in.
async function withRetry<T>(
  label: string,
  fn: () => Promise<T>,
  retries = 4,
  baseDelayMs = 3000
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const delay = baseDelayMs * attempt;
      console.log(`  [retry] ${label} failed (attempt ${attempt}/${retries}): ${(err as Error).message ?? err}`);
      if (attempt < retries) {
        console.log(`  [retry] waiting ${delay / 1000}s before retrying...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }
  throw new Error(`${label} failed after ${retries} attempts: ${(lastError as Error)?.message ?? lastError}`);
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

  console.log("Deploying (v13: sequencer feed optional -- Robinhood Chain has none yet) with account:", deployer.address);
  console.log("Balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "ETH");
  console.log("");

  console.log("Deploying shared infrastructure...");
  const MockWETH = await ethers.getContractFactory("MockWETH");
  const weth = await withRetry("deploy MockWETH", async () => {
    const c = await MockWETH.deploy();
    await c.waitForDeployment();
    return c;
  });
  console.log("  MockWETH:", await weth.getAddress());

  const MockSwapRouter = await ethers.getContractFactory("MockSwapRouter");
  const router = await withRetry("deploy MockSwapRouter", async () => {
    const c = await MockSwapRouter.deploy();
    await c.waitForDeployment();
    return c;
  });
  console.log("  MockSwapRouter:", await router.getAddress());

  const MockPriceOracle = await ethers.getContractFactory("MockPriceOracle");

  const ethUsdOracle = await withRetry("deploy ETH/USD oracle", async () => {
    const c = await MockPriceOracle.deploy(feedPrice(ETH_USD_DOLLARS), 8);
    await c.waitForDeployment();
    return c;
  });
  console.log("  ETH/USD MockPriceOracle:", await ethUsdOracle.getAddress());

  const sequencerFeed = await withRetry("deploy sequencer oracle", async () => {
    const c = await MockPriceOracle.deploy(0, 8);
    await c.waitForDeployment();
    return c;
  });
  await withRetry("set sequencer initial price", async () =>
    (await sequencerFeed.setPriceAt(0, 1)).wait()
  );
  console.log("  Sequencer MockPriceOracle:", await sequencerFeed.getAddress());

  await withRetry("fund WETH contract", async () =>
    (await deployer.sendTransaction({
      to: await weth.getAddress(),
      value: ethers.parseEther("0.001"),
    })).wait()
  );

  console.log("");
  console.log("Deploying StaxVault (v13)...");

  const StaxVault = await ethers.getContractFactory("StaxVault");
  // v10: real team wallet, not deployer.address. teamWallet is immutable
  // in the contract -- this MUST be correct at deploy time, since 50% of
  // every mint/redeem fee routes here via claimTeamFees(), and there is
  // no admin function to change it after construction.
  const TEAM_WALLET = "0x375E296871a38900bbc2de32E37B2Ca181bd9d41";

  const vault = await withRetry("deploy StaxVault", async () => {
    const c = await StaxVault.deploy(
      TEAM_WALLET,
      deployer.address, // staxToken placeholder -- unchanged from prior versions
      await router.getAddress(),
      await weth.getAddress(),
      await ethUsdOracle.getAddress(),
      ONE_HOUR,
      await sequencerFeed.getAddress()
    );
    await c.waitForDeployment();
    return c;
  });
  console.log("  StaxVault (v13):", await vault.getAddress());
  console.log("");

  console.log("Deploying ticker mocks and registering feeds...");
  const tickerAddresses: Record<string, string> = {};

  for (const basket of BASKETS) {
    for (const [symbol, priceDollars] of basket.tickers as [string, bigint, number][]) {
      if (tickerAddresses[symbol]) continue;

      const MockERC20 = await ethers.getContractFactory("MockERC20");
      const token = await withRetry(`deploy ${symbol} token`, async () => {
        const c = await MockERC20.deploy(`Mock ${symbol}`, `m${symbol}`);
        await c.waitForDeployment();
        return c;
      });
      const tokenAddress = await token.getAddress();
      tickerAddresses[symbol] = tokenAddress;

      const oracle = await withRetry(`deploy ${symbol} oracle`, async () => {
        const c = await MockPriceOracle.deploy(feedPrice(priceDollars), 8);
        await c.waitForDeployment();
        return c;
      });

      await withRetry(`set ${symbol} price feed`, async () =>
        (await vault.setPriceFeed(tokenAddress, await oracle.getAddress(), ONE_HOUR)).wait()
      );
      await withRetry(`mint ${symbol} to router`, async () =>
        (await token.mint(await router.getAddress(), ethers.parseUnits("1000000", 18))).wait()
      );

      const ethUsd18 = ETH_USD_DOLLARS * 10n ** 18n;
      const tokenUsd18 = priceDollars * 10n ** 18n;
      const rateEthToToken = (ethUsd18 * 10n ** 18n) / tokenUsd18;
      const rateTokenToEth = (tokenUsd18 * 10n ** 18n) / ethUsd18;

      await withRetry(`set ${symbol} rate (eth->token)`, async () =>
        (await router.setRate(await weth.getAddress(), tokenAddress, rateEthToToken)).wait()
      );
      await withRetry(`set ${symbol} rate (token->eth)`, async () =>
        (await router.setRate(tokenAddress, await weth.getAddress(), rateTokenToEth)).wait()
      );

      console.log(`  ${symbol}: token=${tokenAddress} feed=${await oracle.getAddress()} ($${priceDollars})`);
    }
  }

  console.log("");
  console.log("Creating baskets...");

  for (const basket of BASKETS) {
    const tickerAddrs = (basket.tickers as [string, bigint, number][]).map(([symbol]) => tickerAddresses[symbol]);
    const weights = (basket.tickers as [string, bigint, number][]).map(([, , weight]) => weight);

    await withRetry(`create basket ${basket.id} (${basket.name})`, async () =>
      (await vault.createBasket(
        basket.id,
        basket.name,
        basket.symbol,
        tickerAddrs,
        weights,
        ethers.parseUnits("1000000", 18),
        ethers.parseUnits("100000", 18)
      )).wait()
    );

    console.log(`  Basket ${basket.id} (${basket.name} / ${basket.symbol}) created`);
  }

  console.log("");
  console.log("=== V13 DEPLOYMENT COMPLETE ===");
  console.log("NEW StaxVault address:", await vault.getAddress());
  console.log("Changes in this version vs v12:");
  console.log("  - Constructor no longer requires a non-zero sequencer uptime feed.");
  console.log("    Robinhood Chain has no published Chainlink L2 Sequencer Uptime Feed");
  console.log("    yet (confirmed directly by Chainlink Labs) -- this contract was");
  console.log("    literally undeployable to mainnet without this change. Passing");
  console.log("    address(0) is a deliberate, immutable choice: sequencer-liveness");
  console.log("    checking is skipped, every other price/DEX defense is unaffected.");
  console.log("    THIS DEPLOY still passes a real MockPriceOracle for testing");
  console.log("    parity with prior versions -- the point is that address(0) is now");
  console.log("    ALLOWED, not that this specific deploy uses it.");
  console.log("  Carried over from v12 (unchanged):");
  console.log("  - mint() and redeem() both use two-pass deferred-credit CEI");
  console.log("  - Redeemed emits valueReturnedUsd (real USD realized P&L)");
  console.log("  - teamWallet = real team wallet (0x375E296871a38900bbc2de32E37B2Ca181bd9d41)");
  console.log("  - MIN_INITIAL_VALUE_USD = $2 (genesis mint floor)");
  console.log("");
  console.log("Update VAULT_ADDRESS in src/lib/vault.ts to this new address.");
  console.log("Update VAULT_DEPLOY_BLOCK in src/lib/vault.ts to the current block height.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
