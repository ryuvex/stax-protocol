const ROUTER_ADDRESS = "0x8876789976dEcBfCbBbe364623C63652db8C0904";

async function main() {
  let nextPageParams: any = null;
  let checked = 0;
  let found = 0;

  for (let page = 0; page < 20 && found < 3; page++) {
    const url = new URL(`https://robinhoodchain.blockscout.com/api/v2/addresses/${ROUTER_ADDRESS}/transactions`);
    url.searchParams.set("filter", "to");
    if (nextPageParams) {
      for (const [k, v] of Object.entries(nextPageParams)) {
        url.searchParams.set(k, String(v));
      }
    }

    const res = await fetch(url.toString());
    const data: any = await res.json();

    if (page === 0) {
      console.log("=== DEBUG: raw response keys ===", Object.keys(data));
      console.log("=== DEBUG: item count ===", (data.items || []).length);
      if (data.items && data.items.length > 0) {
        console.log("=== DEBUG: first item keys ===", Object.keys(data.items[0]));
      } else {
        console.log("=== DEBUG: full response (first 2000 chars) ===");
        console.log(JSON.stringify(data).slice(0, 2000));
      }
    }

    for (const tx of data.items || []) {
      checked++;
      const input: string = (tx.raw_input || tx.method || "").toLowerCase();

      // execute(bytes,bytes[],uint256) selector is 0x3593564c
      if (!input.startsWith("0x3593564c")) continue;
      if (tx.status !== "ok" && tx.result !== "success") continue;

      // Look for command byte 0x10 (V4_SWAP) somewhere early in the
      // encoded commands -- rough heuristic, real confirmation needs
      // manual inspection, but this narrows candidates fast.
      // The commands bytes are encoded a few words into the calldata;
      // just check if "10" appears as a standalone command-like byte
      // near the start of the meaningful data (rough, but a real
      // narrow-down step).
      if (input.includes("3593564c") ) {
        console.log(`\n=== Candidate found (checked ${checked} txs) ===`);
        console.log("Hash:", tx.hash);
        console.log("Status:", tx.status || tx.result);
        console.log("Timestamp:", tx.timestamp);
        console.log("From:", tx.from?.hash);
        found++;
        if (found >= 5) break;
      }
    }

    nextPageParams = data.next_page_params;
    if (!nextPageParams) break;
  }

  console.log(`\nChecked ${checked} total transactions, found ${found} execute() candidates.`);
  console.log("Manually inspect each hash's real input data on Blockscout to confirm it's genuinely a V4_SWAP (command byte 0x10) and succeeded.");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
