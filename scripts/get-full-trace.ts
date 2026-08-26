import { network } from "hardhat";
import * as fs from "fs";

const TX_HASH = "0xa1e013dad4080f5b3c26fb14d19972e5de4a439eca24c568bcb64f6185b920c0";
const ROUTER = "0x8876789976decbfcbbbe364623c63652db8c0904";

async function main() {
  const { ethers } = await network.connect({ network: "robinhoodMainnet" });

  console.log("Requesting full call trace directly from the RPC (debug_traceTransaction)...");
  console.log("This should include real input data that Blockscout's summary API omitted.\n");

  try {
    const trace: any = await ethers.provider.send("debug_traceTransaction", [
      TX_HASH,
      { tracer: "callTracer" },
    ]);

    fs.writeFileSync("full-rpc-trace.json", JSON.stringify(trace, null, 2), "utf-8");
    console.log("Full trace saved to full-rpc-trace.json\n");

    // Recursively find the call to our confirmed router with nonzero value
    function findRouterCall(node: any): any {
      if (!node || typeof node !== "object") return null;
      if (node.to && node.to.toLowerCase() === ROUTER && node.value && node.value !== "0x0") {
        return node;
      }
      for (const child of node.calls || []) {
        const result = findRouterCall(child);
        if (result) return result;
      }
      return null;
    }

    const match = findRouterCall(trace);
    if (match) {
      console.log("=== FOUND the real call to the router ===");
      console.log("Value:", match.value);
      console.log("Input length:", match.input?.length ?? 0, "chars");
      console.log("\nRaw input (this is the genuine, working calldata):");
      console.log(match.input);

      fs.writeFileSync("real-router-calldata.txt", match.input ?? "", "utf-8");
      console.log("\nSaved cleanly to real-router-calldata.txt");
    } else {
      console.log("Could not find a matching call in the trace -- full trace saved");
      console.log("to full-rpc-trace.json for manual inspection.");
    }
  } catch (err: any) {
    console.log("debug_traceTransaction FAILED:", err.message ?? err);
    console.log("\nThis RPC method may not be supported on this public endpoint.");
    console.log("If so, we'll need a different approach -- let me know this error.");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
