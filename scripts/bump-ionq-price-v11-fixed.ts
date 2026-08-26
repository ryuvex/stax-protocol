import { network } from "hardhat";

function feedPrice(dollars: bigint, decimals = 8): bigint {
  return dollars * 10n ** BigInt(decimals);
}

// v11 addresses. Fixed version of bump-ionq-price-v11.ts: the original
// only updated the ORACLE price, leaving the MockSwapRouter's configured
// swap rate at the old $30 IONQ price. That made oracle and router
// disagree sharply -- which is EXACTLY what the contract's manipulation
// defense (oracle-vs-DEX-price divergence check) is designed to catch,
// so every redeem involving IONQ correctly reverted with "slippage too
// high." A real price move updates both the price feed AND the market's
// actual liquidity together -- this script now does the same, updating
// oracle price and router rate together so they stay consistent.
const IONQ_ORACLE_ADDRESS = "0xfd373F9196A4559CcC87f80fBc78A8D4ad625e8d";
const IONQ_TOKEN_ADDRESS = "0x4e1Bb822d54E625F16A55780B9941e9e1AE914dc";
const WETH_ADDRESS = "0x572566D6F47DB80ed44A6C9da45Cd60364a80c69";
const ROUTER_ADDRESS = "0x6dC169E39587011Db1aAEDCf77561Ff6A5178c77";

const ETH_USD_DOLLARS = 3000n;
const NEW_IONQ_PRICE_DOLLARS = 60n;

async function main() {
  const { ethers } = await network.connect();

  const oracle = await ethers.getContractAt("MockPriceOracle", IONQ_ORACLE_ADDRESS);
  const priceTx = await oracle.setPrice(feedPrice(NEW_IONQ_PRICE_DOLLARS));
  await priceTx.wait();
  console.log(`IONQ oracle price set to $${NEW_IONQ_PRICE_DOLLARS}.`);

  const router = await ethers.getContractAt("MockSwapRouter", ROUTER_ADDRESS);

  const ethUsd18 = ETH_USD_DOLLARS * 10n ** 18n;
  const tokenUsd18 = NEW_IONQ_PRICE_DOLLARS * 10n ** 18n;
  const rateEthToToken = (ethUsd18 * 10n ** 18n) / tokenUsd18;
  const rateTokenToEth = (tokenUsd18 * 10n ** 18n) / ethUsd18;

  const rate1Tx = await router.setRate(WETH_ADDRESS, IONQ_TOKEN_ADDRESS, rateEthToToken);
  await rate1Tx.wait();
  const rate2Tx = await router.setRate(IONQ_TOKEN_ADDRESS, WETH_ADDRESS, rateTokenToEth);
  await rate2Tx.wait();

  console.log("Router rate for IONQ<->WETH updated to match new price.");
  console.log("");
  console.log("Oracle and router are now consistent -- redeem should work.");
  console.log("Now redeem your full Quantum Computing balance through the UI immediately.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
