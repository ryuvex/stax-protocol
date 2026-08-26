import { network } from "hardhat";

// Mirrors the real deploy script exactly -- kept in sync manually.
// If deploy-mainnet-v18.ts's data changes, this must too, or the
// estimate stops reflecting the real sequence.
const USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
const USDG_USD_FEED = "0x61B7e5650328764B076A108EFF5fa7282a1B9aD2";
const UNIVERSAL_ROUTER = "0x8876789976dEcBfCbBbe364623C63652db8C0904";
const PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3";
const REWARDS_POOL = "0xc02F399cBbF90CEc6DD3a7c2D90fcA84C0a3a5ad";
const TREASURY = "0xFF843Bc76C276086569D081E02DAC467C2aDa5cE";
const USDG_USD_MAX_STALENESS = 27 * 60 * 60;
const STOCK_FEED_MAX_STALENESS = 60 * 60;
const SEQUENCER_UPTIME_FEED = "0x0000000000000000000000000000000000000000";
const ZERO_ADDR = "0x0000000000000000000000000000000000000000";

const TICKERS: Record<string, { token: string; feed: string }> = {
  NVDA: { token: "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC", feed: "0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15" },
  AMD: { token: "0x86923f96303D656E4aa86D9d42D1e57ad2023fdC", feed: "0x943A29E7ae51A4798823ca9eEd2ed533B2A22C72" },
  TSM: { token: "0x58FfE4a942d3885bAa22D7520691F611EF09e7AA", feed: "0x874cF94aa8eC88Fd9560094dD065f2fB3E41Fc2F" },
  AAPL: { token: "0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9", feed: "0x6B22A786bAa607d76728168703a39Ea9C99f2cD0" },
  MSFT: { token: "0xe93237C50D904957Cf27E7B1133b510C669c2e74", feed: "0x45C3C877C15E6BA2EBB19eA114Ea508d14C1Af2E" },
  GOOGL: { token: "0x2e0847E8910a9732eB3fb1bb4b70a580ADAD4FE3", feed: "0xF6f373a037c30F0e5010d854385cA89185AE638b" },
  AMZN: { token: "0x12f190a9F9d7D37a250758b26824B97CE941bF54", feed: "0xD5a1508ceD74c084eBf3cBe853e2C968fB2a651C" },
  META: { token: "0xc0D6457C16Cc70d6790Dd43521C899C87ce02f35", feed: "0x7C38C00C30BEe9378381E7B6135d7283356D71b1" },
  TSLA: { token: "0x322F0929c4625eD5bAd873c95208D54E1c003b2d", feed: "0x4A1166a659A55625345e9515b32adECea5547C38" },
  COIN: { token: "0x6330D8C3178a418788dF01a47479c0ce7CCF450b", feed: "0xA3a468A452940B7D6b69991207B508c609a98Ef2" },
  MSTR: { token: "0xec262a75e413fAfD0dF80480274532C79D42da09", feed: "0x396118bdFB181e6240E74D243F266B061c0edc3D" },
  CRCL: { token: "0xdF0992E440dD0be65BD8439b609d6D4366bf1CB5", feed: "0x6652eDf64bA3731C4F2D3ce821A0Fb1f1f6b482a" },
  SPCX: { token: "0x4a0E65A3EcceC6dBe60AE065F2e7bb85Fae35eEa", feed: "0xB265810950ba6c5C0Ff821c9963014a56fD8Bffb" },
  INTC: { token: "0xc72b96e0E48ecd4DC75E1e45396e26300BC39681", feed: "0x3f390C5C24628Ac7C489515402235FeAD71D1913" },
  MU: { token: "0xfF080c8ce2E5feadaCa0Da81314Ae59D232d4afD", feed: "0x425EEFdCf05ed6526C3cE61Af99429A228a6d596" },
  SNDK: { token: "0xB90A19fF0Af67f7779afF50A882A9CfF42446400", feed: "0xfb133Fa4B7b385802B693a293606682Df47109A3" },
};

const TICKER_POOLS: Record<string, { currency0: string; currency1: string; fee: number; tickSpacing: number; hooks: string }> = {
  NVDA: { currency0: USDG, currency1: TICKERS.NVDA.token, fee: 3000, tickSpacing: 60, hooks: ZERO_ADDR },
  AMD: { currency0: USDG, currency1: TICKERS.AMD.token, fee: 10000, tickSpacing: 200, hooks: ZERO_ADDR },
  TSM: { currency0: TICKERS.TSM.token, currency1: USDG, fee: 400000, tickSpacing: 8000, hooks: ZERO_ADDR },
  AAPL: { currency0: USDG, currency1: TICKERS.AAPL.token, fee: 3000, tickSpacing: 60, hooks: ZERO_ADDR },
  MSFT: { currency0: USDG, currency1: TICKERS.MSFT.token, fee: 3000, tickSpacing: 60, hooks: ZERO_ADDR },
  GOOGL: { currency0: TICKERS.GOOGL.token, currency1: USDG, fee: 3000, tickSpacing: 60, hooks: ZERO_ADDR },
  AMZN: { currency0: TICKERS.AMZN.token, currency1: USDG, fee: 3000, tickSpacing: 60, hooks: ZERO_ADDR },
  META: { currency0: USDG, currency1: TICKERS.META.token, fee: 3000, tickSpacing: 60, hooks: ZERO_ADDR },
  TSLA: { currency0: TICKERS.TSLA.token, currency1: USDG, fee: 3000, tickSpacing: 60, hooks: ZERO_ADDR },
  COIN: { currency0: USDG, currency1: TICKERS.COIN.token, fee: 10000, tickSpacing: 200, hooks: ZERO_ADDR },
  MSTR: { currency0: USDG, currency1: TICKERS.MSTR.token, fee: 50000, tickSpacing: 1100, hooks: ZERO_ADDR },
  CRCL: { currency0: USDG, currency1: TICKERS.CRCL.token, fee: 3000, tickSpacing: 30, hooks: ZERO_ADDR },
  SPCX: { currency0: TICKERS.SPCX.token, currency1: USDG, fee: 10000, tickSpacing: 200, hooks: ZERO_ADDR },
  INTC: { currency0: USDG, currency1: TICKERS.INTC.token, fee: 10000, tickSpacing: 200, hooks: ZERO_ADDR },
  MU: { currency0: USDG, currency1: TICKERS.MU.token, fee: 10000, tickSpacing: 200, hooks: ZERO_ADDR },
  SNDK: { currency0: USDG, currency1: TICKERS.SNDK.token, fee: 10000, tickSpacing: 200, hooks: ZERO_ADDR },
};

const BASKETS = [
  { id: 1, name: "AI Infrastructure", symbol: "sAI", tickers: ["NVDA", "AMD", "TSM"], weights: [4000, 3000, 3000] },
  { id: 2, name: "Mag 7", symbol: "sMAG7", tickers: ["AAPL", "MSFT", "GOOGL", "AMZN", "NVDA", "META", "TSLA"], weights: [1430, 1430, 1430, 1430, 1430, 1430, 1420] },
  { id: 3, name: "Crypto Proxy Equities", symbol: "sCRYPTO", tickers: ["COIN", "MSTR", "CRCL"], weights: [3334, 3333, 3333] },
  { id: 4, name: "Broad Semiconductors", symbol: "sSEMI", tickers: ["INTC", "MU", "TSM", "SNDK"], weights: [2500, 2500, 2500, 2500] },
];

async function main() {
  console.log("=== Real gas estimation: forking live mainnet, running the actual 37-transaction sequence for real (on the fork, zero cost) ===\n");

  // Fix (2nd attempt): Hardhat 3 removed hardhat_reset entirely --
  // runtime forking via RPC call is no longer supported. Forking is
  // now declared statically in hardhat.config.ts as its own network
  // (robinhoodMainnetFork) -- connecting to it establishes the fork
  // automatically, no runtime reset call needed at all.
  const { ethers } = await network.connect({ network: "robinhoodMainnetFork" });

  const [deployer] = await ethers.getSigners();

  // Give the fork's deployer plenty of fake ETH so gas cost isn't the
  // constraint on the SIMULATION itself -- we're measuring real gas
  // USAGE per call, not testing whether THIS run affords it.
  await ethers.provider.send("hardhat_setBalance", [
    deployer.address,
    "0x21E19E0C9BAB2400000", // 10,000 ETH
  ]);

  console.log("Deploying StaxVault on the fork...");
  const StaxVault = await ethers.getContractFactory("StaxVault");
  const vault = await StaxVault.deploy(
    REWARDS_POOL,
    TREASURY,
    UNIVERSAL_ROUTER,
    PERMIT2,
    USDG,
    USDG_USD_FEED,
    USDG_USD_MAX_STALENESS,
    SEQUENCER_UPTIME_FEED
  );
  const deployReceipt = await vault.deploymentTransaction()?.wait();
  const deployGas = deployReceipt?.gasUsed ?? 0n;
  console.log(`  Deploy gas used: ${deployGas}`);

  let totalGas = deployGas;
  const gasLog: { label: string; gas: bigint }[] = [{ label: "constructor deploy", gas: deployGas }];

  console.log("\nRunning all 16 setPriceFeed + setTickerPool calls...");
  for (const [symbol, cfg] of Object.entries(TICKERS)) {
    const feedTx = await vault.setPriceFeed(cfg.token, cfg.feed, STOCK_FEED_MAX_STALENESS);
    const feedReceipt = await feedTx.wait();
    const feedGas = feedReceipt?.gasUsed ?? 0n;
    totalGas += feedGas;
    gasLog.push({ label: `${symbol} setPriceFeed`, gas: feedGas });

    const pool = TICKER_POOLS[symbol];
    const poolTx = await vault.setTickerPool(cfg.token, pool.currency0, pool.currency1, pool.fee, pool.tickSpacing, pool.hooks);
    const poolReceipt = await poolTx.wait();
    const poolGas = poolReceipt?.gasUsed ?? 0n;
    totalGas += poolGas;
    gasLog.push({ label: `${symbol} setTickerPool`, gas: poolGas });

    console.log(`  ${symbol}: feed=${feedGas} pool=${poolGas}`);
  }

  console.log("\nRunning all 4 createBasket calls (each deploys a new ERC-20 internally -- heavier than typical calls)...");
  for (const basket of BASKETS) {
    const tokenAddrs = basket.tickers.map((s) => TICKERS[s].token);
    const tx = await vault.createBasket(
      basket.id,
      basket.name,
      basket.symbol,
      tokenAddrs,
      basket.weights,
      ethers.parseUnits("1000000", 18),
      ethers.parseUnits("100000", 18)
    );
    const receipt = await tx.wait();
    const gas = receipt?.gasUsed ?? 0n;
    totalGas += gas;
    gasLog.push({ label: `createBasket ${basket.name}`, gas });
    console.log(`  ${basket.name}: ${gas}`);
  }

  console.log(`\n=== Total real gas used across all ${gasLog.length} transactions: ${totalGas} ===`);

  // Real current gas price -- read from the live network, not the fork
  // (fork should reflect the same price at fork time, but confirm
  // against the live network directly for the freshest number).
  const liveProvider = new ethers.JsonRpcProvider("https://rpc.mainnet.chain.robinhood.com");
  const feeData = await liveProvider.getFeeData();
  const gasPrice = feeData.gasPrice ?? 0n;
  console.log(`\nCurrent real mainnet gas price: ${ethers.formatUnits(gasPrice, "gwei")} gwei`);

  const totalCostWei = totalGas * gasPrice;
  const totalCostEth = ethers.formatEther(totalCostWei);
  console.log(`\nTotal estimated cost: ${totalCostEth} ETH`);

  // Rough ETH/USD for context -- NOT authoritative, just for a sanity
  // read alongside the real ETH figure above.
  console.log("\n(Convert the ETH figure above to USD yourself against a current price to compare against your real wallet balance.)");

  console.log("\n=== MARGIN CHECK ===");
  console.log("Compare 'Total estimated cost' above against your real wallet balance.");
  console.log("Opus's recommendation: fund to 2-3x this estimate, not 1.1x, since gas price can move mid-run.");
  console.log(`Recommended minimum balance: ${(Number(totalCostEth) * 2).toFixed(6)} - ${(Number(totalCostEth) * 3).toFixed(6)} ETH`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
