import { network } from "hardhat";

function feedPrice(dollars: bigint, decimals = 8): bigint {
  return dollars * 10n ** BigInt(decimals);
}

// v13 deployment addresses -- confirmed against a single continuous
// deploy log pasted directly into chat. StaxVault at
// 0xE5c681cF88F6E0B0c9a033059A2eD6511Fb60aeb.
const ORACLES = [
  { name: "ETH/USD", address: "0xaa68d422c4365e98680686045a0D6A7864B4488D", price: 3000n },
  { name: "NVDA", address: "0x1d39c1BAa21CCf0aF79ac93B1C25fb0659c01Df1", price: 150n },
  { name: "AMD", address: "0xB89b5bC8C3b84CF16312fE9b2F6603bb88398faC", price: 100n },
  { name: "TSM", address: "0x7F16370b0737672c494Ed4c84472a4861A9cE244", price: 200n },
  { name: "AAPL", address: "0xA0c07085Bdd9D0bf13755D6a274F5D499EbF2718", price: 200n },
  { name: "MSFT", address: "0x27BFf0f6E44b9CAF1C9Bef59649ac3047c9c8CF6", price: 400n },
  { name: "GOOGL", address: "0x84C282ae6e6Ce68048278F5BF5Cb9aC6d6aB810e", price: 150n },
  { name: "AMZN", address: "0xb69EB2A9BAd10E8186226261e5D45d7a1885c668", price: 180n },
  { name: "META", address: "0xDe2b00A31264DEA9eCD9aa90D9Fb7dB9a587Df86", price: 500n },
  { name: "TSLA", address: "0xf5cEBE4b856b3D9E18Bac738bF2972ea7F5022d9", price: 300n },
  { name: "COIN", address: "0xa5a7BD0936F883533F87aBEed6963f9149B8e35a", price: 250n },
  { name: "MSTR", address: "0x040F05AC2ea4a7e84C27356fE49854403043016e", price: 300n },
  { name: "CLSK", address: "0x0BFB36970AAb220AA52Ff4546862569F6b850842", price: 10n },
  { name: "CRCL", address: "0xeA55CdC144B4561ad23A0b4E577dca9668dA4E12", price: 150n },
  { name: "IONQ", address: "0x31190491B328f57254eb6ee418EAD024b655B247", price: 30n },
  { name: "RGTI", address: "0x2c53173Dc4cB508f2e64cFF677b34c36cF113872", price: 10n },
  { name: "RKLB", address: "0xB53771ade92387A972a728F608af04ffcD0C08d2", price: 20n },
  { name: "SPCX", address: "0x6a0C3A4AA69146E211f0b45df4b1Af40c54aB0E7", price: 50n },
  { name: "INTC", address: "0x94553eBecC90830A81699c1bB98a5FF9C191A080", price: 25n },
  { name: "MU", address: "0xA4a75774D2592f95eCAfD3E626F487dd6d864Dd8", price: 100n },
  { name: "ASML", address: "0x208a3296C73b02f0EDf50531CF025a00Ca7A3aBD", price: 700n },
  { name: "SNDK", address: "0xF5e9e7A003E67FbA316748dC99773D12f022BD34", price: 50n },
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
  console.log(`All ${ORACLES.length} v13 oracles refreshed with a fresh timestamp.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
