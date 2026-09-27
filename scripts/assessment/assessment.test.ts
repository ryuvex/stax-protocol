import {test} from "node:test";
import assert from "node:assert/strict";
import {findFeedCandidates,summarizeFork,assessCandidates,compareCandidates} from "./assess-token.ts";
test("feed matching does not confuse token names or interpret absence as approval",()=>{
 const feeds=[{name:"Cash Cat / USD",proxyAddress:"feed"},{name:"PONS / USD"}];
 assert.equal(findFeedCandidates(feeds,"CASHCAT","0x1234").length,1);
 assert.equal(findFeedCandidates(feeds,"CAT","0x1234").length,0);
 assert.equal(findFeedCandidates(feeds,"","0x1234").length,0);
});
test("multiple active pools are assessed independently and failure does not skip later candidates",async()=>{
 const visited:string[]=[], saved:number[]=[];
 const results=await assessCandidates([{address:"thin",fee:10000},{address:"deep",fee:3000}],async p=>{
   visited.push(p.address);if(p.address==="thin")throw Error("insufficient history");
   return {...p,...summarizeFork(0,{vault:[{status:"ROUND_TRIP_PASS",amountUsdg:1000}]}),summary:summarizeFork(0,{vault:[{status:"ROUND_TRIP_PASS",amountUsdg:1000}]})};
 },async r=>{saved.push(r.length);});
 assert.deepEqual(visited,["thin","deep"]);assert.deepEqual(saved,[1,2]);
 const comparison=compareCandidates(results);
 assert.equal(comparison.status,"REVIEW_REQUIRED");assert.equal(comparison.listingApproved,false);assert.equal(comparison.selectedPool,null);
 assert.equal(comparison.pools[0].status,"BLOCKED");assert.deepEqual(comparison.pools[1].passedRoundTripSizesUsdg,[1000]);
});
test("zero or all-failed candidates cannot produce a successful assessment",()=>{
 assert.equal(compareCandidates([]).status,"BLOCKED");
 assert.equal(compareCandidates([{address:"a",status:"BLOCKED"},{address:"b",status:"DEPLOYMENT_REVIEW_REQUIRED"}]).status,"BLOCKED");
});
test("failed or empty fork runs are blocked, not counted as successful verification",()=>{
 assert.equal(summarizeFork(1,{assessmentError:"RPC",vault:[]}).status,"BLOCKED");
 assert.equal(summarizeFork(0,{vault:[]}).status,"BLOCKED");
 assert.equal(summarizeFork(0,{vault:[{status:"REVERT",amountUsdg:10,stage:"mint"}]}).status,"BLOCKED");
});
test("passing sizes stay distinct from reverting sizes and never approve listing",()=>{
 const result=summarizeFork(0,{vault:[{status:"ROUND_TRIP_PASS",amountUsdg:100},{status:"REVERT",amountUsdg:10000,stage:"mint"}]});
 assert.equal(result.status,"REVIEW_REQUIRED");assert.equal(result.listingApproved,false);
 assert.deepEqual(result.passedRoundTripSizesUsdg,[100]);assert.deepEqual(result.revertedRoundTripSizes,[{amountUsdg:10000,stage:"mint"}]);
});
