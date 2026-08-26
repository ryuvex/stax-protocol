import "dotenv/config";
import { network } from "hardhat";
import { createClient } from "@supabase/supabase-js";

function feedPriceToUsd(answer: bigint, decimals: number): number {
  return Number(answer) / 10 ** decimals;
}

// v14 deployment oracle addresses -- confirmed against the single
// continuous deploy log pasted into chat.
const ORACLES = [
  { symbol: "NVDA", address: "0x65Bb2Dc2a212B4611A7e421fe866dB889E2f3220" },
  { symbol: "AMD", address: "0x9ff837fF2d64A8045875Fe6097B170C93902eeea" },
  { symbol: "TSM", address: "0xA1cfB826B8fC36f00c4F85D7e11D3f190b802bb3" },
  { symbol: "AAPL", address: "0x9B39282729315880de155314dadcF9699C73FE6E" },
  { symbol: "MSFT", address: "0xf6eef579Df64706696e9784e51250b0D57F2acf0" },
  { symbol: "GOOGL", address: "0x2B85Fc477AB389da76e96baB4bEE30F63a10a605" },
  { symbol: "AMZN", address: "0x1Bc6ddD146Ac6a9629B83d5595c32C52C8eD2B08" },
  { symbol: "META", address: "0x43659a7cCc17Fd03d703EE9C7Bc4AcE813474c3f" },
  { symbol: "TSLA", address: "0x00893bF3f413B4CB63a0C95F92CDfe6133001BeE" },
  { symbol: "COIN", address: "0xB902707b5a74bf55e0572826A5051dF6C636Bd3C" },
  { symbol: "MSTR", address: "0xeAC056Cb40F5e61cC04F1e73A1b654d6a6CF7154" },
  { symbol: "CLSK", address: "0x317CECf124b22EE2c4B803aE9a9487D400FEB597" },
  { symbol: "CRCL", address: "0xC81a4e8A1eA095f7d97CdB3Ac8b2CE68Cb325C06" },
  { symbol: "IONQ", address: "0x7Bf634F321D7aF2B6168A7Cbf69077621e6B4889" },
  { symbol: "RGTI", address: "0x8Fd141CaE5Fe763b74Ed4Dc3296EaD48C904ba40" },
  { symbol: "RKLB", address: "0x122b97E3A91d4F7Aa7f0e7F20bF6c58C2Cb1C50f" },
  { symbol: "SPCX", address: "0x3FC985a7791928d3767FCBDc2AacaDB66408165C" },
  { symbol: "INTC", address: "0x665aa906102Dd776c6160D3890C5B71Ef32C424D" },
  { symbol: "MU", address: "0xD8634152bEFc1Ea950f984B871835604cecabE45" },
  { symbol: "ASML", address: "0x7664675177195ACE21441DDEB741840e9cBe096D" },
  { symbol: "SNDK", address: "0x06f8bB8013f7718332b52a7F7baCAe75381eB0cd" },
];

async function main() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;

  if (!supabaseUrl || !supabaseSecretKey) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SECRET_KEY in .env");
  }

  const supabase = createClient(supabaseUrl, supabaseSecretKey);
  const { ethers } = await network.connect();

  console.log("Taking per-ticker price snapshot (v14)...\n");

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
