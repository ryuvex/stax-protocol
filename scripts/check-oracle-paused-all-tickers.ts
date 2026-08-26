import { network } from "hardhat";

// Real mainnet ticker token addresses, from tonight's resolver work
// (ASML already dropped from the basket lineup).
const TICKER_ADDRESSES: Record<string, string> = {
  NVDA: "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC",
  AMD: "0x86923f96303D656E4aa86D9d42D1e57ad2023fdC",
  TSM: "0x58FfE4a942d3885bAa22D7520691F611EF09e7AA",
  AAPL: "0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9",
  MSFT: "0xe93237C50D904957Cf27E7B1133b510C669c2e74",
  GOOGL: "0x2e0847E8910a9732eB3fb1bb4b70a580ADAD4FE3",
  AMZN: "0x12f190a9F9d7D37a250758b26824B97CE941bF54",
  META: "0xc0D6457C16Cc70d6790Dd43521C899C87ce02f35",
  TSLA: "0x322F0929c4625eD5bAd873c95208D54E1c003b2d",
  COIN: "0x6330D8C3178a418788dF01a47479c0ce7CCF450b",
  MSTR: "0xec262a75e413fAfD0dF80480274532C79D42da09",
  CLSK: "0xcBB95BBF36099d34dA091dc6Fa6F49EfA257Cee3",
  CRCL: "0xdF0992E440dD0be65BD8439b609d6D4366bf1CB5", // dropped from basket, checked anyway for completeness
  IONQ: "0x558378E000D634A36593E338eBacdd6207640EfE", // dropped from basket, checked anyway for completeness
  RGTI: "0x284358abc07F9359f19f4b5b4aC91901Be2597Ba",
  RKLB: "0x3b14C39E89D60D627b42a1A4CA45b5bb45Fc12e2",
  SPCX: "0x4a0E65A3EcceC6dBe60AE065F2e7bb85Fae35eEa",
  INTC: "0xc72b96e0E48ecd4DC75E1e45396e26300BC39681",
  MU: "0xfF080c8ce2E5feadaCa0Da81314Ae59D232d4afD",
  SNDK: "0xB90A19fF0Af67f7779afF50A882A9CfF42446400",
};

async function main() {
  const { ethers } = await network.connect({ network: "robinhoodMainnet" });

  const abi = ["function oraclePaused() external view returns (bool)"];

  console.log("Checking oraclePaused() on all real mainnet ticker tokens...\n");

  let allGood = true;

  for (const [symbol, address] of Object.entries(TICKER_ADDRESSES)) {
    try {
      const token = await ethers.getContractAt(abi, address);
      const paused = await token.oraclePaused();
      console.log(`  ${symbol.padEnd(6)} -- oraclePaused() = ${paused}  [OK, implements interface]`);
    } catch (err: any) {
      allGood = false;
      console.log(`  ${symbol.padEnd(6)} -- FAILED: ${err.message ?? err}`);
      console.log(`  ${symbol.padEnd(6)} -- *** THIS TICKER WOULD BE PERMANENTLY BRICKED under the current try/catch-treats-as-paused logic ***`);
    }
  }

  console.log("\n" + (allGood
    ? "=== ALL 20 TICKERS CONFIRMED SAFE -- every one implements oraclePaused() cleanly ==="
    : "=== WARNING: AT LEAST ONE TICKER FAILED -- see above, this needs a contract-level fix before that basket can go live ==="
  ));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
