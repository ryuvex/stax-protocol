import { expect } from "chai";
import { network } from "hardhat";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const factoryArtifact = require("@uniswap/v3-core/artifacts/contracts/UniswapV3Factory.sol/UniswapV3Factory.json");
const poolArtifact = require("@uniswap/v3-core/artifacts/contracts/UniswapV3Pool.sol/UniswapV3Pool.json");
const Q192 = 1n << 192n;
const LIMITS = [1n, (1n << 48n) - 1n] as const;
const L = 10n ** 20n;

// Independent integer square root for selecting pool starting prices. No oracle library calls.
function sqrt(n: bigint): bigint {
  let x = n, y = (x + 1n) / 2n;
  while (y < x) { x = y; y = (x + n / x) / 2n; }
  return x;
}

describe("Audit fix regressions", function () {
  this.timeout(120_000);
  let connection: any;
  let ethers: any;
  before(async () => { connection = await network.create(); ethers = connection.ethers; });
  after(async () => { await connection.close(); });
  async function deploy(name: string, ...args: any[]) {
    const c: any = await (await ethers.getContractFactory(name)).deploy(...args);
    await c.waitForDeployment();
    return c;
  }
  async function advance(seconds: number) {
    await ethers.provider.send("evm_increaseTime", [seconds]);
    await ethers.provider.send("evm_mine", []);
  }
  async function fixture(rawNumerator: bigint, rawDenominator = 1n, desiredToken0?: boolean) {
    const [owner, user, rewards, treasury] = await ethers.getSigners();
    const usdg = await deploy("MockERC20Decimals", "USDG", "USDG", 6);
    let token = await deploy("LocalCryptoToken", 18);
    for (let i = 0; desiredToken0 !== undefined && (BigInt(token.target) < BigInt(usdg.target)) !== desiredToken0 && i < 32; i++) {
      token = await deploy("LocalCryptoToken", 18);
    }
    if (desiredToken0 !== undefined) expect(BigInt(token.target) < BigInt(usdg.target)).to.equal(desiredToken0);
    const permit = await deploy("MockPermit2");
    const factory: any = await new ethers.ContractFactory(factoryArtifact.abi, factoryArtifact.bytecode, owner).deploy();
    await factory.waitForDeployment();
    await factory.createPool(token.target, usdg.target, 3000);
    const pool: any = new ethers.Contract(await factory.getPool(token.target, usdg.target, 3000), poolArtifact.abi, owner);
    const token0 = BigInt(token.target) < BigInt(usdg.target);
    const numerator = token0 ? rawNumerator : rawDenominator * 10n ** 18n;
    const denominator = token0 ? rawDenominator * 10n ** 18n : rawNumerator;
    await pool.initialize(sqrt(Q192 * numerator / denominator));
    await pool.increaseObservationCardinalityNext(64);
    const router = await deploy("LocalV3Flow", factory.target, permit.target);
    await usdg.mint(router.target, 10n ** 35n);
    await token.mint(router.target, 10n ** 35n);
    await router.provide(pool.target, L);
    await advance(601);
    await router.provide(pool.target, 1);
    const registry = await deploy("UnifiedTwapRegistry", owner.address, usdg.target, factory.target);
    const params = { pool: pool.target, twapWindow: 600, maxObservationAge: 600,
      minCurrentLiquidity: 10n ** 18n, minHarmonicLiquidity: 10n ** 18n, maxDeviationBps: 500 };
    await registry.configureToken(token.target, params);
    const usdFeed = await deploy("MockPriceOracle", 100_000_000n, 8);
    const deployer = await deploy("StaxBasketTokenDeployer");
    const validator = await deploy("StaxV3RouteValidator", router.target, factory.target, ethers.keccak256(poolArtifact.bytecode));
    const args = [owner.address, deployer.target, [], rewards.address, treasury.address,
      router.target, permit.target, usdg.target, usdFeed.target, 100_000, ethers.ZeroAddress, validator.target];
    const vault = await deploy("StaxVaultV2", ...args);
    await vault.setTickerPoolV3(token.target, 3000);
    await vault.setTwapOracle(token.target, registry.target, 200);
    await vault.createBasket(1, "Audit", "AUDIT", [token.target], [10000], 10n ** 27n, 10n ** 25n);
    const shares: any = await ethers.getContractAt("StaxBasketToken", (await vault.baskets(1)).token);
    await usdg.mint(user.address, 1_000_000_000n);
    await usdg.connect(user).approve(vault.target, ethers.MaxUint256);
    return {owner, user, usdg, token, factory, pool, token0, router, registry, params, vault, shares, validator};
  }
  async function preciseSpot(c: any): Promise<bigint> {
    const s = BigInt((await c.pool.slot0()).sqrtPriceX96);
    // 18-decimal USDG price per whole 18-decimal token, computed from exact slot0.
    return c.token0 ? s * s * 10n ** 30n / Q192 : Q192 * 10n ** 30n / (s * s);
  }

  it("A-01: rejects the former 65% deviation hidden in a one-unit raw quote", async () => {
    const c = await fixture(11n, 10n);
    const before = await preciseSpot(c);
    const quote = (await c.registry.quoteUsdg18(c.token.target))[0];
    expect(quote).to.be.gt(1099n * 10n ** 9n).and.lt(1101n * 10n ** 9n);
    await c.usdg.mint(c.owner.address, 30_000_000_000n);
    await c.usdg.approve(c.router.target, ethers.MaxUint256);
    await c.router.trade(c.pool.target, !c.token0, 30_000_000_000n);
    expect(await preciseSpot(c)).to.be.gt(before * 150n / 100n);
    await expect(c.registry.quoteUsdg18(c.token.target)).to.be.revertedWithCustomError(c.registry, "ExcessiveDeviation");
  });

  for (const desiredToken0 of [true, false]) for (const [numerator, denominator] of [[3n, 2n], [1n, 2n]]) {
    it(`A-01: round-trips a stable low-priced token (${numerator}/${denominator} micro-USDG, token0=${desiredToken0})`, async () => {
      const c = await fixture(numerator, denominator, desiredToken0);
      const before = await c.usdg.balanceOf(c.user.address);
      await c.vault.connect(c.user).mint(1, 100_000_000n, 98n * 10n ** 18n, LIMITS[1]);
      const shares = await c.shares.balanceOf(c.user.address);
      await c.vault.connect(c.user).redeem(1, shares, 98_000_000n, LIMITS[1]);
      expect(await c.usdg.balanceOf(c.user.address) - (before - 100_000_000n)).to.be.gt(98_000_000n);
      expect(await c.shares.totalSupply()).to.equal(0);
    });
  }

  it("A-01: blocks the previously underpriced redemption and preserves shares/holdings", async () => {
    const c = await fixture(101n, 100n);
    await c.vault.connect(c.user).mint(1, 100_000_000n, ...LIMITS);
    await c.usdg.mint(c.owner.address, 30_000_000_000n);
    await c.usdg.approve(c.router.target, ethers.MaxUint256);
    await c.router.trade(c.pool.target, !c.token0, 30_000_000_000n);
    await advance(601);
    await c.router.provide(c.pool.target, 1);
    const honestSpot = await preciseSpot(c);
    const held = await c.vault.basketTickerHoldings(1, c.token.target);
    const qty = await c.shares.totalSupply();
    await c.token.mint(c.owner.address, 15n * 10n ** 27n);
    await c.token.approve(c.router.target, ethers.MaxUint256);
    await c.router.trade(c.pool.target, c.token0, 15n * 10n ** 27n);
    expect(await preciseSpot(c)).to.be.lt(honestSpot * 75n / 100n);
    await expect(c.vault.connect(c.user).redeem(1, qty, ...LIMITS)).to.be.revertedWithCustomError(c.registry, "ExcessiveDeviation");
    expect(await c.shares.totalSupply()).to.equal(qty);
    expect(await c.vault.basketTickerHoldings(1, c.token.target)).to.equal(held);
  });

  it("A-02: old selectors and zero result bounds cannot bypass protections", async () => {
    const c = await fixture(1_000_000n);
    const legacy = new ethers.Interface(["function mint(uint256,uint256)", "function redeem(uint256,uint256)"]);
    for (const name of ["mint", "redeem"]) {
      const data = legacy.encodeFunctionData(name, [1, 100_000_000n]);
      await expect(c.user.sendTransaction({to: c.vault.target, data})).to.revert(ethers);
      expect(c.vault.interface.hasFunction(`${name}(uint256,uint256)`)).to.equal(false);
    }
    await expect(c.vault.connect(c.user).mint(1, 100_000_000n, 0, LIMITS[1])).to.be.revertedWithCustomError(c.vault, "UserLimitNotMet");
    await expect(c.vault.connect(c.user).redeem(1, 1, 0, LIMITS[1])).to.be.revertedWithCustomError(c.vault, "UserLimitNotMet");
  });

  it("A-02: minimum shares failures roll back the deposit and swaps", async () => {
    const c = await fixture(1_000_000n);
    const before = await c.usdg.balanceOf(c.user.address);
    const slot = await c.pool.slot0();
    await expect(c.vault.connect(c.user).mint(1, 100_000_000n, 200n * 10n ** 18n, LIMITS[1])).to.be.revertedWithCustomError(c.vault, "UserLimitNotMet");
    expect(await c.usdg.balanceOf(c.user.address)).to.equal(before);
    expect((await c.pool.slot0()).sqrtPriceX96).to.equal(slot.sqrtPriceX96);
    expect(await c.shares.totalSupply()).to.equal(0);
    expect(await c.vault.basketTickerHoldings(1, c.token.target)).to.equal(0);
  });

  it("A-02: rejects expired mint/redeem and insufficient net payout after a mature price fall", async () => {
    const c = await fixture(1_000_000n);
    await expect(c.vault.connect(c.user).mint(1, 100_000_000n, 1, 1)).to.be.revertedWithCustomError(c.vault, "Expired");
    await c.vault.connect(c.user).mint(1, 100_000_000n, ...LIMITS);
    const amount = await c.shares.balanceOf(c.user.address);
    const timestamp = (await ethers.provider.getBlock("latest")).timestamp;
    const pendingCalldata = c.vault.interface.encodeFunctionData("redeem(uint256,uint256,uint256,uint256)", [1, amount, 95_000_000n, LIMITS[1]]);
    const expiringCalldata = c.vault.interface.encodeFunctionData("redeem(uint256,uint256,uint256,uint256)", [1, amount, 1, timestamp + 60]);
    await c.token.mint(c.owner.address, 4n * 10n ** 25n);
    await c.token.approve(c.router.target, ethers.MaxUint256);
    await c.router.trade(c.pool.target, c.token0, 4n * 10n ** 25n);
    await advance(601);
    await c.router.provide(c.pool.target, 1);
    await expect(c.user.sendTransaction({to: c.vault.target, data: expiringCalldata})).to.be.revertedWithCustomError(c.vault, "Expired");
    await expect(c.user.sendTransaction({to: c.vault.target, data: pendingCalldata})).to.be.revertedWithCustomError(c.vault, "UserLimitNotMet");
    expect(await c.shares.balanceOf(c.user.address)).to.equal(amount);
    // A fresh explicit decision to accept the lower payout still permits exit.
    await c.vault.connect(c.user).redeem(1, amount, 45_000_000n, LIMITS[1]);
  });

  it("A-03: rejects a nonexistent execution pool before changing settings", async () => {
    const c = await fixture(1_000_000n);
    await c.vault.connect(c.user).mint(1, 100_000_000n, ...LIMITS);
    await expect(c.vault.updateTickerPoolV3(c.token.target, 10000)).to.be.revertedWithCustomError(c.validator, "InvalidExecutionPool");
    expect((await c.vault.tickerPoolsV3(c.token.target)).fee).to.equal(3000);
    await c.vault.connect(c.user).redeem(1, await c.shares.totalSupply(), ...LIMITS);
    const other = await deploy("LocalCryptoToken", 18);
    await expect(c.vault.setTickerPoolV3(other.target, 3000)).to.be.revertedWithCustomError(c.validator, "InvalidExecutionPool");
  });

  it("A-03: binds oracle and execution pools, including later registry reconfiguration", async () => {
    const c = await fixture(1_000_000n);
    await c.vault.connect(c.user).mint(1, 100_000_000n, ...LIMITS);
    await c.factory.createPool(c.token.target, c.usdg.target, 500);
    const otherPool: any = new ethers.Contract(await c.factory.getPool(c.token.target, c.usdg.target, 500), poolArtifact.abi, c.owner);
    await otherPool.initialize((await c.pool.slot0()).sqrtPriceX96);
    await otherPool.increaseObservationCardinalityNext(64);
    await c.router.provide(otherPool.target, L);
    await advance(601);
    await c.router.provide(otherPool.target, 1);
    await expect(c.vault.updateTickerPoolV3(c.token.target, 500)).to.be.revertedWithCustomError(c.validator, "OraclePoolMismatch");
    await c.registry.configureToken(c.token.target, {...c.params, pool: otherPool.target});
    await expect(c.vault.getBasketNavUsd(1)).to.be.revertedWithCustomError(c.validator, "OraclePoolMismatch");
    await c.vault.updateTickerPoolV3(c.token.target, 500);
    await c.vault.connect(c.user).redeem(1, await c.shares.totalSupply(), ...LIMITS);
  });

  it("deviation remains owner-configurable per token and is enforced after updates", async () => {
    const c = await fixture(1_000_000n);
    await c.registry.configureToken(c.token.target, {...c.params, maxDeviationBps: 10});
    await c.usdg.mint(c.owner.address, 500_000_000_000n);
    await c.usdg.approve(c.router.target, ethers.MaxUint256);
    await c.router.trade(c.pool.target, !c.token0, 500_000_000_000n);
    await expect(c.registry.quoteUsdg18(c.token.target)).to.be.revertedWithCustomError(c.registry, "ExcessiveDeviation");
    await expect(c.registry.connect(c.user).configureToken(c.token.target, c.params)).to.be.revertedWithCustomError(c.registry, "OwnableUnauthorizedAccount");
    await c.registry.configureToken(c.token.target, c.params);
    expect((await c.registry.tokenConfigurations(c.token.target)).maxDeviationBps).to.equal(500);
    expect((await c.registry.quoteUsdg18(c.token.target))[0]).to.be.gt(0);
  });
});
