import { network } from "hardhat";

const V4_POOL_MANAGER = "0x8366a39cc670b4001a1121b8f6a443a643e40951";

const TICKERS = [
  { symbol: "NVDA", address: "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC", feed: "0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15" },
  { symbol: "AMD", address: "0x86923f96303D656E4aa86D9d42D1e57ad2023fdC", feed: "0x943A29E7ae51A4798823ca9eEd2ed533B2A22C72" },
  { symbol: "TSM", address: "0x58FfE4a942d3885bAa22D7520691F611EF09e7AA", feed: "0x874cF94aa8eC88Fd9560094dD065f2fB3E41Fc2F" },
  { symbol: "AAPL", address: "0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9", feed: "0x6B22A786bAa607d76728168703a39Ea9C99f2cD0" },
  { symbol: "MSFT", address: "0xe93237C50D904957Cf27E7B1133b510C669c2e74", feed: "0x45C3C877C15E6BA2EBB19eA114Ea508d14C1Af2E" },
  { symbol: "GOOGL", address: "0x2e0847E8910a9732eB3fb1bb4b70a580ADAD4FE3", feed: "0xF6f373a037c30F0e5010d854385cA89185AE638b" },
  { symbol: "AMZN", address: "0x12f190a9F9d7D37a250758b26824B97CE941bF54", feed: "0xD5a1508ceD74c084eBf3cBe853e2C968fB2a651C" },
  { symbol: "META", address: "0xc0D6457C16Cc70d6790Dd43521C899C87ce02f35", feed: "0x7C38C00C30BEe9378381E7B6135d7283356D71b1" },
  { symbol: "TSLA", address: "0x322F0929c4625eD5bAd873c95208D54E1c003b2d", feed: "0x4A1166a659A55625345e9515b32adECea5547C38" },
  { symbol: "COIN", address: "0x6330D8C3178a418788dF01a47479c0ce7CCF450b", feed: "0xA3a468A452940B7D6b69991207B508c609a98Ef2" },
  { symbol: "MSTR", address: "0xec262a75e413fAfD0dF80480274532C79D42da09", feed: "0x396118bdFB181e6240E74D243F266B061c0edc3D" },
  { symbol: "CLSK", address: "0xcBB95BBF36099d34dA091dc6Fa6F49EfA257Cee3", feed: "0x810c12D3a554Bc47fd39597Fe3b3AAC4941F50eF" },
  { symbol: "CRCL", address: "0xdF0992E440dD0be65BD8439b609d6D4366bf1CB5", feed: "0x6652eDf64bA3731C4F2D3ce821A0Fb1f1f6b482a" },
  { symbol: "IONQ", address: "0x558378E000D634A36593E338eBacdd6207640EfE", feed: "0x22EfeC4919baf55F360E0EDee4AbEB26DE4971eb" },
  { symbol: "RGTI", address: "0x284358abc07F9359f19f4b5b4aC91901Be2597Ba", feed: "0x2A045cF1C49c61c166C036d2f06FA2D2d984f765" },
  { symbol: "RKLB", address: "0x3b14C39E89D60D627b42a1A4CA45b5bb45Fc12e2", feed: "0x045477BF65Aef6f4F2386ad0164579e48381CC74" },
  { symbol: "SPCX", address: "0x4a0E65A3EcceC6dBe60AE065F2e7bb85Fae35eEa", feed: "0xB265810950ba6c5C0Ff821c9963014a56fD8Bffb" },
  { symbol: "INTC", address: "0xc72b96e0E48ecd4DC75E1e45396e26300BC39681", feed: "0x3f390C5C24628Ac7C489515402235FeAD71D1913" },
  { symbol: "MU", address: "0xfF080c8ce2E5feadaCa0Da81314Ae59D232d4afD", feed: "0x425EEFdCf05ed6526C3cE61Af99429A228a6d596" },
  { symbol: "ASML", address: "0x47F93d52cBeC7C6D2CfC080e154002370a60dAEA", feed: "0xB4106147E8cce40b7d46124090d373A71b70f87D" },
  { symbol: "SNDK", address: "0xB90A19fF0Af67f7779afF50A882A9CfF42446400", feed: "0xfb133Fa4B7b385802B693a293606682Df47109A3" },
];

const ERC20_ABI = [
  "function balanceOf(address account) external view returns (uint256)",
  "function decimals() external view returns (uint8)",
];

const ORACLE_ABI = [
  "function decimals() external view returns (uint8)",
  "function latestRoundData() external view returns (uint80,int256,uint256,uint256,uint80)",
];

async function main() {
  const { ethers } = await network.connect({ network: "robinhoodMainnet" });

  console.log("Converting V4 PoolManager holdings to real USD value using");
  console.log("live Chainlink prices -- directly comparable across all 21");
  console.log("tickers, unlike raw token counts.\n");

  const results: { symbol: string; usdValue: number }[] = [];

  for (const ticker of TICKERS) {
    try {
      const token = new ethers.Contract(ticker.address, ERC20_ABI, ethers.provider);
      const oracle = new ethers.Contract(ticker.feed, ORACLE_ABI, ethers.provider);

      const [balance, tokenDecimals, roundData, feedDecimals] = await Promise.all([
        token.balanceOf(V4_POOL_MANAGER),
        token.decimals(),
        oracle.latestRoundData(),
        oracle.decimals(),
      ]);

      const heldAmount = Number(ethers.formatUnits(balance, tokenDecimals));
      const price = Number(roundData[1]) / 10 ** Number(feedDecimals);
      const usdValue = heldAmount * price;

      results.push({ symbol: ticker.symbol, usdValue });
    } catch (err: any) {
      console.log(`  ${ticker.symbol.padEnd(6)} -- FAILED: ${err.message ?? err}`);
    }
  }

  results.sort((a, b) => b.usdValue - a.usdValue);

  for (const r of results) {
    const flag = r.usdValue < 1000 ? "  <-- THIN" : r.usdValue < 5000 ? "  <-- moderate" : "";
    console.log(`  ${r.symbol.padEnd(6)} ~$${r.usdValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}${flag}`);
  }

  console.log("\n=== USD-VALUE LIQUIDITY CHECK COMPLETE ===");
  console.log("Note: this is total VALUE held by the PoolManager for this");
  console.log("ticker (both sides of whatever pairs exist), not the specific");
  console.log("depth of a ticker/WETH pair alone -- a reasonable proxy for");
  console.log("relative liquidity health across tickers, not an exact");
  console.log("'max safe trade size' figure.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
