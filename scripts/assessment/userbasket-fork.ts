// Fork test: deploy StaxUserBasketV2 + factory against the LIVE V2 vault on a local Robinhood fork,
// create user baskets from registered tickers, and run real-router mint/redeem round trips,
// including concentrated weights (the adversarial review's open item). Nothing is broadcast.
// Usage: npx hardhat run scripts/assessment/userbasket-fork.ts   (STAX_RPC_URL optional)
import { network } from "hardhat";
import { readFile, writeFile, mkdir } from "node:fs/promises";
const manifest = JSON.parse(await readFile(new URL("../../reports/mainnet-v2-deployment/deployment.json", import.meta.url), "utf8"));
const VAULT = manifest.contracts.find((c: any) => c.name === "StaxVaultV2").address;
const TICKERS: Record<string, string> = {
  GME: "0x1b0E319c6A659F002271B69dB8A7df2F911c153E", PLTR: "0x894E1EC2D74FFE5AEF8Dc8A9e84686acCB964F2A",
  CRCL: "0xdF0992E440dD0be65BD8439b609d6D4366bf1CB5", AMC: "0x05a3d1cd21d0c88145e82600e62e7e496e0f222b",
  NFLX: "0xE0444EF8BF4eD74f74FD73686e2ddF4C1c5591E8", SPY: "0x117cc2133c37B721F49dE2A7a74833232B3B4C0C",
  QQQ: "0xD5f3879160bc7c32ebb4dC785F8a4F505888de68",
};
const SIZES = [10, 100, 1000, 5000];
const rpc = process.env.STAX_RPC_URL ?? "https://rpc.mainnet.chain.robinhood.com";
const connection = await network.create({ network: "robinhoodMainnetFork", override: { forking: { url: rpc } } });
const { ethers } = connection;
const out: any = { vault: VAULT, mode: "LOCAL_FORK_ONLY", baskets: [], caveat: "Synthetic USDG funding; real pool state at fork block. Not a listing approval." };
const dir = new URL("../../reports/userbasket-fork/", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
await mkdir(dir, { recursive: true });
const save = () => writeFile(`${dir}/results-${out.blockNumber}.json`, JSON.stringify(out, null, 2) + "\n");
try {
  out.blockNumber = await ethers.provider.getBlockNumber();
  await ethers.provider.send("evm_mine", []);
  const [deployer, user] = await ethers.getSigners();
  const vault: any = await ethers.getContractAt("StaxVaultV2", VAULT);
  const usdgAddr = await vault.usdg(), rewards = await vault.rewardsPool(), treasury = await vault.treasury();
  const usd: any = await ethers.getContractAt(["function balanceOf(address) view returns(uint256)", "function approve(address,uint256) returns(bool)"], usdgAddr, user);
  // Fund the tester by locating the USDG balance slot (restoring any non-matching slot).
  const balance = 1_000_000n * 10n ** 6n; let funded = false;
  for (let slot = 0; slot < 64 && !funded; slot++) {
    const key = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["address", "uint256"], [user.address, slot]));
    const old = await ethers.provider.getStorage(usdgAddr, key);
    await ethers.provider.send("hardhat_setStorageAt", [usdgAddr, key, ethers.toBeHex(balance, 32)]);
    if (await usd.balanceOf(user.address) === balance) funded = true; else await ethers.provider.send("hardhat_setStorageAt", [usdgAddr, key, old]);
  }
  if (!funded) throw Error("Could not fund tester");
  // Registered tickers only (live V2 state decides).
  const registered: Record<string, string> = {}; out.unpriceable = [];
  for (const [sym, addr] of Object.entries(TICKERS)) {
    if (Number((await vault.oracleSettings(addr)).oracleType) === 0) continue;
    // A ticker whose vault price reverts at the fork block (e.g. TWAP liquidity floor) would block every basket containing it.
    try { await vault.getOraclePriceUsd18(addr); registered[sym] = addr; }
    catch (e: any) { out.unpriceable.push({ sym, addr, error: (e.shortMessage ?? e.message).slice(0, 120) }); }
  }
  out.registered = Object.keys(registered);
  console.log("registered & priceable:", out.registered, "| unpriceable now:", out.unpriceable.map((u: any) => u.sym));
  const factory: any = await (await ethers.getContractFactory("StaxUserBasketFactoryV2", deployer)).deploy(VAULT, { gasLimit: 8_000_000 }); await factory.waitForDeployment();
  const impl: any = await ethers.getContractAt("StaxUserBasketV2", await factory.implementation());
  void rewards; void treasury;
  out.implementationRuntimeBytes = (await ethers.provider.getCode(impl.target)).length / 2 - 1;
  await (await usd.approve(factory.target, ethers.MaxUint256)).wait();
  const syms = Object.keys(registered);
  const equal = syms.map(() => Math.floor(10000 / syms.length)); equal[0] += 10000 - equal.reduce((a, b) => a + b, 0);
  const plans: { name: string; tickers: string[]; weights: number[] }[] = [{ name: `equal-${syms.join("-")}`, tickers: syms.map(s => registered[s]), weights: equal }];
  for (const s of syms) {
    const others = syms.filter(x => x !== s);
    if (!others.length) continue;
    const w = [9000, ...others.map(() => Math.floor(1000 / others.length))]; w[1] += 1000 - w.slice(1).reduce((a, b) => a + b, 0);
    plans.push({ name: `90pct-${s}`, tickers: [registered[s], ...others.map(o => registered[o])], weights: w });
  }
  const baseline = await ethers.provider.send("evm_snapshot", []);
  for (const plan of plans) {
    await ethers.provider.send("evm_revert", [baseline]); await ethers.provider.send("evm_snapshot", []);
    const row: any = { ...plan, rounds: [] };
    try {
      const tx = await factory.connect(user).createUserBasket(plan.name, "UB", plan.tickers, plan.weights, { gasLimit: 6_000_000 });
      const rc = await tx.wait();
      const log = rc.logs.map((l: any) => { try { return factory.interface.parseLog(l); } catch { return null; } }).find((l: any) => l?.name === "BasketCreated");
      const clone: any = await ethers.getContractAt("StaxUserBasketV2", log.args.clone, user);
      const shares: any = await ethers.getContractAt("StaxUserBasketToken", await clone.token(), user);
      await (await usd.approve(clone.target, ethers.MaxUint256)).wait();
      row.clone = clone.target; row.createGas = String(rc.gasUsed);
      for (const size of SIZES) {
        const snap = await ethers.provider.send("evm_snapshot", []);
        const amount = BigInt(size) * 10n ** 6n, deadline = (await ethers.provider.getBlock("latest"))!.timestamp + 600;
        let stage = "mint";
        try {
          const start = await usd.balanceOf(user.address);
          const m = await (await clone.mint(amount, 1n, deadline, { gasLimit: 6_000_000 })).wait();
          stage = "redeem";
          const r = await (await clone.redeem(await shares.balanceOf(user.address), 1n, deadline, { gasLimit: 6_000_000 })).wait();
          const returned = await usd.balanceOf(user.address) - (start - amount);
          if (await shares.totalSupply() !== 0n) throw Error("Residual supply");
          row.rounds.push({ usdg: size, status: "ROUND_TRIP_PASS", lossPct: (1 - Number(returned) / Number(amount)) * 100, mintGas: String(m.gasUsed), redeemGas: String(r.gasUsed) });
        } catch (e: any) { row.rounds.push({ usdg: size, status: "REVERT", stage, error: (e.shortMessage ?? e.message).slice(0, 160) }); }
        await ethers.provider.send("evm_revert", [snap]);
      }
      // In-kind exit on live state: mint $1k, redeemInKind, every leg's tokens must arrive and the ledger must clear.
      try {
        const snap = await ethers.provider.send("evm_snapshot", []);
        const amount = 1000n * 10n ** 6n, deadline = (await ethers.provider.getBlock("latest"))!.timestamp + 600;
        await (await clone.mint(amount, 1n, deadline, { gasLimit: 6_000_000 })).wait();
        const befores = await Promise.all(plan.tickers.map(async t => (await ethers.getContractAt("MockERC20", t, user) as any).balanceOf(user.address)));
        const r = await (await clone.redeemInKind(await shares.balanceOf(user.address), user.address, { gasLimit: 6_000_000 })).wait();
        const received = await Promise.all(plan.tickers.map(async (t, i) => String((await (await ethers.getContractAt("MockERC20", t, user) as any).balanceOf(user.address)) - befores[i])));
        const ledgerClear = (await Promise.all(plan.tickers.map(t => clone.basketTickerHoldings(t)))).every((h: bigint) => h === 0n);
        const owed = await Promise.all(plan.tickers.map(t => clone.owedInKind(user.address, t)));
        const allPaid = received.every((x: string) => x !== "0") && owed.every((o: bigint) => o === 0n);
        row.inKind = { status: ledgerClear && allPaid ? "PASS" : ledgerClear ? "LEG_NOT_PAID" : "LEDGER_NOT_CLEAR", receivedRaw: received, gas: String(r.gasUsed) };
        await ethers.provider.send("evm_revert", [snap]);
      } catch (e: any) { row.inKind = { status: "REVERT", error: (e.shortMessage ?? e.message).slice(0, 160) }; }
    } catch (e: any) { row.status = "CREATE_FAILED"; row.error = (e.shortMessage ?? e.message).slice(0, 200); }
    out.baskets.push(row); console.log(JSON.stringify(row)); await save();
  }
} catch (e: any) { out.error = e.shortMessage ?? e.message; console.error("Fork test stopped:", out.error); process.exitCode = 1; }
finally { await save(); await connection.close(); }
