import {test} from "node:test";
import assert from "node:assert/strict";
import {generateCandidates,qualifyProposal,recommendCandidate} from "./propose-settings.ts";
function fixture(){
 const liquidity=4_000_000_000_000_000_000n,step=600;
 const observations=Array.from({length:200},(_,i)=>({timestamp:100000+i*step,tickCumulative:String(-260000n*BigInt(i*step)),secondsPerLiquidity:String(BigInt(i*step)*(1n<<128n)/liquidity)}));
 return {observations,snapshot:{timestamp:observations.at(-1)!.timestamp,liquidity:String(liquidity),token0:"0xaaa",addresses:{token:"0xaaa"}}};
}
test("recommendation ranks passing candidates consistently and never promotes a failed candidate",()=>{
 const one={status:"PROPOSED_FOR_REVIEW",pool:"0xa",fee:3000,attackOutcome:"TESTED_PATH_UNPROFITABLE",params:{maxDeviationBps:100,twapWindow:3600},statistics:{historicalStaleFraction:.043}};
 const three={...one,params:{maxDeviationBps:200,twapWindow:10800},statistics:{historicalStaleFraction:0}};
 const failed={...one,status:"INSUFFICIENT_EVIDENCE",params:{maxDeviationBps:50,twapWindow:1800}};
 assert.equal(recommendCandidate([three,failed,one]).recommendedSetting,one);
 assert.deepEqual(recommendCandidate([one,three]).alternatives,[three]);
 assert.equal(recommendCandidate([failed]).recommendedSetting,null);
 assert.match(recommendCandidate([]).recommendationReason,/No suitable configuration/);
 const blocked={...one,attackOutcome:"TESTED_PATH_BLOCKED"};
 assert.equal(recommendCandidate([blocked,three]).recommendedSetting,three);
});
test("derives meaningful floors and bounded candidates from measured history",()=>{
 const f=fixture(),r=generateCandidates(f.snapshot,f.observations);
 assert.equal(r.candidates.length,3);
 // Conservative integer oracle rounding puts the measured value just below 4e18;
 // rounding DOWN to two significant digits therefore gives 3.9e18.
 for(const c of r.candidates){assert.equal(c.params.minCurrentLiquidity,"3900000000000000000");assert.equal(c.params.maxDeviationBps,50);assert.equal(c.statistics.historicalStaleFraction,0);assert.equal(c.params.maxObservationAge,c.params.twapWindow);}
});
test("does not invent settings for short history, duplicate timestamps or falling liquidity",()=>{
 const f=fixture();assert.equal(generateCandidates(f.snapshot,f.observations.slice(-10)).candidates.length,0);
 assert.equal(generateCandidates(f.snapshot,[...f.observations,f.observations[0]]).candidates.length,0);
 assert.equal(generateCandidates({...f.snapshot,liquidity:"2"},f.observations).candidates.length,0);
});
test("long quiet periods reject candidates by staleness policy, including current tail",()=>{
 const f=fixture();const r=generateCandidates({...f.snapshot,timestamp:f.snapshot.timestamp+86400},f.observations);
 assert.equal(r.candidates.length,0);assert.equal(r.rejected.length,3);
});
test("proposal requires exact parameters, round trips, guard checks and a resolved attack",()=>{
 const params={twapWindow:3600};
 const fork:any={trialParameters:params,vault:[10,100,1000].map(amountUsdg=>({amountUsdg,status:"ROUND_TRIP_PASS"})),floorChecks:{currentLiquidityBelowFloor:"REJECTED",harmonicLiquidityBelowFloor:"REJECTED",observationTooOld:"REJECTED"},targetedRisk:[{status:"COMPLETED",attackerProfitUsdg:"-10",victimUnderlyingClaimChangeRaw:"0"}]};
 assert.equal(qualifyProposal(params,fork,0).status,"PROPOSED_FOR_REVIEW");
 assert.equal(qualifyProposal(params,fork,0).listingApproved,false);
 assert.equal(qualifyProposal({twapWindow:1800},fork,0).status,"INSUFFICIENT_EVIDENCE");
 assert.equal(qualifyProposal(params,{...fork,floorChecks:{}},0).status,"INSUFFICIENT_EVIDENCE");
 fork.targetedRisk=[{status:"COMPLETED",attackerProfitUsdg:"1",victimUnderlyingClaimChangeRaw:"0"}];
 assert.equal(qualifyProposal(params,fork,0).status,"INSUFFICIENT_EVIDENCE");
 fork.targetedRisk=[{status:"INCOMPLETE",stage:"manipulation",error:"RPC unavailable"}];
 assert.equal(qualifyProposal(params,fork,0).status,"INSUFFICIENT_EVIDENCE");
 fork.targetedRisk=[{status:"INCOMPLETE",stage:"manipulation",error:"reverted with custom error 'InsufficientLiquidity()'"}];
 assert.equal(qualifyProposal(params,fork,0).status,"PROPOSED_FOR_REVIEW");
});
