// Summarises onboard-batch results per token: node scripts/onboarding/batch-summary.mjs [SYM ...]
import {readFile,readdir,stat} from "node:fs/promises";
const status=JSON.parse(await readFile("reports/prospects/onboard-batch-status.json","utf8"));
const prospects=JSON.parse(await readFile((await readdir("reports/prospects")).filter(f=>/^prospects-\d+\.json$/.test(f)).map(f=>"reports/prospects/"+f).sort().at(-1),"utf8")).rows;
const want=process.argv.slice(2).map(s=>s.toUpperCase());
const out=[];
for(const [sym,s] of Object.entries(status)){
  if(want.length&&!want.includes(sym.toUpperCase()))continue;
  if(s.state==="running")continue;
  const dir=`reports/assessments/${s.address.toLowerCase()}`;
  let latest=null;try{const runs=(await readdir(dir)).filter(x=>/^\d+$/.test(x)).sort();latest=runs.at(-1)?`${dir}/${runs.at(-1)}`:null;}catch{}
  const row={symbol:sym,address:s.address,path:s.path,state:s.state,exitCode:s.exitCode,assessmentDir:latest};
  const p=prospects.find(r=>r.address.toLowerCase()===s.address.toLowerCase());
  if(p){row.v3UsdgInPool=Math.round(p.v3UsdgInPool);row.v3Pool=p.v3Pool;row.v3Fee=p.v3Fee;row.onV1=p.onV1;row.feedFromDirectory=p.chainlinkFeed;}
  if(latest){
    try{
      const ps=JSON.parse(await readFile(`${latest}/proposed-settings.json`,"utf8"));
      row.status=ps.status;row.reason=ps.reason??null;const c=ps.recommendedSetting??ps.proposedSettings?.[0]??{};
      const params=c.params??ps.params;
      if(params){row.feed=params.feed??null;row.maxStalenessH=params.maxStaleness?Math.round(params.maxStaleness/3600):null;row.slippageBps=params.slippageBps??null;
        row.route=params.route?`${params.route.venue} fee ${params.route.fee}${params.route.venue==="v3"&&params.route.pool?" "+params.route.pool:""}`:null;
        row.twap=params.twapWindow?{window:params.twapWindow,maxObsAge:params.maxObservationAge,maxDeviationBps:params.maxDeviationBps,minHarmonicLiquidity:params.minHarmonicLiquidity}:null;}
      row.roundTrips=c.passedRoundTripSizesUsdg??ps.passedRoundTripSizesUsdg??null;row.oracleType=c.oracleType??ps.oracleType??null;
      row.policy=ps.policy??null;
    }catch(e){row.settingsError=String(e.message).slice(0,80);}
  }
  try{const log=await readFile(s.log,"utf8");
    row.result=(log.match(/CONFIGURATION RESULT: *([A-Z_]+)/)??[])[1]??null;
    row.staleCheck=(log.match(/staleCheck (\w+)/)??[])[1]??null;
    const errs=[...new Set((log.match(/"error":"[^"]{0,140}/g)??[]).map(x=>x.slice(9)))];row.errors=errs.slice(0,2);
    row.alternatives=(log.match(/Alternatives: (\d+)/)??[])[1]??null;
  }catch{}
  out.push(row);
}
console.log(JSON.stringify(out,null,1));
