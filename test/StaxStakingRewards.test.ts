import { expect } from "chai";
import { network } from "hardhat";

// StaxStaking (Synthetix custody fork) + StaxRewardsDistributor (Uniswap merkle fork).
// STAX is not deployed yet: a mock 18-decimal token stands in, as the brief assumes.
describe("StaxStaking + StaxRewardsDistributor", function () {
  this.timeout(120_000);
  let connection: any; let ethers: any;
  before(async () => { connection = await network.create(); ethers = connection.ethers; });
  after(async () => { await connection?.close?.(); });

  async function deploy(name: string, ...args: any[]) {
    const c: any = await (await ethers.getContractFactory(name)).deploy(...args); await c.waitForDeployment(); return c;
  }
  async function advance(s: number) { await ethers.provider.send("evm_increaseTime", [s]); await ethers.provider.send("evm_mine", []); }
  const now = async () => (await ethers.provider.getBlock("latest")).timestamp;

  // --- merkle helper: same leaf as the contract, sorted-pair keccak like OpenZeppelin's MerkleProof
  type Leaf = { index: number; account: string; amount: bigint };
  const leafHash = (l: Leaf) => ethers.keccak256(ethers.solidityPacked(["uint256", "address", "uint256"], [l.index, l.account, l.amount]));
  const pair = (a: string, b: string) => (a.toLowerCase() < b.toLowerCase() ? ethers.keccak256(ethers.concat([a, b])) : ethers.keccak256(ethers.concat([b, a])));
  function tree(leaves: Leaf[]) {
    const layers: string[][] = [leaves.map(leafHash)];
    while (layers[layers.length - 1].length > 1) {
      const prev = layers[layers.length - 1]; const next: string[] = [];
      for (let i = 0; i < prev.length; i += 2) next.push(i + 1 < prev.length ? pair(prev[i], prev[i + 1]) : prev[i]);
      layers.push(next);
    }
    const root = layers[layers.length - 1][0];
    const proof = (leafIdx: number) => {
      const out: string[] = []; let i = leafIdx;
      for (let d = 0; d < layers.length - 1; d++) { const sib = i ^ 1; if (sib < layers[d].length) out.push(layers[d][sib]); i = Math.floor(i / 2); }
      return out;
    };
    return { root, proof };
  }

  it("staking: exact custody, unconditional withdraw, events for the indexer, no owner power over stakes", async () => {
    const [owner, alice, bob] = await ethers.getSigners();
    const stax = await deploy("MockERC20Decimals", "Stax", "STAX", 18);
    const staking = await deploy("StaxStaking", owner.address, await stax.getAddress());
    expect(await stax.decimals()).to.equal(18n);
    for (const u of [alice, bob]) { await stax.mint(u.address, ethers.parseUnits("1000", 18)); await stax.connect(u).approve(await staking.getAddress(), ethers.MaxUint256); }

    const a1 = ethers.parseUnits("123.456789012345678901", 18);
    const tx = await staking.connect(alice).stake(a1);
    const r = await tx.wait();
    const ev = r.logs.map((l: any) => { try { return staking.interface.parseLog(l); } catch { return null; } }).find((e: any) => e?.name === "Staked");
    expect(ev.args.user).to.equal(alice.address);
    expect(ev.args.amount).to.equal(a1);
    expect(ev.args.newBalance).to.equal(a1);
    expect(ev.args.timestamp).to.equal(BigInt((await ethers.provider.getBlock(r.blockNumber)).timestamp));
    expect(await staking.balanceOf(alice.address)).to.equal(a1);
    expect(await staking.totalSupply()).to.equal(a1);
    expect(await stax.balanceOf(await staking.getAddress())).to.equal(a1);

    await staking.connect(bob).stake(ethers.parseUnits("10", 18));
    await expect(staking.connect(alice).stake(0)).to.be.revertedWith("Cannot stake 0");
    await expect(staking.connect(alice).withdraw(0)).to.be.revertedWith("Cannot withdraw 0");
    await expect(staking.connect(alice).withdraw(a1 + 1n)).to.be.revertedWithPanic(0x11); // checked arithmetic underflow

    // partial withdraw, any time, no conditions
    const half = a1 / 2n;
    await staking.connect(alice).withdraw(half);
    expect(await staking.balanceOf(alice.address)).to.equal(a1 - half);
    expect(await stax.balanceOf(alice.address)).to.equal(ethers.parseUnits("1000", 18) - a1 + half);
    await advance(30 * 86400);
    await staking.connect(alice).exit();
    expect(await staking.balanceOf(alice.address)).to.equal(0n);
    expect(await stax.balanceOf(alice.address)).to.equal(ethers.parseUnits("1000", 18)); // exact amount back
    expect(await staking.totalSupply()).to.equal(ethers.parseUnits("10", 18)); // bob still in

    // owner cannot touch staked STAX; can recover a stray token
    await expect(staking.connect(owner).recoverERC20(await stax.getAddress(), 1n)).to.be.revertedWith("Cannot withdraw the staking token");
    const stray = await deploy("MockERC20Decimals", "Stray", "STRAY", 6);
    await stray.mint(await staking.getAddress(), 5_000_000n);
    await expect(staking.connect(alice).recoverERC20(await stray.getAddress(), 5_000_000n)).to.be.revertedWithCustomError(staking, "OwnableUnauthorizedAccount");
    await staking.connect(owner).recoverERC20(await stray.getAddress(), 5_000_000n);
    expect(await stray.balanceOf(owner.address)).to.equal(5_000_000n);
    // no reward surface exists on the fork
    expect((staking as any).notifyRewardAmount).to.equal(undefined);
    expect((staking as any).getReward).to.equal(undefined);
  });

  it("distributor: epoch roots bounded by pool balance, claims, double-claim/bad-proof rejection, expiry recovery", async () => {
    const [owner, alice, bob, carol] = await ethers.getSigners();
    const usdg = await deploy("MockERC20Decimals", "USDG", "USDG", 6);
    const dist = await deploy("StaxRewardsDistributor", owner.address, await usdg.getAddress());
    const D = await dist.getAddress();

    // the vault's rewards share lands here as plain USDG transfers
    await usdg.mint(D, 1_000_000n); // 1.000000 USDG
    expect(await dist.unallocated()).to.equal(1_000_000n);

    const leaves1: Leaf[] = [
      { index: 0, account: alice.address, amount: 600_000n },
      { index: 1, account: bob.address, amount: 300_000n },
      { index: 2, account: carol.address, amount: 100_000n },
    ];
    const t1 = tree(leaves1);
    // over-allocation refused
    await expect(dist.publishEpoch(t1.root, 1_000_001n, 0)).to.be.revertedWithCustomError(dist, "InsufficientUnallocated");
    await expect(dist.connect(alice).publishEpoch(t1.root, 1_000_000n, 0)).to.be.revertedWithCustomError(dist, "OwnableUnauthorizedAccount");
    await dist.publishEpoch(t1.root, 1_000_000n, 0);
    expect(await dist.epochCount()).to.equal(1n);
    expect(await dist.unallocated()).to.equal(0n);
    expect(await dist.outstanding()).to.equal(1_000_000n);

    // anyone may submit a claim; funds go to the leaf's account
    await dist.connect(bob).claim(1, 0, alice.address, 600_000n, t1.proof(0));
    expect(await usdg.balanceOf(alice.address)).to.equal(600_000n);
    await expect(dist.claim(1, 0, alice.address, 600_000n, t1.proof(0))).to.be.revertedWithCustomError(dist, "AlreadyClaimed");
    await expect(dist.claim(1, 1, bob.address, 300_001n, t1.proof(1))).to.be.revertedWithCustomError(dist, "InvalidProof");
    await expect(dist.claim(1, 1, carol.address, 300_000n, t1.proof(1))).to.be.revertedWithCustomError(dist, "InvalidProof");
    await expect(dist.claim(2, 1, bob.address, 300_000n, t1.proof(1))).to.be.revertedWithCustomError(dist, "EpochNotFound");
    expect(await dist.outstanding()).to.equal(400_000n);

    // a second epoch with expiry; new fees arrive first
    await usdg.mint(D, 500_000n);
    expect(await dist.unallocated()).to.equal(500_000n);
    const exp = (await now()) + 7 * 86400;
    const leaves2: Leaf[] = [{ index: 0, account: alice.address, amount: 200_000n }, { index: 1, account: bob.address, amount: 300_000n }];
    const t2 = tree(leaves2);
    await dist.publishEpoch(t2.root, 500_000n, exp);

    // claimMany across epochs for bob
    await dist.connect(bob).claimMany([1, 2], [1, 1], bob.address, [300_000n, 300_000n], [t1.proof(1), t2.proof(1)]);
    expect(await usdg.balanceOf(bob.address)).to.equal(600_000n);

    // expiry: alice misses epoch 2; owner recovers the remainder into the pool; carol's epoch-1 claim (no expiry) still works
    await expect(dist.recoverExpired(2)).to.be.revertedWithCustomError(dist, "EpochNotExpired");
    await advance(8 * 86400);
    await expect(dist.claim(2, 0, alice.address, 200_000n, t2.proof(0))).to.be.revertedWithCustomError(dist, "EpochExpired");
    await dist.recoverExpired(2);
    await expect(dist.recoverExpired(2)).to.be.revertedWithCustomError(dist, "RecoveryNotAllowed");
    expect(await dist.unallocated()).to.equal(200_000n);
    await dist.claim(1, 2, carol.address, 100_000n, t1.proof(2));
    expect(await dist.outstanding()).to.equal(0n);
    expect(await usdg.balanceOf(D)).to.equal(200_000n); // exactly the recovered remainder

    // USDG can never be pulled by the owner outside claims
    await expect(dist.recoverERC20(await usdg.getAddress(), 1n)).to.be.revertedWithCustomError(dist, "RecoveryNotAllowed");
  });
});
