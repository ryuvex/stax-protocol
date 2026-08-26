import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

// TEMPORARY TEST SCRIPT -- inserts one fake snapshot, 3 days in the past,
// for ai-infra, purely to prove the 24H/7D range toggle actually filters
// differently. Uses an obviously-fake price ($9.9999) so it's easy to
// spot and won't be confused with real data. Delete this row afterward
// (see instructions printed at the end) -- do not leave fake data mixed
// into real history.

const BASKET_ID = "ai-infra";
const FAKE_PRICE = 9.9999;
const DAYS_AGO = 3;

async function main() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;

  if (!supabaseUrl || !supabaseSecretKey) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SECRET_KEY in .env");
  }

  const supabase = createClient(supabaseUrl, supabaseSecretKey);

  const fakeTimestamp = new Date(Date.now() - DAYS_AGO * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from("nav_snapshots")
    .insert({
      basket_id: BASKET_ID,
      nav_usd: FAKE_PRICE,
      tvl_usd: FAKE_PRICE,
      created_at: fakeTimestamp,
    })
    .select();

  if (error) {
    console.error("FAILED to insert test row:", error.message);
    process.exitCode = 1;
    return;
  }

  console.log(`Inserted fake test row for "${BASKET_ID}":`);
  console.log(`  price: $${FAKE_PRICE}`);
  console.log(`  timestamp: ${fakeTimestamp} (${DAYS_AGO} days ago)`);
  console.log(`  row id: ${data?.[0]?.id}`);
  console.log("");
  console.log("Now check the AI Infrastructure basket page:");
  console.log("  - 24H toggle: should NOT show this point (older than 24h)");
  console.log("  - 7D toggle: SHOULD show this point (within 7 days)");
  console.log("");
  console.log("When done testing, delete it in Supabase SQL editor with:");
  console.log(`  DELETE FROM nav_snapshots WHERE nav_usd = ${FAKE_PRICE};`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
