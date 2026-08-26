const VAULT_ADDRESS = "0x420943e5A26efFfaD91eD968cC4C4322a19306b2";

async function main() {
  const res = await fetch(`https://robinhoodchain.blockscout.com/api/v2/addresses/${VAULT_ADDRESS}`);
  const data = await res.json();

  console.log("is_verified:", data.is_verified);
  console.log("name:", data.name);
  console.log("\nFull response:");
  console.log(JSON.stringify(data, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
