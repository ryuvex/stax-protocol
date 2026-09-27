import { FetchRequest, JsonRpcProvider, getAddress } from "ethers";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { discoverWithoutVault, ROBINHOOD_DISCOVERY } from "../onboarding/discover-token.ts";
import { collectSnapshot } from "./token-snapshot.ts";
import {collectObservations,generateCandidates,qualifyProposal,recommendCandidate} from "./propose-settings.ts";
import {CHAINLINK_POLICY,checkFeedAndToken,collectBaseSnapshot,measureFeedHistory,qualifyChainlink,resolveFeedAddress,selectRoute} from "./chainlink-assess.ts";

async function runFork(root:string,directory:string,settingsPath?:string,chainlinkPath?:string) {
  return await new Promise<number>((finish,reject)=>{
    // Do not inherit a previous manual experiment's switches into a normal run.
    const env:NodeJS.ProcessEnv={...process.env,STAX_ASSESSMENT_SNAPSHOT:resolve(directory,"snapshot.json")};
    delete env.STAX_SAFETY_PARAMS;delete env.STAX_RISK_CHECK;delete env.STAX_CHAINLINK_PARAMS;
    if(settingsPath){env.STAX_SAFETY_PARAMS=settingsPath;env.STAX_RISK_CHECK="1";}
    if(chainlinkPath)env.STAX_CHAINLINK_PARAMS=chainlinkPath;
    const child=spawn(process.execPath,[resolve(root,"node_modules/hardhat/dist/src/cli.js"),"run","scripts/assessment/token-fork.ts"],{
      cwd:root,env,stdio:["ignore","pipe","pipe"],windowsHide:true});
    const sanitize=(s:string)=>process.env.STAX_RPC_URL?s.split(process.env.STAX_RPC_URL).join("[RPC]"):s;
    child.stdout.on("data",b=>process.stdout.write(sanitize(String(b))));
    child.stderr.on("data",b=>process.stderr.write(sanitize(String(b))));
    child.once("error",reject);child.once("close",code=>finish(code??1));
  });
}

// Directory names come as "Robinhood GOOGL / USD" and "Robinhood SGOV-USD"; both forms yield the bare symbol.
function robinhoodSymbol(name: unknown) { const m=typeof name==="string"?/^Robinhood\s+([A-Za-z0-9.]+)\s*(?:-|\/)\s*USD$/i.exec(name):null; return m?m[1]:undefined; }
export function findFeedCandidates(feeds: any[], symbol: string, address: string) {
  const normalize=(s:string)=>s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const target=normalize(symbol);
  return feeds.filter(f=>JSON.stringify(f).toLowerCase().includes(address.toLowerCase()) || (target.length>0 &&
    [f.name?.split("/")[0],robinhoodSymbol(f.name),f.docs?.baseAsset,f.assetName,f.ens].some(x=>typeof x==="string" && normalize(x)===target)));
}
export function summarizeFork(exitCode: number, fork: any) {
  const passed=(fork.vault??[]).filter((x:any)=>x.status==="ROUND_TRIP_PASS").map((x:any)=>x.amountUsdg);
  const reverted=(fork.vault??[]).filter((x:any)=>x.status==="REVERT").map((x:any)=>({amountUsdg:x.amountUsdg,stage:x.stage}));
  return {status: exitCode===0 && !fork.assessmentError && passed.length>0 ? "REVIEW_REQUIRED" : "BLOCKED",
    listingApproved:false,passedRoundTripSizesUsdg:passed,revertedRoundTripSizes:reverted};
}
// A failed candidate must not prevent independent pools from being assessed.
export async function assessCandidates(pools: any[], assess: (pool: any) => Promise<any>, save: (results: any[]) => Promise<void>) {
  const results: any[] = [];
  for (const pool of pools) {
    let result;
    try { result = await assess(pool); }
    catch { result = {address:pool.address,fee:pool.fee,status:"BLOCKED",error:"Candidate assessment failed; inspect its saved evidence and RPC availability."}; }
    results.push(result);
    await save(results);
  }
  return results;
}
export function compareCandidates(results: any[]) {
  return {
    status:results.some(p=>p.status==="REVIEW_REQUIRED")?"REVIEW_REQUIRED":"BLOCKED",
    listingApproved:false,selectedPool:null,
    pools:results.map(p=>({address:p.address,fee:p.fee,status:p.status,
      passedRoundTripSizesUsdg:p.summary?.passedRoundTripSizesUsdg??[],
      revertedRoundTripSizes:p.summary?.revertedRoundTripSizes??[],
      directSwapResults:p.fork?.direct??[],manipulationResults:p.fork?.manipulation??[],
      reason:p.reason??p.error??p.fork?.assessmentError??null})),
  };
}
export async function assessToken(input: string) {
  const token=getAddress(input), root=resolve(dirname(fileURLToPath(import.meta.url)),"../..");
  const directory=resolve(root,"reports","assessments",token.toLowerCase(),String(Date.now()));
  await mkdir(directory,{recursive:true});
  const report:any={token,status:"ASSESSING",stages:{},listingApproved:false,
    limitations:["Automated engineering assessment, not independent review or a listing approval.",
      "Probe sizes and oracle parameters are experiments. Production caps/parameters require economic review."]};
  const save=async()=>writeFile(resolve(directory,"assessment.json"),JSON.stringify(report,null,2)+"\n");
  const request=new FetchRequest(process.env.STAX_RPC_URL??ROBINHOOD_DISCOVERY.rpc);request.timeout=20000;
  const provider=new JsonRpcProvider(request,4663,{staticNetwork:true,batchMaxCount:1});
  try {
    report.currentStage="RPC connection / chain ID";
    let chainId;
    for(let attempt=0;attempt<3;attempt++){
      try {chainId=await provider.send("eth_chainId",[]);break;}
      catch(error){if(attempt===2)throw error;await new Promise(r=>setTimeout(r,1000));}
    }
    if(BigInt(chainId)!==4663n)throw Error("Wrong chain");
    report.currentStage="Token and pool discovery";
    console.log("1/4 Discovering token and pools...");
    const discovery=await discoverWithoutVault(provider,token);
    report.discovery=discovery;report.stages.discovery="COMPLETE";await save();
    console.log("2/4 Checking the Robinhood Chainlink directory...");
    report.currentStage="Chainlink directory";
    const url="https://reference-data-directory.vercel.app/feeds-robinhood-mainnet.json";
    const response=await fetch(url,{signal:AbortSignal.timeout(20000)});
    if(!response.ok)throw Error("Chainlink directory unavailable; no automatic TWAP fallback");
    const feeds=await response.json();if(!Array.isArray(feeds) || !feeds.length)throw Error("Invalid feed directory");
    await writeFile(resolve(directory,"chainlink-directory.json"),JSON.stringify(feeds,null,2));
    const candidates=findFeedCandidates(feeds,discovery.token.symbol??"",token);
    report.chainlink={source:url,count:feeds.length,checkedAt:new Date().toISOString(),candidates,
      caveat:"Address/name matches are candidates, not verified feed identity; no match is limited to this directory."};
    report.stages.chainlink="COMPLETE";await save();
    if(candidates.length || discovery.feedLookups.some(x=>x.status==="candidate")) {
      // Chainlink path: verify feed + route + measured staleness, then real V2 round trips on a local fork. No TWAP fallback.
      report.oracleType="CHAINLINK";report.currentStage="Chainlink feed, route and history";
      console.log("3/4 Chainlink candidate found: verifying feed, route and round history...");
      const resolved=resolveFeedAddress(discovery.feedLookups,candidates);
      report.chainlinkAssessment={feedResolution:resolved};await save();
      if(!resolved.feed){report.status="FEED_REVIEW_REQUIRED";report.reason=resolved.reason;return report;}
      const routing=await selectRoute(provider,discovery,ROBINHOOD_DISCOVERY.feedSourceVaults,discovery.blockNumber);
      report.chainlinkAssessment.route=routing;await save();
      if(!routing.route){report.status="BLOCKED";report.reason=routing.reason;return report;}
      const pinned=await provider.getBlock(discovery.blockNumber);if(!pinned)throw Error("Pinned block unavailable");
      const checks=await checkFeedAndToken(provider,discovery,resolved.feed,routing.route,discovery.blockNumber,pinned.timestamp);
      const history=await measureFeedHistory(provider,resolved.feed,discovery.blockNumber,pinned.timestamp);
      Object.assign(report.chainlinkAssessment,{feedChecks:checks,feedHistory:history});await save();
      const params={feed:resolved.feed,maxStaleness:history.proposedMaxStaleness,route:routing.route,slippageBps:CHAINLINK_POLICY.slippageBps};
      const clDirectory=resolve(directory,"chainlink");await mkdir(clDirectory,{recursive:true});
      const snapshot=await collectBaseSnapshot(provider,discovery,routing.route,ROBINHOOD_DISCOVERY.feedSourceVaults[0],clDirectory);
      report.chainlinkAssessment.snapshot=snapshot;
      if(!snapshot.routerContainsFactory||!snapshot.routerContainsPoolHash||snapshot.derivationMatches===false){
        report.status="DEPLOYMENT_REVIEW_REQUIRED";report.reason="Router bytecode or pool derivation evidence does not match; fork setup halted.";return report;
      }
      const paramsPath=resolve(clDirectory,"params.json");await writeFile(paramsPath,JSON.stringify(params,null,2));
      console.log(`4/4 Running V2 Chainlink round trips on a LOCAL fork (${routing.route.venue} route)...`);
      const code=await runFork(root,clDirectory,undefined,paramsPath);
      let fork:any;try{fork=JSON.parse(await readFile(resolve(clDirectory,"fork-results.json"),"utf8"));}catch{fork={assessmentError:"Fork produced no results"};}
      const qualified=qualifyChainlink(params,fork,code,checks);
      Object.assign(report.chainlinkAssessment,{fork,result:qualified});
      report.proposedSettings=qualified.status==="PROPOSED_FOR_REVIEW"?[{token,pool:routing.route.venue==="v3"?routing.route.pool:null,fee:routing.route.fee,...qualified}]:[];
      report.status=qualified.status==="PROPOSED_FOR_REVIEW"?"REVIEW_REQUIRED":"BLOCKED";
      report.reason=qualified.status==="PROPOSED_FOR_REVIEW"?null:(qualified as any).reason;
      report.stages.chainlinkAssessment="COMPLETE";
      report.remaining=["Confirm feed identity against Chainlink's official Robinhood listing.","Decide basket composition/weights and caps (Dan's cap formula).","Broadcaster support for Chainlink routes and multi-token baskets."];
      return report;
    }
    const active=discovery.pools.filter(p=>BigInt(p.currentLiquidityRaw)>0n && p.unlocked);
    if(active.length===0){report.status="BLOCKED";report.reason="No active unlocked V3 USDG pool found in the checked factory/tiers.";return report;}
    report.currentStage="Pool history and fork assessment";
    report.poolAssessments=await assessCandidates(active,async pool=>{
      const poolDirectory=resolve(directory,"pools",pool.address.toLowerCase());
      await mkdir(poolDirectory,{recursive:true});
      const candidate:any={address:pool.address,fee:pool.fee,status:"ASSESSING"};
      console.log(`Assessing pool ${pool.address} (fee ${pool.fee})`);
      console.log("3/4 Capturing price history and deployment evidence...");
      const snapshot=await collectSnapshot(provider,discovery,pool.address,poolDirectory);
      candidate.snapshot=snapshot;
      if(!snapshot.derivationMatches || !snapshot.routerContainsFactory || !snapshot.routerContainsPoolHash){
        candidate.status="DEPLOYMENT_REVIEW_REQUIRED";candidate.reason="Pool derivation or router bytecode evidence does not match; this candidate's fork setup halted.";return candidate;
      }
      const observations=await collectObservations(provider,snapshot);
      await writeFile(resolve(poolDirectory,"observations.json"),JSON.stringify(observations,null,2));
      candidate.settingCandidates=generateCandidates(snapshot,observations);
      console.log("4/4 Running real-router trades and V2 round trips on a LOCAL fork...");
      const exitCode=await runFork(root,poolDirectory);
      try {candidate.fork=JSON.parse(await readFile(resolve(poolDirectory,"fork-results.json"),"utf8"));}
      catch {candidate.fork={assessmentError:"Fork produced no results"};}
      candidate.summary=summarizeFork(exitCode,candidate.fork);
      candidate.status=candidate.summary.status;
      candidate.configurationTests=[];
      for(const setting of candidate.settingCandidates.candidates){
        const testDirectory=resolve(poolDirectory,`configuration-${setting.params.twapWindow}`);
        await mkdir(testDirectory,{recursive:true});
        await writeFile(resolve(testDirectory,"snapshot.json"),JSON.stringify(snapshot,null,2));
        const settingsPath=resolve(testDirectory,"params.json");
        await writeFile(settingsPath,JSON.stringify(setting.params,null,2));
        console.log(`Testing proposed ${setting.params.twapWindow/60}-minute configuration for ${pool.address}`);
        try{
          const code=await runFork(root,testDirectory,settingsPath);
          const fork=JSON.parse(await readFile(resolve(testDirectory,"fork-results.json"),"utf8"));
          candidate.configurationTests.push({...qualifyProposal(setting.params,fork,code),statistics:setting.statistics});
        }catch{candidate.configurationTests.push({status:"INSUFFICIENT_EVIDENCE",params:setting.params,reason:"Candidate test failed; inspect its saved results."});}
      }
      candidate.proposedSettings=candidate.configurationTests.filter((t:any)=>t.status==="PROPOSED_FOR_REVIEW");
      if(candidate.proposedSettings.length)candidate.status="REVIEW_REQUIRED";
      return candidate;
    },async results=>{report.poolAssessments=results;await save();});
    report.summary=compareCandidates(report.poolAssessments);
    report.status=report.summary.status;
    report.stages.candidateAssessment="COMPLETE";
    report.remaining=["Select defensible production TWAP window/deviation/liquidity floors and basket caps.",
      "Model competing arbitrage, sustained manipulation and extractable vault value; isolated fork attack costs are not a safety proof.",
      "Extend history/volatility sampling beyond the available observation ring.",
      "Review verified token/router source, full invariants, and independent final audit."];
  }catch(e:any){report.status="BLOCKED";const code=typeof e?.code==="string"&&/^[A-Z_]+$/.test(e.code)?e.code:"UNAVAILABLE";report.error=`Assessment failed during ${report.currentStage??"assessment"} (${code}). No token suitability conclusion can be drawn from this failure.`;console.error(report.error);}
  finally {
    if(report.oracleType!=="CHAINLINK")report.proposedSettings=(report.poolAssessments??[]).flatMap((pool:any)=>(pool.proposedSettings??[]).map((setting:any)=>({token,pool:pool.address,fee:pool.fee,...setting})));
    report.proposedSettings??=[];
    const recommendation=recommendCandidate(report.proposedSettings);
    if(report.oracleType==="CHAINLINK"&&recommendation.recommendedSetting)recommendation.recommendationReason="Chainlink candidate passed feed/token checks, measured round-history staleness and V2 fork round trips. Feed identity, basket composition and caps still require review.";
    Object.assign(report,recommendation);
    const proposal={status:report.proposedSettings.length?"PROPOSED_FOR_REVIEW":report.status==="FEED_REVIEW_REQUIRED"?"CHAINLINK_REVIEW_REQUIRED":"INSUFFICIENT_EVIDENCE",
      ...recommendation,
      listingApproved:false,proposedSettings:report.proposedSettings,reason:report.reason??report.error??(report.proposedSettings.length?null:"No candidate completed the required configuration checks; inspect pool results."),
      pools:(report.poolAssessments??[]).map((p:any)=>({address:p.address,candidateGeneration:p.settingCandidates,configurationTests:p.configurationTests,error:p.error}))};
    await writeFile(resolve(directory,"proposed-settings.json"),JSON.stringify(proposal,null,2)+"\n");
    const lines=["# Proposed token settings",`Status: ${proposal.status}`,"These are proposals for single-token baskets, not listing approval. No live transactions sent."];
    lines.push("## Recommended candidate",recommendation.recommendationReason);
    if(recommendation.recommendedSetting)lines.push("```json",JSON.stringify(recommendation.recommendedSetting,null,2),"```","## All passing candidates (including alternatives)");
    for(const setting of report.proposedSettings){
      if(setting.oracleType==="CHAINLINK"){
        const h=report.chainlinkAssessment?.feedHistory;
        lines.push(`\n## Chainlink route (${setting.params.route.venue})`,"```json",JSON.stringify(setting.params,null,2),"```",
          `Measured feed history: ${h?.rounds} rounds over ${h?.coveredDays?.toFixed(1)} days; largest update gap ${((h?.maxGapSeconds??0)/3600).toFixed(1)}h; proposed maxStaleness ${(setting.params.maxStaleness/3600).toFixed(0)}h.`,
          `Passed round-trip sizes (USDG): ${setting.passedRoundTripSizesUsdg.join(", ")}. Total basket cap: not established.`,...setting.limitations);
        continue;
      }
      lines.push(`\n## Pool ${setting.pool}`,"```json",JSON.stringify(setting.params,null,2),"```",
        `Historical staleness blocking: ${(100*setting.statistics.historicalStaleFraction).toFixed(2)}% of retained time.`,
        `Deviation exceedances: ${(100*setting.statistics.deviationExceedanceFraction).toFixed(2)}% of observation-time samples (not uptime).`,
        `Passed round-trip sizes (USDG): ${setting.passedRoundTripSizesUsdg.join(", ")}. Total basket cap: not established.`,...setting.limitations);
    }
    if(!report.proposedSettings.length)lines.push(proposal.reason??"No supported configuration proposed.");
    await writeFile(resolve(directory,"proposed-settings.md"),lines.join("\n\n")+"\n");
    await save();provider.destroy();
    console.log(`\nCONFIGURATION RESULT: ${proposal.status}`);
    for(const setting of report.proposedSettings)console.log(JSON.stringify({pool:setting.pool,configuration:setting.params,historicalStalePercent:setting.statistics?100*setting.statistics.historicalStaleFraction:undefined}));
    console.log(`Settings: ${resolve(directory,"proposed-settings.json")}\nReadable report: ${resolve(directory,"proposed-settings.md")}\nAssessment: ${report.status}. Nothing sent on-chain.`);
    console.log("\nRECOMMENDED CANDIDATE (FOR REVIEW)");
    console.log(recommendation.recommendationReason);
    if(recommendation.recommendedSetting)console.log(JSON.stringify(recommendation.recommendedSetting,null,2));
    console.log(`Alternatives: ${recommendation.alternatives.length} (saved in proposed-settings.json).`);
  }
  return report;
}
