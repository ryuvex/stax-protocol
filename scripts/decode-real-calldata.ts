import { ethers } from "ethers";

// The REAL, genuine calldata sent directly to the confirmed Universal
// Router (0x8876789976dEcBfCbBbe364623C63652db8C0904), extracted from
// the internal call trace of a real, successful mainnet transaction
// (0xa1e013dad4080f5b3c26fb14d19972e5de4a439eca24c568bcb64f6185b920c0).
// This is ground truth -- not reconstructed from docs, not guessed.
const REAL_CALLDATA =
  "0x3593564c000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000000000000000000000000000000000006a825c6700000000000000000000000000000000000000000000000000000000000000011000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000340000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000800000000000000000000000000000000000000000000000000000000000000003060c0f00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000003000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000001e000000000000000000000000000000000000000000000000000000000000002400000000000000000000000000000000000000000000000000000000000000160000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000000000000000000000000000009dcd2538c3be2657fe9e5c35178fa0633f07510700000000000000000000000000000000000000000000000000000000000001f400000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000b0bf5c859360000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000012000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000040000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000b0bf5c8593600000000000000000000000000000000000000000000000000000000000000000400000000000000000000000009dcd2538c3be2657fe9e5c35178fa0633f0751070000000000000000000000000000000000000000000000000000000000000000";

function main() {
  const abiCoder = ethers.AbiCoder.defaultAbiCoder();

  const selector = REAL_CALLDATA.slice(0, 10);
  console.log("Function selector:", selector);
  console.log("(execute(bytes,bytes[],uint256) is known to be 0x3593564c -- checking match)\n");

  const params = "0x" + REAL_CALLDATA.slice(10);

  // Top-level: execute(bytes commands, bytes[] inputs, uint256 deadline)
  const [commands, inputs, deadline] = abiCoder.decode(["bytes", "bytes[]", "uint256"], params);

  console.log("=== Top-level execute() call ===");
  console.log("commands:", commands);
  console.log("deadline:", deadline.toString(), `(${new Date(Number(deadline) * 1000).toISOString()})`);
  console.log("number of inputs:", inputs.length);
  console.log("");

  // Decode each command byte
  const commandBytes = ethers.getBytes(commands);
  console.log("Individual command bytes:");
  for (const byte of commandBytes) {
    console.log(`  0x${byte.toString(16).padStart(2, "0")}`);
  }
  console.log("");

  // For each input, try to decode as the V4Router (actions, params[]) pattern
  inputs.forEach((input: string, i: number) => {
    console.log(`=== inputs[${i}] (raw length: ${ethers.getBytes(input).length} bytes) ===`);
    console.log("raw:", input);
    console.log("");

    try {
      const [actions, actionParams] = abiCoder.decode(["bytes", "bytes[]"], input);
      console.log("  Decoded as (bytes actions, bytes[] params):");
      console.log("  actions:", actions);

      const actionBytes = ethers.getBytes(actions);
      console.log("  Individual action bytes:");
      for (const byte of actionBytes) {
        console.log(`    0x${byte.toString(16).padStart(2, "0")}`);
      }

      console.log(`  number of action params: ${actionParams.length}`);
      actionParams.forEach((p: string, j: number) => {
        console.log(`  actionParams[${j}] (${ethers.getBytes(p).length} bytes):`, p);
      });
    } catch (err: any) {
      console.log("  Could not decode as (bytes,bytes[]) -- may be a different structure:", err.message);
    }
  });


  // Now the real question: does actionParams[0] (the SWAP_EXACT_IN_SINGLE
  // params) match the STANDARD Uniswap ExactInputSingleParams struct
  // shape, or does it have the documented extra field? Rather than hand-
  // count hex bytes (error-prone, already bit us twice tonight), let
  // ethers' real decoder tell us definitively.
  const [, actionParamsForCheck] = abiCoder.decode(["bytes", "bytes[]"], inputs[0]);
  const swapParamsRaw = actionParamsForCheck[0];

  // CORRECTED: the real contract calls abi.decode(params, (ExactInputSingleParams))
  // -- decoding into ONE struct type, not 5 separate flat top-level values.
  // Since the struct contains a dynamic field (bytes hookData), Solidity's
  // ABI rules require the WHOLE STRUCT to be encoded as a dynamic unit
  // (leading offset pointer, then tail data) -- decoding as 5 flat values
  // instead of 1 wrapped struct caused a real misalignment last run
  // (confirmed by amountOutMinimum correctly showing 49750000000000000 --
  // the real 0.04975 ETH value -- but one field late).
  console.log("\n\n=== Checking actionParams[0] as ONE wrapped struct (STANDARD shape) ===");
  const standardWrapped = [
    "tuple(tuple(address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) poolKey, bool zeroForOne, uint128 amountIn, uint128 amountOutMinimum, bytes hookData)",
  ];
  try {
    const [decoded] = abiCoder.decode(standardWrapped, swapParamsRaw);
    console.log("STANDARD wrapped shape decoded:");
    console.log("poolKey:", decoded.poolKey);
    console.log("zeroForOne:", decoded.zeroForOne);
    console.log("amountIn:", decoded.amountIn.toString());
    console.log("amountOutMinimum:", decoded.amountOutMinimum.toString());
    console.log("hookData:", decoded.hookData);
  } catch (err: any) {
    console.log("STANDARD wrapped shape FAILED:", err.message);
  }

  // Same, but with minHopPriceX36 added as one extra field INSIDE the
  // wrapped struct (at the end, right after hookData).
  console.log("\n=== Checking wrapped struct WITH extra minHopPriceX36 field ===");
  const modifiedWrapped = [
    "tuple(tuple(address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) poolKey, bool zeroForOne, uint128 amountIn, uint128 amountOutMinimum, bytes hookData, uint256 minHopPriceX36)",
  ];
  try {
    const [decoded2] = abiCoder.decode(modifiedWrapped, swapParamsRaw);
    console.log("MODIFIED wrapped shape decoded:");
    console.log("poolKey:", decoded2.poolKey);
    console.log("zeroForOne:", decoded2.zeroForOne);
    console.log("amountIn:", decoded2.amountIn.toString());
    console.log("amountOutMinimum:", decoded2.amountOutMinimum.toString());
    console.log("hookData:", decoded2.hookData);
    console.log("minHopPriceX36:", decoded2.minHopPriceX36.toString());
  } catch (err: any) {
    console.log("MODIFIED wrapped shape FAILED:", err.message);
  }

}

main();