import { network } from "hardhat";

const VAULT_ADDRESS = "0x8C1fe310f75c16453EEd2d25cddd49eeE48d89EC";

const MAG7_TICKERS = [
  { name: "AAPL", token: "0xa49a405036D4227Ce60c7C4E3D68c6883E7FcE10", feed: "0x54D4A438e3018A81a89907f20E529086011Fd74a" },
  { name: "MSFT", token: "0x754589C39870522f9FB5F73Ce780734fB712Ccd3", feed: "0xfbe580527956546aC63D28fe1A6A072318b7D81F" },
  { name: "GOOGL", token: "0x9003199493171Da55E676FAC1f5C34D181798554", feed: "0xE8f45AC0844Deb67CcE777C95C8e888aBA0A9C4a" },
  { name: "AMZN", token: "0xEAF96A496EF700D42D79C7229Fc0C84C7d43B01F", feed: "0xD0C4F80468845528A0c3Cfc86c7D132C49728D0d" },
  { name: "NVDA", token: "0xf52B9659Bbe600FAD64b6CAE8f57e5b3fe72657D", feed: "0x1E36a65473De361C638fD33F97B41AFF6B90954B" },
  { name: "META", token: "0x803740B226f0603Ca7409f8ff90605EB6519123e", feed: "0x279629AC0e71FD9E161456CbCd1f45402cAeC397" },
  { name: "TSLA", token: "0x519636a2aB5AF55f10E6822650463BDF64897255", feed: "0x3D048d5700c0abe03A5175aF00e27310A6F5aCde" },
];

async function main() {
  const { ethers } = await network.connect();
  const vault = await ethers.getContractAt("StaxVault", VAULT_ADDRESS);

  console.log("=== Mag 7 (v7, basket 2) — full diagnostic ===\n");

  let manualTotal = 0n;

  for (const t of MAG7_TICKERS) {
    const token = await ethers.getContractAt("MockERC20", t.token);
    const balanceRaw = await token.balanceOf(VAULT_ADDRESS);

    const oracle = await ethers.getContractAt("MockPriceOracle", t.feed);
    const [, answer, , updatedAt] = await oracle.latestRoundData();
    const decimals = await oracle.decimals();

    const priceUsd18 = BigInt(answer) * 10n ** (18n - BigInt(decimals));
    const valueUsd18 = (balanceRaw * priceUsd18) / 10n ** 18n;

    manualTotal += valueUsd18;

    console.log(`${t.name}:`);
    console.log(`  Balance held: ${ethers.formatUnits(balanceRaw, 18)} tokens`);
    console.log(`  Oracle price: $${ethers.formatUnits(priceUsd18, 18)} (updated: ${new Date(Number(updatedAt) * 1000).toISOString()})`);
    console.log(`  Value: $${ethers.formatUnits(valueUsd18, 18)}`);
    console.log("");
  }

  console.log("=== NAV check ===");
  console.log("Manually summed total:", "$" + ethers.formatUnits(manualTotal, 18));

  const contractNav = await vault.getBasketNavUsd(2);
  console.log("Contract's getBasketNavUsd(2):", "$" + ethers.formatUnits(contractNav, 18));

  console.log("\n=== Supply check (the key question) ===");
  const basketData = await vault.baskets(2);
  const tokenAddress = basketData[1];
  const basketToken = await ethers.getContractAt("StaxBasketToken", tokenAddress);
  const totalSupply = await basketToken.totalSupply();
  console.log("Total supply:", ethers.formatUnits(totalSupply, 18), "tokens");
  console.log("(If this matches the supply from before the 'doubling', no mint happened --");
  console.log(" meaning the value increase came entirely from real price movement across");
  console.log(" the underlying tickers, not from anything mint-related.)");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
