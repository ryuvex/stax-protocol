import { expect } from "chai";
import { network } from "hardhat";
import { buildTree } from "../scripts/rewards/merkle.mjs";
import { computePayouts, ONE } from "../scripts/rewards/scoring.mjs";

// Full round trip on a mainnet fork (brief section 6):
//   vault.setRewardsPool(distributor) by the real owner -> a real mint generates fees ->
//   claimRewardsPool() funds the distributor with real USDG -> stake 100k STAX, wait, unstake exact ->
//   score, publish root, claim. STAX is not deployed, so a mock 18-decimal token stands in.
// Run: npm run test:staking:fork   (needs RPC access; nothing is sent to mainnet)
const RPC = process.env.STAX_RPC_URL ?? "https://rpc.mainnet.chain.robinhood.com";
const VAULT = "0xAda84161033C0Cc54EF21CEeF913A8fEC4239b33";
const OFFICIAL_ID = 5n; // sSEMI
const VAULT_ABI = [
  "function owner() view returns(address)", "function usdg() view returns(address)", "function rewardsPool() view returns(address)",
  "function pendingRewardsPool() view returns(uint256)", "function setRewardsPool(address)", "function claimRewardsPool()",
  "function previewMint(uint256,uint256) view returns(uint256)", "function mint(uint256,uint256,uint256,uint256)",
  "function baskets(uint256) view returns(string name,address token,uint256 depositCapUsd,uint256 maxMintUsd,bool mintPaused,bool exists)",
];
const ERC20 = ["function balanceOf(address) view returns(uint256)", "function approve(address,uint256) returns(bool)", "function decimals() view returns(uint8)"];

describe("staking + rewards: mainnet fork round trip", function () {
  this.timeout(600_000);
  let connection: any; let ethers: any;
  before(async () => {
    const head = await new (await import("ethers")).JsonRpcProvider(RPC, 4663, { staticNetwork: true }).getBlockNumber();
    connection = await network.create({ network: "robinhoodMainnetFork", override: { forking: { url: RPC, blockNumber: head - 5 } } });
    ethers = connection.ethers;
    await ethers.provider.send("evm_mine", []);
  });
  after(async () => { await connection?.close?.(); });

  async function deploy(name: string, ...args: any[]) { const c: any = await (await ethers.getContractFactory(name)).deploy(...args); await c.waitForDeployment(); return c; }
  async function fundUsdg(usdg: any, who: string, amount: bigint) {
    for (let slot = 0; slot < 64; slot++) {
      const key = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["address", "uint256"], [who, slot]));
      const old = await ethers.provider.getStorage(usdg.target, key);
      await ethers.provider.send("hardhat_setStorageAt", [usdg.target, key, ethers.toBeHex(amount, 32)]);
      if ((await usdg.balanceOf(who)) === amount) return;
      await ethers.provider.send("hardhat_setStorageAt", [usdg.target, key, old]);
    }
    throw new Error("could not fund USDG");
  }
  async function impersonate(addr: string) {
    await ethers.provider.send("hardhat_impersonateAccount", [addr]);
    await ethers.provider.send("hardhat_setBalance", [addr, ethers.toBeHex(ethers.parseEther("1"))]);
    return await ethers.getSigner(addr);
  }

  it("funds the distributor from real vault fees, custodies 100k STAX exactly, pays a scored epoch", async () => {
    const [deployer, alice, bob] = await ethers.getSigners();
    const vault = new ethers.Contract(VAULT, VAULT_ABI, deployer);
    const usdg = new ethers.Contract(await vault.usdg(), ERC20, deployer);
    const owner = await impersonate(await vault.owner());

    // --- contracts under test
    const stax = await deploy("MockERC20Decimals", "Stax", "STAX", 18);
    const staking = await deploy("StaxStaking", deployer.address, await stax.getAddress());
    const dist = await deploy("StaxRewardsDistributor", deployer.address, usdg.target);
    const D = await dist.getAddress();

    // --- point the vault's rewards share at the distributor (one owner call, nothing else changes)
    const before = await vault.rewardsPool();
    await vault.connect(owner).setRewardsPool(D);
    expect(await vault.rewardsPool()).to.equal(D);
    console.log(`   rewardsPool ${before} -> distributor ${D}`);

    // --- a real mint on an official basket generates a fee; 30% is the rewards share
    const mintUsdg = 500n * 10n ** 6n;
    await fundUsdg(usdg, alice.address, mintUsdg * 2n);
    await usdg.connect(alice).approve(VAULT, mintUsdg);
    const preview: bigint = await vault.previewMint(OFFICIAL_ID, mintUsdg);
    const minOut = (preview * 97n) / 100n;
    const deadline = (await ethers.provider.getBlock("latest")).timestamp + 600;
    const pendingBefore: bigint = await vault.pendingRewardsPool();
    await vault.connect(alice).mint(OFFICIAL_ID, mintUsdg, minOut, deadline);
    const pendingAfter: bigint = await vault.pendingRewardsPool();
    expect(pendingAfter).to.be.greaterThan(pendingBefore);
    console.log(`   fee to rewards from a 500 USDG mint: ${ethers.formatUnits(pendingAfter - pendingBefore, 6)} USDG (pending total ${ethers.formatUnits(pendingAfter, 6)})`);

    // --- anyone flushes the share; it lands in the distributor as unallocated USDG
    await vault.connect(bob).claimRewardsPool();
    const pool: bigint = await usdg.balanceOf(D);
    expect(pool).to.equal(pendingAfter);
    expect(await dist.unallocated()).to.equal(pool);
    expect(await vault.pendingRewardsPool()).to.equal(0n);

    // --- staking custody at real size: 100k STAX in, wait a week, exact amount out
    const amt = 100_000n * ONE;
    await stax.mint(bob.address, amt);
    await stax.connect(bob).approve(await staking.getAddress(), amt);
    await staking.connect(bob).stake(amt);
    expect(await staking.balanceOf(bob.address)).to.equal(amt);
    expect(await stax.balanceOf(await staking.getAddress())).to.equal(amt);
    await ethers.provider.send("evm_increaseTime", [7 * 86400]); await ethers.provider.send("evm_mine", []);
    await staking.connect(bob).withdraw(amt);
    expect(await staking.balanceOf(bob.address)).to.equal(0n);
    expect(await stax.balanceOf(bob.address)).to.equal(amt);
    expect(await stax.balanceOf(await staking.getAddress())).to.equal(0n);

    // --- score an epoch with the real pool amount (synthetic timelines: alice held TVL, bob staked)
    const basketToken = new ethers.Contract((await vault.baskets(OFFICIAL_ID)).token, ERC20, deployer);
    const aliceShares: bigint = await basketToken.balanceOf(alice.address);
    expect(aliceShares).to.be.greaterThan(0n);
    const { payouts, distributed } = computePayouts([
      { account: alice.address, tvlTw: 500n * ONE, heldFraction: 1, stakeTw: 0n },
      { account: bob.address, tvlTw: 500n * ONE, heldFraction: 1, stakeTw: 100_000n * ONE },
    ], pool);
    const leaves = payouts.filter((r: any) => r.amount > 0n).map((r: any, i: number) => ({ index: i, account: r.account, amount: r.amount }));
    const { root, proofs } = buildTree(leaves);
    await dist.publishEpoch(root, distributed, 0);
    expect(await dist.unallocated()).to.equal(pool - distributed);

    // --- claims pay real USDG from real fees
    for (const l of leaves) {
      const b0: bigint = await usdg.balanceOf(l.account);
      await dist.connect(alice).claim(1, l.index, l.account, l.amount, proofs[l.index]);
      expect((await usdg.balanceOf(l.account)) - b0).to.equal(l.amount);
    }
    expect(await dist.outstanding()).to.equal(0n);
    console.log(`   epoch 1 paid ${ethers.formatUnits(distributed, 6)} USDG to ${leaves.length} wallets (bob 2x via max stake)`);
    // same TVL, bob at max stake -> bob gets 2x alice (integer floors may differ by a unit)
    const [a, b] = [leaves.find((l: any) => l.account === alice.address)!.amount, leaves.find((l: any) => l.account === bob.address)!.amount];
    expect(b >= 2n * a - 2n && b <= 2n * a + 2n).to.equal(true);
  });
});
