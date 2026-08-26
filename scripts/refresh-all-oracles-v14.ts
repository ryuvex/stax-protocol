import { network } from "hardhat";

function feedPrice(dollars: bigint, decimals = 8): bigint {
  return dollars * 10n ** BigInt(decimals);
}

// v14 deployment addresses -- confirmed against a single continuous
// deploy log pasted directly into chat. StaxVault at
// 0xA87E5C6C972cb680F59c24D9AA6136B0955478e8.
const ORACLES = [
  { name: "ETH/USD", address: "0x459e34d51e32e300340f613eaE0CBba938f7B7a4", price: 3000n },
  { name: "NVDA", address: "0x65Bb2Dc2a212B4611A7e421fe866dB889E2f3220", price: 150n },
  { name: "AMD", address: "0x9ff837fF2d64A8045875Fe6097B170C93902eeea", price: 100n },
  { name: "TSM", address: "0xA1cfB826B8fC36f00c4F85D7e11D3f190b802bb3", price: 200n },
  { name: "AAPL", address: "0x9B39282729315880de155314dadcF9699C73FE6E", price: 200n },
  { name: "MSFT", address: "0xf6eef579Df64706696e9784e51250b0D57F2acf0", price: 400n },
  { name: "GOOGL", address: "0x2B85Fc477AB389da76e96baB4bEE30F63a10a605", price: 150n },
  { name: "AMZN", address: "0x1Bc6ddD146Ac6a9629B83d5595c32C52C8eD2B08", price: 180n },
  { name: "META", address: "0x43659a7cCc17Fd03d703EE9C7Bc4AcE813474c3f", price: 500n },
  { name: "TSLA", address: "0x00893bF3f413B4CB63a0C95F92CDfe6133001BeE", price: 300n },
  { name: "COIN", address: "0xB902707b5a74bf55e0572826A5051dF6C636Bd3C", price: 250n },
  { name: "MSTR", address: "0xeAC056Cb40F5e61cC04F1e73A1b654d6a6CF7154", price: 300n },
  { name: "CLSK", address: "0x317CECf124b22EE2c4B803aE9a9487D400FEB597", price: 10n },
  { name: "CRCL", address: "0xC81a4e8A1eA095f7d97CdB3Ac8b2CE68Cb325C06", price: 150n },
  { name: "IONQ", address: "0x7Bf634F321D7aF2B6168A7Cbf69077621e6B4889", price: 30n },
  { name: "RGTI", address: "0x8Fd141CaE5Fe763b74Ed4Dc3296EaD48C904ba40", price: 10n },
  { name: "RKLB", address: "0x122b97E3A91d4F7Aa7f0e7F20bF6c58C2Cb1C50f", price: 20n },
  { name: "SPCX", address: "0x3FC985a7791928d3767FCBDc2AacaDB66408165C", price: 50n },
  { name: "INTC", address: "0x665aa906102Dd776c6160D3890C5B71Ef32C424D", price: 25n },
  { name: "MU", address: "0xD8634152bEFc1Ea950f984B871835604cecabE45", price: 100n },
  { name: "ASML", address: "0x7664675177195ACE21441DDEB741840e9cBe096D", price: 700n },
  { name: "SNDK", address: "0x06f8bB8013f7718332b52a7F7baCAe75381eB0cd", price: 50n },
];

async function main() {
  const { ethers } = await network.connect();
  for (const oracle of ORACLES) {
    const contract = await ethers.getContractAt("MockPriceOracle", oracle.address);
    const tx = await contract.setPrice(feedPrice(oracle.price));
    await tx.wait();
    console.log(`Refreshed ${oracle.name} (${oracle.address})`);
  }
  console.log("");
  console.log(`All ${ORACLES.length} v14 oracles refreshed with a fresh timestamp.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
