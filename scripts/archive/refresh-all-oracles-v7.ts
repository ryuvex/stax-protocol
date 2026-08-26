import { network } from "hardhat";

function feedPrice(dollars: bigint, decimals = 8): bigint {
  return dollars * 10n ** BigInt(decimals);
}

const ORACLES = [
  { name: "ETH/USD", address: "0x6b881528f5D560db0eaC31034F6b2a2585d4726A", price: 3000n },
  { name: "NVDA", address: "0x1E36a65473De361C638fD33F97B41AFF6B90954B", price: 150n },
  { name: "AMD", address: "0x599802d30E723dEe6ff685e92A5069853c1B911d", price: 100n },
  { name: "TSM", address: "0xbD14deDb9329e205e6be4b373bBCdDC45f8716a3", price: 200n },
  { name: "AAPL", address: "0x54D4A438e3018A81a89907f20E529086011Fd74a", price: 200n },
  { name: "MSFT", address: "0xfbe580527956546aC63D28fe1A6A072318b7D81F", price: 400n },
  { name: "GOOGL", address: "0xE8f45AC0844Deb67CcE777C95C8e888aBA0A9C4a", price: 150n },
  { name: "AMZN", address: "0xD0C4F80468845528A0c3Cfc86c7D132C49728D0d", price: 180n },
  { name: "META", address: "0x279629AC0e71FD9E161456CbCd1f45402cAeC397", price: 500n },
  { name: "TSLA", address: "0x3D048d5700c0abe03A5175aF00e27310A6F5aCde", price: 300n },
  { name: "COIN", address: "0xDA8114cB7452e06b451083dE72E3d5C644df1986", price: 250n },
  { name: "MSTR", address: "0x42fDB4C48909133e683611439f6749D184378d75", price: 300n },
  { name: "CLSK", address: "0x7d4B438c381F19095617e11C84183FfA48dC120c", price: 10n },
  { name: "CRCL", address: "0x95756f70427a8aFddA645773Bb2810CA8825e639", price: 150n },
  { name: "IONQ", address: "0xdDC99B7A8747A8f907Cb2435DEa65D49D1e5fF8E", price: 30n },
  { name: "RGTI", address: "0xc9B34fAfdd8926c08e444ab387Ce8e246eD2Ae0A", price: 10n },
  { name: "RKLB", address: "0xB3848ffEc78555b8AF1c65002bb980ED05d27f16", price: 20n },
  { name: "SPCX", address: "0xC0060d774273e200C797832a424722827B2EC31F", price: 50n },
  { name: "INTC", address: "0x048EBBb9F596C892B11ACAbd268211EB2Aa96062", price: 25n },
  { name: "MU", address: "0xb1Afe6AE62A82fe149e962a8E67D479865B6275C", price: 100n },
  { name: "ASML", address: "0xa68c098D5Ba9ac28B94080F3354196a64a64F89b", price: 700n },
  { name: "SNDK", address: "0x77A71c0E66A3aFc529ee7322bC0dAa86D0DFc60B", price: 50n },
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
  console.log(`All ${ORACLES.length} v7 oracles refreshed with a fresh timestamp.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
