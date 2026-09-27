import { expect } from "chai";
import { rejects } from "node:assert/strict";
import { network } from "hardhat";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const factoryArtifact = require("@uniswap/v3-core/artifacts/contracts/UniswapV3Factory.sol/UniswapV3Factory.json");
const poolArtifact = require("@uniswap/v3-core/artifacts/contracts/UniswapV3Pool.sol/UniswapV3Pool.json");
const L = 10n ** 20n;
const USDG = (n: number) => BigInt(n) * 10n ** 6n;
const FAR = (1n << 48n) - 1n;

/// User-basket V2 clones against a locally deployed StaxVaultV2 with one TWAP token (real V3 core)
/// and one Chainlink stock (V4 route through the configurable mock router).
describe("StaxUserBasketV2 — clones bound to V2, TWAP + Chainlink tickers", function () {
  this.timeout(120_000);
  let connection: any, ethers: any;
  before(async () => { connection = await network.create(); ethers = connection.ethers; });
  after(async () => { await connection.close(); });

  async function deploy(name: string, ...args: any[]) {
    const c: any = await (await ethers.getContractFactory(name)).deploy(...args); await c.waitForDeployment(); return c;
  }
  async function advance(s: number) { await ethers.provider.send("evm_increaseTime", [s]); await ethers.provider.send("evm_mine", []); }

  async function fixture() {
    const [owner, user, other, rewards, treasury] = await ethers.getSigners();
    const usdg = await deploy("MockERC20Decimals", "USDG", "USDG", 6);
    const crypto = await deploy("LocalCryptoToken", 18);
    const stock = await deploy("MockERC20Decimals", "STOCK", "STOCK", 18);
    const frz = await deploy("MockFreezableERC20", "FRZ", "FRZ", 18); // second TWAP token whose transfers can be frozen
    const permit = await deploy("MockPermit2");
    const v3Factory: any = await new ethers.ContractFactory(factoryArtifact.abi, factoryArtifact.bytecode, owner).deploy();
    await v3Factory.waitForDeployment();
    // One router serves both venues: LocalV3Flow executes real V3 swaps and forwards V4 commands to a rate mock.
    const router = await deploy("LocalV3Flow", v3Factory.target, permit.target);
    await usdg.mint(router.target, 10n ** 35n);
    const registry = await deploy("UnifiedTwapRegistry", owner.address, usdg.target, v3Factory.target);
    const scale = 10n ** 6n;
    async function twapPool(tok: any) {
      await v3Factory.createPool(tok.target, usdg.target, 3000);
      const p: any = new ethers.Contract(await v3Factory.getPool(tok.target, usdg.target, 3000), poolArtifact.abi, owner);
      const isToken0 = BigInt(tok.target) < BigInt(usdg.target);
      await p.initialize(isToken0 ? (2n ** 96n) / scale : (2n ** 96n) * scale); // 1 token = 1 USDG
      await p.increaseObservationCardinalityNext(64);
      await tok.mint(router.target, 10n ** 35n);
      await router.provide(p.target, L); await advance(601); await router.provide(p.target, 1);
      await registry.configureToken(tok.target, { pool: p.target, twapWindow: 600, maxObservationAge: 600,
        minCurrentLiquidity: 10n ** 18n, minHarmonicLiquidity: 10n ** 18n, maxDeviationBps: 500 });
      return { pool: p, isToken0 };
    }
    const { pool, isToken0: cryptoIsToken0 } = await twapPool(crypto);
    const { pool: frzPool } = await twapPool(frz);
    await router.provide(pool.target, 1); // second pool setup advanced time; refresh the first pool's observation
    const usdFeed = await deploy("MockPriceOracle", 100_000_000n, 8);
    const stockFeed = await deploy("MockPriceOracle", 100_000_000n, 8);
    const sequencer = await deploy("MockPriceOracle", 0, 8); await sequencer.setPriceAt(0, 1);
    const tokenDeployer = await deploy("StaxBasketTokenDeployer");
    const validator = await deploy("StaxV3RouteValidator", router.target, v3Factory.target, ethers.keccak256(poolArtifact.bytecode));
    const vault = await deploy("StaxVaultV2", owner.address, tokenDeployer.target, [[stock.target, stockFeed.target, 100_000]],
      rewards.address, treasury.address, router.target, permit.target, usdg.target, usdFeed.target, 100_000, sequencer.target, validator.target);
    await vault.setTickerPoolV3(crypto.target, 3000);
    await vault.setTwapOracle(crypto.target, registry.target, 200);
    await vault.setTickerPoolV3(frz.target, 3000);
    await vault.setTwapOracle(frz.target, registry.target, 200);
    // Stock executes on a V4 key; LocalV3Flow has no V4 leg in this fixture, so stock baskets are only used for registration checks.
    const [c0, c1] = [usdg.target, stock.target].sort((a: string, b: string) => BigInt(a) < BigInt(b) ? -1 : 1);
    await vault.setTickerPool(stock.target, c0, c1, 3000, 60, ethers.ZeroAddress);
    const unregistered = await deploy("MockERC20Decimals", "NOPE", "NOPE", 18);
    const factory = await deploy("StaxUserBasketFactoryV2", vault.target);
    const impl: any = await ethers.getContractAt("StaxUserBasketV2", await factory.implementation());
    for (const s of [user, other]) { await usdg.mint(s.address, USDG(1_000_000)); await usdg.connect(s).approve(factory.target, ethers.MaxUint256); }
    return { owner, user, other, rewards, treasury, usdg, crypto, frz, stock, unregistered, vault, impl, factory, registry, pool, frzPool, cryptoIsToken0, router };
  }

  async function create(c: any, tickers: string[], weights: number[], signer = c.user, name = "User basket", symbol = "UB") {
    const tx = await c.factory.connect(signer).createUserBasket(name, symbol, tickers, weights);
    const receipt = await tx.wait();
    const log = receipt.logs.map((l: any) => { try { return c.factory.interface.parseLog(l); } catch { return null; } }).find((l: any) => l?.name === "BasketCreated");
    const clone: any = await ethers.getContractAt("StaxUserBasketV2", log.args.clone);
    expect(log.args.token).to.equal(await clone.token());
    expect(log.args.symbol).to.equal(symbol);
    await c.usdg.connect(signer).approve(clone.target, ethers.MaxUint256);
    return clone;
  }
  const deadline = async () => BigInt((await ethers.provider.getBlock("latest")).timestamp + 600);

  it("implementation is bound to V2 and cannot be initialized directly", async () => {
    const c = await fixture();
    expect(await c.impl.mainVault()).to.equal(c.vault.target);
    expect(await c.impl.usdg()).to.equal(c.usdg.target);
    expect(await c.impl.DEPOSIT_CAP_USD()).to.equal(ethers.parseEther("25000"));
    await rejects(c.impl.initialize("x", "x", [c.crypto.target], [10000], c.user.address));
    expect(await c.impl.factory()).to.equal(c.factory.target);
    expect(await c.impl.treasury()).to.equal(c.treasury.address);
    // A hand-rolled clone of the implementation cannot be initialized outside the factory.
    const rogue: any = await deploy("MockClone", c.impl.target);
    const asBasket: any = await ethers.getContractAt("StaxUserBasketV2", await rogue.clone());
    await rejects(asBasket.initialize("x", "x", [c.crypto.target], [10000], c.user.address), /OnlyFactory/);
    // Fee destination follows the vault's treasury.
    await c.vault.setTreasury(c.other.address);
    const before = await c.usdg.balanceOf(c.other.address);
    await c.factory.connect(c.user).createUserBasket("t", "T", [c.crypto.target], [10000]);
    expect(await c.usdg.balanceOf(c.other.address) - before).to.equal(USDG(2));
    await c.vault.setTreasury(c.treasury.address);
  });

  it("creates a TWAP-token basket, charges the $2 fee, mints and redeems with user bounds", async () => {
    const c = await fixture();
    const treasuryBefore = await c.usdg.balanceOf(c.treasury.address);
    const clone = await create(c, [c.crypto.target], [10000]);
    expect(await c.usdg.balanceOf(c.treasury.address) - treasuryBefore).to.equal(USDG(2));
    expect(await clone.creator()).to.equal(c.user.address);
    const shares: any = await ethers.getContractAt("StaxUserBasketToken", await clone.token());
    expect(await shares.symbol()).to.equal("UB");

    await rejects(clone.connect(c.user).mint(USDG(100), 0n, await deadline()), /UserLimitNotMet/);
    await rejects(clone.connect(c.user).mint(USDG(100), 1n, 1n), /Expired/);
    await rejects(clone.connect(c.user).mint(USDG(100), ethers.parseEther("1000000"), await deadline()), /UserLimitNotMet/);

    await clone.connect(c.user).mint(USDG(100), 1n, await deadline());
    const minted = await shares.balanceOf(c.user.address);
    expect(minted > 0n).to.equal(true);
    expect(await clone.basketTickerHoldings(c.crypto.target) > 0n).to.equal(true);
    const nav = await clone.getBasketNavUsd();
    expect(nav > ethers.parseEther("95") && nav < ethers.parseEther("100")).to.equal(true);
    // Fee routing: burn share is tracked and paid to treasury; rewards share separate.
    const fee = USDG(100) * 25n / 10000n;
    expect(await clone.pendingRewardsPool()).to.equal(fee * 3000n / 10000n);
    expect(await clone.pendingBuyBurnInformational()).to.equal(fee - fee * 3000n / 10000n - fee * 2000n / 10000n);
    expect(await clone.pendingTreasuryFees()).to.equal(fee - fee * 3000n / 10000n);

    await rejects(clone.connect(c.user).redeem(minted, USDG(1_000_000), await deadline()), /UserLimitNotMet/);
    await rejects(clone.connect(c.user).redeem(minted, 1n, 1n), /Expired/);
    const before = await c.usdg.balanceOf(c.user.address);
    await clone.connect(c.user).redeem(minted, 1n, await deadline());
    const back = await c.usdg.balanceOf(c.user.address) - before;
    expect(back > USDG(95) && back < USDG(100)).to.equal(true);
    expect(await shares.totalSupply()).to.equal(0n);
    expect(await clone.basketTickerHoldings(c.crypto.target)).to.equal(0n);
    await clone.claimTreasuryFees(); await clone.claimRewardsPool();
    await rejects(clone.claimTreasuryFees(), /NothingToClaim/);
  });

  it("accepts Chainlink and TWAP tickers, rejects unregistered ones, duplicates and bad weights", async () => {
    const c = await fixture();
    await create(c, [c.stock.target, c.crypto.target], [5000, 5000]); // registration check only
    // Unpriceable-at-creation ticker (stale TWAP) is rejected, and the fee is refunded by the revert.
    await advance(700);
    await rejects(c.factory.connect(c.user).createUserBasket("x", "x", [c.crypto.target], [10000]));
    await c.router.provide(c.pool.target, 1); // fresh observation
    await rejects(c.factory.connect(c.user).createUserBasket("x", "x", [c.unregistered.target], [10000]), /TickerNotRegisteredOnMainVault/);
    await rejects(c.factory.connect(c.user).createUserBasket("x", "x", [c.usdg.target], [10000]), /TickerNotRegisteredOnMainVault/);
    await rejects(c.factory.connect(c.user).createUserBasket("x", "x", [c.crypto.target, c.crypto.target], [5000, 5000]), /DuplicateTicker/);
    await rejects(c.factory.connect(c.user).createUserBasket("x", "x", [c.crypto.target], [9999]), /WeightsSumMismatch/);
    await rejects(c.factory.connect(c.user).createUserBasket("x", "x", [], []), /EmptyBasket/);
    await rejects(c.factory.connect(c.user).createUserBasket("x", "x", [c.crypto.target], [5000, 5000]), /LengthMismatch/);
    // A failed create must not charge the fee.
    const t = await c.usdg.balanceOf(c.treasury.address);
    await rejects(c.factory.connect(c.user).createUserBasket("x", "x", [c.unregistered.target], [10000]));
    expect(await c.usdg.balanceOf(c.treasury.address)).to.equal(t);
  });

  it("enforces the 25k USD cap and follows the vault's per-ticker slippage", async () => {
    const c = await fixture();
    const clone = await create(c, [c.crypto.target], [10000]);
    await rejects(clone.connect(c.user).mint(USDG(30_000), 1n, await deadline()), /ExceedsVaultCap/);
    await clone.connect(c.user).mint(USDG(20_000), 1n, await deadline());
    await c.usdg.connect(c.other).approve(clone.target, ethers.MaxUint256);
    await rejects(clone.connect(c.other).mint(USDG(6_000), 1n, await deadline()), /ExceedsVaultCap/);
    // Vault owner tightening slippage to 1 bps makes the clone's swap floor unreachable on this pool.
    await c.vault.setTickerSlippage(c.crypto.target, 1);
    await rejects(clone.connect(c.other).mint(USDG(1_000), 1n, await deadline()));
    await c.vault.setTickerSlippage(c.crypto.target, 300);
    await clone.connect(c.other).mint(USDG(1_000), 1n, await deadline());
  });

  it("stops pricing when the vault's oracle for a ticker fails (stale TWAP), but redeemInKind still exits", async () => {
    const c = await fixture();
    const clone = await create(c, [c.crypto.target], [10000]);
    await clone.connect(c.user).mint(USDG(100), 1n, await deadline());
    const shares: any = await ethers.getContractAt("StaxUserBasketToken", await clone.token());
    const held = await clone.basketTickerHoldings(c.crypto.target);
    await advance(700); // beyond maxObservationAge with no new observation
    await rejects(clone.getBasketNavUsd());
    await rejects(clone.connect(c.user).mint(USDG(100), 1n, await deadline()));
    await rejects(clone.connect(c.user).redeem(await shares.balanceOf(c.user.address), 1n, await deadline()));
    // Oracle-free exit: burns shares, pays the underlying tokens pro rata, no fee.
    const before = await c.crypto.balanceOf(c.user.address);
    const feesBefore = await clone.pendingTreasuryFees();
    await clone.connect(c.user).redeemInKind(await shares.balanceOf(c.user.address), c.user.address);
    expect(await c.crypto.balanceOf(c.user.address) - before).to.equal(held);
    expect(await clone.owedInKind(c.user.address, c.crypto.target)).to.equal(0n);
    expect(await shares.totalSupply()).to.equal(0n);
    expect(await clone.basketTickerHoldings(c.crypto.target)).to.equal(0n);
    expect(await clone.pendingTreasuryFees()).to.equal(feesBefore);
    await rejects(clone.connect(c.user).redeemInKind(1n, c.user.address), /RedeemAmountTooSmall/);
    await rejects(clone.connect(c.user).redeemInKind(USDG(1), ethers.ZeroAddress), /ZeroAddress/);
  });

  it("rejects a mint leg that returns more tokens than oracle + slippage (lagging oracle arbitrage)", async () => {
    const c = await fixture();
    const clone = await create(c, [c.crypto.target], [10000]);
    await clone.connect(c.user).mint(USDG(100), 1n, await deadline());
    // Push spot ~3% below the 600s TWAP by selling crypto into the pool (within the registry's 5% deviation limit).
    await c.crypto.mint(c.other.address, 10n ** 25n);
    await c.crypto.connect(c.other).approve(c.router.target, ethers.MaxUint256);
    await c.router.connect(c.other).trade(c.pool.target, c.cryptoIsToken0, 16n * 10n ** 23n);
    await rejects(clone.connect(c.user).mint(USDG(100), 1n, await deadline()), /SwapAboveOracle/);
    // Once the TWAP window has caught up with the new price the mint is accepted again.
    await advance(601); await c.router.provide(c.pool.target, 1);
    await clone.connect(c.user).mint(USDG(100), 1n, await deadline());
  });

  it("redeemInKind pays a receiver per leg; a frozen leg stays owed and is pulled with withdrawInKind", async () => {
    const c = await fixture();
    const clone = await create(c, [c.crypto.target, c.frz.target], [5000, 5000]);
    await clone.connect(c.user).mint(USDG(100), 1n, await deadline());
    const shares: any = await ethers.getContractAt("StaxUserBasketToken", await clone.token());
    const heldCrypto = await clone.basketTickerHoldings(c.crypto.target), heldFrz = await clone.basketTickerHoldings(c.frz.target);
    await c.frz.setFrozen(c.other.address, true);
    // Exit to a different receiver while its FRZ transfers revert: crypto arrives, FRZ is recorded as owed.
    await clone.connect(c.user).redeemInKind(await shares.balanceOf(c.user.address), c.other.address);
    expect(await shares.totalSupply()).to.equal(0n);
    expect(await c.crypto.balanceOf(c.other.address)).to.equal(heldCrypto);
    expect(await c.frz.balanceOf(c.other.address)).to.equal(0n);
    expect(await clone.owedInKind(c.other.address, c.frz.target)).to.equal(heldFrz);
    expect(await clone.owedInKind(c.other.address, c.crypto.target)).to.equal(0n);
    expect(await clone.basketTickerHoldings(c.frz.target)).to.equal(0n);
    expect(await c.frz.balanceOf(clone.target)).to.equal(heldFrz);
    await rejects(clone.connect(c.other).withdrawInKind(c.frz.target), /InKindTransferFailed/);
    await rejects(clone.connect(c.user).withdrawInKind(c.frz.target), /NothingOwed/);
    await c.frz.setFrozen(c.other.address, false);
    await clone.connect(c.other).withdrawInKind(c.frz.target);
    expect(await c.frz.balanceOf(c.other.address)).to.equal(heldFrz);
    expect(await clone.owedInKind(c.other.address, c.frz.target)).to.equal(0n);
    await rejects(clone.connect(c.other).withdrawInKind(c.frz.target), /NothingOwed/);
  });

  it("redeemInKind is pro rata across holders and mixes with normal redeem consistently", async () => {
    const c = await fixture();
    const clone = await create(c, [c.crypto.target], [10000]);
    await c.usdg.connect(c.other).approve(clone.target, ethers.MaxUint256);
    await clone.connect(c.user).mint(USDG(300), 1n, await deadline());
    await clone.connect(c.other).mint(USDG(100), 1n, await deadline());
    const shares: any = await ethers.getContractAt("StaxUserBasketToken", await clone.token());
    const supply = await shares.totalSupply(), held = await clone.basketTickerHoldings(c.crypto.target);
    const otherShares = await shares.balanceOf(c.other.address);
    const before = await c.crypto.balanceOf(c.other.address);
    await clone.connect(c.other).redeemInKind(otherShares, c.other.address);
    const got = await c.crypto.balanceOf(c.other.address) - before;
    expect(got).to.equal(held * otherShares / supply);
    expect(await clone.basketTickerHoldings(c.crypto.target)).to.equal(held - got);
    // Remaining holder can still exit normally, ledger returns to zero.
    await clone.connect(c.user).redeem(await shares.balanceOf(c.user.address), 1n, await deadline());
    expect(await shares.totalSupply()).to.equal(0n);
    expect(await clone.basketTickerHoldings(c.crypto.target)).to.equal(0n);
  });
});
