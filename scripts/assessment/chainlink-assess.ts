import {AbiCoder,Contract,Interface,ZeroAddress,getAddress,getCreate2Address,keccak256} from "ethers";
import type {AbstractProvider} from "ethers";
import {readFile,writeFile} from "node:fs/promises";

// Chainlink listing policy for V2. Explicit heuristics, not proof of safety.
export const CHAINLINK_POLICY={
  historySeconds:30*86400,        // walk feed rounds back this far
  maxRounds:4000,                 // hard cap on rounds inspected
  minimumStaleness:345_600,       // never propose below V1's measured 96h
  stalenessMultiplier:1.25,       // proposed = max(minimum, ceil(maxGap*1.25) to the hour)
  maxFeedSpotDeviationBps:1000,   // feed vs pool spot sanity bound (10%)
  slippageBps:200,
};
const MULTICALL="0xcA11bde05977b3631167028862bE2a173976CA11";
const FEED_ABI=["function decimals() view returns(uint8)","function description() view returns(string)",
 "function latestRoundData() view returns(uint80 roundId,int256 answer,uint256 startedAt,uint256 updatedAt,uint80 answeredInRound)",
 "function getRoundData(uint80) view returns(uint80 roundId,int256 answer,uint256 startedAt,uint256 updatedAt,uint80 answeredInRound)"];
const SOURCE_VAULT_ABI=["function priceFeeds(address) view returns(address feed,uint48 maxStaleness)",
 "function tickerIsV3(address) view returns(bool)","function tickerPoolsV3(address) view returns(uint24 fee,bool exists)",
 "function tickerPools(address) view returns(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)",
 "function universalRouter() view returns(address)","function permit2() view returns(address)","function usdgUsdFeed() view returns(address)",
 "function usdgUsdMaxStaleness() view returns(uint48)","function sequencerUptimeFeed() view returns(address)"];
const same=(a:string,b:string)=>a.toLowerCase()===b.toLowerCase();

export type Route={venue:"v3";fee:number;pool:string;source:string}
 |{venue:"v4";currency0:string;currency1:string;fee:number;tickSpacing:number;hooks:string;source:string};

/// Feed address: an existing configured vault feed wins; otherwise a directory entry with a proxy address.
export function resolveFeedAddress(feedLookups:any[],directoryCandidates:any[]) {
  const configured=[...new Set(feedLookups.filter(x=>x.status==="candidate"&&x.feed).map(x=>getAddress(x.feed)))];
  const directory=[...new Set(directoryCandidates.map(f=>f.proxyAddress??f.contractAddress).filter(x=>typeof x==="string"&&/^0x[0-9a-fA-F]{40}$/.test(x)).map(x=>getAddress(x)))];
  if(configured.length>1)return {feed:null,reason:"Configured source vaults disagree on the feed address; manual selection required."};
  if(configured.length===1)return {feed:configured[0],source:"configured source vault",directoryAgrees:directory.length===0?null:directory.some(d=>same(d,configured[0]))};
  if(directory.length===1)return {feed:directory[0],source:"Chainlink directory (address/name match; identity NOT verified)",directoryAgrees:true};
  return {feed:null,reason:directory.length?"Multiple directory feed candidates; manual selection required.":"Feed candidate found but no usable feed address; manual selection required."};
}

/// Walks real round history to measure the largest update gap. Reports; does not approve.
export async function measureFeedHistory(provider:AbstractProvider,feed:string,blockNumber:number,blockTimestamp:number,policy=CHAINLINK_POLICY) {
  const at={blockTag:blockNumber},iface=new Interface(FEED_ABI),f=new Contract(feed,FEED_ABI,provider);
  const latest=await f.latestRoundData(at);
  const rounds:{roundId:string;updatedAt:number;answer:string}[]=[{roundId:String(latest.roundId),updatedAt:Number(latest.updatedAt),answer:String(latest.answer)}];
  const cutoff=blockTimestamp-policy.historySeconds;
  const hasMulti=await provider.getCode(MULTICALL,blockNumber)!=="0x";
  const multi=new Contract(MULTICALL,["function aggregate3((address target,bool allowFailure,bytes callData)[]) payable returns((bool success,bytes returnData)[])"],provider);
  let next=BigInt(latest.roundId)-1n,stoppedBy="cutoff";
  outer: while(rounds.length<policy.maxRounds&&rounds.at(-1)!.updatedAt>cutoff){
    const ids:bigint[]=[];for(let i=0;i<(hasMulti?200:10)&&next-BigInt(i)>0n;i++)ids.push(next-BigInt(i));
    if(!ids.length){stoppedBy="round zero";break;}
    const rows=hasMulti
      ?(await multi.aggregate3.staticCall(ids.map(id=>({target:feed,allowFailure:true,callData:iface.encodeFunctionData("getRoundData",[id])})),at))
        .map((r:any)=>r.success&&r.returnData!=="0x"?iface.decodeFunctionResult("getRoundData",r.returnData):null)
      :await Promise.all(ids.map(id=>f.getRoundData(id,at).catch(()=>null)));
    for(const r of rows){
      // A failed/empty round means a phase boundary: earlier phases are not walked automatically.
      if(!r||Number(r.updatedAt)===0){stoppedBy="phase boundary or missing round";break outer;}
      rounds.push({roundId:String(r.roundId),updatedAt:Number(r.updatedAt),answer:String(r.answer)});
      if(Number(r.updatedAt)<=cutoff||rounds.length>=policy.maxRounds)break outer;
    }
    next-=BigInt(ids.length);
  }
  const gaps=rounds.slice(1).map((r,i)=>rounds[i].updatedAt-r.updatedAt);
  const maxGap=Math.max(0,...gaps),currentAge=blockTimestamp-rounds[0].updatedAt;
  const coveredSeconds=rounds[0].updatedAt-rounds.at(-1)!.updatedAt;
  const proposedMaxStaleness=Math.max(policy.minimumStaleness,Math.ceil(Math.max(maxGap,currentAge)*policy.stalenessMultiplier/3600)*3600);
  return {rounds:rounds.length,coveredSeconds,coveredDays:coveredSeconds/86400,maxGapSeconds:maxGap,currentAgeSeconds:currentAge,
    stoppedBy,proposedMaxStaleness,nonPositiveAnswers:rounds.filter(r=>BigInt(r.answer)<=0n).length,
    caveat:"Finite window of round history. A holiday weekend longer than anything observed can still exceed the proposed staleness."};
}

/// Prefer the route an existing configured vault already executes on; otherwise the deepest canonical V3 USDG pool.
export async function selectRoute(provider:AbstractProvider,discovery:any,sourceVaults:string[],blockNumber:number):Promise<{route:Route|null;reason:string|null;alternatives:any[]}> {
  const at={blockTag:blockNumber},token=discovery.token.address;
  // STAX_FORCE_V3_POOL=<address>: assess a specific canonical V3 USDG pool instead of the source vault's route.
  const forced=process.env.STAX_FORCE_V3_POOL;
  if(forced){
    const pool=discovery.pools.find((p:any)=>same(p.address,forced));
    if(!pool)return {route:null,reason:`STAX_FORCE_V3_POOL ${forced} is not a canonical V3 USDG pool for this token.`,alternatives:[]};
    return {route:{venue:"v3",fee:pool.fee,pool:pool.address,source:"STAX_FORCE_V3_POOL override"},reason:null,alternatives:[]};
  }
  for(const source of sourceVaults){
    try{
      const v=new Contract(source,SOURCE_VAULT_ABI,provider);
      if(await v.tickerIsV3(token,at)){
        const cfg=await v.tickerPoolsV3(token,at);
        const pool=discovery.pools.find((p:any)=>p.fee===Number(cfg.fee));
        if(!pool)return {route:null,reason:`Source vault ${source} uses V3 fee ${cfg.fee} but discovery found no canonical pool for it.`,alternatives:[]};
        return {route:{venue:"v3",fee:Number(cfg.fee),pool:pool.address,source},reason:null,alternatives:[]};
      }
      const key=await v.tickerPools(token,at);
      if(key.currency0!==ZeroAddress||key.currency1!==ZeroAddress){
        if(key.hooks!==ZeroAddress)return {route:null,reason:"Source vault route uses a hook; V2 requires hookless pools unless explicitly allowlisted.",alternatives:[]};
        return {route:{venue:"v4",currency0:key.currency0,currency1:key.currency1,fee:Number(key.fee),tickSpacing:Number(key.tickSpacing),hooks:key.hooks,source},reason:null,alternatives:[]};
      }
    }catch{ /* source vault unreadable: fall through to discovery */ }
  }
  const active=discovery.pools.filter((p:any)=>BigInt(p.currentLiquidityRaw)>0n&&p.unlocked).sort((a:any,b:any)=>BigInt(b.currentLiquidityRaw)>BigInt(a.currentLiquidityRaw)?1:-1);
  if(!active.length)return {route:null,reason:"No configured source route and no active canonical V3 USDG pool. V4 pool discovery is not automated; supply the route manually.",alternatives:[]};
  return {route:{venue:"v3",fee:active[0].fee,pool:active[0].address,source:"deepest canonical V3 USDG pool (raw liquidity, not USD depth)"},reason:null,
    alternatives:active.slice(1).map((p:any)=>({address:p.address,fee:p.fee,currentLiquidityRaw:p.currentLiquidityRaw}))};
}

/// Sanity checks on the feed and token before spending fork time. Failures are reasons, not approvals.
export async function checkFeedAndToken(provider:AbstractProvider,discovery:any,feed:string,route:Route|null,blockNumber:number,blockTimestamp:number,policy=CHAINLINK_POLICY) {
  const at={blockTag:blockNumber},problems:string[]=[];
  const token=new Contract(discovery.token.address,["function oraclePaused() view returns(bool)"],provider);
  let oraclePaused:boolean|null=null;
  try{oraclePaused=await token.oraclePaused(at);}catch{problems.push("Token has no working oraclePaused(); V2's Chainlink branch cannot price it.");}
  if(oraclePaused===true)problems.push("Token reports oraclePaused()=true at the assessed block.");
  const f=new Contract(feed,FEED_ABI,provider);
  let decimals=0,description:string|null=null,answer=0n,updatedAt=0;
  try{
    decimals=Number(await f.decimals(at));const r=await f.latestRoundData(at);answer=BigInt(r.answer);updatedAt=Number(r.updatedAt);
    try{description=await f.description(at);}catch{ /* optional */ }
    if(decimals>18)problems.push("Feed decimals exceed 18.");
    if(answer<=0n)problems.push("Feed latest answer is not positive.");
    if(updatedAt===0||updatedAt>blockTimestamp)problems.push("Feed updatedAt is invalid.");
  }catch{problems.push("Feed does not implement AggregatorV3 decimals()/latestRoundData().");}
  // Feed price vs pool spot, both in USDG per token; USDG assumed ~1 USD for this sanity bound only.
  let feedPriceUsd:number|null=null,poolSpotUsdg:number|null=null,feedSpotDeviationBps:number|null=null;
  if(answer>0n&&decimals<=18){
    feedPriceUsd=Number(answer)/10**decimals;
    // Only the execution pool is a meaningful reference; unrelated thin V3 pools would give false alarms for V4 routes.
    const v3=route?.venue==="v3"?discovery.pools.find((p:any)=>same(p.address,route.pool)):null;
    if(v3){
      const sign=same(v3.token0,discovery.token.address)?1:-1;
      poolSpotUsdg=Math.pow(1.0001,sign*v3.tick)*10**(discovery.token.decimals-discovery.usdg.decimals);
      feedSpotDeviationBps=Math.abs(poolSpotUsdg/feedPriceUsd-1)*10000;
      if(feedSpotDeviationBps>policy.maxFeedSpotDeviationBps)problems.push(`Feed price deviates ${feedSpotDeviationBps.toFixed(0)} bps from the V3 pool spot; verify feed identity.`);
    }
  }
  return {feed,description,decimals,latestAnswer:String(answer),updatedAt,oraclePaused,feedPriceUsd,poolSpotUsdg,feedSpotDeviationBps,problems,
    note:poolSpotUsdg===null?"Feed-vs-spot sanity check applies to V3 routes only; for V4 routes the fork round trips at 2% slippage are the price-consistency evidence.":null};
}

/// Minimal fork evidence for the Chainlink path (no V3 observation history needed).
export async function collectBaseSnapshot(provider:AbstractProvider,discovery:any,route:Route|null,sourceVault:string,directory:string) {
  const block=await provider.getBlock(discovery.blockNumber);if(!block?.hash||block.hash!==discovery.blockHash)throw Error("Discovery block changed");
  const at={blockTag:block.number},v=new Contract(sourceVault,SOURCE_VAULT_ABI,provider);
  const artifact=JSON.parse(await readFile("node_modules/@uniswap/v3-core/artifacts/contracts/UniswapV3Pool.sol/UniswapV3Pool.json","utf8"));
  const hash=keccak256(artifact.bytecode);
  const router=await v.universalRouter(at),routerCode=await provider.getCode(router,block.number);
  const pool=route?.venue==="v3"?discovery.pools.find((p:any)=>same(p.address,route.pool)):null;
  const derivationMatches=pool?same(getCreate2Address(discovery.factory,keccak256(AbiCoder.defaultAbiCoder().encode(["address","address","uint24"],[pool.token0,pool.token1,pool.fee])),hash),pool.address):null;
  const result={blockNumber:block.number,blockHash:block.hash,timestamp:block.timestamp,
    addresses:{token:discovery.token.address,usdg:discovery.usdg.address,pool:pool?.address??null,v1:sourceVault},
    router,factory:discovery.factory,permit2:await v.permit2(at),usdgFeed:await v.usdgUsdFeed(at),usdgMaxStaleness:String(await v.usdgUsdMaxStaleness(at)),
    sequencerFeed:await v.sequencerUptimeFeed(at),poolInitCodeHash:hash,derivationMatches,
    routerContainsFactory:routerCode.toLowerCase().includes(discovery.factory.toLowerCase().slice(2)),routerContainsPoolHash:routerCode.toLowerCase().includes(hash.slice(2)),
    tokenDecimals:discovery.token.decimals,usdgDecimals:discovery.usdg.decimals,token0:pool?.token0??null,token1:pool?.token1??null,fee:pool?.fee??(route?.venue==="v4"?route.fee:null),
    route,mode:"CHAINLINK"};
  await writeFile(directory+"/snapshot.json",JSON.stringify(result,null,2)+"\n");
  return result;
}

export function qualifyChainlink(params:any,fork:any,exitCode:number,checks:any) {
  const fail=(reason:string)=>({status:"INSUFFICIENT_EVIDENCE",reason,params,listingApproved:false});
  if(checks.problems.length)return fail(`Feed/token checks failed: ${checks.problems.join(" ")}`);
  if(exitCode!==0||fork.assessmentError)return fail("Candidate fork failed or did not complete.");
  if(fork.mode!=="CHAINLINK_FORK"||!same(String(fork.chainlink?.feed),params.feed)||Number(fork.chainlink?.maxStaleness)!==params.maxStaleness)return fail("Tested configuration differs from candidate.");
  const passed=(fork.vault??[]).filter((x:any)=>x.status==="ROUND_TRIP_PASS").map((x:any)=>x.amountUsdg);
  if(![10,100,1000].every(n=>passed.includes(n)))return fail("Required 10/100/1000 USDG round trips did not all pass.");
  if(fork.staleCheck!=="REJECTED")return fail("Stale-feed rejection check is incomplete.");
  return {status:"PROPOSED_FOR_REVIEW",params,listingApproved:false,passedRoundTripSizesUsdg:passed,
    oracleType:"CHAINLINK",totalBasketCap:null,
    limitations:["Feed identity is inferred from the configured source vault or the public directory; confirm against Chainlink's official listing.",
      "Staleness proposal is measured from a finite window of round history and floored at V1's 96h; longer market closures can still block mint/redeem.",
      "Round trips prove integration at tested sizes only; they do not establish a safe basket cap.",
      "V4 routes are executed on the fork but not depth-probed by direct router trades."]};
}
