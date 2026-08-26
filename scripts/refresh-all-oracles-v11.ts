import { network } from "hardhat";

function feedPrice(dollars: bigint, decimals = 8): bigint {
  return dollars * 10n ** BigInt(decimals);
}

// v11 deployment oracle addresses -- pulled directly from
// deploy-testnet-v11.ts output (StaxVault at
// 0x576b931BA15B632003062403Dd194fC09eB9413c).
const ORACLES = [
  { name: "ETH/USD", address: "0x631Bb33d28631Bf3d7eB9a38da520BB9d9f0E045", price: 3000n },
  { name: "NVDA", address: "0x61e2Ce3f2da765cD9448d06E3cF4b0764E059aC3", price: 150n },
  { name: "AMD", address: "0x0090AA1AfD478f2a07567ffA5e198DDB5B2c9764", price: 100n },
  { name: "TSM", address: "0x230559ec098d4Db25a9308d90b80EAe32b5a6742", price: 200n },
  { name: "AAPL", address: "0x6cB9865f873336f2caA614B2e6f98b68619A2FA0", price: 200n },
  { name: "MSFT", address: "0xdcdB2e646964A6552b229050DC72beB9Be4382A8", price: 400n },
  { name: "GOOGL", address: "0x0B9ec5A99EDb342a3Fd19eFc51e02B72F39c4D76", price: 150n },
  { name: "AMZN", address: "0x81e56344cB50fE2148b6Ce7A9a845CEE6c492B67", price: 180n },
  { name: "META", address: "0x0B63406e9A7F748be5BAc1aFa9A4Fb5f1CD45426", price: 500n },
  { name: "TSLA", address: "0x9718e40B21795BA5f63a365e6130DFb32Be33F30", price: 300n },
  { name: "COIN", address: "0x0A6A5a2D4D27016223cbb942928Ac83A3bF93B01", price: 250n },
  { name: "MSTR", address: "0xb229E851B099B53E4BbD8950b4ACA4ac4B76e8Fe", price: 300n },
  { name: "CLSK", address: "0x92A0AA47dF8c782f964BDeE366A58A1937B6ab8F", price: 10n },
  { name: "CRCL", address: "0x470a22a65f7F11609C569316149Dc4B19b4f0E08", price: 150n },
  { name: "IONQ", address: "0xfd373F9196A4559CcC87f80fBc78A8D4ad625e8d", price: 30n },
  { name: "RGTI", address: "0x7D932464EC1B1Af28a162Aff97529780b23008b2", price: 10n },
  { name: "RKLB", address: "0x4899410313784274abeD9A98460D65cE3FdC49C3", price: 20n },
  { name: "SPCX", address: "0x86323763744AF0Da51C00a68041a56DB4659856F", price: 50n },
  { name: "INTC", address: "0xdFcf2F050891F6E7e18362F4A4A03CAC619F9D79", price: 25n },
  { name: "MU", address: "0x4d3497cF21b49D64F9A053704C6f83750B86BE60", price: 100n },
  { name: "ASML", address: "0x82576CC88C5E9BA0a2b5bB5d9C78Cb58b0068c00", price: 700n },
  { name: "SNDK", address: "0xBD7920F0E106aac11e2De10DF8007F0688C23326", price: 50n },
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
  console.log(`All ${ORACLES.length} v11 oracles refreshed with a fresh timestamp.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
