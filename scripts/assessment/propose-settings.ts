import {Contract,Interface} from "ethers";
import type {AbstractProvider} from "ethers";

// Explicit proposal policy, not contract constants or proof of economic safety.
// STAX_MAX_DEVIATION_BPS raises the 200 bps proposal ceiling for an explicitly approved token (Dan's call per listing).
const deviationOverride=Number(process.env.STAX_MAX_DEVIATION_BPS??200);
if(!Number.isInteger(deviationOverride)||deviationOverride<50||deviationOverride>500)throw Error("STAX_MAX_DEVIATION_BPS must be an integer 50-500");
// STAX_LIQUIDITY_FLOOR_FRACTION (0.1-1) sets the floor below the observed 72h minimum liquidity; 1 = the minimum itself.
const floorFraction=Number(process.env.STAX_LIQUIDITY_FLOOR_FRACTION??1);
if(!Number.isFinite(floorFraction)||floorFraction<0.1||floorFraction>1)throw Error("STAX_LIQUIDITY_FLOOR_FRACTION must be between 0.1 and 1");
// STAX_MAX_STALE_FRACTION (0.05-0.25) tolerates a quiet pool: the share of windows with no fresh observation (Dan's call per listing).
const staleOverride=Number(process.env.STAX_MAX_STALE_FRACTION??0.05);
if(!Number.isFinite(staleOverride)||staleOverride<0.05||staleOverride>0.25)throw Error("STAX_MAX_STALE_FRACTION must be between 0.05 and 0.25");
// STAX_TWAP_WINDOWS (comma-separated seconds) restricts the candidate windows, e.g. "10800" to force a 3h proposal.
const windowsOverride=(process.env.STAX_TWAP_WINDOWS??"1800,3600,10800").split(",").map(x=>Number(x.trim())).filter(Boolean);
if(!windowsOverride.length||windowsOverride.some(w=>![1800,3600,10800].includes(w)))throw Error("STAX_TWAP_WINDOWS must be a subset of 1800,3600,10800");
export const PROPOSAL_POLICY={windows:windowsOverride,minimumHistorySeconds:86400,minimumObservations:100,
  maximumHistoricalStaleFraction:staleOverride,maximumProposedDeviationBps:deviationOverride,slippageBps:200,maxCandidates:3,
  liquidityFloorFraction:floorFraction,deviationCeilingOverridden:deviationOverride!==200,liquidityFloorOverridden:floorFraction!==1,
  staleFractionOverridden:staleOverride!==0.05};
export type Observation={timestamp:number;tickCumulative:string;secondsPerLiquidity:string};
// Rank only qualified candidates. This expresses a preference, not proof of safety.
export function recommendCandidate(settings:any[]) {
  const eligible=settings.filter(s=>s.status==="PROPOSED_FOR_REVIEW");
  const ranked=[...eligible].sort((a,b)=>
    Number(a.attackOutcome!=="TESTED_PATH_UNPROFITABLE")-Number(b.attackOutcome!=="TESTED_PATH_UNPROFITABLE") ||
    a.params.maxDeviationBps-b.params.maxDeviationBps ||
    a.params.twapWindow-b.params.twapWindow ||
    a.statistics.historicalStaleFraction-b.statistics.historicalStaleFraction ||
    a.fee-b.fee || String(a.pool).toLowerCase().localeCompare(String(b.pool).toLowerCase()));
  const recommendedSetting=ranked[0]??null;
  return {recommendedSetting,alternatives:ranked.slice(1),
    recommendationReason:recommendedSetting
      ? "Among passing candidates, prefer a completed unprofitable attack test, then tighter deviation, shorter TWAP window, less historical staleness, and lower pool fee. This is a policy preference, not a safety guarantee; staleness/deviation can still block withdrawals."
      : "No suitable configuration: no candidate passed the required checks."};
}
export async function collectObservations(provider:AbstractProvider,snapshot:any):Promise<Observation[]> {
  const at={blockTag:snapshot.blockNumber};
  const abi=["function slot0() view returns(uint160,int24,uint16,uint16,uint16,uint8,bool)","function observations(uint256) view returns(uint32,int56,uint160,bool)"];
  const pool=new Contract(snapshot.addresses.pool,abi,provider),iface=new Interface(abi);
  const slot=await pool.slot0(at),count=Number(slot[3]);
  if(count<2) return [];
  const multiAddress="0xcA11bde05977b3631167028862bE2a173976CA11";
  const hasMulti=await provider.getCode(multiAddress,snapshot.blockNumber)!=="0x";
  const multi=new Contract(multiAddress,["function aggregate3((address target,bool allowFailure,bytes callData)[]) payable returns((bool success,bytes returnData)[])"],provider);
  const observations:Observation[]=[];
  for(let start=0;start<count;start+=hasMulti?300:20){
    const ids=Array.from({length:Math.min(hasMulti?300:20,count-start)},(_,i)=>start+i);
    const rows=hasMulti?(await multi.aggregate3.staticCall(ids.map(i=>({target:pool.target,allowFailure:false,callData:iface.encodeFunctionData("observations",[i])})),at)).map((r:any)=>iface.decodeFunctionResult("observations",r.returnData)):
      await Promise.all(ids.map(i=>pool.observations(i,at)));
    for(const r of rows)if(r[3])observations.push({timestamp:Number(r[0]),tickCumulative:String(r[1]),secondsPerLiquidity:String(r[2])});
  }
  return observations.sort((a,b)=>a.timestamp-b.timestamp);
}
function quantile(values:number[],q:number){const v=[...values].sort((a,b)=>a-b);return v[Math.min(v.length-1,Math.floor(v.length*q))];}
function floorTwoDigits(n:bigint){const scale=10n**BigInt(Math.max(0,n.toString().length-2));return n/scale*scale;}
export function generateCandidates(snapshot:any,input:Observation[]) {
  const policy=PROPOSAL_POLICY;
  const none=(reason:string)=>({policy,candidates:[] as any[],rejected:[] as any[],reason});
  const o=[...input].sort((a,b)=>a.timestamp-b.timestamp);
  if(o.length<policy.minimumObservations)return none("Insufficient initialized observations (need at least 100).");
  if(o.some((x,i)=>!Number.isSafeInteger(x.timestamp)||x.timestamp>snapshot.timestamp||(i>0&&x.timestamp<=o[i-1].timestamp)))return none("Invalid or duplicate observation timestamps.");
  const span=snapshot.timestamp-o[0].timestamp;
  if(span<policy.minimumHistorySeconds)return none("Need at least 24 hours of retained history.");
  // Unwrap the cumulative counters before interpolation.
  const ticks:bigint[]=[BigInt(o[0].tickCumulative)],spl:bigint[]=[BigInt(o[0].secondsPerLiquidity)];
  for(let i=1;i<o.length;i++){
    ticks.push(ticks[i-1]+BigInt.asIntN(56,BigInt(o[i].tickCumulative)-BigInt(o[i-1].tickCumulative)));
    spl.push(spl[i-1]+BigInt.asUintN(160,BigInt(o[i].secondsPerLiquidity)-BigInt(o[i-1].secondsPerLiquidity)));
  }
  function interpolate(t:number,values:bigint[]) {
    let lo=0,hi=o.length-1;
    while(lo+1<hi){const mid=(lo+hi)>>1;if(o[mid].timestamp<=t)lo=mid;else hi=mid;}
    if(t===o[hi].timestamp)return values[hi];
    return values[lo]+(values[hi]-values[lo])*BigInt(t-o[lo].timestamp)/BigInt(o[hi].timestamp-o[lo].timestamp);
  }
  const hourly:bigint[]=[];
  for(let end=o.at(-1)!.timestamp;end-3600>=o[0].timestamp && hourly.length<72;end-=3600){
    const delta=interpolate(end,spl)-interpolate(end-3600,spl);
    if(delta<=0n)return none("Invalid liquidity accumulation.");
    hourly.push(3600n*((1n<<160n)-1n)/(delta<<32n));
  }
  if(hourly.length<24)return none("Need 24 complete hourly liquidity measurements.");
  const minimum=hourly.reduce((a,b)=>a<b?a:b),floor=floorTwoDigits(minimum*BigInt(Math.round(policy.liquidityFloorFraction*1000))/1000n);
  if(floor<=1n)return none("Measured liquidity cannot support a meaningful floor.");
  const gaps=o.slice(1).map((x,i)=>x.timestamp-o[i].timestamp);
  const tail=snapshot.timestamp-o.at(-1)!.timestamp;
  const candidates:any[]=[],rejected:any[]=[];
  for(const window of policy.windows){
    const deviations:number[]=[];
    for(let i=1;i<o.length-1;i++){
      if(o[i].timestamp-window<o[0].timestamp)continue;
      const mean=Number(ticks[i]-interpolate(o[i].timestamp-window,ticks))/window;
      const tick=Number(ticks[i+1]-ticks[i])/(o[i+1].timestamp-o[i].timestamp);
      const sign=snapshot.token0.toLowerCase()===snapshot.addresses.token.toLowerCase()?1:-1;
      deviations.push(Math.abs(Math.pow(1.0001,sign*(tick-mean))-1)*10000);
    }
    const staleFraction=(gaps.reduce((sum,g)=>sum+Math.max(0,g-window),0)+Math.max(0,tail-window))/span;
    if(deviations.length<50||deviations.some(x=>!Number.isFinite(x))){rejected.push({window,reason:"Insufficient usable deviation samples"});continue;}
    const deviation=Math.max(50,Math.ceil(quantile(deviations,.95)/50)*50);
    const statistics={historicalStaleFraction:staleFraction,latestObservationAge:tail,maxGap:Math.max(...gaps),
      deviationP95Bps:quantile(deviations,.95),deviationP99Bps:quantile(deviations,.99),deviationSamples:deviations.length,
      deviationExceedanceFraction:deviations.filter(d=>d>deviation).length/deviations.length,hourlyLiquiditySamples:hourly.length,minimumHourlyLiquidity:String(minimum)};
    const reason=staleFraction>policy.maximumHistoricalStaleFraction?"Historical staleness exceeds proposal policy":
      tail>window?"Latest observation is stale for this window":deviation>policy.maximumProposedDeviationBps?"Measured deviation exceeds proposal policy":
      BigInt(snapshot.liquidity)<floor?"Current liquidity is below the observed-range floor":null;
    if(reason){rejected.push({window,reason,statistics});continue;}
    candidates.push({params:{twapWindow:window,maxObservationAge:window,minCurrentLiquidity:String(floor),minHarmonicLiquidity:String(floor),maxDeviationBps:deviation,slippageBps:policy.slippageBps},statistics});
  }
  return {policy,candidates:candidates.slice(0,policy.maxCandidates),rejected,reason:candidates.length?null:"No candidate satisfies the declared proposal policy."};
}
export function qualifyProposal(params:any,fork:any,exitCode:number) {
  const fail=(reason:string)=>({status:"INSUFFICIENT_EVIDENCE",reason,params,listingApproved:false});
  if(exitCode!==0||fork.assessmentError)return fail("Candidate fork failed or did not complete.");
  if(Object.entries(params).some(([k,v])=>String(fork.trialParameters?.[k])!==String(v)))return fail("Tested configuration differs from candidate.");
  const passed=(fork.vault??[]).filter((x:any)=>x.status==="ROUND_TRIP_PASS").map((x:any)=>x.amountUsdg);
  if(![10,100,1000].every(n=>passed.includes(n)))return fail("Required 10/100/1000 USDG round trips did not all pass.");
  if(!["currentLiquidityBelowFloor","harmonicLiquidityBelowFloor","observationTooOld"].every(k=>fork.floorChecks?.[k]==="REJECTED"))return fail("Protection boundary checks are incomplete.");
  const attacks=fork.targetedRisk??[];
  if(attacks.length!==1)return fail("Expected candidate attack probe is missing.");
  const a=attacks[0];
  const noDilution=typeof a.victimUnderlyingClaimChangeRaw==="string"&&BigInt(a.victimUnderlyingClaimChangeRaw)>=0n;
  const completed=a.status==="COMPLETED"&&Number.isFinite(Number(a.attackerProfitUsdg))&&Number(a.attackerProfitUsdg)<=0&&noDilution;
  const blocked=a.status==="INCOMPLETE"&&a.stage==="manipulation"&&["InsufficientLiquidity()","ExcessiveDeviation()","StaleObservation()"].some(e=>String(a.error).includes(`'${e}'`));
  if(!completed&&!blocked)return fail("Attack probe is unresolved, profitable, or diluted existing holders.");
  return {status:"PROPOSED_FOR_REVIEW",params,listingApproved:false,passedRoundTripSizesUsdg:passed,
    attackOutcome:blocked?"TESTED_PATH_BLOCKED":"TESTED_PATH_UNPROFITABLE",totalBasketCap:null,
    limitations:["Single-token basket only; not validated for mixed baskets.","Heuristic observed-range proposal, not a safety guarantee or listing approval.",
      "Historical withdrawal blocks are disclosed; future liquidity and availability can differ.","One upward attack path; downward attacks, sandwiches and LP-withdrawal economics are not covered.",
      "Tested trade sizes do not establish a safe total basket cap."]};
}
