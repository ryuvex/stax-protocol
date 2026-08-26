const VAULT_ADDRESS = "0xF253beBd47753048b34DF28Ae60D755618Ad031d";

async function main() {
  const res = await fetch(`https://robinhoodchain.blockscout.com/api/v2/addresses/${VAULT_ADDRESS}`);
  const data = await res.json();

  console.log("Creation transaction hash:", data.creation_tx_hash ?? data.creation_transaction_hash ?? "(field name may differ, see full response below)");
  console.log("\nFull response (searching for a block reference):");
  console.log(JSON.stringify(data, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
