import "dotenv/config";
import { network } from "hardhat";
import { createClient } from "@supabase/supabase-js";

function feedPriceToUsd(answer: bigint, decimals: number): number {
  return Number(answer) / 10 ** decimals;
}

// v11 deployment oracle addresses -- same list as
// refresh-all-oracles-v11.ts. Kept as a separate constant here (not
// imported) since this is a standalone script, same pattern as the
// other snapshot scripts in this repo.
const ORACLES = [
  { symbol: "NVDA", address: "0x61e2Ce3f2da765cD9448d06E3cF4b0764E059aC3" },
  { symbol: "AMD", address: "0x0090AA1AfD478f2a07567ffA5e198DDB5B2c9764" },
  { symbol: "TSM", address: "0x230559ec098d4Db25a9308d90b80EAe32b5a6742" },
  { symbol: "AAPL", address: "0x6cB9865f873336f2caA614B2e6f98b68619A2FA0" },
  { symbol: "MSFT", address: "0xdcdB2e646964A6552b229050DC72beB9Be4382A8" },
  { symbol: "GOOGL", address: "0x0B9ec5A99EDb342a3Fd19eFc51e02B72F39c4D76" },
  { symbol: "AMZN", address: "0x81e56344cB50fE2148b6Ce7A9a845CEE6c492B67" },
  { symbol: "META", address: "0x0B63406e9A7F748be5BAc1aFa9A4Fb5f1CD45426" },
  { symbol: "TSLA", address: "0x9718e40B21795BA5f63a365e6130DFb32Be33F30" },
  { symbol: "COIN", address: "0x0A6A5a2D4D27016223cbb942928Ac83A3bF93B01" },
  { symbol: "MSTR", address: "0xb229E851B099B53E4BbD8950b4ACA4ac4B76e8Fe" },
  { symbol: "CLSK", address: "0x92A0AA47dF8c782f964BDeE366A58A1937B6ab8F" },
  { symbol: "CRCL", address: "0x470a22a65f7F11609C569316149Dc4B19b4f0E08" },
  { symbol: "IONQ", address: "0xfd373F9196A4559CcC87f80fBc78A8D4ad625e8d" },
  { symbol: "RGTI", address: "0x7D932464EC1B1Af28a162Aff97529780b23008b2" },
  { symbol: "RKLB", address: "0x4899410313784274abeD9A98460D65cE3FdC49C3" },
  { symbol: "SPCX", address: "0x86323763744AF0Da51C00a68041a56DB4659856F" },
  { symbol: "INTC", address: "0xdFcf2F050891F6E7e18362F4A4A03CAC619F9D79" },
  { symbol: "MU", address: "0x4d3497cF21b49D64F9A053704C6f83750B86BE60" },
  { symbol: "ASML", address: "0x82576CC88C5E9BA0a2b5bB5d9C78Cb58b0068c00" },
  { symbol: "SNDK", address: "0xBD7920F0E106aac11e2De10DF8007F0688C23326" },
];

async function main() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;

  if (!supabaseUrl || !supabaseSecretKey) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SECRET_KEY in .env");
  }

  const supabase = createClient(supabaseUrl, supabaseSecretKey);
  const { ethers } = await network.connect();

  console.log("Taking per-ticker price snapshot...\n");

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
