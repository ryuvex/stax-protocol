import { network } from "hardhat";

const VAULT_ADDRESS = "0x80B9594400eF598D7260b643A18417EeDdE936e0";

// Mag 7's ticker + feed addresses, from the original deploy script output.
const MAG7_TICKERS = [
  { name: "AAPL", token: "0xC326AA0575f49538667F388C6C208bcc6F99408A", feed: "0xD72fe8A3302082c36faaF9bd08dBd08d936687e1" },
  { name: "MSFT", token: "0xf31a0a0f1Daf78fD4E1c7a53801a46A1C86E5072", feed: "0x73D37F81b3AF65bBeB44d56Dd88462cC4b61507d" },
  { name: "GOOGL", token: "0x1EA9925c683A2f67B2eEDd7fA36e60508b7a7bAd", feed: "0x8E383886A45e600b0e7A62B6af54b81A52Bd3727" },
  { name: "AMZN", token: "0xa5eDD252c6A939F7df713541c0654608f4317D00", feed: "0xB94664e5cC28A3bF3715f32fEdca7C27eD4b8E37" },
  { name: "NVDA", token: "0xCB776f5CE516a5aDA4F2f1425d57C0C0C6a3b6B4", feed: "0xBb59eD288C58C767442973B6bbD004A59bC934d9" },
  { name: "META", token: "0x78B754C564b3D66C00F2AAA066B9054e9E70f521", feed: "0xF3530560E1B2DEf46109a2E666B4c5796226d1D1" },
  { name: "TSLA", token: "0x6eDCCb1d9A95018D2f8Cd542F5Bde19c666A8869", feed: "0x2b941d786B2A13221C396Bf0917466c333A75a40" },
];

async function main() {
  const { ethers } = await network.connect();
  const vault = await ethers.getContractAt("StaxVault", VAULT_ADDRESS);

  console.log("=== Mag 7 (basket 2) — per-ticker decomposition ===\n");

  let manualTotal = 0n;

  for (const t of MAG7_TICKERS) {
    const token = await ethers.getContractAt("MockERC20", t.token);
    const balanceRaw = await token.balanceOf(VAULT_ADDRESS);

    const oracle = await ethers.getContractAt("MockPriceOracle", t.feed);
    const [, answer, , updatedAt] = await oracle.latestRoundData();
    const decimals = await oracle.decimals();

    const priceUsd18 = BigInt(answer) * 10n ** (18n - BigInt(decimals));
    const balance18 = balanceRaw; // MockERC20 is 18-decimal
    const valueUsd18 = (balance18 * priceUsd18) / 10n ** 18n;

    manualTotal += valueUsd18;

    console.log(`${t.name}:`);
    console.log(`  Balance held: ${ethers.formatUnits(balanceRaw, 18)} tokens`);
    console.log(`  Oracle price: $${ethers.formatUnits(priceUsd18, 18)} (last updated: ${new Date(Number(updatedAt) * 1000).toISOString()})`);
    console.log(`  Value: $${ethers.formatUnits(valueUsd18, 18)}`);
    console.log("");
  }

  console.log("=== Totals ===");
  console.log("Manually summed total:", "$" + ethers.formatUnits(manualTotal, 18));

  const contractNav = await vault.getBasketNavUsd(2);
  console.log("Contract's getBasketNavUsd(2):", "$" + ethers.formatUnits(contractNav, 18));

  console.log("\nThese two totals should match exactly (or be extremely close) --");
  console.log("if they do, the NAV figure is confirmed genuine and internally consistent.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
