import { network } from "hardhat";

// Confirmed real V4 PoolManager address on Robinhood Chain mainnet --
// sourced from Bitquery's own technical documentation for indexing this
// specific chain, which explicitly identifies it as "the Uniswap v4
// singleton for all of Robinhood Chain." In V4's architecture, ALL pool
// liquidity across every pair is custodied by this ONE contract (unlike
// V3, where every pair gets its own separate pool contract) -- so
// checking this address's token balance is a direct, reliable proxy for
// "does real V4 liquidity exist for this ticker, and how much."
const V4_POOL_MANAGER = "0x8366a39cc670b4001a1121b8f6a443a643e40951";

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

const ERC20_ABI = [
  "function balanceOf(address account) external view returns (uint256)",
  "function decimals() external view returns (uint8)",
];

async function main() {
  const { ethers } = await network.connect({ network: "robinhoodMainnet" });

  console.log("Checking REAL V4 liquidity: how much of each ticker the V4");
  console.log("PoolManager singleton actually holds (confirmed by Bitquery's");
  console.log("own indexing docs as the real custody address for ALL V4 pools");
  console.log("on this chain, across every pair, every hook, every fee tier).\n");

  for (const ticker of TICKERS) {
    try {
      const token = new ethers.Contract(ticker.address, ERC20_ABI, ethers.provider);
      const [balance, decimals] = await Promise.all([
        token.balanceOf(V4_POOL_MANAGER),
        token.decimals(),
      ]);

      const formatted = ethers.formatUnits(balance, decimals);
      const held = Number(formatted);

      if (held === 0) {
        console.log(`  ${ticker.symbol.padEnd(6)} -- PoolManager holds ZERO. No V4 liquidity for this ticker.`);
      } else {
        console.log(`  ${ticker.symbol.padEnd(6)} -- PoolManager holds ${held.toLocaleString()} ${ticker.symbol}`);
      }
    } catch (err: any) {
      console.log(`  ${ticker.symbol.padEnd(6)} -- FAILED to read: ${err.message ?? err}`);
    }
  }

  console.log("\n=== V4 LIQUIDITY CHECK COMPLETE ===");
  console.log("A nonzero balance here confirms SOME real V4 liquidity exists");
  console.log("for that ticker, held by the actual singleton pool contract --");
  console.log("this doesn't tell us which specific pool/fee/hook combination,");
  console.log("but it IS a direct, reliable signal of 'is there real liquidity");
  console.log("anywhere in V4 for this name,' unlike the V3 check which came");
  console.log("back empty for most of these because it was looking in the");
  console.log("wrong protocol version.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
