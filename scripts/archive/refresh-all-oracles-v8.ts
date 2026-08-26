import { network } from "hardhat";

function feedPrice(dollars: bigint, decimals = 8): bigint {
  return dollars * 10n ** BigInt(decimals);
}

// Addresses below are the v8 deployment's oracle addresses, taken directly
// from the deploy-testnet-v8.ts output (StaxVault at
// 0xD06F68a482cE2ab891E01dB5D9bE24b92b06aBbd). Do NOT reuse the v7 oracle
// addresses -- v8 deployed entirely fresh tokens/oracles, it did not reuse
// v7's contracts.
const ORACLES = [
  { name: "ETH/USD", address: "0xdbA550d5287e7146418FBA7df1EaeB571992a1d8", price: 3000n },
  { name: "NVDA", address: "0xB59916De27223D658bc929360A261Bbbed5F4BB1", price: 150n },
  { name: "AMD", address: "0x8E2a4CD86b4160a117aBc23D52450354f8A53D26", price: 100n },
  { name: "TSM", address: "0xeeFee1d0E6d1dfF80D77bcc9f5AD21c64f9C2F83", price: 200n },
  { name: "AAPL", address: "0x408eF17c942aaF1e9F29ae7FafdE53202C432Dc7", price: 200n },
  { name: "MSFT", address: "0x09A0d237481cCb5724d461755cbcECE0626c9144", price: 400n },
  { name: "GOOGL", address: "0xB87598C840D4B5E79bd9A4d8B07052797f5F803f", price: 150n },
  { name: "AMZN", address: "0xE7500293765D2a89a81fd3c32675c3F621048203", price: 180n },
  { name: "META", address: "0x820621EEb727554874dc47a61c7c6c886335655e", price: 500n },
  { name: "TSLA", address: "0x31b9DE53fBBC3AbddEb49B4Ff23B061F10EBB850", price: 300n },
  { name: "COIN", address: "0x0304846ED19Ee585e7c5a0F1E4674D3A745d2172", price: 250n },
  { name: "MSTR", address: "0x2C5d74BC7D48fEb8F3BefD4Dc9939615DbDdd7d3", price: 300n },
  { name: "CLSK", address: "0xA32607d2f2fD165FD7D2bCCfD38FDd60221fc94E", price: 10n },
  { name: "CRCL", address: "0x101153d26273a04ad6434CFA186e75B496240946", price: 150n },
  { name: "IONQ", address: "0xd6098eD0571fb24e8Adf847288DCF681bf79D079", price: 30n },
  { name: "RGTI", address: "0x891E18E1a978a7201c4616C31824f8a9BF65924f", price: 10n },
  { name: "RKLB", address: "0x20977cBEDfb329c0e91688d5e8a15670E815E49D", price: 20n },
  { name: "SPCX", address: "0xbc929aF0358e762c4749Dd7Da91f2b3D416404Ef", price: 50n },
  { name: "INTC", address: "0xFC4D6669E17D9a8B96a23F6A47e52dfaaCD45b9e", price: 25n },
  { name: "MU", address: "0x28a0f398Bb8f6deCDE099202A9C946f05D9eCF15", price: 100n },
  { name: "ASML", address: "0xfcdeA347460b7539567FdD2134b9D0025BE85c94", price: 700n },
  { name: "SNDK", address: "0x8f1616d0130b39277651C191a52cf2724070a4EA", price: 50n },
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
  console.log(`All ${ORACLES.length} v8 oracles refreshed with a fresh timestamp.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
