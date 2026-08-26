import { network } from "hardhat";

// Confirmed V4 PoolManager on Robinhood Chain mainnet.
const V4_POOL_MANAGER = "0x8366a39cc670b4001a1121b8f6a443a643e40951";
const WETH = "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73";
const NATIVE_ETH = "0x0000000000000000000000000000000000000000"; // V4 can pair against native ETH directly, not just WETH

const TICKERS = [
  { symbol: "NVDA", address: "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC" },
  { symbol: "AMD", address: "0x86923f96303D656E4aa86D9d42D1e57ad2023fdC" },
  { symbol: "TSM", address: "0x58FfE4a942d3885bAa22D7520691F611EF09e7AA" },
  { symbol: "AAPL", address: "0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9" },
  { symbol: "MSFT", address: "0xe93237C50D904957Cf27E7B1133b510C669c2e74" },
  { symbol: "GOOGL", address: "0x2e0847E8910a9732eB3fb1bb4b70a580ADAD4FE3" },
  { symbol: "AMZN", address: "0x12f190a9F9d7D37a250758b26824B97CE941bF54" },
  { symbol: "META", address: "0xc0D6457C16Cc70d6790Dd43521C899C87ce02f35" },
  { symbol: "TSLA", address: "0x322F0929c4625eD5bAd873c95208D54E1c003b2d" },
  { symbol: "COIN", address: "0x6330D8C3178a418788dF01a47479c0ce7CCF450b" },
  { symbol: "MSTR", address: "0xec262a75e413fAfD0dF80480274532C79D42da09" },
  { symbol: "CLSK", address: "0xcBB95BBF36099d34dA091dc6Fa6F49EfA257Cee3" },
  { symbol: "CRCL", address: "0xdF0992E440dD0be65BD8439b609d6D4366bf1CB5" },
  { symbol: "IONQ", address: "0x558378E000D634A36593E338eBacdd6207640EfE" },
  { symbol: "RGTI", address: "0x284358abc07F9359f19f4b5b4aC91901Be2597Ba" },
  { symbol: "RKLB", address: "0x3b14C39E89D60D627b42a1A4CA45b5bb45Fc12e2" },
  { symbol: "SPCX", address: "0x4a0E65A3EcceC6dBe60AE065F2e7bb85Fae35eEa" },
  { symbol: "INTC", address: "0xc72b96e0E48ecd4DC75E1e45396e26300BC39681" },
  { symbol: "MU", address: "0xfF080c8ce2E5feadaCa0Da81314Ae59D232d4afD" },
  { symbol: "ASML", address: "0x47F93d52cBeC7C6D2CfC080e154002370a60dAEA" },
  { symbol: "SNDK", address: "0xB90A19fF0Af67f7779afF50A882A9CfF42446400" },
];

// Standard V4 PoolManager Initialize event -- confirmed against Bitquery's
// own indexing docs for this chain ("Returns id (poolId), currency0,
// currency1, fee, tickSpacing, hooks, sqrtPriceX96, tick").
const POOL_MANAGER_ABI = [
  "event Initialize(bytes32 indexed id, address indexed currency0, address indexed currency1, uint24 fee, int24 tickSpacing, address hooks, uint160 sqrtPriceX96, int24 tick)",
];

async function main() {
  const { ethers } = await network.connect({ network: "robinhoodMainnet" });

  const poolManager = new ethers.Contract(V4_POOL_MANAGER, POOL_MANAGER_ABI, ethers.provider);

  console.log("Finding real V4 pool parameters for all 21 tickers by querying");
  console.log("Initialize events directly from the PoolManager contract.\n");

  for (const ticker of TICKERS) {
    try {
      // A token could be currency0 OR currency1 in the pool key (V4 orders
      // by address value) -- check both positions.
      const asC0 = await poolManager.queryFilter(
        poolManager.filters.Initialize(null, ticker.address, null)
      );
      const asC1 = await poolManager.queryFilter(
        poolManager.filters.Initialize(null, null, ticker.address)
      );

      const events = [...asC0, ...asC1];

      if (events.length === 0) {
        console.log(`  ${ticker.symbol.padEnd(6)} -- NO Initialize event found at all (unexpected, given confirmed balance)`);
        continue;
      }

      for (const event of events) {
        const args = (event as any).args;
        const otherCurrency =
          args.currency0.toLowerCase() === ticker.address.toLowerCase() ? args.currency1 : args.currency0;

        const pairedWith =
          otherCurrency.toLowerCase() === WETH.toLowerCase()
            ? "WETH"
            : otherCurrency.toLowerCase() === NATIVE_ETH.toLowerCase()
              ? "NATIVE ETH"
              : otherCurrency;

        console.log(
          `  ${ticker.symbol.padEnd(6)} paired=${pairedWith.padEnd(12)} fee=${args.fee.toString().padStart(6)} tickSpacing=${args.tickSpacing.toString().padStart(4)} hooks=${args.hooks}`
        );
      }
    } catch (err: any) {
      console.log(`  ${ticker.symbol.padEnd(6)} -- FAILED: ${err.message ?? err}`);
    }
  }

  console.log("\n=== V4 POOL PARAMETER DISCOVERY COMPLETE ===");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
