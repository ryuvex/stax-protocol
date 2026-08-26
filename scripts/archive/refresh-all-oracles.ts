import { network } from "hardhat";

function feedPrice(dollars: bigint, decimals = 8): bigint {
  return dollars * 10n ** BigInt(decimals);
}

// v10 deployment oracle addresses -- pulled directly from
// deploy-testnet-v10.ts output (StaxVault at
// 0x62C641739c2317b740F5A18904311f5c4aD0DDb7).
const ORACLES = [
  { name: "ETH/USD", address: "0x811Db0512b95cb09A0c6386C17ac39BA6686b822", price: 3000n },
  { name: "NVDA", address: "0x53C25B00AFbc89f8846F13Ad49df812bEC1EA8FA", price: 150n },
  { name: "AMD", address: "0x5B9a0F8D320C23f712AC743D9A217Dc87258478D", price: 100n },
  { name: "TSM", address: "0xCc127B7B376DF851420bc6918C8939f5f9A9279E", price: 200n },
  { name: "AAPL", address: "0xE531D5B4669747000C11090FCa009771400b4Abb", price: 200n },
  { name: "MSFT", address: "0xc97dD1BCff0eC486B395f3936F4eE90b34d5F451", price: 400n },
  { name: "GOOGL", address: "0x1B711DA495F90fB1d45843A3BCA71E3AD5b371C2", price: 150n },
  { name: "AMZN", address: "0xE5fD01F2Fd9257a9984a20F084ddaDC1B0Ab8BA7", price: 180n },
  { name: "META", address: "0x7487Aa26f8D58e8BBE0C1Eba1BA5230910227168", price: 500n },
  { name: "TSLA", address: "0xA7892818456b29Ecc25Bd2D43A4a81FDb4F73785", price: 300n },
  { name: "COIN", address: "0x1b4e74ca45BB5BF83d033F9abbf796eCd7700710", price: 250n },
  { name: "MSTR", address: "0x43653d6dda2E2330c848Cf4CB04907335F32dB1d", price: 300n },
  { name: "CLSK", address: "0xfCe34dbA2B6A69c14D7ACa91BF6BfB3F686B5955", price: 10n },
  { name: "CRCL", address: "0xdAB6E03F50B582F6D11e285c704C35B7dbd98b27", price: 150n },
  { name: "IONQ", address: "0xe8a23750AdFBC1A0073fd4733B2911CABad5FDbC", price: 30n },
  { name: "RGTI", address: "0x47F205287d2d59de693B095958B1D1802a84E556", price: 10n },
  { name: "RKLB", address: "0x4185C586A0751C3da1D621d15c3b05C7bc9e9dc6", price: 20n },
  { name: "SPCX", address: "0xbAC0cDd644e3b531605a8D52c4a76801883aDE42", price: 50n },
  { name: "INTC", address: "0x7297F9b900B9aD9297eDbC3c08C3487e937e6b9d", price: 25n },
  { name: "MU", address: "0x7D2D9672D5Ab9d189F59Aac51CD8AE9dB2df8dC4", price: 100n },
  { name: "ASML", address: "0x78A839407e1A03dC07AE3826465cC740F496fdE4", price: 700n },
  { name: "SNDK", address: "0x4baB18855DAaFeE0753d56093ee5fD0d0eb50128", price: 50n },
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
  console.log(`All ${ORACLES.length} v10 oracles refreshed with a fresh timestamp.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
