import "dotenv/config";
import { network } from "hardhat";
import { createClient } from "@supabase/supabase-js";

function feedPriceToUsd(answer: bigint, decimals: number): number {
  return Number(answer) / 10 ** decimals;
}

// v12 deployment oracle addresses -- same source as
// refresh-all-oracles-v12.ts, confirmed against the single continuous
// deploy log pasted into chat.
const ORACLES = [
  { symbol: "NVDA", address: "0x324633A0cF28877e6365953DA1c74d340bCe1832" },
  { symbol: "AMD", address: "0xFD2E63E887A779448c69027168Bbc4ED89F60595" },
  { symbol: "TSM", address: "0xa7361d20488E27D664F90CdB699aefF0546421cC" },
  { symbol: "AAPL", address: "0x51e1A158f6b0555f72340600C5350e5482Fe5a98" },
  { symbol: "MSFT", address: "0xB35bBFa17c332df0d08589020AC2487a018B0b15" },
  { symbol: "GOOGL", address: "0x3952EE225BA6455AF61739e4743a7db2D103578B" },
  { symbol: "AMZN", address: "0x0f6343c5D3FdFABA8705D2F81dd8caa54aF55CC0" },
  { symbol: "META", address: "0x851eb55E1a455024638042Add382d7E2A8F2E854" },
  { symbol: "TSLA", address: "0x514050ba868363e7Dc4bB01Cd4D5268dD0777688" },
  { symbol: "COIN", address: "0x5e9699333b5C35dcf94f0F02dF650bca38B88E38" },
  { symbol: "MSTR", address: "0x8B4D12c9abd666f897A5d1510fd02d6514FCBE30" },
  { symbol: "CLSK", address: "0x83B3150013585deD7683D37f3762a915E875873c" },
  { symbol: "CRCL", address: "0x6a8e389448B92475519610C7fbC942E884B030d8" },
  { symbol: "IONQ", address: "0xfF9a8D1282D48303b8d336865F403d019DDB3111" },
  { symbol: "RGTI", address: "0x1Ae70F70aB73f18fC9400216Eb7fb975ed8E8F4f" },
  { symbol: "RKLB", address: "0x37b10890171e91173fdfBa46c51b2D6028a05b0B" },
  { symbol: "SPCX", address: "0x14c8F992cBdD2212bF2B5c901B2f63cfB1723379" },
  { symbol: "INTC", address: "0x49060e5eEEa0f7Dba394c702891687a6B0612e9f" },
  { symbol: "MU", address: "0x77F1a1fE7375eAF3fE1BB96bFc602264Ebc39Ec8" },
  { symbol: "ASML", address: "0x1849dF7ef576B521f50bBadC46Bf8409d58D7858" },
  { symbol: "SNDK", address: "0x8bDdA8b79f42b950567dDE8F1eba348463BC270C" },
];

async function main() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;

  if (!supabaseUrl || !supabaseSecretKey) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SECRET_KEY in .env");
  }

  const supabase = createClient(supabaseUrl, supabaseSecretKey);
  const { ethers } = await network.connect();

  console.log("Taking per-ticker price snapshot (v12)...\n");

  for (const { symbol, address } of ORACLES) {
    try {
      const oracle = await ethers.getContractAt("MockPriceOracle", address);
      const decimals = await oracle.decimals();
      const [, answer] = await oracle.latestRoundData();
      const priceUsd = feedPriceToUsd(answer, Number(decimals));

      const { error } = await supabase.from("ticker_price_snapshots").insert({
        ticker_symbol: symbol,
        price_usd: priceUsd,
      });

      if (error) {
        console.log(`  ${symbol}: FAILED to write — ${error.message}`);
      } else {
        console.log(`  ${symbol}: $${priceUsd.toFixed(2)} — snapshot saved`);
      }
    } catch (err: any) {
      console.log(`  ${symbol}: FAILED to read on-chain — ${err.message ?? err}`);
    }
  }

  console.log("\n=== TICKER PRICE SNAPSHOT COMPLETE ===");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
