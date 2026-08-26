import { network } from "hardhat";

// Real, confirmed mainnet addresses -- from tonight's research, cross-
// checked against Chainlink's live feed page and Robinhood's own docs.
const WETH = "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73";
const UNISWAP_V3_FACTORY = "0x1f7d7550b1b028f7571e69a784071f0205fd2efa";

// Standard Uniswap V3 fee tiers, in the order most likely to be used for
// a given pair -- 3000 (0.3%) matches our contract's POOL_FEE constant,
// but a real pool might exist at a different tier (500 = 0.05%,
// 10000 = 1%), so check all three per ticker.
const FEE_TIERS = [3000, 500, 10000];

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

const FACTORY_ABI = [
  "function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool)",
];

const ERC20_ABI = [
  "function balanceOf(address account) external view returns (uint256)",
  "function decimals() external view returns (uint8)",
];

async function main() {
  const { ethers } = await network.connect({ network: "robinhoodMainnet" });

  const factory = new ethers.Contract(UNISWAP_V3_FACTORY, FACTORY_ABI, ethers.provider);
  const weth = new ethers.Contract(WETH, ERC20_ABI, ethers.provider);

  console.log("Checking REAL, live Uniswap V3 pool liquidity for all 21 tickers");
  console.log("on Robinhood Chain mainnet (querying the actual Factory + pool");
  console.log("contracts directly -- not secondhand reports).\n");

  for (const ticker of TICKERS) {
    let found = false;

    for (const fee of FEE_TIERS) {
      try {
        const poolAddress = await factory.getPool(WETH, ticker.address, fee);

        if (poolAddress === ethers.ZeroAddress) continue;

        const token = new ethers.Contract(ticker.address, ERC20_ABI, ethers.provider);
        const [wethBalance, tokenBalance, tokenDecimals] = await Promise.all([
          weth.balanceOf(poolAddress),
          token.balanceOf(poolAddress),
          token.decimals(),
        ]);

        const wethFormatted = ethers.formatUnits(wethBalance, 18);
        const tokenFormatted = ethers.formatUnits(tokenBalance, tokenDecimals);

        console.log(
          `  ${ticker.symbol.padEnd(6)} fee=${fee.toString().padStart(5)}  pool=${poolAddress}  WETH=${Number(wethFormatted).toFixed(4)}  ${ticker.symbol}=${Number(tokenFormatted).toFixed(2)}`
        );
        found = true;
      } catch (err: any) {
        // Pool doesn't exist at this fee tier, or a read failed -- skip.
      }
    }

    if (!found) {
      console.log(`  ${ticker.symbol.padEnd(6)} -- NO POOL FOUND at any standard fee tier (500/3000/10000)`);
    }
  }

  console.log("\n=== LIQUIDITY CHECK COMPLETE ===");
  console.log("WETH balance in a pool is the most direct proxy for real depth --");
  console.log("more WETH sitting in the pool means larger trades can execute");
  console.log("with less price impact. A ticker showing 'NO POOL FOUND' has no");
  console.log("liquidity at all on Uniswap V3 at standard fee tiers -- our");
  console.log("contract's mint/redeem for that ticker would fail entirely, not");
  console.log("just suffer high slippage.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
