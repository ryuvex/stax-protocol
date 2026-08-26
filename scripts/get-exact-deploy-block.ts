import { network } from "hardhat";

const CREATION_TX_HASH = "0x7f63db3514d78bd8ae6c4f78f7ab297275c92008d2676dc0958c879bb45e897d";

async function main() {
  const { ethers } = await network.connect({ network: "robinhoodMainnet" });

  const receipt = await ethers.provider.getTransactionReceipt(CREATION_TX_HASH);
  if (!receipt) {
    console.log("Receipt not found -- check the tx hash.");
    return;
  }

  console.log("Real, exact deployment block number:", receipt.blockNumber);
  console.log("Contract address created:", receipt.contractAddress);
  console.log("Status:", receipt.status === 1 ? "success" : "FAILED");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
