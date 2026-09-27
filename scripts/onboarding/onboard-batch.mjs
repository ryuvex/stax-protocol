// Runs `npm run onboard -- <token>` for every token in reports/prospects/onboard-queue.json, one at a time.
// Progress in reports/prospects/onboard-batch-status.json; per-token log in reports/prospects/logs/<SYMBOL>.log.
// Re-running skips tokens already marked done. Usage: node scripts/onboarding/onboard-batch.mjs [--only SYM,SYM] [--retry-failed] [--force]
import {readFile,writeFile,mkdir} from "node:fs/promises";
import {spawn} from "node:child_process";
const args=process.argv.slice(2);
const only=(args.includes("--only")?args[args.indexOf("--only")+1]:"").split(",").filter(Boolean).map(s=>s.toUpperCase());
const retryFailed=args.includes("--retry-failed");
const force=args.includes("--force"); // rerun even if already done (use with --only)
const {queue}=JSON.parse(await readFile("reports/prospects/onboard-queue.json","utf8"));
const statusFile="reports/prospects/onboard-batch-status.json";
let status={};try{status=JSON.parse(await readFile(statusFile,"utf8"));}catch{}
await mkdir("reports/prospects/logs",{recursive:true});
const save=()=>writeFile(statusFile,JSON.stringify(status,null,2)+"\n");
const todo=queue.filter(t=>(!only.length||only.includes(t.symbol.toUpperCase()))&&(force||(!(status[t.symbol]?.state==="done")&&!(status[t.symbol]?.state==="failed"&&!retryFailed))));
console.log(`${todo.length} of ${queue.length} tokens to run: ${todo.map(t=>t.symbol).join(" ")}`);
for(const [i,t] of todo.entries()){
  const started=new Date().toISOString();
  status[t.symbol]={...(status[t.symbol]??{}),...t,state:"running",started};await save();
  console.log(`\n[${i+1}/${todo.length}] ${t.symbol} ${t.address} (${t.path}) ${started}`);
  const log=`reports/prospects/logs/${t.symbol}.log`;
  const chunks=[];
  // A retry of a token whose (V1-inherited) V4 route failed is forced onto its canonical V3 USDG pool.
  const env={...process.env};
  const prior=status[t.symbol];
  if(prior?.exitCode!==undefined&&prior.exitCode!==0&&t.v3Pool&&!prior.forcedV3Pool){env.STAX_FORCE_V3_POOL=t.v3Pool;status[t.symbol].forcedV3Pool=t.v3Pool;console.log(`  retry on V3 pool ${t.v3Pool}`);}
  const code=await new Promise(resolve=>{
    const child=spawn(process.platform==="win32"?"npm.cmd":"npm",["run","onboard","--",t.address],{shell:process.platform==="win32",windowsHide:true,env});
    const tail=d=>{chunks.push(d);const s=String(d);process.stdout.write(s.length>200?s.slice(-200):s);};
    child.stdout.on("data",tail);child.stderr.on("data",tail);
    child.once("error",e=>{chunks.push(Buffer.from(String(e)));resolve(-1);});child.once("close",resolve);
  });
  const out=Buffer.concat(chunks.map(c=>Buffer.isBuffer(c)?c:Buffer.from(String(c)))).toString();
  await writeFile(log,out);
  const verdict=(out.match(/(NOT_RECOMMENDED|RECOMMENDED|FEED_REVIEW_REQUIRED|PASS(?:ED)?|FAIL(?:ED)?|REJECTED)[^\n]{0,120}/g)??[]).slice(-3);
  status[t.symbol]={...status[t.symbol],state:code===0?"done":"failed",exitCode:code,finished:new Date().toISOString(),log,verdictLines:verdict};
  await save();
  console.log(`\n${t.symbol}: ${status[t.symbol].state} (exit ${code})`);
}
console.log("\nBatch finished. Status:",statusFile);
