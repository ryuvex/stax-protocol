import "dotenv/config";
import { network } from "hardhat";
import { createClient } from "@supabase/supabase-js";

function feedPriceToUsd(answer: bigint, decimals: number): number {
  return Number(answer) / 10 ** decimals;
}

// v13 deployment oracle addresses -- confirmed against the single
// continuous deploy log pasted into chat.
const ORACLES = [
  { symbol: "NVDA", address: "0x1d39c1BAa21CCf0aF79ac93B1C25fb0659c01Df1" },
  { symbol: "AMD", address: "0xB89b5bC8C3b84CF16312fE9b2F6603bb88398faC" },
  { symbol: "TSM", address: "0x7F16370b0737672c494Ed4c84472a4861A9cE244" },
  { symbol: "AAPL", address: "0xA0c07085Bdd9D0bf13755D6a274F5D499EbF2718" },
  { symbol: "MSFT", address: "0x27BFf0f6E44b9CAF1C9Bef59649ac3047c9c8CF6" },
  { symbol: "GOOGL", address: "0x84C282ae6e6Ce68048278F5BF5Cb9aC6d6aB810e" },
  { symbol: "AMZN", address: "0xb69EB2A9BAd10E8186226261e5D45d7a1885c668" },
  { symbol: "META", address: "0xDe2b00A31264DEA9eCD9aa90D9Fb7dB9a587Df86" },
  { symbol: "TSLA", address: "0xf5cEBE4b856b3D9E18Bac738bF2972ea7F5022d9" },
  { symbol: "COIN", address: "0xa5a7BD0936F883533F87aBEed6963f9149B8e35a" },
  { symbol: "MSTR", address: "0x040F05AC2ea4a7e84C27356fE49854403043016e" },
  { symbol: "CLSK", address: "0x0BFB36970AAb220AA52Ff4546862569F6b850842" },
  { symbol: "CRCL", address: "0xeA55CdC144B4561ad23A0b4E577dca9668dA4E12" },
  { symbol: "IONQ", address: "0x31190491B328f57254eb6ee418EAD024b655B247" },
  { symbol: "RGTI", address: "0x2c53173Dc4cB508f2e64cFF677b34c36cF113872" },
  { symbol: "RKLB", address: "0xB53771ade92387A972a728F608af04ffcD0C08d2" },
  { symbol: "SPCX", address: "0x6a0C3A4AA69146E211f0b45df4b1Af40c54aB0E7" },
  { symbol: "INTC", address: "0x94553eBecC90830A81699c1bB98a5FF9C191A080" },
  { symbol: "MU", address: "0xA4a75774D2592f95eCAfD3E626F487dd6d864Dd8" },
  { symbol: "ASML", address: "0x208a3296C73b02f0EDf50531CF025a00Ca7A3aBD" },
  { symbol: "SNDK", address: "0xF5e9e7A003E67FbA316748dC99773D12f022BD34" },
];

async function main() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;

  if (!supabaseUrl || !supabaseSecretKey) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SECRET_KEY in .env");
  }

  const supabase = createClient(supabaseUrl, supabaseSecretKey);
  const { ethers } = await network.connect();

  console.log("Taking per-ticker price snapshot (v13)...\n");

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
