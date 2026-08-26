import { network } from "hardhat";

function feedPrice(dollars: bigint, decimals = 8): bigint {
  return dollars * 10n ** BigInt(decimals);
}

// v15 deployment addresses -- confirmed against a single continuous
// deploy log pasted directly into chat. StaxVault at
// 0xC10Ef76b35cB7ae4a68226E3b82F58B1cf4c32f4.
const ORACLES = [
  { name: "ETH/USD", address: "0x3d39F6fBB5ddDA1A3eAD7e56A09b7b4647d7cFfe", price: 3000n },
  { name: "NVDA", address: "0xED081F3441f574c82D948793B190352f829FF5cf", price: 150n },
  { name: "AMD", address: "0x305C7796d21486d873672f77727c86Afb9e3d8F0", price: 100n },
  { name: "TSM", address: "0x5EFdE0BC6576b5C390D22be8402d6B71C7CDC701", price: 200n },
  { name: "AAPL", address: "0xc897dE8367117ac6A61a0736a1206099754abB96", price: 200n },
  { name: "MSFT", address: "0x750EE0A29C4C868E7B4Ca8DbAAa7241340340a82", price: 400n },
  { name: "GOOGL", address: "0x7FeCEF7872263CDD22c7a592154f93DE4A96C229", price: 150n },
  { name: "AMZN", address: "0x46563C94Fe61e8BCC299206325379bC99037e92F", price: 180n },
  { name: "META", address: "0x14bCae202dcb1CeE9d272340568e436318FcEab7", price: 500n },
  { name: "TSLA", address: "0xa1B4CbEd74b652eeD50554Ab5e9BA9cd0BEe65d7", price: 300n },
  { name: "COIN", address: "0x3e7C5020cA325F9cB0381Cfbe006472237DbE7b1", price: 250n },
  { name: "MSTR", address: "0x4cDaf5A79576CE6e530AAe6c29EB5f3Dbd787b9b", price: 300n },
  { name: "CLSK", address: "0x4f695C593f83F99C8075B88e3765D2502CB87f9f", price: 10n },
  { name: "CRCL", address: "0x41472DdF8013868B826F297695f036c06ba1bb95", price: 150n },
  { name: "IONQ", address: "0x53009Fa7806759b4DdbDb68c8f2C3C1dF5214409", price: 30n },
  { name: "RGTI", address: "0x8561Ee4D1e22C764751dD1FAd61bB7a10CfAA515", price: 10n },
  { name: "RKLB", address: "0x162F13cde00724Fab4dbB5ADA63BB7CFEB6F1EC6", price: 20n },
  { name: "SPCX", address: "0x91F081C6Cd97EbeDeee7b6bD99d6eEd8251f1B77", price: 50n },
  { name: "INTC", address: "0x7fd25F87B54De26028B332B28beC82C5e95b500F", price: 25n },
  { name: "MU", address: "0xdc861fc4eF3FA55CA8cDa84B16A9D9B4EeCa1FcF", price: 100n },
  { name: "ASML", address: "0xDb3D35CcE8b2417B442F3582a5AEEE5622b01a55", price: 700n },
  { name: "SNDK", address: "0x35485e81853566dE15A281669168A5695f66b8B4", price: 50n },
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
  console.log(`All ${ORACLES.length} v15 oracles refreshed with a fresh timestamp.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
