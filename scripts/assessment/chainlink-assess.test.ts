import {test} from "node:test";
import assert from "node:assert/strict";
import {qualifyChainlink,resolveFeedAddress} from "./chainlink-assess.ts";
const A="0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15",B="0x943A29E7ae51A4798823ca9eEd2ed533B2A22C72";
test("configured vault feed wins; directory alone is used only when unambiguous",()=>{
 assert.equal(resolveFeedAddress([{status:"candidate",feed:A}],[{proxyAddress:B}]).feed,A);
 assert.equal(resolveFeedAddress([{status:"candidate",feed:A}],[{proxyAddress:B}]).directoryAgrees,false);
 assert.equal(resolveFeedAddress([{status:"not-configured"}],[{proxyAddress:B}]).feed,B);
 assert.equal(resolveFeedAddress([{status:"not-configured"}],[{proxyAddress:A},{proxyAddress:B}]).feed,null);
 assert.equal(resolveFeedAddress([{status:"not-configured"}],[{name:"X / USD"}]).feed,null);
 assert.equal(resolveFeedAddress([{status:"candidate",feed:A},{status:"candidate",feed:B}],[]).feed,null);
});
const params={feed:A,maxStaleness:345600,route:{venue:"v3",fee:3000},slippageBps:200};
const good={mode:"CHAINLINK_FORK",chainlink:{feed:A,maxStaleness:345600},staleCheck:"REJECTED",vault:[10,100,1000,10000].map(n=>({status:"ROUND_TRIP_PASS",amountUsdg:n}))};
test("chainlink qualification requires clean checks, matching fork params, round trips and the stale guard",()=>{
 assert.equal(qualifyChainlink(params,good,0,{problems:[]}).status,"PROPOSED_FOR_REVIEW");
 assert.equal(qualifyChainlink(params,good,0,{problems:["oraclePaused"]}).status,"INSUFFICIENT_EVIDENCE");
 assert.equal(qualifyChainlink(params,good,1,{problems:[]}).status,"INSUFFICIENT_EVIDENCE");
 assert.equal(qualifyChainlink(params,{...good,chainlink:{feed:B,maxStaleness:345600}},0,{problems:[]}).status,"INSUFFICIENT_EVIDENCE");
 assert.equal(qualifyChainlink(params,{...good,staleCheck:"NOT_REJECTED"},0,{problems:[]}).status,"INSUFFICIENT_EVIDENCE");
 assert.equal(qualifyChainlink(params,{...good,vault:good.vault.filter(v=>v.amountUsdg!==1000)},0,{problems:[]}).status,"INSUFFICIENT_EVIDENCE");
 const r:any=qualifyChainlink(params,good,0,{problems:[]});
 assert.equal(r.listingApproved,false);assert.equal(r.totalBasketCap,null);assert.deepEqual(r.passedRoundTripSizesUsdg,[10,100,1000,10000]);
});
