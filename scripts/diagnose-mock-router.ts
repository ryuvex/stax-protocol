import { network } from "hardhat";

async function main() {
  const { ethers } = await network.connect();
  const [owner] = await ethers.getSigners();

  console.log("=== Isolated MockUniversalRouter diagnostic ===\n");

  // Deploy the same mocks the real test uses.
  const MockWETH = await ethers.getContractFactory("MockWETH");
  const weth = await MockWETH.deploy();

  const MockPermit2 = await ethers.getContractFactory("MockPermit2");
  const permit2 = await MockPermit2.deploy();

  const MockUniversalRouter = await ethers.getContractFactory("MockUniversalRouter");
  const router = await MockUniversalRouter.deploy(await permit2.getAddress(), await weth.getAddress());

  const MockERC20 = await ethers.getContractFactory("MockERC20");
  const nvda = await MockERC20.deploy("Mock NVDA", "mNVDA");

  // Fund the router with NVDA to pay out, same as the real test setup.
  await nvda.mint(await router.getAddress(), ethers.parseUnits("1000000", 18));

  // Configure a rate: 1 WETH = 20 NVDA (arbitrary, matches roughly $3000/$150).
  const rate = 20n * 10n ** 18n;
  await router.setRate(await weth.getAddress(), await nvda.getAddress(), rate);

  // Owner wraps 1 ETH into WETH, approves permit2, then permit2-approves the router --
  // exactly the same sequence StaxVault's _approveViaPermit2 does.
  const ethAmount = ethers.parseEther("1");
  await weth.deposit({ value: ethAmount });
  await weth.approve(await permit2.getAddress(), ethAmount);
  await permit2.approve(await weth.getAddress(), await router.getAddress(), ethAmount, Math.floor(Date.now() / 1000) + 3600);

  console.log("Setup complete. WETH balance:", ethers.formatEther(await weth.balanceOf(owner.address)));
  console.log("Permit2 allowance:", await permit2.allowance(owner.address, await weth.getAddress(), await router.getAddress()));

  // Now hand-craft the EXACT same encoding StaxVault._executeV4Swap produces,
  // using ethers' own AbiCoder directly -- full visibility into every step.
  const abiCoder = ethers.AbiCoder.defaultAbiCoder();

  const wethAddr = await weth.getAddress();
  const nvdaAddr = await nvda.getAddress();
  const [currency0, currency1] = wethAddr.toLowerCase() < nvdaAddr.toLowerCase() ? [wethAddr, nvdaAddr] : [nvdaAddr, wethAddr];
  const zeroForOne = (currency0 === wethAddr);

  const expectedOut = (ethAmount * rate) / 10n ** 18n;
  const minOut = expectedOut - (expectedOut * 200n) / 10000n; // 2% slippage tolerance

  console.log("\nPoolKey: currency0=", currency0, "currency1=", currency1);
  console.log("zeroForOne:", zeroForOne);
  console.log("amountIn:", ethAmount.toString());
  console.log("expected amountOut:", expectedOut.toString());
  console.log("minOut:", minOut.toString());

  const poolKeyType = "tuple(address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks)";
  const swapParamsType = `tuple(${poolKeyType} poolKey, bool zeroForOne, uint128 amountIn, uint128 amountOutMinimum, bytes hookData)`;

  const swapParamsEncoded = abiCoder.encode(
    [swapParamsType],
    [{
      poolKey: { currency0, currency1, fee: 3000, tickSpacing: 60, hooks: ethers.ZeroAddress },
      zeroForOne,
      amountIn: ethAmount,
      amountOutMinimum: minOut,
      hookData: "0x",
    }]
  );

  const settleParamsEncoded = abiCoder.encode(["address", "uint256"], [wethAddr, ethAmount]);
  const takeParamsEncoded = abiCoder.encode(["address", "uint256"], [nvdaAddr, minOut]);

  const actions = ethers.concat([
    ethers.toBeHex(0x06, 1),
    ethers.toBeHex(0x0c, 1),
    ethers.toBeHex(0x0f, 1),
  ]);

  const actionParams = [swapParamsEncoded, settleParamsEncoded, takeParamsEncoded];

  const inputs0 = abiCoder.encode(["bytes", "bytes[]"], [actions, actionParams]);

  const commands = "0x10";

  console.log("\nCalling router.execute() directly...\n");

  try {
    const tx = await router.execute(commands, [inputs0], Math.floor(Date.now() / 1000) + 3600);
    const receipt = await tx.wait();
    console.log("SUCCESS! Transaction hash:", receipt.hash);

    const nvdaBalance = await nvda.balanceOf(owner.address);
    console.log("NVDA received:", ethers.formatUnits(nvdaBalance, 18));
  } catch (err: any) {
    console.log("FAILED:", err.message ?? err);
    if (err.data) {
      console.log("Error data:", err.data);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
