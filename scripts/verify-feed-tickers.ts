import { network } from "hardhat";

// Rough, generous price ranges per ticker -- wide enough to tolerate
// real market movement, tight enough to catch a genuine transposition
// (e.g. AAPL's feed accidentally in MSFT's slot). Not investment
// guidance, just a sanity bound for catching a wrong address.
const EXPECTED_PRICE_RANGES: Record<string, [number, number]> = {
  NVDA: [50, 400],
  AMD: [50, 350],
  TSM: [50, 400],
  AAPL: [100, 400],
  MSFT: [200, 800],
  GOOGL: [80, 400],
  AMZN: [80, 400],
  META: [200, 1200],
  TSLA: [50, 600],
  COIN: [50, 600],
  MSTR: [50, 1200],
  CRCL: [20, 500],
  SPCX: [10, 300],
  INTC: [10, 150],
  MU: [30, 400],
  SNDK: [10, 300],
};

const TICKERS: Record<string, string> = {
  NVDA: "0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15",
  AMD: "0x943A29E7ae51A4798823ca9eEd2ed533B2A22C72",
  TSM: "0x874cF94aa8eC88Fd9560094dD065f2fB3E41Fc2F",
  AAPL: "0x6B22A786bAa607d76728168703a39Ea9C99f2cD0",
  MSFT: "0x45C3C877C15E6BA2EBB19eA114Ea508d14C1Af2E",
  GOOGL: "0xF6f373a037c30F0e5010d854385cA89185AE638b",
  AMZN: "0xD5a1508ceD74c084eBf3cBe853e2C968fB2a651C",
  META: "0x7C38C00C30BEe9378381E7B6135d7283356D71b1",
  TSLA: "0x4A1166a659A55625345e9515b32adECea5547C38",
  COIN: "0xA3a468A452940B7D6b69991207B508c609a98Ef2",
  MSTR: "0x396118bdFB181e6240E74D243F266B061c0edc3D",
  CRCL: "0x6652eDf64bA3731C4F2D3ce821A0Fb1f1f6b482a",
  SPCX: "0xB265810950ba6c5C0Ff821c9963014a56fD8Bffb",
  INTC: "0x3f390C5C24628Ac7C489515402235FeAD71D1913",
  MU: "0x425EEFdCf05ed6526C3cE61Af99429A228a6d596",
  SNDK: "0xfb133Fa4B7b385802B693a293606682Df47109A3",
};

async function main() {
  const { ethers } = await network.connect({ network: "robinhoodMainnet" });

  const feedAbi = [
    "function decimals() external view returns (uint8)",
    "function latestRoundData() external view returns (uint80,int256,uint256,uint256,uint80)",
    "function description() external view returns (string memory)",
  ];

  console.log("=== Verifying all 16 stock feed addresses -- description() + live price sanity check ===\n");
  console.log("This catches a transposed-but-real address (e.g. AAPL's feed pasted into MSFT's slot)");
  console.log("that would otherwise pass every distinctness/null check silently.\n");

  let anyFailed = false;
  let anyDescriptionUnavailable = false;

  for (const [symbol, feedAddress] of Object.entries(TICKERS)) {
    const feed = await ethers.getContractAt(feedAbi, feedAddress);

    let description = "(unavailable)";
    try {
      description = await feed.description();
    } catch {
      anyDescriptionUnavailable = true;
    }

    let priceCheckResult = "SKIPPED (read failed)";
    let flagged = false;

    try {
      const decimals = await feed.decimals();
      const roundData = await feed.latestRoundData();
      const rawPrice = roundData[1] as bigint;
      const price = Number(rawPrice) / 10 ** Number(decimals);

      const range = EXPECTED_PRICE_RANGES[symbol];
      const inRange = range ? price >= range[0] && price <= range[1] : true;

      priceCheckResult = `$${price.toFixed(2)}${range ? ` (expected ${range[0]}-${range[1]})` : ""}`;
      if (range && !inRange) {
        flagged = true;
        anyFailed = true;
      }
    } catch (err: any) {
      priceCheckResult = `READ FAILED: ${err.message ?? err}`;
      flagged = true;
      anyFailed = true;
    }

    const descriptionMentionsTicker = description.toUpperCase().includes(symbol);
    const flag = flagged || (description !== "(unavailable)" && !descriptionMentionsTicker);

    console.log(
      `  ${symbol.padEnd(6)} feed=${feedAddress}  description="${description}"  price=${priceCheckResult}${
        flag ? "  *** FLAGGED -- MANUALLY VERIFY THIS ONE ***" : "  OK"
      }`
    );

    if (description !== "(unavailable)" && !descriptionMentionsTicker) {
      console.log(`      -- description doesn't obviously mention "${symbol}", worth a manual look even if price seems fine`);
      anyFailed = true;
    }
  }

  console.log("\n=== RESULT ===");
  if (anyDescriptionUnavailable) {
    console.log("Note: some feeds don't expose description() -- normal for some proxy patterns, not itself a problem. Price-range check is the primary signal for those.");
  }
  if (anyFailed) {
    console.log("*** At least one feed was flagged. Manually verify each flagged entry against a second source (Blockscout, Chainlink's page) before trusting it in the deploy script. ***");
  } else {
    console.log("All 16 feeds passed both checks: description mentions the expected ticker (where available) and live price falls within the expected range. This is real evidence the addresses are correctly mapped, not just present and distinct.");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
