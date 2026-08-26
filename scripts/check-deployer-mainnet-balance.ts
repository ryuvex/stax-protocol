import { network } from "hardhat";

const ADDRESS_TO_CHECK = "0xCECa5491a16ea73F29990313924285EEB9771e3b";

async function main() {
  const { ethers } = await network.connect({ network: "robinhoodMainnet" });

  console.log("Checking real mainnet balance for:", ADDRESS_TO_CHECK);

  const balance = await ethers.provider.getBalance(ADDRESS_TO_CHECK);
  console.log("ETH balance:", ethers.formatEther(balance), "ETH");

  // Also confirm this matches the address the configured
  // ROBINHOOD_MAINNET_PRIVATE_KEY actually resolves to, so there's no
  // ambiguity about which wallet is really configured for mainnet
  // deploys.
  const [configuredSigner] = await ethers.getSigners();
  console.log("\nAddress the mainnet network config's private key resolves to:", configuredSigner.address);

  const matches = configuredSigner.address.toLowerCase() === ADDRESS_TO_CHECK.toLowerCase();
  console.log("Matches the address you provided:", matches ? "YES" : "NO -- these are different addresses, worth understanding why before proceeding");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
