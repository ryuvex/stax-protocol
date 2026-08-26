import "dotenv/config";
import { network } from "hardhat";
import { createClient } from "@supabase/supabase-js";

const VAULT_ADDRESS = "0xC10Ef76b35cB7ae4a68226E3b82F58B1cf4c32f4"; // v15

const BASKET_IDS: Record<string, number> = {
  "ai-infra": 1,
  mag7: 2,
  "crypto-proxy": 3,
  quantum: 4,
  "new-space": 5,
  semis: 6,
};

async function main() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;

  if (!supabaseUrl || !supabaseSecretKey) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SECRET_KEY in .env");
  }

  const supabase = createClient(supabaseUrl, supabaseSecretKey);
  const { ethers } = await network.connect();
  const vault = await ethers.getContractAt("StaxVault", VAULT_ADDRESS);

  console.log("Taking NAV + price snapshot for all baskets...\n");

  for (const [basketStringId, onchainId] of Object.entries(BASKET_IDS)) {
    try {
      const navRaw = await vault.getBasketNavUsd(onchainId);
      const navUsd = Number(ethers.formatUnits(navRaw, 18));

      const basketInfo = await vault.baskets(onchainId);
      const tokenAddress = basketInfo[1] as string;

      const basketToken = await ethers.getContractAt("StaxBasketToken", tokenAddress);
      const supplyRaw = await basketToken.totalSupply();
      const supply = Number(ethers.formatUnits(supplyRaw, 18));

      if (supply === 0) {
        console.log(`  ${basketStringId}: supply is 0, skipping (no meaningful price yet)`);
        continue;
      }

      const priceUsd = navUsd / supply;

      const { error } = await supabase.from("nav_snapshots").insert({
        basket_id: basketStringId,
        nav_usd: priceUsd,
        tvl_usd: navUsd,
      });

      if (error) {
        console.log(`  ${basketStringId}: FAILED to write — ${error.message}`);
      } else {
        console.log(`  ${basketStringId}: price $${priceUsd.toFixed(4)}, TVL $${navUsd.toFixed(2)} — snapshot saved`);
      }
    } catch (err: any) {
      console.log(`  ${basketStringId}: FAILED to read on-chain — ${err.message ?? err}`);
    }
  }

  console.log("\n=== SNAPSHOT COMPLETE ===");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
