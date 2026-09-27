import { expect } from "chai";
import { rejects } from "node:assert/strict";
import { network } from "hardhat";
import { createRequire } from "node:module";
import { buildPlan, validateConfig } from "../scripts/onboarding/plan-token.ts";
import { onboardAddress } from "../scripts/onboarding/onboard-token.ts";
import { discoverWithoutVault } from "../scripts/onboarding/discover-token.ts";
import {executeListing,executeBasketListing} from "../scripts/onboarding/broadcast-token.ts";

const require = createRequire(import.meta.url);
const factoryArtifact = require("@uniswap/v3-core/artifacts/contracts/UniswapV3Factory.sol/UniswapV3Factory.json");
const poolArtifact = require("@uniswap/v3-core/artifacts/contracts/UniswapV3Pool.sol/UniswapV3Pool.json");
const LIMITS = [1n, (1n << 48n) - 1n] as const;
const L = 10n ** 20n;
const DEPOSIT = 100_000_000n; // 100 USDG, 6 decimals.

describe("V2 local flow — real V3 core, simulated assets and router connector", function () {
  this.timeout(120_000);
  let connection: any;
  let ethers: any;
  before(async () => { connection = await network.create(); ethers = connection.ethers; });
  after(async () => { await connection.close(); });

  async function deploy(name: string, ...args: any[]) {
    const f = await ethers.getContractFactory(name);
    const c: any = await f.deploy(...args);
    await c.waitForDeployment();
    return c;
  }
  async function advance(seconds: number) {
    await ethers.provider.send("evm_increaseTime", [seconds]);
    await ethers.provider.send("evm_mine", []);
  }
  async function fixture(stock = false, decimals = 18, history = true) {
    const [owner, user, other, rewards, treasury] = await ethers.getSigners();
    const usdg = await deploy("MockERC20Decimals", "USDG", "USDG", 6);
    const token = stock
      ? await deploy("MockERC20Decimals", "STOCK", "STOCK", decimals)
      : await deploy("LocalCryptoToken", decimals);
    const permit = await deploy("MockPermit2");
    const factory: any = await new ethers.ContractFactory(factoryArtifact.abi, factoryArtifact.bytecode, owner).deploy();
    await factory.waitForDeployment();
    await factory.createPool(token.target, usdg.target, 3000);
    const poolAddress = await factory.getPool(token.target, usdg.target, 3000);
    const pool: any = new ethers.Contract(poolAddress, poolArtifact.abi, owner);
    const token0 = BigInt(token.target) < BigInt(usdg.target);
    // Exactly $1 at initialization (up to integer sqrt rounding), independent of oracle math.
    const scale = 10n ** BigInt((decimals - 6) / 2);
    await pool.initialize(token0 ? (2n ** 96n) / scale : (2n ** 96n) * scale);
    await pool.increaseObservationCardinalityNext(64);
    const router = await deploy("LocalV3Flow", factory.target, permit.target);
    await usdg.mint(router.target, 10n ** 35n);
    await token.mint(router.target, 10n ** 35n);
    await router.provide(pool.target, L);
    if (history) { await advance(601); await router.provide(pool.target, 1); }
    const registry = await deploy("UnifiedTwapRegistry", owner.address, usdg.target, factory.target);
    const params = { pool: pool.target, twapWindow: 600, maxObservationAge: 600,
      minCurrentLiquidity: 10n ** 18n, minHarmonicLiquidity: 10n ** 18n, maxDeviationBps: 500 };
    if (history) await registry.configureToken(token.target, params);
    const usdFeed = await deploy("MockPriceOracle", 100_000_000n, 8);
    const stockFeed = await deploy("MockPriceOracle", 100_000_000n, 8);
    const sequencer = await deploy("MockPriceOracle", 0, 8);
    await sequencer.setPriceAt(0, 1);
    const tokenDeployer = await deploy("StaxBasketTokenDeployer");
    const legacy = stock ? [[token.target, stockFeed.target, 100_000]] : [];
    const validator = await deploy("StaxV3RouteValidator", router.target, factory.target, ethers.keccak256(poolArtifact.bytecode));
    const deploymentArgs = [owner.address, tokenDeployer.target, legacy, rewards.address, treasury.address,
      router.target, permit.target, usdg.target, usdFeed.target, 100_000, sequencer.target, validator.target];
    const vault = await deploy("StaxVaultV2", ...deploymentArgs);
    await vault.setTickerPoolV3(token.target, 3000);
    if (!stock && history) await vault.setTwapOracle(token.target, registry.target, 200);
    await usdg.mint(user.address, DEPOSIT * 1000n);
    await usdg.mint(other.address, DEPOSIT * 1000n);
    await usdg.connect(user).approve(vault.target, ethers.MaxUint256);
    await usdg.connect(other).approve(vault.target, ethers.MaxUint256);
    return { owner, user, other, rewards, treasury, usdg, token, permit, factory, pool, token0,
      router, registry, params, usdFeed, stockFeed, sequencer, tokenDeployer, deploymentArgs, vault, validator };
  }
  async function basket(c: any, id = 1) {
    await c.vault.createBasket(id, "Local basket", "LOCAL", [c.token.target], [10000], 10n ** 27n, 10n ** 25n);
    const b = await c.vault.baskets(id);
    return await ethers.getContractAt("StaxBasketToken", b.token);
  }
  async function mint(c: any, id = 1, amount = DEPOSIT, user = c.user) {
    await c.vault.connect(user).mint(id, amount, ...LIMITS);
  }
  async function liabilities(c: any) {
    return await c.vault.pendingBuyBurn() + await c.vault.pendingRewardsPool() + await c.vault.pendingTreasuryFees();
  }

  async function onboarding(stock = false) {
    const c = await fixture(stock);
    const args = [...c.deploymentArgs]; args[2] = [];
    const vault = await deploy("StaxVaultV2", ...args);
    if (!stock) await c.registry.removeToken(c.token.target);
    const config: any = {
      chainId: Number((await ethers.provider.getNetwork()).chainId), vault: vault.target,
      expectedVaultCodeHash: ethers.keccak256(await ethers.provider.getCode(vault.target)), expectedOwner: c.owner.address,
      usdg: c.usdg.target, expectedUsdgDecimals: 6, token: c.token.target, expectedTokenDecimals: 18,
      router: c.router.target, factory: c.factory.target, poolInitCodeHash: ethers.keccak256(poolArtifact.bytecode),
      pool: c.pool.target, fee: 3000, slippageBps: 200,
      oracle: stock ? {type: "CHAINLINK", feed: c.stockFeed.target, maxStaleness: 100_000}
        : {type: "TWAP", registry: c.registry.target, expectedRegistryOwner: c.owner.address,
          safety: {twapWindow: 600, maxObservationAge: 600, minCurrentLiquidity: "1000000000000000000",
            minHarmonicLiquidity: "1000000000000000000", maxDeviationBps: 500}},
      review: {tokenBehavior: "local fixture", routerDeployment: "local fixture", roundTripFork: "local test, NOT production approval",
        chainlinkFeedSearch: "local fixture", riskParameters: "local test settings, NOT production approval"},
    };
    return {...c, vault, config};
  }

  it("broadcaster dry-runs, resumes registration, creates exact basket caps and permits mint/redeem",async()=>{
    const c=await onboarding();
    const proposal={status:"PROPOSED_FOR_REVIEW",recommendedSetting:{status:"PROPOSED_FOR_REVIEW",token:c.token.target,pool:c.pool.target,fee:3000,params:{...c.config.oracle.safety,slippageBps:200}}};
    const b={id:"77",name:"Broadcast basket",symbol:"BCAST",capUsd:"5000"};
    const preview=await executeListing(ethers.provider,null,proposal,c.config,b,{singleTokenApproved:true});
    expect((preview as any).steps.length).to.equal(4);
    expect((await c.registry.tokenConfigurations(c.token.target)).pool).to.equal(ethers.ZeroAddress);
    await rejects(executeListing(ethers.provider,c.other,proposal,c.config,b,{broadcast:true,singleTokenApproved:true}),/Signer must own/);
    await rejects(executeListing(ethers.provider,c.owner,{status:"INSUFFICIENT_EVIDENCE"},c.config,b,{broadcast:true,singleTokenApproved:true}),/No recommended/);
    await rejects(executeListing(ethers.provider,c.owner,proposal,c.config,b,{broadcast:true,singleTokenApproved:true,record:async e=>{if(e.status==="CONFIRMED")throw Error("Simulated interruption");}}),/Simulated interruption/);
    expect((await c.registry.tokenConfigurations(c.token.target)).pool).to.equal(c.pool.target);
    const events:any[]=[];
    const result=await executeListing(ethers.provider,c.owner,proposal,c.config,b,{broadcast:true,singleTokenApproved:true,record:async e=>{events.push(e);}});
    expect(result.mode).to.equal("COMPLETE");
    expect(events.filter(e=>e.status==="CONFIRMED").length).to.equal(3);
    const state=await c.vault.baskets(77);
    expect(state.depositCapUsd).to.equal(ethers.parseEther("5000"));
    expect(state.maxMintUsd).to.equal(ethers.parseEther("750"));
    await c.usdg.connect(c.user).approve(c.vault.target,ethers.MaxUint256);
    await mint(c,77);
    const shares=await ethers.getContractAt("StaxBasketToken",state.token);
    await c.vault.connect(c.user).redeem(77,await shares.balanceOf(c.user.address),...LIMITS);
    const repeated=await executeListing(ethers.provider,c.owner,proposal,c.config,b,{broadcast:true,singleTokenApproved:true});
    expect((repeated as any).transactions).to.equal(0);
    await rejects(executeListing(ethers.provider,c.owner,proposal,c.config,{...b,capUsd:"6000"},{broadcast:true,singleTokenApproved:true}),/already exists/);
  });

  it("broadcaster lists a Chainlink token from its proposal and validates multi-token basket inputs",async()=>{
    const c=await onboarding(true);
    const proposal={status:"PROPOSED_FOR_REVIEW",recommendedSetting:{status:"PROPOSED_FOR_REVIEW",oracleType:"CHAINLINK",token:c.token.target,pool:c.pool.target,fee:3000,
      params:{feed:c.stockFeed.target,maxStaleness:100_000,route:{venue:"v3",fee:3000,pool:c.pool.target},slippageBps:200}}};
    const b={id:"78",name:"Stock basket",symbol:"STK",capUsd:"20000"};
    const preview:any=await executeListing(ethers.provider,null,proposal,c.config,b,{singleTokenApproved:true});
    expect(preview.steps.length).to.equal(3);
    expect(preview.oracles).to.deep.equal(["CHAINLINK"]);
    expect(preview.steps.some((s:any)=>/Chainlink pricing/.test(s.label))).to.equal(true);
    expect(preview.steps.some((s:any)=>/TWAP/.test(s.label))).to.equal(false);
    await rejects(executeListing(ethers.provider,null,proposal,c.config,b),/Single-token basket refused/);
    const bad=JSON.parse(JSON.stringify(proposal));bad.recommendedSetting.params.route={venue:"v5",fee:3000};
    await rejects(executeListing(ethers.provider,null,bad,c.config,b,{singleTokenApproved:true}),/Unknown route venue/);
    await rejects(executeBasketListing(ethers.provider,null,[{proposal,base:c.config,weightBps:6000},{proposal,base:c.config,weightBps:4000}],b),/Duplicate component/);
    await rejects(executeBasketListing(ethers.provider,null,[{proposal,base:c.config,weightBps:9000}],b,{singleTokenApproved:true}),/summing to 10000/);
    const result=await executeListing(ethers.provider,c.owner,proposal,c.config,b,{broadcast:true,singleTokenApproved:true});
    expect(result.mode).to.equal("COMPLETE");
    expect(Number(await c.vault.oracleSettings(c.token.target).then((o:any)=>o.oracleType))).to.equal(1);
    expect((await c.vault.priceFeeds(c.token.target)).feed).to.equal(c.stockFeed.target);
    const state=await c.vault.baskets(78);
    expect(state.maxMintUsd).to.equal(ethers.parseEther("3000"));
    await c.usdg.connect(c.user).approve(c.vault.target,ethers.MaxUint256);
    await mint(c,78);
    const shares=await ethers.getContractAt("StaxBasketToken",state.token);
    await c.vault.connect(c.user).redeem(78,await shares.balanceOf(c.user.address),...LIMITS);
    const repeated:any=await executeListing(ethers.provider,c.owner,proposal,c.config,b,{broadcast:true,singleTokenApproved:true});
    expect(repeated.transactions).to.equal(0);
  });

  it("broadcaster registers a Chainlink token on a hookless V4 route and refuses colliding share symbols",async()=>{
    const c=await fixture(true);
    const router=await deploy("MockUniversalRouter",c.permit.target,c.usdg.target);
    const args=[...c.deploymentArgs];args[2]=[];args[5]=router.target;
    args[11]=(await deploy("StaxV3RouteValidator",router.target,c.factory.target,ethers.keccak256(poolArtifact.bytecode))).target;
    const vault=await deploy("StaxVaultV2",...args);
    const [currency0,currency1]=[c.usdg.target,c.token.target].sort((a,b)=>BigInt(a)<BigInt(b)?-1:1);
    await c.token.mint(router.target,10n**30n);await c.usdg.mint(router.target,10n**20n);
    await router.setRate(c.usdg.target,c.token.target,10n**30n);await router.setRate(c.token.target,c.usdg.target,10n**6n);
    const config:any={chainId:Number((await ethers.provider.getNetwork()).chainId),vault:vault.target,
      expectedVaultCodeHash:ethers.keccak256(await ethers.provider.getCode(vault.target)),expectedOwner:c.owner.address,
      usdg:c.usdg.target,expectedUsdgDecimals:6,token:c.token.target,expectedTokenDecimals:18,
      router:router.target,factory:c.factory.target,poolInitCodeHash:ethers.keccak256(poolArtifact.bytecode),pool:c.pool.target,fee:3000,slippageBps:200,
      oracle:{type:"CHAINLINK",feed:c.stockFeed.target,maxStaleness:100_000},
      review:{tokenBehavior:"local",routerDeployment:"local",roundTripFork:"local",chainlinkFeedSearch:"local",riskParameters:"local"}};
    const proposal={status:"PROPOSED_FOR_REVIEW",recommendedSetting:{status:"PROPOSED_FOR_REVIEW",oracleType:"CHAINLINK",token:c.token.target,pool:null,fee:3000,
      params:{feed:c.stockFeed.target,maxStaleness:100_000,route:{venue:"v4",currency0,currency1,fee:3000,tickSpacing:60,hooks:ethers.ZeroAddress},slippageBps:200}}};
    // An existing basket on this vault already uses symbol "TAKEN"; a new basket must not reuse it.
    await vault.setPriceFeed(c.token.target,c.stockFeed.target,100_000);
    await vault.setTickerPool(c.token.target,currency0,currency1,3000,60,ethers.ZeroAddress);
    await vault.createBasket(5,"Existing","TAKEN",[c.token.target],[10000],10n**27n,10n**25n);
    const opts={singleTokenApproved:true,symbolCheckVaults:[String(vault.target)]};
    await rejects(executeListing(ethers.provider,null,proposal,config,{id:"9",name:"New",symbol:"taken",capUsd:"1000"},opts),/already exists: basket 5/);
    const preview:any=await executeListing(ethers.provider,null,proposal,config,{id:"9",name:"New",symbol:"FRESH",capUsd:"1000"},opts);
    expect(preview.steps.map((s:any)=>s.label)).to.deep.equal(["Create basket (1 token)"]);
    // Fresh vault: the V4 route step must be emitted and executed.
    const fresh=await deploy("StaxVaultV2",...args);
    const freshConfig={...config,vault:fresh.target,expectedVaultCodeHash:ethers.keccak256(await ethers.provider.getCode(fresh.target))};
    const plan:any=await executeListing(ethers.provider,null,proposal,freshConfig,{id:"1",name:"V4 basket","symbol":"V4B",capUsd:"1000"},{singleTokenApproved:true});
    expect(plan.steps.map((s:any)=>s.label)).to.deep.equal(["Register V4 execution pool","Register Chainlink pricing at 200 bps","Create basket (1 token)"]);
    const result=await executeListing(ethers.provider,c.owner,proposal,freshConfig,{id:"1",name:"V4 basket",symbol:"V4B",capUsd:"1000"},{broadcast:true,singleTokenApproved:true});
    expect(result.mode).to.equal("COMPLETE");
    const key=await fresh.tickerPools(c.token.target);
    expect(key.currency0).to.equal(currency0);expect(Number(key.tickSpacing)).to.equal(60);
    await c.usdg.connect(c.user).approve(fresh.target,ethers.MaxUint256);
    await fresh.connect(c.user).mint(1,DEPOSIT,...LIMITS);
    const shares:any=await ethers.getContractAt("StaxBasketToken",(await fresh.baskets(1)).token);
    await fresh.connect(c.user).redeem(1,await shares.balanceOf(c.user.address),...LIMITS);
  });

  it("broadcaster rejects failing live liquidity before any transaction",async()=>{
    const c=await onboarding();
    const proposal={status:"PROPOSED_FOR_REVIEW",recommendedSetting:{status:"PROPOSED_FOR_REVIEW",token:c.token.target,pool:c.pool.target,fee:3000,params:{...c.config.oracle.safety,minCurrentLiquidity:String(L*100n),slippageBps:200}}};
    const nonce=await ethers.provider.getTransactionCount(c.owner.address);
    await rejects(executeListing(ethers.provider,c.owner,proposal,c.config,{id:"1",name:"Fail",symbol:"FAIL",capUsd:"5000"},{broadcast:true,singleTokenApproved:true}));
    expect(await ethers.provider.getTransactionCount(c.owner.address)).to.equal(nonce);
    expect((await c.registry.tokenConfigurations(c.token.target)).pool).to.equal(ethers.ZeroAddress);
  });

  for (const stock of [false, true]) it(`onboarding plans and resumes ${stock ? "Chainlink" : "TWAP"} registration without sending transactions`, async () => {
    const c = await onboarding(stock);
    const nonce = await c.owner.getNonce();
    let plan = await buildPlan(ethers.provider, c.config);
    expect(await c.owner.getNonce()).to.equal(nonce);
    expect((await c.vault.oracleSettings(c.token.target)).oracleType).to.equal(0);
    expect(plan.steps.length).to.equal(stock ? 2 : 3);
    if (!stock) expect(await c.registry.poolFor(c.token.target)).to.equal(ethers.ZeroAddress);
    expect(plan.batches.length).to.equal(1);
    // Execute only on this local simulated chain, using the exact generated calldata.
    await (await c.owner.sendTransaction(plan.steps[0])).wait();
    plan = await buildPlan(ethers.provider, c.config);
    expect(plan.steps.length).to.equal(stock ? 1 : 2);
    for (const step of plan.steps) await (await c.owner.sendTransaction(step)).wait();
    expect((await buildPlan(ethers.provider, c.config)).steps).to.have.length(0);
    expect((await c.vault.oracleSettings(c.token.target)).oracleType).to.equal(stock ? 1 : 2);
    await basket(c);
    await c.usdg.connect(c.user).approve(c.vault.target, ethers.MaxUint256);
    await mint(c);
    const shares = await ethers.getContractAt("StaxBasketToken", (await c.vault.baskets(1)).token);
    await c.vault.connect(c.user).redeem(1, await shares.totalSupply(), ...LIMITS);
  });

  it("onboarding rejects wrong chain, decimals, deployment identity, pool and unreviewed TWAP settings", async () => {
    const c = await onboarding();
    for (const [key, value, error] of [
      ["chainId", c.config.chainId + 1, "Wrong RPC chain"],
      ["expectedTokenDecimals", 6, "Token decimals mismatch"],
      ["expectedVaultCodeHash", "0x" + "01".repeat(32), "Vault bytecode differs"],
      ["expectedOwner", c.user.address, "Vault owner mismatch"],
      ["pool", c.token.target, "Canonical V3 pool mismatch"],
    ]) await rejects(buildPlan(ethers.provider, {...c.config, [key]: value}), new RegExp(String(error)));
    expect(() => validateConfig({...c.config, slippageBps: 501})).to.throw("slippageBps");
    expect(() => validateConfig({...c.config, oracle: {type: "V4"}})).to.throw("Explicit CHAINLINK or TWAP");
    const bad = structuredClone(c.config); bad.review.riskParameters = "";
    expect(() => validateConfig(bad)).to.throw("riskParameters");
    const thin = structuredClone(c.config); thin.oracle.safety.minCurrentLiquidity = (10n ** 30n).toString();
    await rejects(buildPlan(ethers.provider, thin));
  });

  it("onboarding keeps different registry/vault owners in ordered batches and rejects shared-setting changes", async () => {
    const c = await onboarding();
    await c.registry.transferOwnership(c.other.address); await c.registry.connect(c.other).acceptOwnership();
    c.config.oracle.expectedRegistryOwner = c.other.address;
    const plan = await buildPlan(ethers.provider, c.config);
    expect(plan.batches.map(b => b.owner)).to.deep.equal([c.other.address, c.owner.address]);
    await (await c.other.sendTransaction(plan.steps[0])).wait();
    const changed = structuredClone(c.config); changed.oracle.safety.maxDeviationBps = 400;
    await rejects(buildPlan(ethers.provider, changed), /Existing registry maxDeviationBps conflicts/);
    const cl = await onboarding(true);
    await cl.token.setOraclePaused(true);
    await rejects(buildPlan(ethers.provider, cl.config), /paused/);
  });

  it("standalone discovery needs no V2, registry, owner or approval settings", async () => {
    const c = await fixture(false, 6);
    const network = {chainId: Number((await ethers.provider.getNetwork()).chainId), usdg: c.usdg.target,
      factory: c.factory.target, feeTiers: [500, 3000, 10000], feedSourceVaults: []};
    const nonce = await c.owner.getNonce();
    const result = await discoverWithoutVault(ethers.provider, c.token.target, network);
    expect(result.mode).to.equal("DISCOVERY_ONLY");
    expect(result.token.decimals).to.equal(6);
    expect(result.usdg.decimals).to.equal(6);
    expect(result.pools).to.have.length(1);
    expect(result.pools[0].address).to.equal(c.pool.target);
    expect(result.pools[0].availableHistorySeconds).to.be.gte(600);
    expect(result.registrationStatus).to.equal("NOT_PREPARED");
    expect(result.feedLookups).to.have.length(0);
    expect(await c.owner.getNonce()).to.equal(nonce);
    await rejects(discoverWithoutVault(ethers.provider, c.token.target, {...network, chainId: network.chainId + 1}), /Unexpected RPC chain/);
    await rejects(discoverWithoutVault(ethers.provider, c.user.address, network), /No code/);
    await rejects(discoverWithoutVault(ethers.provider, c.usdg.target, network), /other than USDG/);
  });

  function savedProject(c: any) {
    return { ...c.config, v3FeeTiers: [100, 500, 3000, 10000], chainlinkSourceVaults: [],
      chainlinkCandidates: {}, routerDeploymentReview: "local reviewed fixture",
      registry: c.registry.target, expectedRegistryOwner: c.owner.address };
  }

  it("address onboarding discovers pools/decimals and stops without a token approval", async () => {
    const c = await onboarding();
    const nonce = await c.owner.getNonce();
    const result = await onboardAddress(ethers.provider, savedProject(c), c.token.target);
    expect(result.status).to.equal("NEEDS_REVIEW");
    expect(result.discovery.decimals).to.equal(18);
    expect(result.discovery.pools).to.have.length(1);
    expect(result.discovery.pools[0].address).to.equal(c.pool.target);
    if (result.status === "NEEDS_REVIEW") {
      expect(result.draft.pool).to.equal(c.pool.target);
      expect(result.draft.oracle).to.equal(null); // Absence of a candidate feed must not select TWAP automatically.
      expect(result.draft.slippageBps).to.equal(null);
      expect(result.draft.approved).to.equal(false);
    }
    expect(await c.owner.getNonce()).to.equal(nonce);
    expect(await c.registry.poolFor(c.token.target)).to.equal(ethers.ZeroAddress);
  });

  it("address onboarding finds feed candidates by token address and never picks between pools", async () => {
    const c = await onboarding(true);
    await c.factory.createPool(c.token.target, c.usdg.target, 500);
    const other = new ethers.Contract(await c.factory.getPool(c.token.target, c.usdg.target, 500), poolArtifact.abi, c.owner);
    await other.initialize((await c.pool.slot0()).sqrtPriceX96);
    await c.router.provide(other.target, L);
    const p = savedProject(c);
    p.chainlinkCandidates = {[c.token.target.toLowerCase()]: [c.stockFeed.target]};
    const result = await onboardAddress(ethers.provider, p, c.token.target);
    expect(result.discovery.chainlinkCandidates[0].address).to.equal(c.stockFeed.target);
    expect(result.discovery.pools).to.have.length(2);
    if (result.status === "NEEDS_REVIEW") {
      expect(result.draft.pool).to.equal(null);
      expect(result.draft.oracle?.type).to.equal("CHAINLINK");
      expect(result.draft.oracle?.maxStaleness).to.equal(null);
    } else throw new Error("Unexpected approved plan");
  });

  for (const stock of [true, false]) it(`address onboarding reuses saved ${stock ? "Chainlink" : "TWAP"} approval without extra arguments`, async () => {
    const c = await onboarding(stock), project = savedProject(c);
    const approval = {...c.config, approved: true};
    const result = await onboardAddress(ethers.provider, project, c.token.target, approval);
    expect(result.status).to.equal("READY");
    if (result.status === "READY") expect(result.plan.steps.length).to.equal(stock ? 2 : 3);
    await rejects(onboardAddress(ethers.provider, project, c.token.target, {...approval, token: c.other.address}), /another token/);
    await rejects(onboardAddress(ethers.provider, project, c.token.target, {...approval, expectedOwner: c.other.address}), /saved project/);
    const noApproval = await onboardAddress(ethers.provider, project, c.token.target, {...approval, approved: false});
    expect(noApproval.status).to.equal("NEEDS_REVIEW");
  });

  it("deploys directly with fixed dependencies and rejects invalid deployment configuration", async () => {
    const c = await fixture(true);
    expect(await c.vault.owner()).to.equal(c.owner.address);
    expect(await c.vault.usdgDecimals()).to.equal(6);
    expect(await c.vault.routeValidator()).to.equal(c.validator.target);
    expect(await c.vault.basketTokenDeployer()).to.equal(c.tokenDeployer.target);
    expect(await c.vault.tickerSlippageBps(c.token.target)).to.equal(200);
    for (const name of ["initialize", "upgradeToAndCall", "proxiableUUID"]) {
      expect(c.vault.interface.hasFunction(name)).to.equal(false);
    }
    const args = [...c.deploymentArgs];
    args[0] = ethers.ZeroAddress;
    await expect(deploy("StaxVaultV2", ...args)).to.be.revertedWithCustomError(c.vault, "OwnableInvalidOwner");
    args[0] = c.owner.address; args[5] = c.token.target;
    await expect(deploy("StaxVaultV2", ...args)).to.be.revertedWithCustomError(c.vault, "InvalidOracleConfiguration");
  });

  it("caps all slippage configuration at 500 bps and retains 200 for Chainlink", async () => {
    const c = await fixture(true);
    expect(await c.vault.tickerSlippageBps(c.token.target)).to.equal(200);
    await c.vault.setTickerSlippage(c.token.target, 500);
    await c.vault.updatePriceFeed(c.token.target, c.stockFeed.target, 100_000);
    expect(await c.vault.tickerSlippageBps(c.token.target)).to.equal(500);
    for (const value of [0, 501, 9999]) {
      await expect(c.vault.setTickerSlippage(c.token.target, value)).to.be.revertedWithCustomError(c.vault, "InvalidSlippage");
    }
    const crypto = await fixture();
    await expect(crypto.vault.setTwapOracle(crypto.token.target, crypto.registry.target, 501)).to.be.revertedWithCustomError(crypto.vault, "InvalidSlippage");
    expect(await crypto.vault.tickerSlippageBps(crypto.token.target)).to.equal(200);
    for (const name of ["MAX_SLIPPAGE_BPS", "USDG_STALENESS_CONFIRMED_REFERENCE"]) expect(c.vault.interface.hasFunction(name)).to.equal(false);
  });

  it("encodes canonical true for the V3 payer flag in both directions", async () => {
    const c = await fixture();
    const shares = await basket(c);
    await mint(c);
    expect(await c.router.lastPayerWord()).to.equal(1);
    await c.vault.connect(c.user).redeem(1, await shares.totalSupply(), ...LIMITS);
    expect(await c.router.lastPayerWord()).to.equal(1);
  });

  it("changes fee destinations with authorization and pays accrued fees to the new recipients", async () => {
    const c = await fixture();
    await basket(c); await mint(c);
    for (const [method, error] of [["setTreasury", "ZeroTreasury"], ["setRewardsPool", "ZeroRewardsPool"]]) {
      await expect(c.vault.connect(c.user)[method](c.other.address)).to.be.revertedWithCustomError(c.vault, "OwnableUnauthorizedAccount");
      await expect(c.vault[method](ethers.ZeroAddress)).to.be.revertedWithCustomError(c.vault, error);
    }
    const treasury = await c.vault.pendingTreasuryFees(), rewards = await c.vault.pendingRewardsPool();
    await expect(c.vault.setTreasury(c.other.address)).to.emit(c.vault, "TreasuryUpdated").withArgs(c.treasury.address, c.other.address);
    await expect(c.vault.setRewardsPool(c.owner.address)).to.emit(c.vault, "RewardsPoolUpdated").withArgs(c.rewards.address, c.owner.address);
    const before = await c.usdg.balanceOf(c.other.address);
    await c.vault.claimTreasuryFees(); await c.vault.claimRewardsPool();
    expect(await c.usdg.balanceOf(c.other.address) - before).to.equal(treasury);
    expect(await c.usdg.balanceOf(c.owner.address)).to.equal(rewards);
    expect(await c.vault.pendingTreasuryFees()).to.equal(0);
    expect(await c.vault.pendingRewardsPool()).to.equal(0);
  });

  it("enables a sequencer feed once and enforces downtime and recovery on both fund paths", async () => {
    const c = await fixture(true);
    const args = [...c.deploymentArgs]; args[10] = ethers.ZeroAddress;
    c.vault = await deploy("StaxVaultV2", ...args);
    await c.vault.setTickerPoolV3(c.token.target, 3000);
    await c.usdg.connect(c.user).approve(c.vault.target, ethers.MaxUint256);
    const shares = await basket(c); await mint(c);
    await expect(c.vault.connect(c.user).setSequencerUptimeFeed(c.sequencer.target)).to.be.revertedWithCustomError(c.vault, "OwnableUnauthorizedAccount");
    for (const feed of [ethers.ZeroAddress, c.user.address, c.usdFeed.target]) {
      await expect(c.vault.setSequencerUptimeFeed(feed)).to.be.revertedWithCustomError(c.vault, "InvalidSequencerFeed");
    }
    expect(await c.vault.sequencerUptimeFeed()).to.equal(ethers.ZeroAddress);
    await c.sequencer.setPrice(1);
    await expect(c.vault.setSequencerUptimeFeed(c.sequencer.target)).to.emit(c.vault, "SequencerFeedSet").withArgs(c.sequencer.target);
    const quantity = await shares.totalSupply();
    for (const error of ["SequencerDown", "GracePeriodActive"]) {
      await expect(mint(c)).to.be.revertedWithCustomError(c.vault, error);
      await expect(c.vault.connect(c.user).redeem(1, quantity, ...LIMITS)).to.be.revertedWithCustomError(c.vault, error);
      if (error === "SequencerDown") await c.sequencer.setPrice(0);
    }
    for (const feed of [ethers.ZeroAddress, c.sequencer.target, c.usdFeed.target]) {
      await expect(c.vault.setSequencerUptimeFeed(feed)).to.be.revertedWithCustomError(c.vault, "SequencerFeedAlreadySet");
    }
    await advance(3601);
    await c.vault.connect(c.user).redeem(1, quantity, ...LIMITS);
    await expect((await fixture()).vault.setSequencerUptimeFeed(c.sequencer.target)).to.be.revertedWithCustomError(c.vault, "SequencerFeedAlreadySet");
  });

  for (const decimals of [6, 18]) it(`previews use exact share math and isolated holdings (${decimals} decimals)`, async () => {
    const c = await fixture(true, decimals);
    const shares = await basket(c);
    const quote = await c.vault.previewMint(1, DEPOSIT);
    expect(quote).to.equal(99_750_000n * 10n ** 12n);
    await mint(c);
    expect(await shares.totalSupply()).to.be.lt(quote); // Real V3 trading fees are excluded by the oracle preview.
    const supply = await shares.totalSupply(), nav = await c.vault.getBasketNavUsd(1);
    expect(await c.vault.previewMint(1, DEPOSIT)).to.equal(quote * (supply + 1n) / (nav + 1n));
    const quantity = supply / 3n;
    const held = await c.vault.basketTickerHoldings(1, c.token.target);
    const units = held * quantity / supply;
    const gross = units * 10n ** BigInt(18 - decimals) / 10n ** 12n;
    expect(await c.vault.previewRedeem(1, quantity)).to.equal(gross - gross * 25n / 10000n);
    const before = await c.vault.previewRedeem(1, quantity);
    await c.token.mint(c.vault.target, 10n ** 22n);
    await basket(c, 2); await mint(c, 2);
    expect(await c.vault.previewRedeem(1, quantity)).to.equal(before);
    await c.vault.setMintPaused(1, true);
    await expect(c.vault.previewMint(1, DEPOSIT)).to.be.revertedWithCustomError(c.vault, "MintingPaused");
    expect(await c.vault.previewRedeem(1, quantity)).to.equal(before);
    await c.token.setOraclePaused(true);
    await expect(c.vault.previewRedeem(1, quantity)).to.be.revertedWithCustomError(c.vault, "OraclePausedErr");
    await c.token.setOraclePaused(false);
    await expect(c.vault.previewRedeem(1, supply + 1n)).to.be.revertedWithCustomError(c.vault, "NoSupply");
  });

  it("previews respect TWAP health, USDG conversion, caps and re-genesis", async () => {
    const c = await fixture();
    const shares = await basket(c);
    expect(await (await ethers.getContractAt("StaxVaultPreview", await c.vault.previewer())).vault()).to.equal(c.vault.target);
    const quote = await c.vault.previewMint(1, DEPOSIT);
    await c.usdFeed.setPrice(80_000_000n);
    const depegged = await c.vault.previewMint(1, DEPOSIT);
    expect(depegged).to.be.closeTo(quote * 8n / 10n, 10n);
    await c.vault.setCaps(1, 1, 10n ** 25n);
    await expect(c.vault.previewMint(1, DEPOSIT)).to.be.revertedWithCustomError(c.vault, "ExceedsVaultCap");
    await c.vault.setCaps(1, 10n ** 27n, 1);
    await expect(c.vault.previewMint(1, DEPOSIT)).to.be.revertedWithCustomError(c.vault, "ExceedsMintLimit");
    await c.vault.setCaps(1, 10n ** 27n, 10n ** 25n);
    await mint(c);
    await c.registry.removeToken(c.token.target);
    await expect(c.vault.previewRedeem(1, await shares.totalSupply())).to.be.revertedWithCustomError(c.validator, "OraclePoolMismatch");
    await c.registry.configureToken(c.token.target, c.params);
    await c.vault.connect(c.user).redeem(1, await shares.totalSupply(), ...LIMITS);
    expect(await c.vault.previewMint(1, DEPOSIT)).to.be.closeTo(depegged, 10n ** 10n);
    expect((await ethers.provider.getCode(c.vault.target)).length / 2 - 1).to.be.at.most(24576);
  });

  for (const decimals of [6, 18]) {
    it(`mints and fully redeems crypto without oraclePaused (${decimals} decimals)`, async () => {
      const c = await fixture(false, decimals);
      const shares = await basket(c);
      expect(c.token.interface.hasFunction("oraclePaused")).to.equal(false);
      expect(await c.vault.priceFeeds(c.token.target)).to.deep.equal([ethers.ZeroAddress, 0n]);
      expect((await c.vault.oracleSettings(c.token.target)).oracleType).to.equal(2);
      expect(await shares.vault()).to.equal(c.vault.target);
      const start = await c.usdg.balanceOf(c.user.address);
      await mint(c);
      const bought = await c.token.balanceOf(c.vault.target);
      expect(bought).to.equal(await c.vault.basketTickerHoldings(1, c.token.target));
      expect(bought).to.be.gt(0);
      const qty = await shares.balanceOf(c.user.address);
      expect(qty).to.be.gt(98n * 10n ** 18n).and.lt(101n * 10n ** 18n);
      expect(await c.usdg.balanceOf(c.vault.target)).to.equal(await liabilities(c));
      await c.vault.connect(c.user).redeem(1, qty, ...LIMITS);
      const payout = await c.usdg.balanceOf(c.user.address) - (start - DEPOSIT);
      expect(payout).to.be.gt(98_000_000n).and.lt(DEPOSIT);
      expect(await shares.totalSupply()).to.equal(0);
      expect(await c.vault.basketTickerHoldings(1, c.token.target)).to.equal(0);
      expect(await c.token.balanceOf(c.vault.target)).to.equal(0);
      expect(await c.usdg.balanceOf(c.vault.target)).to.equal(await liabilities(c));
      expect(await c.permit.allowance(c.vault.target, c.token.target, c.router.target)).to.equal(0);
      expect(await c.permit.allowance(c.vault.target, c.usdg.target, c.router.target)).to.equal(0);
      const rewards = await c.vault.pendingRewardsPool();
      const treasury = await c.vault.pendingTreasuryFees();
      await c.vault.connect(c.other).claimRewardsPool();
      await c.vault.connect(c.other).claimTreasuryFees();
      expect(await c.usdg.balanceOf(c.rewards.address)).to.equal(rewards);
      expect(await c.usdg.balanceOf(c.treasury.address)).to.equal(treasury);
      expect(await c.usdg.balanceOf(c.vault.target)).to.equal(await c.vault.pendingBuyBurn());
    });
  }

  it("prices USDG depegs correctly without changing underlying TWAP units", async () => {
    const c = await fixture();
    const shares = await basket(c);
    await c.usdFeed.setPrice(80_000_000n);
    await mint(c);
    const held = await c.vault.basketTickerHoldings(1, c.token.target);
    const [rawQuote] = await c.registry.quoteUsdg18(c.token.target);
    const expectedNav = held * (rawQuote * 8n / 10n) / 10n ** 18n;
    expect(await c.vault.getBasketNavUsd(1)).to.equal(expectedNav);
    expect(await shares.totalSupply()).to.be.gt(78n * 10n ** 18n).and.lt(81n * 10n ** 18n);
    await c.vault.connect(c.user).redeem(1, await shares.balanceOf(c.user.address), ...LIMITS);
  });

  it("retains stock oraclePaused checks and prevents changing a stock to TWAP", async () => {
    const c = await fixture(true);
    const shares = await basket(c);
    expect(await c.vault.tickerSlippageBps(c.token.target)).to.equal(200);
    await expect(c.vault.setTwapOracle(c.token.target, c.registry.target, 200)).to.be.revertedWithCustomError(c.vault, "InvalidOracleConfiguration");
    await c.token.setOraclePaused(true);
    await expect(mint(c)).to.be.revertedWithCustomError(c.vault, "OraclePausedErr");
    await c.token.setOraclePaused(false);
    await mint(c);
    await c.token.setOraclePaused(true);
    const before = await shares.balanceOf(c.user.address);
    await expect(c.vault.connect(c.user).redeem(1, before, ...LIMITS)).to.be.revertedWithCustomError(c.vault, "OraclePausedErr");
    expect(await shares.balanceOf(c.user.address)).to.equal(before);
    await c.token.setOraclePaused(false);
    await c.vault.connect(c.user).redeem(1, before, ...LIMITS);
  });

  it("matches V1 stock NAV, shares, and exact buy/sell minimums from identical pool state", async () => {
    const c = await fixture(true);
    const shares = await basket(c);
    const v1 = await deploy("StaxVault", c.rewards.address, c.treasury.address, c.router.target, c.permit.target,
      c.usdg.target, c.usdFeed.target, 100_000, c.sequencer.target);
    await v1.setPriceFeed(c.token.target, c.stockFeed.target, 100_000);
    await v1.setTickerPoolV3(c.token.target, 3000);
    await v1.createBasket(1, "V1", "V1", [c.token.target], [10000], 10n ** 27n, 10n ** 25n);
    await c.usdg.connect(c.user).approve(v1.target, ethers.MaxUint256);
    const oldShares: any = await ethers.getContractAt("StaxBasketToken", (await v1.baskets(1)).token);
    const snapshot = await ethers.provider.send("evm_snapshot", []);
    await v1.connect(c.user).mint(1, DEPOSIT);
    const buyMinimum = await c.router.lastMinimum();
    const nav = await v1.getBasketNavUsd(1);
    const supply = await oldShares.totalSupply();
    await v1.connect(c.user).redeem(1, supply);
    const sellMinimum = await c.router.lastMinimum();
    const payout = await c.router.lastOutput();
    await ethers.provider.send("evm_revert", [snapshot]);
    await mint(c);
    expect(await c.router.lastMinimum()).to.equal(buyMinimum);
    expect(await c.vault.getBasketNavUsd(1)).to.equal(nav);
    expect(await shares.totalSupply()).to.equal(supply);
    await c.vault.connect(c.user).redeem(1, supply, ...LIMITS);
    expect(await c.router.lastMinimum()).to.equal(sellMinimum);
    expect(await c.router.lastOutput()).to.equal(payout);
  });

  it("retains V4 stock round trips and V1's exact minimums with the existing router fixture", async () => {
    const c = await fixture(true);
    const router = await deploy("MockUniversalRouter", c.permit.target, c.usdg.target);
    const args = [...c.deploymentArgs]; args[5] = router.target;
    args[11] = (await deploy("StaxV3RouteValidator", router.target, c.factory.target, ethers.keccak256(poolArtifact.bytecode))).target;
    const v2 = await deploy("StaxVaultV2", ...args);
    const v1 = await deploy("StaxVault", c.rewards.address, c.treasury.address, router.target, c.permit.target,
      c.usdg.target, c.usdFeed.target, 100_000, c.sequencer.target);
    await v1.setPriceFeed(c.token.target, c.stockFeed.target, 100_000);
    const currencies = [c.usdg.target, c.token.target].sort((a, b) => BigInt(a) < BigInt(b) ? -1 : 1);
    await c.token.mint(router.target, 10n ** 30n);
    await c.usdg.mint(router.target, 10n ** 20n);
    await router.setRate(c.usdg.target, c.token.target, 10n ** 30n);
    await router.setRate(c.token.target, c.usdg.target, 10n ** 6n);
    const outcomes: any[] = [];
    for (const vault of [v1, v2]) {
      await vault.setTickerPool(c.token.target, ...currencies, 3000, 60, ethers.ZeroAddress);
      await vault.createBasket(1, "V4", "V4", [c.token.target], [10000], 10n ** 27n, 10n ** 25n);
      await c.usdg.connect(c.user).approve(vault.target, ethers.MaxUint256);
      await (vault === v1 ? vault.connect(c.user).mint(1, DEPOSIT) : vault.connect(c.user).mint(1, DEPOSIT, ...LIMITS));
      const shares: any = await ethers.getContractAt("StaxBasketToken", (await vault.baskets(1)).token);
      const buy = await router.lastMinimum();
      const nav = await vault.getBasketNavUsd(1);
      const qty = await shares.totalSupply();
      const before = await c.usdg.balanceOf(c.user.address);
      await (vault === v1 ? vault.connect(c.user).redeem(1, qty) : vault.connect(c.user).redeem(1, qty, ...LIMITS));
      outcomes.push([buy, nav, qty, await router.lastMinimum(), await c.usdg.balanceOf(c.user.address) - before]);
    }
    expect(outcomes[1]).to.deep.equal(outcomes[0]);
    expect(outcomes[1][4]).to.equal(99_500_625n);
  });

  it("round-trips a mixed Chainlink/V4 stock and TWAP/V3 crypto basket", async () => {
    const c = await fixture();
    const stock = await deploy("MockERC20", "Stock", "STOCK");
    const router = await deploy("MockUniversalRouter", c.permit.target, c.usdg.target);
    const args = [...c.deploymentArgs]; args[5] = router.target;
    args[11] = (await deploy("StaxV3RouteValidator", router.target, c.factory.target, ethers.keccak256(poolArtifact.bytecode))).target;
    const vault = await deploy("StaxVaultV2", ...args);
    await vault.setPriceFeed(stock.target, c.stockFeed.target, 100_000);
    await vault.setTickerPoolV3(c.token.target, 3000);
    await vault.setTwapOracle(c.token.target, c.registry.target, 200);
    const currencies = [c.usdg.target, stock.target].sort((a, b) => BigInt(a) < BigInt(b) ? -1 : 1);
    await vault.setTickerPool(stock.target, ...currencies, 3000, 60, ethers.ZeroAddress);
    for (const token of [stock, c.token]) {
      await token.mint(router.target, 10n ** 30n);
      await router.setRate(c.usdg.target, token.target, 10n ** 30n);
      await router.setRate(token.target, c.usdg.target, 10n ** 6n);
    }
    await c.usdg.mint(router.target, 10n ** 20n);
    await vault.createBasket(1, "Mixed", "MIX", [stock.target, c.token.target], [5000, 5000], 10n ** 27n, 10n ** 25n);
    await c.usdg.connect(c.user).approve(vault.target, ethers.MaxUint256);
    await vault.connect(c.user).mint(1, DEPOSIT, ...LIMITS);
    const shares: any = await ethers.getContractAt("StaxBasketToken", (await vault.baskets(1)).token);
    for (const token of [stock, c.token]) expect(await vault.basketTickerHoldings(1, token.target)).to.equal(49_875n * 10n ** 15n);
    await vault.connect(c.user).redeem(1, await shares.totalSupply(), ...LIMITS);
    for (const token of [stock, c.token]) {
      expect(await vault.basketTickerHoldings(1, token.target)).to.equal(0);
      expect(await token.balanceOf(vault.target)).to.equal(0);
    }
  });

  it("rejects insufficient observation history using real V3 OLD behavior", async () => {
    const c = await fixture(false, 18, false);
    await expect(c.registry.configureToken(c.token.target, c.params)).to.be.revertedWith("OLD");
  });
  it("rejects quotes during a real pool's locked mint callback", async () => {
    const c = await fixture();
    await expect(c.router.provideAndQuote(c.pool.target, c.registry.target, c.token.target))
      .to.be.revertedWithCustomError(c.registry, "PoolLocked");
    expect((await c.registry.quoteUsdg18(c.token.target))[0]).to.be.gt(0);
  });
  it("rounds negative mean ticks down and handles accumulator wraparound", async () => {
    const vectors = await deploy("LocalOracleVectors");
    const delta = (600n << 128n) / 1000n;
    await vectors.set(0, -601, 0, delta);
    expect((await vectors.consult(vectors.target, 600))[0]).to.equal(-2);
    await vectors.set(0, 601, 0, delta);
    expect((await vectors.consult(vectors.target, 600))[0]).to.equal(1);
    // Cross int56 and uint160 accumulator limits, with the same elapsed deltas.
    const maxTick = (1n << 55n) - 1n;
    const maxLiquidity = (1n << 160n) - 1n;
    await vectors.set(maxTick - 100n, -(1n << 55n) + 500n, maxLiquidity - 10n, delta - 11n);
    const [tick, liquidity] = await vectors.consult(vectors.target, 600);
    expect(tick).to.equal(1);
    expect(liquidity).to.equal(1000);
  });
  it("rejects stale observations on configuration and on quote", async () => {
    const c = await fixture();
    await advance(601);
    await expect(c.registry.quoteUsdg18(c.token.target)).to.be.revertedWithCustomError(c.registry, "StaleObservation");
    await expect(c.registry.configureToken(c.token.target, c.params)).to.be.revertedWithCustomError(c.registry, "StaleObservation");
  });
  it("rejects thin current liquidity and rolls back a redeem burn/ledger debit", async () => {
    const c = await fixture();
    const shares = await basket(c);
    await mint(c);
    await c.router.remove(c.pool.target, L);
    const qty = await shares.totalSupply();
    const held = await c.vault.basketTickerHoldings(1, c.token.target);
    await expect(c.registry.quoteUsdg18(c.token.target)).to.be.revertedWithCustomError(c.registry, "InsufficientLiquidity");
    await expect(c.vault.connect(c.user).redeem(1, qty, ...LIMITS)).to.be.revertedWithCustomError(c.registry, "InsufficientLiquidity");
    expect(await shares.totalSupply()).to.equal(qty);
    expect(await c.vault.basketTickerHoldings(1, c.token.target)).to.equal(held);
  });
  it("rejects thin historical liquidity even after current liquidity is restored", async () => {
    const c = await fixture();
    await c.router.remove(c.pool.target, L);
    await advance(590);
    await c.router.provide(c.pool.target, L);
    expect(await c.pool.liquidity()).to.be.gt(c.params.minCurrentLiquidity);
    await expect(c.registry.quoteUsdg18(c.token.target)).to.be.revertedWithCustomError(c.registry, "InsufficientLiquidity");
  });
  it("rejects spot manipulation against a lagging TWAP", async () => {
    const c = await fixture();
    await c.usdg.mint(c.owner.address, 10n ** 14n);
    await c.usdg.approve(c.router.target, ethers.MaxUint256);
    await c.router.trade(c.pool.target, !c.token0, 10n ** 13n);
    await expect(c.registry.quoteUsdg18(c.token.target)).to.be.revertedWithCustomError(c.registry, "ExcessiveDeviation");
  });
  it("documents that a sustained manipulated price can eventually pass the deviation check", async () => {
    const c = await fixture();
    const before = (await c.registry.quoteUsdg18(c.token.target))[0];
    await c.usdg.mint(c.owner.address, 10n ** 14n);
    await c.usdg.approve(c.router.target, ethers.MaxUint256);
    await c.router.trade(c.pool.target, !c.token0, 10n ** 13n);
    await expect(c.registry.quoteUsdg18(c.token.target)).to.be.revertedWithCustomError(c.registry, "ExcessiveDeviation");
    await advance(601);
    await c.router.provide(c.pool.target, 1);
    const after = (await c.registry.quoteUsdg18(c.token.target))[0];
    expect(after).to.be.gt(before * 110n / 100n);
  });
  it("rejects wrong pairs, noncanonical factories, and invalid safety settings atomically", async () => {
    const c = await fixture();
    const other = await deploy("LocalCryptoToken", 18);
    await expect(c.registry.configureToken(other.target, c.params)).to.be.revertedWithCustomError(c.registry, "InvalidPool");
    const wrongRegistry = await deploy("UnifiedTwapRegistry", c.owner.address, c.usdg.target, c.router.target);
    await expect(wrongRegistry.configureToken(c.token.target, c.params)).to.be.revertedWithCustomError(wrongRegistry, "InvalidPool");
    for (const patch of [{twapWindow: 0}, {maxObservationAge: 0}, {maxObservationAge: 601},
      {minCurrentLiquidity: 0}, {minHarmonicLiquidity: 0}, {maxDeviationBps: 0}, {maxDeviationBps: 10000}]) {
      await expect(c.registry.configureToken(c.token.target, {...c.params, ...patch})).to.be.revertedWithCustomError(c.registry, "InvalidConfiguration");
    }
    expect((await c.registry.tokenConfigurations(c.token.target)).twapWindow).to.equal(600);
  });

  it("enforces slippage on both directions and rolls back failed transfers/burns", async () => {
    const c = await fixture();
    const shares = await basket(c);
    // 1 bp cannot cover the real pool's 30 bp swap fee.
    await c.vault.setTickerSlippage(c.token.target, 1);
    const balance = await c.usdg.balanceOf(c.user.address);
    await expect(mint(c)).to.be.revertedWith("slippage");
    expect(await c.usdg.balanceOf(c.user.address)).to.equal(balance);
    expect(await shares.totalSupply()).to.equal(0);
    await c.vault.setTickerSlippage(c.token.target, 200);
    await mint(c);
    const supply = await shares.totalSupply();
    await c.vault.setTickerSlippage(c.token.target, 1);
    await expect(c.vault.connect(c.user).redeem(1, supply, ...LIMITS)).to.be.revertedWith("slippage");
    expect(await shares.totalSupply()).to.equal(supply);
    await c.vault.setTickerSlippage(c.token.target, 200);
    await c.vault.connect(c.user).redeem(1, supply, ...LIMITS);
    for (const bps of [0, 501, 9999, 10000]) await expect(c.vault.setTickerSlippage(c.token.target, bps)).to.be.revertedWithCustomError(c.vault, "InvalidSlippage");
    await expect(c.vault.setTickerSlippage(c.other.address, 200)).to.be.revertedWithCustomError(c.vault, "NoFeed");
  });
  it("blocks unconfigured basket assets and unauthorized configuration", async () => {
    const c = await fixture();
    await expect(c.vault.createBasket(7, "bad", "BAD", [c.usdg.target], [10000], 10n ** 22n, 10n ** 22n)).to.be.revertedWithCustomError(c.vault, "NoTickerFeed");
    await expect(c.vault.connect(c.user).setTickerSlippage(c.token.target, 300)).to.be.revertedWithCustomError(c.vault, "OwnableUnauthorizedAccount");
    await expect(c.vault.connect(c.user).setTwapOracle(c.token.target, c.registry.target, 200)).to.be.revertedWithCustomError(c.vault, "OwnableUnauthorizedAccount");
    await expect(c.registry.connect(c.user).configureToken(c.token.target, c.params)).to.be.revertedWithCustomError(c.registry, "OwnableUnauthorizedAccount");
  });
  it("enforces USDG feed freshness and sequencer downtime/recovery grace", async () => {
    const c = await fixture();
    await basket(c);
    await c.usdFeed.setPriceAt(100_000_000n, 1);
    await expect(mint(c)).to.be.revertedWithCustomError(c.vault, "StaleOraclePrice");
    await c.usdFeed.setPrice(100_000_000n);
    await c.sequencer.setPrice(1);
    await expect(mint(c)).to.be.revertedWithCustomError(c.vault, "SequencerDown");
    await c.sequencer.setPrice(0);
    await expect(mint(c)).to.be.revertedWithCustomError(c.vault, "GracePeriodActive");
    await c.sequencer.setPriceAt(0, 1);
    await mint(c);
  });
  it("supports registry replacement and fails closed when a configured token is removed", async () => {
    const c = await fixture();
    const shares = await basket(c);
    await mint(c);
    const replacement = await deploy("UnifiedTwapRegistry", c.owner.address, c.usdg.target, c.factory.target);
    await replacement.configureToken(c.token.target, c.params);
    await c.vault.setTwapOracle(c.token.target, replacement.target, 200);
    await c.registry.removeToken(c.token.target);
    expect(await c.vault.getBasketNavUsd(1)).to.be.gt(0);
    await replacement.removeToken(c.token.target);
    await expect(c.vault.connect(c.user).redeem(1, await shares.totalSupply(), ...LIMITS)).to.be.revertedWithCustomError(c.validator, "OraclePoolMismatch");
    await replacement.configureToken(c.token.target, c.params);
    await c.vault.connect(c.user).redeem(1, await shares.totalSupply(), ...LIMITS);
  });
  it("rejects upgrade attempts even by the owner, preserves funds, and retains two-step ownership", async () => {
    const c = await fixture();
    const shares = await basket(c);
    await mint(c);
    const held = await c.vault.basketTickerHoldings(1, c.token.target);
    const fees = await liabilities(c);
    const code = await ethers.provider.getCode(c.vault.target);
    const oldUpgrade = new ethers.Interface(["function upgradeToAndCall(address,bytes)"]);
    const data = oldUpgrade.encodeFunctionData("upgradeToAndCall", [c.token.target, "0x"]);
    for (const signer of [c.owner, c.user]) {
      await expect(signer.sendTransaction({ to: c.vault.target, data })).to.revert(ethers);
    }
    expect(await ethers.provider.getCode(c.vault.target)).to.equal(code);
    expect(await ethers.provider.getStorage(c.vault.target,
      "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc")).to.equal(ethers.ZeroHash);
    expect(await c.vault.owner()).to.equal(c.owner.address);
    expect(await c.vault.basketTickerHoldings(1, c.token.target)).to.equal(held);
    expect(await liabilities(c)).to.equal(fees);
    expect((await c.vault.oracleSettings(c.token.target)).registry).to.equal(c.registry.target);
    expect(await c.vault.tickerSlippageBps(c.token.target)).to.equal(200);
    await c.vault.connect(c.user).redeem(1, await shares.totalSupply(), ...LIMITS);
    expect(await shares.totalSupply()).to.equal(0);
    await c.vault.transferOwnership(c.other.address);
    expect(await c.vault.owner()).to.equal(c.owner.address);
    await expect(c.vault.connect(c.user).acceptOwnership()).to.be.revertedWithCustomError(c.vault, "OwnableUnauthorizedAccount");
    await c.vault.connect(c.other).acceptOwnership();
    expect(await c.vault.owner()).to.equal(c.other.address);
    await expect(c.vault.connect(c.other).renounceOwnership()).to.be.revertedWithCustomError(c.vault, "OwnershipRenunciationDisabled");
  });
  it("preserves shared-token ledger solvency through seeded deposits, partial exits and donations", async () => {
    const c = await fixture();
    const a = await basket(c, 1);
    const b = await basket(c, 2);
    await c.token.mint(c.vault.target, 123456n); // Never credited to either basket.
    let seed = 0x5a17;
    for (let i = 0; i < 30; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const id = seed % 2 + 1;
      const share = id === 1 ? a : b;
      const user = seed % 3 === 0 ? c.other : c.user;
      const owned = await share.balanceOf(user.address);
      const untouched = await c.vault.basketTickerHoldings(id === 1 ? 2 : 1, c.token.target);
      if (owned > 10n ** 15n && seed % 4 === 0) await c.vault.connect(user).redeem(id, owned / 2n, ...LIMITS);
      else await mint(c, id, BigInt(10 + seed % 90) * 1_000_000n, user);
      expect(await c.vault.basketTickerHoldings(id === 1 ? 2 : 1, c.token.target)).to.equal(untouched);
      const sum = await c.vault.basketTickerHoldings(1, c.token.target) + await c.vault.basketTickerHoldings(2, c.token.target);
      expect(await c.token.balanceOf(c.vault.target)).to.equal(sum + 123456n);
      expect(await c.usdg.balanceOf(c.vault.target)).to.equal(await liabilities(c));
    }
    for (const [id, shares] of [[1, a], [2, b]] as const) for (const user of [c.user, c.other]) {
      const qty = await shares.balanceOf(user.address);
      if (qty > 0n) await c.vault.connect(user).redeem(id, qty, ...LIMITS);
    }
    expect(await a.totalSupply()).to.equal(0);
    expect(await b.totalSupply()).to.equal(0);
    expect(await c.token.balanceOf(c.vault.target)).to.equal(123456n);
  });
});

