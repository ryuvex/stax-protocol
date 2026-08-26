import { network } from "hardhat";

const VAULT_ADDRESS = "0x8C1fe310f75c16453EEd2d25cddd49eeE48d89EC";
const NVDA_TOKEN = "0xf52B9659Bbe600FAD64b6CAE8f57e5b3fe72657D";
const NVDA_FEED = "0x1E36a65473De361C638fD33F97B41AFF6B90954B";

async function main() {
  const { ethers } = await network.connect();
  const vault = await ethers.getContractAt("StaxVault", VAULT_ADDRESS);

  console.log("=== Shared-ticker check: NVDA (used in both AI Infrastructure and Mag 7) ===\n");

  // The one, single, real NVDA balance the vault actually holds.
  const nvdaToken = await ethers.getContractAt("MockERC20", NVDA_TOKEN);
  const vaultNvdaBalance = await nvdaToken.balanceOf(VAULT_ADDRESS);
  console.log("Vault's ACTUAL total NVDA balance (one real number):", ethers.formatUnits(vaultNvdaBalance, 18));

  const oracle = await ethers.getContractAt("MockPriceOracle", NVDA_FEED);
  const [, answer, , ] = await oracle.latestRoundData();
  const decimals = await oracle.decimals();
  const priceUsd18 = BigInt(answer) * 10n ** (18n - BigInt(decimals));
  const nvdaValueUsd18 = (vaultNvdaBalance * priceUsd18) / 10n ** 18n;
  console.log("That NVDA's real total value: $" + ethers.formatUnits(nvdaValueUsd18, 18));
  console.log("");

  const aiInfraNav = await vault.getBasketNavUsd(1);
  const mag7Nav = await vault.getBasketNavUsd(2);

  console.log("AI Infrastructure's reported total NAV: $" + ethers.formatUnits(aiInfraNav, 18));
  console.log("Mag 7's reported total NAV: $" + ethers.formatUnits(mag7Nav, 18));
  console.log("");

  console.log("=== The actual question ===");
  console.log("If NVDA's real total value ($" + ethers.formatUnits(nvdaValueUsd18, 18) + ") is being");
  console.log("counted in FULL toward BOTH baskets' NAV independently (rather than each basket");
  console.log("only counting its own fair share), that's the double-counting bug.");
  console.log("");
  console.log("Compare: does Mag 7's NVDA-attributable value (from the earlier decomposition,");
  console.log("~$169) roughly equal NVDA's ENTIRE real balance value shown above, rather than");
  console.log("just Mag 7's proportional share of it?");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
