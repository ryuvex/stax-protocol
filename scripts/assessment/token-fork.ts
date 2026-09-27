import { network } from "hardhat";
import { readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
const snapshotPath = process.env.STAX_ASSESSMENT_SNAPSHOT;
if (!snapshotPath) throw Error("Missing assessment snapshot file");
const directory = dirname(snapshotPath);
const riskCheck = process.env.STAX_RISK_CHECK === "1";
const evidence = JSON.parse(await readFile(snapshotPath, "utf8"));
const safetyOverride = process.env.STAX_SAFETY_PARAMS ? JSON.parse(await readFile(process.env.STAX_SAFETY_PARAMS,"utf8")) : null;
// Chainlink mode: feed + route from the assessment; no TWAP registry, no direct probes, no manipulation runs.
const chainlink = process.env.STAX_CHAINLINK_PARAMS ? JSON.parse(await readFile(process.env.STAX_CHAINLINK_PARAMS,"utf8")) : null;
// Always create an in-process simulated fork. Never select an HTTP signer network.
const connection = await network.create({network:"robinhoodMainnetFork", override:{forking:{
  url:process.env.STAX_RPC_URL ?? "https://rpc.mainnet.chain.robinhood.com",blockNumber:evidence.blockNumber}}});
const {ethers} = connection;
const results: any = {blockNumber:evidence.blockNumber,blockHash:evidence.blockHash,
  mode:"LOCAL_FORK_ONLY",funding:"Synthetic trader USDG balance; real pool reserves/liquidity untouched",direct:[],vault:[],
  trialParameters:{twapWindow:1800,maxObservationAge:1800,minCurrentLiquidity:"1",minHarmonicLiquidity:"1",maxDeviationBps:500,slippageBps:200},
  caveat:"Trial oracle settings isolate integration; NOT production risk parameters or a listing approval. Direct router probes use minOut=0 only on this fork."};
try {
  if(safetyOverride) results.trialParameters={...results.trialParameters,...safetyOverride};
  if(chainlink){results.mode="CHAINLINK_FORK";results.chainlink=chainlink;delete results.trialParameters;results.caveat="Chainlink integration probe on a local fork; not a listing approval or cap.";}
  const pinned = await ethers.provider.getBlock(evidence.blockNumber);
  if(pinned?.hash !== evidence.blockHash) throw Error("Fork block hash mismatch");
  // Start simulated execution on a local Cancun block instead of asking EDR to
  // infer an unknown historical hardfork schedule for chain 4663.
  await ethers.provider.send("evm_mine", []);
  if(evidence.usdgDecimals!==6) throw Error("Probe sizing currently requires verified six-decimal USDG");
  const [owner,user,rewards,treasury] = await ethers.getSigners();
  const abi=["function balanceOf(address) view returns(uint256)","function approve(address,uint256) returns(bool)","function transfer(address,uint256) returns(bool)","function decimals() view returns(uint8)"];
  const usd:any = await ethers.getContractAt(abi,evidence.addresses.usdg,user);
  const token:any = await ethers.getContractAt(abi,evidence.addresses.token,user);
  const pool:any = evidence.addresses.pool ? await ethers.getContractAt(["function slot0() view returns(uint160,int24,uint16,uint16,uint16,uint8,bool)"],evidence.addresses.pool) : null;
  const router:any = await ethers.getContractAt(["function execute(bytes,bytes[],uint256) payable"],evidence.router,user);
  const permit:any = await ethers.getContractAt(["function approve(address,address,uint160,uint48)"],evidence.permit2,user);
  const balance = 10_000_000n*10n**6n;
  // Discover balance mapping on the local fork, restoring every nonmatching storage slot.
  let funded=false;
  for(let slot=0;slot<64;slot++) {
    const key=ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["address","uint256"],[user.address,slot]));
    const old=await ethers.provider.getStorage(usd.target,key);
    await ethers.provider.send("hardhat_setStorageAt",[usd.target,key,ethers.toBeHex(balance,32)]);
    if(await usd.balanceOf(user.address)===balance){results.balanceMappingSlot=slot;funded=true;break;}
    await ethers.provider.send("hardhat_setStorageAt",[usd.target,key,old]);
  }
  if(!funded) throw Error("Could not establish isolated fork funding");
  for(const t of [usd,token]) {
    await (await t.approve(evidence.permit2,ethers.MaxUint256)).wait();
    await (await permit.approve(t.target,evidence.router,(1n<<160n)-1n,(1n<<48n)-1n)).wait();
  }
  const price=async()=>{const s=await pool.slot0();return (evidence.token0.toLowerCase()===evidence.addresses.token.toLowerCase() ? (Number(s[0])/2**96)**2 : 1/(Number(s[0])/2**96)**2)*10**(evidence.tokenDecimals-evidence.usdgDecimals);};
  async function trade(input:string,output:string,amount:bigint) {
    const path=ethers.solidityPacked(["address","uint24","address"],[input,evidence.fee,output]);
    const data=ethers.AbiCoder.defaultAbiCoder().encode(["address","uint256","uint256","bytes","bool","uint256[]"],
      [user.address,amount,0,path,true,[]]);
    const block=await ethers.provider.getBlock("latest");
    return await (await router.execute("0x00",[data],block!.timestamp+300)).wait();
  }
  let baseline=await ethers.provider.send("evm_snapshot",[]);
  for(const amount of (riskCheck||chainlink)?[]:[10,100,1000,10000,50000,100000]) {
    await ethers.provider.send("evm_revert",[baseline]); baseline=await ethers.provider.send("evm_snapshot",[]);
    const start=await usd.balanceOf(user.address), initial=await price();
    try {
      const buy=await trade(usd.target,token.target,BigInt(amount)*10n**6n);
      const got=await token.balanceOf(user.address), afterBuy=await price();
      const sell=await trade(token.target,usd.target,got);
      const returned=await usd.balanceOf(user.address)-(start-BigInt(amount)*10n**6n);
      results.direct.push({amountUsdg:amount,tokensBought:ethers.formatUnits(got,evidence.tokenDecimals),priceBefore:initial,priceAfterBuy:afterBuy,
        spotMovePct:(afterBuy/initial-1)*100,returnedUsdg:ethers.formatUnits(returned,6),roundTripLossPct:(1-Number(returned)/(amount*1e6))*100,
        buyGas:String(buy.gasUsed),sellGas:String(sell.gasUsed)});
    }catch(e:any){results.direct.push({amountUsdg:amount,error:e.shortMessage??e.message});}
    console.log("direct",JSON.stringify(results.direct.at(-1)));
    await writeFile(directory+"/fork-results.json",JSON.stringify(results,null,2));
  }
  await ethers.provider.send("evm_revert",[baseline]);
  async function deploy(name:string,...args:any[]){const c:any=await(await ethers.getContractFactory(name,owner)).deploy(...args,{gasLimit:12_000_000});await c.waitForDeployment();return c;}
  let registry:any=null;
  if(!chainlink){
  results.setupStage="deploy registry";
  registry=await deploy("UnifiedTwapRegistry",owner.address,usd.target,evidence.factory);
  results.setupStage="configure registry";
  await (await registry.configureToken(token.target,{pool:evidence.addresses.pool,...results.trialParameters},{gasLimit:2_000_000})).wait();
  }
  results.setupStage="deploy validator and vault";
  const validator=await deploy("StaxV3RouteValidator",evidence.router,evidence.factory,evidence.poolInitCodeHash);
  const deployer=await deploy("StaxBasketTokenDeployer");
  const vault=await deploy("StaxVaultV2",owner.address,deployer.target,[],rewards.address,treasury.address,evidence.router,evidence.permit2,
    usd.target,evidence.usdgFeed,evidence.usdgMaxStaleness,evidence.sequencerFeed,validator.target);
  results.setupStage="configure vault";
  if(chainlink){
    await (await vault.setPriceFeed(token.target,chainlink.feed,chainlink.maxStaleness,{gasLimit:2_000_000})).wait();
    const r=chainlink.route;
    if(r.venue==="v3") await (await vault.setTickerPoolV3(token.target,r.fee,{gasLimit:2_000_000})).wait();
    else await (await vault.setTickerPool(token.target,r.currency0,r.currency1,r.fee,r.tickSpacing,r.hooks,{gasLimit:2_000_000})).wait();
    if(chainlink.slippageBps&&chainlink.slippageBps!==200) await (await vault.setTickerSlippage(token.target,chainlink.slippageBps,{gasLimit:1_000_000})).wait();
    results.vaultOraclePriceUsd18=String(await vault.getOraclePriceUsd18(token.target));
  } else {
  await (await vault.setTickerPoolV3(token.target,evidence.fee,{gasLimit:2_000_000})).wait();
  await (await vault.setTwapOracle(token.target,registry.target,results.trialParameters.slippageBps,{gasLimit:2_000_000})).wait();
  }
  await (await vault.createBasket(1,"Token fork probe","TEST",[token.target],[10000],ethers.parseEther("10000000"),ethers.parseEther("1000000"),{gasLimit:3_000_000})).wait();
  await (await usd.approve(vault.target,ethers.MaxUint256)).wait();
  const shares:any=await ethers.getContractAt(["function balanceOf(address) view returns(uint256)","function totalSupply() view returns(uint256)"],(await vault.baskets(1)).token);
  results.setupStage="complete";
  baseline=await ethers.provider.send("evm_snapshot",[]);
  for(const amount of riskCheck && !safetyOverride?[]:[10,100,1000,10000]) {
    await ethers.provider.send("evm_revert",[baseline]);baseline=await ethers.provider.send("evm_snapshot",[]);
    let stage="mint";
    const start=await usd.balanceOf(user.address),deadline=(await ethers.provider.getBlock("latest"))!.timestamp+600;
    try {
      const mint=await(await vault.connect(user).mint(1,BigInt(amount)*10n**6n,1,deadline)).wait();
      stage="redeem";
      const quantity=await shares.balanceOf(user.address);
      const redeem=await(await vault.connect(user).redeem(1,quantity,1,deadline)).wait();
      const returned=await usd.balanceOf(user.address)-(start-BigInt(amount)*10n**6n);
      if(await shares.totalSupply()!==0n || await vault.basketTickerHoldings(1,token.target)!==0n)throw Error("Residual share/ledger invariant");
      results.vault.push({amountUsdg:amount,status:"ROUND_TRIP_PASS",returnedUsdg:ethers.formatUnits(returned,6),lossPct:(1-Number(returned)/(amount*1e6))*100,
        mintGas:String(mint.gasUsed),redeemGas:String(redeem.gasUsed)});
    }catch(e:any){results.vault.push({amountUsdg:amount,status:"REVERT",stage,error:e.shortMessage??e.message});}
    console.log("vault",JSON.stringify(results.vault.at(-1)));
  }
  if(chainlink){
    // Guard check: the ticker feed alone must reject once older than maxStaleness (USDG feed is not on this read path).
    await ethers.provider.send("evm_revert",[baseline]);baseline=await ethers.provider.send("evm_snapshot",[]);
    await ethers.provider.send("evm_increaseTime",[Number(chainlink.maxStaleness)+1]);await ethers.provider.send("evm_mine",[]);
    try{await vault.getOraclePriceUsd18(token.target);results.staleCheck="NOT_REJECTED";}
    catch(e:any){const raw=e.data??e.error?.data;const name=typeof raw==="string"?vault.interface.parseError(raw)?.name:null;
      results.staleCheck=(name==="StaleOraclePrice"||String(e.shortMessage??e.message).includes("StaleOraclePrice"))?"REJECTED":`UNEXPECTED:${name??e.shortMessage??e.message}`;}
    console.log("staleCheck",results.staleCheck);
    await ethers.provider.send("evm_revert",[baseline]);
  }
  results.manipulation = [];
  for (const amount of (riskCheck||chainlink)?[]:[10000, 50000]) {
    await ethers.provider.send("evm_revert",[baseline]);baseline=await ethers.provider.send("evm_snapshot",[]);
    const start=await usd.balanceOf(user.address), quoteBefore=(await registry.quoteUsdg18(token.target))[0];
    try {
      await trade(usd.target,token.target,BigInt(amount)*10n**6n);
      let immediateQuoteRejected=false;
      try { await registry.quoteUsdg18(token.target); } catch { immediateQuoteRejected=true; }
      await ethers.provider.send("evm_increaseTime",[1801]);await ethers.provider.send("evm_mine",[]);
      await trade(usd.target,token.target,100_000_000n); // $100 probe: small swaps may not change a tick or write an observation.
      const after=(await registry.quoteUsdg18(token.target))[0];
      await trade(token.target,usd.target,await token.balanceOf(user.address));
      results.manipulation.push({capitalUsdg:amount+100,heldSeconds:1801,immediateQuoteRejected,
        quoteRisePct:(Number(after)/Number(quoteBefore)-1)*100,oracleAcceptedAfterHold:true,
        closedRoundTripCostUsdg:ethers.formatUnits(start-await usd.balanceOf(user.address),6),
        limitation:"No competing arbitrage simulated, no extracted vault profit; cost is an isolated-pool scenario, not total sustained-attack cost."});
    }catch(e:any){results.manipulation.push({capitalUsdg:amount,error:e.shortMessage??e.message});}
    console.log("manipulation",JSON.stringify(results.manipulation.at(-1)));
  }

  if(riskCheck) {
    results.targetedRisk=[];
    // STAX_PROBE_VICTIM_USDG (1000-10000, default 10000): the victim's mint in the manipulation probe. Lower it only when the
    // basket's per-deposit cap keeps this token's leg below the tested size; the value is recorded in every probe row.
    const victimUsdg=Number(process.env.STAX_PROBE_VICTIM_USDG??10000);
    if(!Number.isInteger(victimUsdg)||victimUsdg<1000||victimUsdg>10000)throw new Error("STAX_PROBE_VICTIM_USDG must be an integer 1000-10000");
    const victimRaw=BigInt(victimUsdg)*1_000_000n;
    for(const window of safetyOverride?[results.trialParameters.twapWindow]:[900,1800,3600]) {
      await ethers.provider.send("evm_revert",[baseline]);baseline=await ethers.provider.send("evm_snapshot",[]);
      let stage="configure";
      const deviation=safetyOverride?results.trialParameters.maxDeviationBps:100;
      const row:any={window,maxDeviationBps:deviation,victimDepositUsdg:victimUsdg,victimDepositOverridden:victimUsdg!==10000,attackerDepositUsdg:1000,manipulationCapitalUsdg:100000,
        caveat:"Isolated single-token basket, one upward attack path, no external arbitrage. Experimental settings, not production approval. Profit excludes gas."};
      try {
        // Floors deliberately unchanged: isolate window/deviation behaviour in this bounded experiment.
        await(await registry.configureToken(token.target,{pool:evidence.addresses.pool,...results.trialParameters,twapWindow:window,maxObservationAge:window,maxDeviationBps:deviation},{gasLimit:2_000_000})).wait();
        stage="victim mint";
        await(await usd.transfer(owner.address,victimRaw)).wait();
        await(await usd.connect(owner).approve(vault.target,ethers.MaxUint256)).wait();
        let deadline=(await ethers.provider.getBlock("latest"))!.timestamp+600;
        await(await vault.mint(1,victimRaw,1,deadline)).wait();
        const start=await usd.balanceOf(user.address);
        const victimShares=await shares.balanceOf(owner.address);
        const heldBefore=await vault.basketTickerHoldings(1,token.target);
        stage="manipulation";
        await trade(usd.target,token.target,100_000_000_000n);
        await ethers.provider.send("evm_increaseTime",[window+1]);await ethers.provider.send("evm_mine",[]);
        await trade(usd.target,token.target,1_000_000_000n);
        row.quoteAfterHold=String((await registry.quoteUsdg18(token.target))[0]);
        stage="attacker mint";
        deadline=(await ethers.provider.getBlock("latest"))!.timestamp+600;
        await(await vault.connect(user).mint(1,1_000_000_000n,1,deadline)).wait();
        const minted=await shares.balanceOf(user.address),total=await shares.totalSupply();
        const heldAfter=await vault.basketTickerHoldings(1,token.target);
        const claimBefore=heldBefore;
        const claimAfter=heldAfter*victimShares/total;
        row.victimUnderlyingClaimChangeRaw=String(claimAfter-claimBefore);
        row.victimUnderlyingClaimChangePct=Number(claimAfter-claimBefore)/Number(claimBefore)*100;
        stage="unwind manipulation";
        await trade(token.target,usd.target,await token.balanceOf(user.address));
        stage="attacker redeem";
        try {
          await(await vault.connect(user).redeem(1,minted,1,deadline)).wait();row.immediateRedeemPassed=true;
        }catch {
          row.immediateRedeemPassed=false;
          await ethers.provider.send("evm_increaseTime",[window+1]);await ethers.provider.send("evm_mine",[]);
          await trade(usd.target,token.target,1_000_000_000n);
          await trade(token.target,usd.target,await token.balanceOf(user.address));
          deadline=(await ethers.provider.getBlock("latest"))!.timestamp+600;
          await(await vault.connect(user).redeem(1,minted,1,deadline)).wait();
        }
        if(await token.balanceOf(user.address)!==0n || await shares.balanceOf(user.address)!==0n)throw Error("Unclosed inventory");
        row.attackerProfitUsdg=ethers.formatUnits(await usd.balanceOf(user.address)-start,6);
        stage="victim redeem";
        await(await vault.redeem(1,victimShares,1,deadline)).wait();
        row.victimReturnedUsdg=ethers.formatUnits(await usd.balanceOf(owner.address),6);
        row.status="COMPLETED";
      }catch(e:any){row.status="INCOMPLETE";row.stage=stage;row.error=e.shortMessage??e.message;}
      results.targetedRisk.push(row);console.log("targetedRisk",JSON.stringify(row));
      await writeFile(directory+"/fork-results.json",JSON.stringify(results,null,2));
    }
    if(safetyOverride){
      await ethers.provider.send("evm_revert",[baseline]);
      const clean=await ethers.provider.send("evm_snapshot",[]);
      const expectError=async(action:()=>Promise<any>,name:string)=>{
        try{await action();throw Error(`Expected ${name}`);}catch(e:any){
          const raw=e.data??e.error?.data;const decoded=typeof raw==="string"?registry.interface.parseError(raw)?.name:null;
          if(decoded!==name && !String(e.shortMessage??e.message).includes(`'${name}()'`))throw e;
        }
      };
      const storage=BigInt(await ethers.provider.getStorage(pool.target,4));
      const floor=BigInt(results.trialParameters.minCurrentLiquidity);
      await ethers.provider.send("hardhat_setStorageAt",[pool.target,ethers.toBeHex(4,32),ethers.toBeHex((storage>>128n<<128n)|(floor-1n),32)]);
      await expectError(()=>registry.quoteUsdg18(token.target),"InsufficientLiquidity");
      await ethers.provider.send("evm_revert",[clean]);
      const quote=await registry.quoteUsdg18(token.target);
      await expectError(()=>registry.configureToken.staticCall(token.target,{pool:evidence.addresses.pool,...results.trialParameters,minHarmonicLiquidity:quote[1]+1n}),"InsufficientLiquidity");
      await ethers.provider.send("evm_increaseTime",[results.trialParameters.maxObservationAge+1]);await ethers.provider.send("evm_mine",[]);
      await expectError(()=>registry.quoteUsdg18(token.target),"StaleObservation");
      results.floorChecks={currentLiquidityBelowFloor:"REJECTED",harmonicLiquidityBelowFloor:"REJECTED",observationTooOld:"REJECTED",note:"Current-liquidity boundary uses fork storage injection; this is a guard test, not realistic LP withdrawal modelling."};
      console.log("floorChecks",JSON.stringify(results.floorChecks));
    }
  }

}catch(e:any){results.assessmentError=e.shortMessage??e.message;console.error("Assessment stopped:",results.assessmentError);process.exitCode=1;}
finally {await writeFile(directory+"/fork-results.json",JSON.stringify(results,null,2)+"\n");await connection.close();}
