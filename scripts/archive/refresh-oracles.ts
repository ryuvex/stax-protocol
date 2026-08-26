import { network } from "hardhat";

const ETH_USD_ORACLE = "0x03F3A4dc604b05f4Aa53cAd36b368379fAD50384";
const NVDA_ORACLE = "0xBb59eD288C58C767442973B6bbD004A59bC934d9";
const AMD_ORACLE = "0x1B3a3a207E510d1E376cE71618aa1589295c760A";
const TSM_ORACLE = "0x97a2828b27f85f56cb2ED821cB41eb88bB6275Ff";

function feedPrice(dollars: bigint, decimals = 8): bigint {
  return dollars * 10n ** BigInt(decimals);
}

async function main() {
  const { ethers } = await network.connect();

  const oracles = [
    { name: "ETH/USD", address: ETH_USD_ORACLE, price: 3000n },
    { name: "NVDA", address: NVDA_ORACLE, price: 150n },
    { name: "AMD", address: AMD_ORACLE, price: 100n },
    { name: "TSM", address: TSM_ORACLE, price: 200n },
  ];

  for (const oracle of oracles) {
    const contract = await ethers.getContractAt("MockPriceOracle", oracle.address);
    const tx = await contract.setPrice(feedPrice(oracle.price));
    await tx.wait();
    console.log(`Refreshed ${oracle.name} oracle at ${oracle.address} — tx: ${tx.hash}`);
  }

  console.log("");
  console.log("All oracles refreshed with a fresh timestamp.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
