import { network } from "hardhat";

async function main() {
  const { ethers } = await network.connect();
  const signers = await ethers.getSigners();

  for (let i = 0; i < signers.length; i++) {
    const address = signers[i].address;
    const balance = await ethers.provider.getBalance(address);
    console.log(`Signer[${i}]: ${address}`);
    console.log(`  Balance: ${ethers.formatEther(balance)} ETH`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
