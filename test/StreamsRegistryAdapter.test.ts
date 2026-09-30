import { expect } from "chai";
import { network } from "hardhat";

// Unit test for StreamsRegistryAdapter against a mock verifier. Real reports need Chainlink
// Data Streams API credentials; here we build v8/v11 report bytes ourselves and let the mock
// verifier "accept" them, so the adapter's own logic (schema decode, freshness, market status,
// USDG conversion, ordering, rejection) is what gets tested.
describe("StreamsRegistryAdapter", function () {
  this.timeout(120_000);
  let connection: any; let ethers: any;
  before(async () => { connection = await network.create(); ethers = connection.ethers; });
  after(async () => { await connection?.close?.(); });

  async function deploy(name: string, ...args: any[]) {
    const c: any = await (await ethers.getContractFactory(name)).deploy(...args); await c.waitForDeployment(); return c;
  }
  async function now(): Promise<number> { return (await ethers.provider.getBlock("latest")).timestamp; }
  async function advance(s: number) { await ethers.provider.send("evm_increaseTime", [s]); await ethers.provider.send("evm_mine", []); }

  const abi = () => ethers.AbiCoder.defaultAbiCoder();
  // feedId's first two bytes are the schema version
  const feedIdFor = (version: number, tag: string) =>
    ethers.zeroPadBytes(ethers.concat([ethers.toBeHex(version, 2), ethers.keccak256(ethers.toUtf8Bytes(tag)).slice(0, 62)]), 32);

  function reportV8(feedId: string, mid: bigint, observedAt: number, status: number, expiresAt: number) {
    const data = abi().encode(
      ["bytes32", "uint32", "uint32", "uint192", "uint192", "uint32", "uint64", "int192", "uint32"],
      [feedId, observedAt, observedAt, 0, 0, expiresAt, BigInt(observedAt) * 1_000_000_000n, mid, status]);
    return abi().encode(["bytes32[3]", "bytes"], [[ethers.ZeroHash, ethers.ZeroHash, ethers.ZeroHash], data]);
  }
  function reportV11(feedId: string, mid: bigint, observedAt: number, status: number, expiresAt: number) {
    const data = abi().encode(
      ["bytes32", "uint32", "uint32", "uint192", "uint192", "uint32", "int192", "uint64", "int192", "int192", "int192", "int192", "int192", "uint32"],
      [feedId, observedAt, observedAt, 0, 0, expiresAt, mid, BigInt(observedAt) * 1_000_000_000n, mid - 1n, 0, mid + 1n, 0, mid, status]);
    return abi().encode(["bytes32[3]", "bytes"], [[ethers.ZeroHash, ethers.ZeroHash, ethers.ZeroHash], data]);
  }

  const MASK_24_5_OPEN = (1 << 1) | (1 << 2) | (1 << 3) | (1 << 4); // pre, regular, post, overnight (v11 24/5)
  const MASK_V8_OPEN = 1 << 2;

  it("prices a v8 report, converts to USDG terms, and enforces freshness / status / ordering / rejection", async () => {
    const [owner, other] = await ethers.getSigners();
    const usdg = await deploy("MockERC20Decimals", "USDG", "USDG", 6);
    const nflx = await deploy("MockERC20Decimals", "Netflix", "NFLX", 18);
    const usdgUsd = await deploy("MockPriceOracle", 99_900_000n, 8); // $0.999
    const verifier = await deploy("MockStreamsVerifier");
    const adapter = await deploy("StreamsRegistryAdapter", await verifier.getAddress(), await usdg.getAddress(), await usdgUsd.getAddress(), 97_200);

    const pool = ethers.Wallet.createRandom().address;
    const feedId = feedIdFor(8, "NFLX/USD");
    await adapter.setToken(await nflx.getAddress(), feedId, pool, 900, MASK_V8_OPEN);

    // registry surface the vault's route validator checks
    expect(await adapter.usdg()).to.equal(await usdg.getAddress());
    expect(await adapter.usdgDecimals()).to.equal(6n);
    expect(await adapter.tokenDecimals(await nflx.getAddress())).to.equal(18n);
    expect(await adapter.poolFor(await nflx.getAddress())).to.equal(pool);

    // nothing stored yet -> stale
    await expect(adapter.quoteUsdg18(await nflx.getAddress())).to.be.revertedWithCustomError(adapter, "StaleStreamPrice");

    // anyone can post a verified report
    const t = await now();
    const mid = ethers.parseUnits("1200.50", 18);
    await adapter.connect(other).update(reportV8(feedId, mid, t, 2, t + 600));
    const [q, liq] = await adapter.quoteUsdg18(await nflx.getAddress());
    // $1200.50 / 0.999 USDG per USD
    expect(q).to.equal((mid * 10n ** 18n) / ethers.parseUnits("0.999", 18));
    expect(liq).to.equal((1n << 128n) - 1n);
    expect(await adapter.isFresh(await nflx.getAddress())).to.equal(true);

    // an older report cannot overwrite a newer one
    await expect(adapter.update(reportV8(feedId, mid, t - 10, 2, t + 600))).to.be.revertedWithCustomError(adapter, "ReportOlderThanStored");
    // an expired report is refused
    await expect(adapter.update(reportV8(feedId, mid, t + 1, 2, t - 1))).to.be.revertedWithCustomError(adapter, "ReportExpired");
    // unknown feed
    await expect(adapter.update(reportV8(feedIdFor(8, "PFE/USD"), mid, t + 1, 2, t + 600))).to.be.revertedWithCustomError(adapter, "UnknownFeed");
    // zero price
    await expect(adapter.update(reportV8(feedId, 0n, t + 1, 2, t + 600))).to.be.revertedWithCustomError(adapter, "InvalidPrice");
    // verifier rejects -> nothing stored
    await verifier.setRejectAll(true);
    await expect(adapter.update(reportV8(feedId, mid * 2n, t + 2, 2, t + 600))).to.be.revertedWith("MockVerifier: bad signature");
    await verifier.setRejectAll(false);
    expect((await adapter.prices(await nflx.getAddress())).usd18).to.equal(mid);

    // market closed -> quote refuses, even though the price is fresh
    await adapter.update(reportV8(feedId, mid, t + 3, 1, t + 600));
    await expect(adapter.quoteUsdg18(await nflx.getAddress())).to.be.revertedWithCustomError(adapter, "MarketStatusNotAllowed");
    await adapter.update(reportV8(feedId, mid, t + 4, 2, t + 600));

    // freshness window
    await advance(901);
    await expect(adapter.quoteUsdg18(await nflx.getAddress())).to.be.revertedWithCustomError(adapter, "StaleStreamPrice");
    expect(await adapter.isFresh(await nflx.getAddress())).to.equal(false);

    // stale USDG/USD feed blocks quoting too
    const t2 = await now();
    await adapter.update(reportV8(feedId, mid, t2, 2, t2 + 600));
    await usdgUsd.setPriceAt(99_900_000n, t2 - 200_000);
    await expect(adapter.quoteUsdg18(await nflx.getAddress())).to.be.revertedWithCustomError(adapter, "StaleUsdgFeed");

    // only owner configures
    await expect(adapter.connect(other).setToken(await nflx.getAddress(), feedId, pool, 900, MASK_V8_OPEN)).to.be.revertedWithCustomError(adapter, "NotOwner");
    void owner;
  });

  it("decodes v11 (24/5 equities) and honours the status mask", async () => {
    const usdg = await deploy("MockERC20Decimals", "USDG", "USDG", 6);
    const amc = await deploy("MockERC20Decimals", "AMC", "AMC", 18);
    const usdgUsd = await deploy("MockPriceOracle", 100_000_000n, 8);
    const verifier = await deploy("MockStreamsVerifier");
    const adapter = await deploy("StreamsRegistryAdapter", await verifier.getAddress(), await usdg.getAddress(), await usdgUsd.getAddress(), 97_200);
    const feedId = feedIdFor(11, "AMC/USD");
    await adapter.setToken(await amc.getAddress(), feedId, ethers.Wallet.createRandom().address, 900, MASK_24_5_OPEN);

    const t = await now();
    const mid = ethers.parseUnits("3.21", 18);
    await adapter.update(reportV11(feedId, mid, t, 4, t + 600)); // overnight session
    const [q] = await adapter.quoteUsdg18(await amc.getAddress());
    expect(q).to.equal(mid); // USDG/USD = 1.00

    await adapter.update(reportV11(feedId, mid, t + 1, 5, t + 600)); // closed
    await expect(adapter.quoteUsdg18(await amc.getAddress())).to.be.revertedWithCustomError(adapter, "MarketStatusNotAllowed");

    // unsupported schema version is refused before anything is stored
    const bad = feedIdFor(3, "AMC/USD");
    await adapter.setToken(await amc.getAddress(), bad, ethers.Wallet.createRandom().address, 900, MASK_24_5_OPEN);
    await expect(adapter.update(reportV8(bad, mid, t + 2, 2, t + 600))).to.be.revertedWithCustomError(adapter, "UnsupportedSchema");
  });
});
