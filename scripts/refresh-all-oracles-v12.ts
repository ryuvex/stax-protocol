import { network } from "hardhat";

function feedPrice(dollars: bigint, decimals = 8): bigint {
  return dollars * 10n ** BigInt(decimals);
}

// v12 deployment addresses (second v12 deploy tonight -- this is the
// correct, confirmed one, verified against a single continuous deploy
// log pasted directly into chat). StaxVault at
// 0xF3cE0386FEf1cE4493bEd00caDE0A00D783666a6.
const ORACLES = [
  { name: "ETH/USD", address: "0x11dAbCa0373adB4DeA4582f3873E0C7E74434eDA", price: 3000n },
  { name: "NVDA", address: "0x324633A0cF28877e6365953DA1c74d340bCe1832", price: 150n },
  { name: "AMD", address: "0xFD2E63E887A779448c69027168Bbc4ED89F60595", price: 100n },
  { name: "TSM", address: "0xa7361d20488E27D664F90CdB699aefF0546421cC", price: 200n },
  { name: "AAPL", address: "0x51e1A158f6b0555f72340600C5350e5482Fe5a98", price: 200n },
  { name: "MSFT", address: "0xB35bBFa17c332df0d08589020AC2487a018B0b15", price: 400n },
  { name: "GOOGL", address: "0x3952EE225BA6455AF61739e4743a7db2D103578B", price: 150n },
  { name: "AMZN", address: "0x0f6343c5D3FdFABA8705D2F81dd8caa54aF55CC0", price: 180n },
  { name: "META", address: "0x851eb55E1a455024638042Add382d7E2A8F2E854", price: 500n },
  { name: "TSLA", address: "0x514050ba868363e7Dc4bB01Cd4D5268dD0777688", price: 300n },
  { name: "COIN", address: "0x5e9699333b5C35dcf94f0F02dF650bca38B88E38", price: 250n },
  { name: "MSTR", address: "0x8B4D12c9abd666f897A5d1510fd02d6514FCBE30", price: 300n },
  { name: "CLSK", address: "0x83B3150013585deD7683D37f3762a915E875873c", price: 10n },
  { name: "CRCL", address: "0x6a8e389448B92475519610C7fbC942E884B030d8", price: 150n },
  { name: "IONQ", address: "0xfF9a8D1282D48303b8d336865F403d019DDB3111", price: 30n },
  { name: "RGTI", address: "0x1Ae70F70aB73f18fC9400216Eb7fb975ed8E8F4f", price: 10n },
  { name: "RKLB", address: "0x37b10890171e91173fdfBa46c51b2D6028a05b0B", price: 20n },
  { name: "SPCX", address: "0x14c8F992cBdD2212bF2B5c901B2f63cfB1723379", price: 50n },
  { name: "INTC", address: "0x49060e5eEEa0f7Dba394c702891687a6B0612e9f", price: 25n },
  { name: "MU", address: "0x77F1a1fE7375eAF3fE1BB96bFc602264Ebc39Ec8", price: 100n },
  { name: "ASML", address: "0x1849dF7ef576B521f50bBadC46Bf8409d58D7858", price: 700n },
  { name: "SNDK", address: "0x8bDdA8b79f42b950567dDE8F1eba348463BC270C", price: 50n },
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
  console.log(`All ${ORACLES.length} v12 oracles refreshed with a fresh timestamp.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
