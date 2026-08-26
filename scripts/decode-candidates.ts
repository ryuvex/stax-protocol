import { network } from "hardhat";

const CANDIDATES = [
  "0x51174f0f7b135ceaa9a80994d6c41ed965b07e25a129e4f984f8b470dca7581f",
  "0xb4b02d03061007597fefa27d32cec67bfe2dc0e3e8578662781dd8b90e2badc8",
  "0xac83c913a09dca1d65ee3c0aacfd753bb85838ad86fa18a3e763e59c639a7c47",
  "0x8aed3290c1f20a29a4c51fa9196c77e8bc807bd795012643143d1ab3cd750fac",
  "0x27b1f4ecb2f7076c79e669a70bd476f70a5098d227d0df7fc20b3aaf23c58271",
];

async function main() {
  const { ethers } = await network.connect({ network: "robinhoodMainnet" });

  const abiCoder = ethers.AbiCoder.defaultAbiCoder();

  for (const hash of CANDIDATES) {
    const tx = await ethers.provider.getTransaction(hash);
    if (!tx) {
      console.log(`${hash}: could not fetch tx`);
      continue;
    }

    // Strip the 4-byte selector, then decode as (bytes, bytes[], uint256)
    const dataWithoutSelector = "0x" + tx.data.slice(10);
    try {
      const [commands, inputs, deadline] = abiCoder.decode(
        ["bytes", "bytes[]", "uint256"],
        dataWithoutSelector
      );

      const commandBytes = commands.slice(2); // strip 0x
      const hasV4Swap = commandBytes.toLowerCase().match(/(^|.{2})10(.{0}|$)/) !== null;
      // More precise: check each command byte individually
      const individualCommands: string[] = [];
      for (let i = 0; i < commandBytes.length; i += 2) {
        individualCommands.push(commandBytes.slice(i, i + 2));
      }
      const containsV4SwapCommand = individualCommands.includes("10");

      console.log(`\n=== ${hash} ===`);
      console.log("Commands byte string:", commands);
      console.log("Individual commands:", individualCommands);
      console.log("Contains V4_SWAP (0x10)?", containsV4SwapCommand);
      console.log("Number of inputs:", inputs.length);
      if (containsV4SwapCommand) {
        console.log("*** THIS IS A REAL V4_SWAP TRANSACTION ***");
        console.log("Full tx.data (real, known-good calldata):");
        console.log(tx.data);
      }
    } catch (err: any) {
      console.log(`${hash}: decode failed -- ${err.message}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
