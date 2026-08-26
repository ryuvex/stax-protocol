import { network } from "hardhat";

const ONE_HOUR = 3600;
const ETH_USD_DOLLARS = 3000n;
const NVDA_USD_DOLLARS = 150n;

function feedPrice(dollars: bigint, decimals = 8): bigint {
  return dollars * 10n ** BigInt(decimals);
}

async function main() {
  const { ethers } = await network.connect();
  const [owner, teamWallet, staxTokenStandIn, user] = await ethers.getSigners();

  console.log("=== Real StaxVault mint, with explicit gas limit (bypassing auto-estimation) ===\n");

  const MockWETH = await ethers.getContractFactory("MockWETH");
  const weth = await MockWETH.deploy();

  const MockPermit2 = await ethers.getContractFactory("MockPermit2");
  const permit2 = await MockPermit2.deploy();

  const MockUniversalRouter = await ethers.getContractFactory("MockUniversalRouter");
  const router = await MockUniversalRouter.deploy(await permit2.getAddress(), await weth.getAddress());

  const MockPriceOracle = await ethers.getContractFactory("MockPriceOracle");
  const ethUsdOracle = await MockPriceOracle.deploy(feedPrice(ETH_USD_DOLLARS), 8);
  const sequencerFeed = await MockPriceOracle.deploy(0, 8);
  await sequencerFeed.setPriceAt(0, 1);

  const StaxVault = await ethers.getContractFactory("StaxVault");
  const vault = await StaxVault.deploy(
    await teamWallet.getAddress(),
    await staxTokenStandIn.getAddress(),
    await router.getAddress(),
    await weth.getAddress(),
    await ethUsdOracle.getAddress(),
    ONE_HOUR,
    await sequencerFeed.getAddress()
  );

  await owner.sendTransaction({ to: await weth.getAddress(), value: ethers.parseEther("1000") });

  const MockERC20 = await ethers.getContractFactory("MockERC20");
  const nvda = await MockERC20.deploy("Mock NVDA", "mNVDA");
  const nvdaOracle = await MockPriceOracle.deploy(feedPrice(NVDA_USD_DOLLARS), 8);

  await vault.connect(owner).setPriceFeed(await nvda.getAddress(), await nvdaOracle.getAddress(), ONE_HOUR);

  const wethAddr = await weth.getAddress();
  const nvdaAddr = await nvda.getAddress();
  const [currency0, currency1] = wethAddr.toLowerCase() < nvdaAddr.toLowerCase() ? [wethAddr, nvdaAddr] : [nvdaAddr, wethAddr];

  console.log("WETH address:", wethAddr);
  console.log("NVDA address:", nvdaAddr);
  console.log("currency0:", currency0, "currency1:", currency1);

  await vault.connect(owner).setTickerPool(nvdaAddr, currency0, currency1, 3000, 60, ethers.ZeroAddress);

  const basketId = 1;
  await vault.connect(owner).createBasket(
    basketId, "AI Infrastructure", "sAI",
    [nvdaAddr], [10000],
    ethers.parseUnits("1000000", 18), ethers.parseUnits("100000", 18)
  );

  await nvda.mint(await router.getAddress(), ethers.parseUnits("1000000", 18));

  const ethUsd18 = ETH_USD_DOLLARS * 10n ** 18n;
  const nvdaUsd18 = NVDA_USD_DOLLARS * 10n ** 18n;
  const rateEthToNvda = (ethUsd18 * 10n ** 18n) / nvdaUsd18;
  const rateNvdaToEth = (nvdaUsd18 * 10n ** 18n) / ethUsd18;

  await router.setRate(wethAddr, nvdaAddr, rateEthToNvda);
  await router.setRate(nvdaAddr, wethAddr, rateNvdaToEth);

  console.log("\nAll setup complete. Attempting mint with explicit gasLimit...\n");

  try {
    const tx = await vault.connect(user).mint(basketId, {
      value: ethers.parseEther("1"),
      gasLimit: 5_000_000,
    });
    const receipt = await tx.wait();
    console.log("SUCCESS! Transaction hash:", receipt.hash);

    const nvdaBalance = await nvda.balanceOf(await vault.getAddress());
    console.log("Vault's NVDA balance:", ethers.formatUnits(nvdaBalance, 18));
  } catch (err: any) {
    console.log("FAILED with explicit gas limit too.");
    console.log("Error message:", err.message ?? err);
    if (err.data) console.log("Error data:", err.data);
    if (err.reason) console.log("Error reason:", err.reason);

    // Try to get a static call trace for more detail
    console.log("\nTrying staticCall for more detail...");
    try {
      await vault.connect(user).mint.staticCall(basketId, { value: ethers.parseEther("1") });
    } catch (staticErr: any) {
      console.log("staticCall error message:", staticErr.message ?? staticErr);
      if (staticErr.data) console.log("staticCall error data:", staticErr.data);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
