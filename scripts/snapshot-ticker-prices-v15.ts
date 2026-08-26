import "dotenv/config";
import { network } from "hardhat";
import { createClient } from "@supabase/supabase-js";

function feedPriceToUsd(answer: bigint, decimals: number): number {
  return Number(answer) / 10 ** decimals;
}

// v15 deployment oracle addresses -- confirmed against the real
// refresh-all-oracles-v15.ts run output from this session.
const ORACLES = [
  { symbol: "NVDA", address: "0xED081F3441f574c82D948793B190352f829FF5cf" },
  { symbol: "AMD", address: "0x305C7796d21486d873672f77727c86Afb9e3d8F0" },
  { symbol: "TSM", address: "0x5EFdE0BC6576b5C390D22be8402d6B71C7CDC701" },
  { symbol: "AAPL", address: "0xc897dE8367117ac6A61a0736a1206099754abB96" },
  { symbol: "MSFT", address: "0x750EE0A29C4C868E7B4Ca8DbAAa7241340340a82" },
  { symbol: "GOOGL", address: "0x7FeCEF7872263CDD22c7a592154f93DE4A96C229" },
  { symbol: "AMZN", address: "0x46563C94Fe61e8BCC299206325379bC99037e92F" },
  { symbol: "META", address: "0x14bCae202dcb1CeE9d272340568e436318FcEab7" },
  { symbol: "TSLA", address: "0xa1B4CbEd74b652eeD50554Ab5e9BA9cd0BEe65d7" },
  { symbol: "COIN", address: "0x3e7C5020cA325F9cB0381Cfbe006472237DbE7b1" },
  { symbol: "MSTR", address: "0x4cDaf5A79576CE6e530AAe6c29EB5f3Dbd787b9b" },
  { symbol: "CLSK", address: "0x4f695C593f83F99C8075B88e3765D2502CB87f9f" },
  { symbol: "CRCL", address: "0x41472DdF8013868B826F297695f036c06ba1bb95" },
  { symbol: "IONQ", address: "0x53009Fa7806759b4DdbDb68c8f2C3C1dF5214409" },
  { symbol: "RGTI", address: "0x8561Ee4D1e22C764751dD1FAd61bB7a10CfAA515" },
  { symbol: "RKLB", address: "0x162F13cde00724Fab4dbB5ADA63BB7CFEB6F1EC6" },
  { symbol: "SPCX", address: "0x91F081C6Cd97EbeDeee7b6bD99d6eEd8251f1B77" },
  { symbol: "INTC", address: "0x7fd25F87B54De26028B332B28beC82C5e95b500F" },
  { symbol: "MU", address: "0xdc861fc4eF3FA55CA8cDa84B16A9D9B4EeCa1FcF" },
  { symbol: "ASML", address: "0xDb3D35CcE8b2417B442F3582a5AEEE5622b01a55" },
  { symbol: "SNDK", address: "0x35485e81853566dE15A281669168A5695f66b8B4" },
];

async function main() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;

  if (!supabaseUrl || !supabaseSecretKey) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SECRET_KEY in .env");
  }

  const supabase = createClient(supabaseUrl, supabaseSecretKey);
  const { ethers } = await network.connect();

  console.log("Taking per-ticker price snapshot (v15)...\n");

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