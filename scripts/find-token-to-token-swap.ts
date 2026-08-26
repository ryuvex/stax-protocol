import { network } from "hardhat";
import * as fs from "fs";

const ROUTER_ADDRESS = "0x8876789976dEcBfCbBbe364623C63652db8C0904";
const OUTPUT_FILE = "token-to-token-matches.txt";

async function fetchWithRetry(url: string, maxAttempts = 3): Promise<any> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(url);
      const text = await res.text();
      return JSON.parse(text);
    } catch (err: any) {
      if (attempt >= maxAttempts) throw err;
      console.log(`  (retry ${attempt}/${maxAttempts} after: ${err.message})`);
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
  }
}

async function main() {
  const { ethers } = await network.connect({ network: "robinhoodMainnet" });
  const abiCoder = ethers.AbiCoder.defaultAbiCoder();

  const poolKeyType = "tuple(address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks)";
  const swapParamsType = `tuple(${poolKeyType} poolKey, bool zeroForOne, uint128 amountIn, uint128 amountOutMinimum, bytes hookData)`;

  let nextPageParams: any = null;
  let checked = 0;
  let foundTokenToToken = 0;

  for (let page = 0; page < 40 && foundTokenToToken < 3; page++) {
    const url = new URL(`https://robinhoodchain.blockscout.com/api/v2/addresses/${ROUTER_ADDRESS}/transactions`);
    url.searchParams.set("filter", "to");
    if (nextPageParams) {
      for (const [k, v] of Object.entries(nextPageParams)) {
        url.searchParams.set(k, String(v));
      }
    }

    const res = await fetchWithRetry(url.toString());
    const data: any = res;

    if (page === 0) {
      console.log("=== DEBUG page 0 ===");
      console.log("URL:", url.toString());
      console.log("Response keys:", Object.keys(data));
      console.log("Item count:", (data.items || []).length);
      if (!data.items || data.items.length === 0) {
        console.log("Full response:", JSON.stringify(data).slice(0, 1000));
      }
    }

    for (const tx of data.items || []) {
      checked++;
      const input: string = tx.raw_input || "";
      if (!input.toLowerCase().startsWith("0x3593564c")) continue;
      if (tx.status !== "ok") continue;

      try {
        const withoutSelector = "0x" + input.slice(10);
        const [commands, inputs] = abiCoder.decode(["bytes", "bytes[]", "uint256"], withoutSelector);
        const commandBytes = commands.slice(2);
        if (commandBytes.toLowerCase() !== "10") continue; // only single V4_SWAP commands, for clean comparison

        const [actions, params] = abiCoder.decode(["bytes", "bytes[]"], inputs[0]);
        if (actions.toLowerCase() !== "0x060c0f") continue; // only our exact 3-action shape

        const swapParams = abiCoder.decode([swapParamsType], params[0])[0];
        const isTokenToToken =
          swapParams.poolKey.currency0 !== "0x0000000000000000000000000000000000000000" &&
          swapParams.poolKey.currency1 !== "0x0000000000000000000000000000000000000000";

        if (isTokenToToken) {
          foundTokenToToken++;
          const output = `
=== GENUINE TOKEN-TO-TOKEN SWAP FOUND ===
Hash: ${tx.hash}
currency0: ${swapParams.poolKey.currency0}
currency1: ${swapParams.poolKey.currency1}
fee: ${swapParams.poolKey.fee.toString()}
tickSpacing: ${swapParams.poolKey.tickSpacing.toString()}
Full raw_input:
${input}
`;
          console.log(output);
          fs.appendFileSync(OUTPUT_FILE, output);
        }
      } catch {
        // decode failed, skip -- not our exact shape
        continue;
      }
    }

    nextPageParams = data.next_page_params;
    if (!nextPageParams) break;
  }

  console.log(`\nChecked ${checked} total transactions, found ${foundTokenToToken} genuine token-to-token matches.`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
