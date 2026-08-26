const ROUTER_ADDRESS = "0x8876789976dEcBfCbBbe364623C63652db8C0904";
const EXPECTED_PERMIT2 = "000000000022d473030f116ddee9f6b43ac78ba3"; // lowercase, no 0x
const EXPECTED_WETH = "0bd7d308f8e1639fab988df18a8011f41eacad73"; // lowercase, no 0x
const EXPECTED_POOL_MANAGER = "8366a39cc670b4001a1121b8f6a443a643e40951"; // lowercase, no 0x

async function main() {
  const res = await fetch(`https://robinhoodchain.blockscout.com/api/v2/addresses/${ROUTER_ADDRESS}`);
  const data = await res.json();

  // Fetch the deployed bytecode directly via the RPC, not the address
  // summary endpoint -- need the raw code, not metadata.
  const rpcRes = await fetch("https://rpc.mainnet.chain.robinhood.com", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_getCode",
      params: [ROUTER_ADDRESS, "latest"],
    }),
  });
  const rpcData: any = await rpcRes.json();
  const bytecode: string = (rpcData.result || "").toLowerCase();

  console.log("Bytecode length:", bytecode.length, "chars");
  console.log("\nDoes bytecode contain expected Permit2 address?", bytecode.includes(EXPECTED_PERMIT2));
  console.log("Does bytecode contain expected WETH address?", bytecode.includes(EXPECTED_WETH));
  console.log("Does bytecode contain expected PoolManager address?", bytecode.includes(EXPECTED_POOL_MANAGER));

  if (!bytecode.includes(EXPECTED_PERMIT2)) {
    console.log("\n*** Permit2 address NOT found in router bytecode -- router was built with a DIFFERENT Permit2 address ***");
  }
  if (!bytecode.includes(EXPECTED_WETH)) {
    console.log("*** WETH address NOT found in router bytecode -- router was built with a DIFFERENT WETH address ***");
  }
  if (!bytecode.includes(EXPECTED_POOL_MANAGER)) {
    console.log("*** POOL MANAGER address NOT found in router bytecode -- router's onlyPoolManager check likely points elsewhere, explaining the empty revert ***");
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
