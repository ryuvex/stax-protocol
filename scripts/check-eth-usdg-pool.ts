import { network } from "hardhat";

const LENS_ADDRESS = "0xa5fd118AF173BF852950D504c5035Dd4A461a87D";

async function main() {
  const { ethers } = await network.connect({ network: "robinhoodMainnet" });

  const lensAbi = [
    "function getLiquidityBatch(bytes32[] calldata poolIds) external view returns (uint128[] memory)",
  ];
  const lens = new ethers.Contract(LENS_ADDRESS, lensAbi, ethers.provider);

  // Standard tiers, hookless -- computed for WETH/USDG (currency0 < currency1
  // ordering already applied).
  const poolIds = [
    { label: "fee=100 tickSpacing=1", id: "0x35d5055f7162c8e8e1742f0559f53376287e998c0e4845ffefd275d85cc1701a" },
    { label: "fee=500 tickSpacing=10", id: "0xfcfae8fa0bd6da961bcf5d990f27690932deac4f093e99bf3e871691c6586593" },
    { label: "fee=3000 tickSpacing=60", id: "0x77c25b9386d47de62e0155c393696e9f43f7e6d036c6ca52f66735ccbb8808a7" },
    { label: "fee=10000 tickSpacing=200", id: "0x4e61f742ae3516c0223997579cc13753b653a3ed299dcf40f3baf5a4daa6e353" },
  ];

  const ids = poolIds.map((p) => p.id);
  const liquidities: bigint[] = await lens.getLiquidityBatch(ids);

  console.log("WETH/USDG pool check across standard fee tiers:\n");
  for (let i = 0; i < poolIds.length; i++) {
    console.log(`  ${poolIds[i].label} -- liquidity=${liquidities[i]}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
