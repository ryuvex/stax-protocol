// Stax basket health monitor. Read-only, no keys.
// Every STAX_MONITOR_INTERVAL_SEC (default 120) it prices every leg of every basket (official V2 + user-basket clones)
// and posts to Slack ONLY when a basket changes state: blocked -> one message with reason + suggested fix; recovered -> one message.
// Env: STAX_RPC_URL, Slack = STAX_SLACK_WEBHOOK | STAX_SLACK_BOT_TOKEN+STAX_SLACK_CHANNEL | rotating OAuth token in .slack-tokens.local.json + STAX_SLACK_CLIENT_ID/SECRET + STAX_SLACK_CHANNEL, STAX_MONITOR_INTERVAL_SEC, STAX_MONITOR_STATE (state file), STAX_MONITOR_INCLUDE_PAUSED=1
import {Contract,JsonRpcProvider,Interface} from "ethers";
import {readFile,writeFile,mkdir} from "node:fs/promises";
import {dirname} from "node:path";
import {fileURLToPath} from "node:url";
import "dotenv/config";

const RPC=process.env.STAX_RPC_URL??"https://rpc.mainnet.chain.robinhood.com";
const INTERVAL=Math.max(30,Number(process.env.STAX_MONITOR_INTERVAL_SEC??120))*1000;
const CALL_TIMEOUT=20_000, RPC_FAILS_BEFORE_ALERT=3, REDISCOVER_EVERY=5; // rediscover baskets every 5 ticks (~10 min)
const STATE_FILE=process.env.STAX_MONITOR_STATE??fileURLToPath(new URL("../../reports/monitor/state.json",import.meta.url));
const deployment=JSON.parse(await readFile(new URL("../../reports/mainnet-v2-deployment/deployment.json",import.meta.url),"utf8"));
const userDeployment=JSON.parse(await readFile(new URL("../../reports/userbasket-v2-deployment/deployment.json",import.meta.url),"utf8"));
const addr=n=>deployment.contracts.find(c=>c.name===n).address;
const VAULT=addr("StaxVaultV2"), REGISTRY=addr("UnifiedTwapRegistry");
const FACTORY=userDeployment.factory?.address??userDeployment.contracts?.find(c=>c.name==="StaxUserBasketFactoryV2")?.address;
if(!FACTORY) throw Error("User-basket factory address not found in reports/userbasket-v2-deployment/deployment.json");

const abi=async f=>{const a=JSON.parse(await readFile(new URL(`../../abi/${f}.json`,import.meta.url),"utf8"));return Array.isArray(a)?a:a.abi;};
const errorIface=new Interface([...(await abi("StaxVaultV2")),...(await abi("UnifiedTwapRegistry"))].filter(e=>e.type==="error"));
const provider=new JsonRpcProvider(RPC,4663,{staticNetwork:true,batchMaxCount:20});
const vault=new Contract(VAULT,await abi("StaxVaultV2"),provider);
const registry=new Contract(REGISTRY,await abi("UnifiedTwapRegistry"),provider);
const factory=new Contract(FACTORY,await abi("StaxUserBasketFactoryV2"),provider);
const cloneAbi=await abi("StaxUserBasketV2");
const POOL_ABI=["function liquidity() view returns(uint128)","function slot0() view returns(uint160 sqrtPriceX96,int24 tick,uint16 observationIndex,uint16 observationCardinality,uint16 observationCardinalityNext,uint8 feeProtocol,bool unlocked)","function observations(uint256) view returns(uint32 blockTimestamp,int56 tickCumulative,uint160 secondsPerLiquidityCumulativeX128,bool initialized)","function observe(uint32[]) view returns(int56[] tickCumulatives,uint160[])"];
const FEED_ABI=["function latestRoundData() view returns(uint80,int256 answer,uint256,uint256 updatedAt,uint80)","function decimals() view returns(uint8)"];
const ERC20_ABI=["function symbol() view returns(string)"];

const withTimeout=(p,ms=CALL_TIMEOUT)=>Promise.race([p,new Promise((_,rej)=>setTimeout(()=>rej(Error("RPC call timed out")),ms))]);
const short=a=>`${a.slice(0,6)}…${a.slice(-4)}`;
const minutes=s=>`${Math.round(s/60)} min`;
const symbols=new Map();
async function symbolOf(token){
  if(!symbols.has(token.toLowerCase())){let s=short(token);try{s=await withTimeout(new Contract(token,ERC20_ABI,provider).symbol());}catch{}symbols.set(token.toLowerCase(),s);}
  return symbols.get(token.toLowerCase());
}
function decodeError(e){
  const data=e?.data??e?.error?.data??e?.info?.error?.data;
  if(typeof data==="string"&&data.length>=10){try{return errorIface.parseError(data)?.name??data.slice(0,10);}catch{return data.slice(0,10);}}
  return (e?.shortMessage??e?.message??String(e)).slice(0,80);
}

// ---------- discovery ----------
async function discoverBaskets(){
  const baskets=[];
  const includePaused=process.env.STAX_MONITOR_INCLUDE_PAUSED==="1";
  let misses=0;
  for(let id=1;misses<5&&id<200;id++){
    const b=await withTimeout(vault.baskets(id));
    if(!b.exists){misses++;continue;}
    misses=0;
    if(b.mintPaused&&!includePaused) continue;
    const [tickers]=await withTimeout(vault.getBasketComposition(id));
    baskets.push({key:`official:${id}`,label:`${await symbolOf(b.token)} (ID ${id})`,tickers:[...tickers]});
  }
  const count=Number(await withTimeout(factory.basketCount()));
  for(let i=0;i<count;i++){
    const clone=await withTimeout(factory.baskets(i));
    const c=new Contract(clone,cloneAbi,provider);
    const [tickers]=await withTimeout(c.getComposition());
    const name=await withTimeout(c.name()).catch(()=>short(clone));
    baskets.push({key:`user:${clone.toLowerCase()}`,label:`user basket "${name}" (${short(clone)})`,tickers:[...tickers]});
  }
  return baskets;
}

// ---------- per-token check ----------
async function checkToken(token,now){
  const sym=await symbolOf(token);
  try{ await withTimeout(vault.getOraclePriceUsd18.staticCall(token)); return {token,sym,ok:true}; }
  catch(e){
    const error=decodeError(e);
    const detail=await explain(token,error,now).catch(x=>({why:`(could not read details: ${(x.shortMessage??x.message).slice(0,60)})`}));
    return {token,sym,ok:false,error,...detail};
  }
}
const REASSESS=t=>`re-assess first: \`npm run onboard -- ${t}\``;
async function explain(token,error,now){
  const settings=await withTimeout(vault.oracleSettings(token));
  const type=Number(settings.oracleType);
  if(type===2){ // TWAP
    const c=await withTimeout(registry.tokenConfigurations(token));
    const pool=new Contract(c.pool,POOL_ABI,provider);
    const [liq,s0]=await Promise.all([withTimeout(pool.liquidity()),withTimeout(pool.slot0())]);
    const obs=await withTimeout(pool.observations(s0.observationIndex));
    const age=now-Number(obs.blockTimestamp), maxAge=Number(c.maxObservationAge), window=Number(c.twapWindow);
    const floor=c.minCurrentLiquidity;
    let deviationBps=null;
    try{const r=await withTimeout(pool.observe([window,0]));const mean=Number((r[0][1]-r[0][0])/BigInt(window));deviationBps=Math.round(Math.abs(Math.pow(1.0001,Number(s0.tick)-mean)-1)*10000);}catch{}
    if(error==="StaleObservation"){
      const next=[3600,10800].find(w=>w>age&&w>maxAge);
      const fix=next?`\`npm run registry:floor -- ${token} --window ${next} --max-obs-age ${next}\` (${REASSESS(token)})`:"no window up to 3h fits — wait for a trade on the pool";
      return {why:`last trade ${minutes(age)} ago, limit ${minutes(maxAge)}`,fix};
    }
    if(error==="InsufficientLiquidity"){
      const suggested=(liq/2n).toString();
      return {why:`pool liquidity ${liq} is below the floor ${floor}`,fix:`\`npm run registry:floor -- ${token} --floor ${suggested}\` (${REASSESS(token)})`};
    }
    if(error==="ExcessiveDeviation"){
      return {why:`spot is ${deviationBps??"?"} bps off the ${minutes(window)} TWAP, limit ${Number(c.maxDeviationBps)} bps`,fix:"no config fix — wait for the price to settle; if it keeps happening re-assess with a higher STAX_MAX_DEVIATION_BPS"};
    }
    return {why:`TWAP token; last trade ${minutes(age)} ago (limit ${minutes(maxAge)}), liquidity ${liq} (floor ${floor})${deviationBps!=null?`, deviation ${deviationBps} bps (limit ${Number(c.maxDeviationBps)})`:""}`,fix:"unexpected error — check manually"};
  }
  if(type===1){ // Chainlink
    const f=await withTimeout(vault.priceFeeds(token));
    const feed=new Contract(f.feed,FEED_ABI,provider);
    const [round,dec]=await Promise.all([withTimeout(feed.latestRoundData()),withTimeout(feed.decimals()).catch(()=>8)]);
    const age=now-Number(round.updatedAt), max=Number(f.maxStaleness), price=Number(round.answer)/10**Number(dec);
    if(error==="StaleOraclePrice") return {why:`Chainlink feed last updated ${minutes(age)} ago, limit ${minutes(max)} (market closed?)`,fix:"nothing on our side — feed must update; if this is normal off-hours behaviour, consider a longer maxStaleness for the feed"};
    if(error==="InvalidOraclePrice") return {why:`Chainlink feed answer is ${price}`,fix:"feed problem — nothing on our side"};
    return {why:`Chainlink feed age ${minutes(age)} (limit ${minutes(max)}), answer ${price}`,fix:"check manually"};
  }
  if(error==="SequencerDown"||error==="GracePeriodActive") return {why:"Robinhood Chain sequencer feed reports down / in grace period",fix:"chain-level — wait"};
  if(error==="OraclePausedErr") return {why:"oracle paused by owner",fix:"unpause when ready"};
  return {why:"oracle type NONE or unknown",fix:"check registration"};
}

// ---------- slack ----------
// Three ways to post, first that is configured wins: webhook; static bot token; rotating OAuth token (access+refresh in .slack-tokens.local.json + client id/secret in .env).
const TOKENS_FILE=process.env.STAX_SLACK_TOKENS_FILE??fileURLToPath(new URL("../../.slack-tokens.local.json",import.meta.url));
async function rotatingToken(force=false){
  let t={};try{t=JSON.parse(await readFile(TOKENS_FILE,"utf8"));}catch{return null;}
  const access=t.access_token??t.slack_access_token, refresh=t.refresh_token??t.slack_refresh_token??t.slac_refresh_token;
  if(!access||!refresh) return null;
  const fresh=t.expires_at&&Date.now()<t.expires_at-10*60_000;
  if(fresh&&!force) return access;
  const id=process.env.STAX_SLACK_CLIENT_ID,secret=process.env.STAX_SLACK_CLIENT_SECRET;
  if(!id||!secret){ if(!t.expires_at&&!force) return access; console.error("Slack token needs refresh but STAX_SLACK_CLIENT_ID/SECRET are not set"); return access; }
  const r=await fetch("https://slack.com/api/oauth.v2.access",{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},
    body:new URLSearchParams({client_id:id,client_secret:secret,grant_type:"refresh_token",refresh_token:refresh})});
  const j=await r.json();
  if(!j.ok){console.error("Slack token refresh failed:",j.error);return access;}
  const next={access_token:j.authed_user?.access_token??j.access_token,refresh_token:j.authed_user?.refresh_token??j.refresh_token,
    expires_at:Date.now()+Number(j.authed_user?.expires_in??j.expires_in??43200)*1000,refreshed_at:new Date().toISOString()};
  await writeFile(TOKENS_FILE,JSON.stringify(next,null,2));
  console.log("Slack token refreshed, valid until",new Date(next.expires_at).toISOString());
  return next.access_token;
}
async function postWithToken(token,text){
  const r=await fetch("https://slack.com/api/chat.postMessage",{method:"POST",headers:{"content-type":"application/json",authorization:`Bearer ${token}`},body:JSON.stringify({channel:process.env.STAX_SLACK_CHANNEL,text})});
  return r.json();
}
async function slack(text){
  console.log(new Date().toISOString(),"SLACK:",text.replace(/\n/g," | "));
  try{
    if(process.env.STAX_SLACK_WEBHOOK){
      const r=await fetch(process.env.STAX_SLACK_WEBHOOK,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({text})});
      if(!r.ok) console.error("slack webhook failed",r.status,await r.text());
      return;
    }
    if(!process.env.STAX_SLACK_CHANNEL){console.warn("(no Slack configured — printed only)");return;}
    if(process.env.STAX_SLACK_BOT_TOKEN){const j=await postWithToken(process.env.STAX_SLACK_BOT_TOKEN,text);if(!j.ok)console.error("slack api failed",j.error);return;}
    let token=await rotatingToken();
    if(!token){console.warn("(no Slack configured — printed only)");return;}
    let j=await postWithToken(token,text);
    if(!j.ok&&(j.error==="token_expired"||j.error==="invalid_auth")){token=await rotatingToken(true);j=await postWithToken(token,text);}
    if(!j.ok) console.error("slack api failed",j.error);
  }catch(e){console.error("slack post error",e.message);}
}

// ---------- state ----------
let state={baskets:{},rpcDown:false,startedAt:null};
try{state={...state,...JSON.parse(await readFile(STATE_FILE,"utf8"))};}catch{}
async function saveState(){await mkdir(dirname(STATE_FILE),{recursive:true});await writeFile(STATE_FILE,JSON.stringify(state,null,2));}

// ---------- main loop ----------
let baskets=[], tick=0, rpcFailures=0;
console.log(`Stax monitor: vault ${VAULT}, factory ${FACTORY}, every ${INTERVAL/1000}s, state ${STATE_FILE}`);
for(;;){
  const started=Date.now();
  try{
    if(tick%REDISCOVER_EVERY===0||!baskets.length) baskets=await discoverBaskets();
    const now=(await withTimeout(provider.getBlock("latest"))).timestamp;
    const tokens=[...new Set(baskets.flatMap(b=>b.tickers.map(t=>t.toLowerCase())))];
    const results=new Map();
    for(const t of tokens) results.set(t,await checkToken(t,now));
    if(rpcFailures>=RPC_FAILS_BEFORE_ALERT||state.rpcDown){await slack("🟢 Monitor can reach the RPC again.");state.rpcDown=false;}
    rpcFailures=0;
    const blocked=[],recovered=[];
    for(const b of baskets){
      const failing=b.tickers.map(t=>results.get(t.toLowerCase())).filter(r=>!r.ok);
      const prev=state.baskets[b.key];
      if(failing.length&&!prev?.blockedSince){
        state.baskets[b.key]={blockedSince:now,label:b.label};
        blocked.push(`🔴 *${b.label}* blocked\n`+failing.map(f=>`   • ${f.sym}: ${f.error} — ${f.why}\n     fix: ${f.fix??"-"}`).join("\n"));
      } else if(!failing.length&&prev?.blockedSince){
        recovered.push(`🟢 *${b.label}* recovered after ${minutes(now-prev.blockedSince)}`);
        delete state.baskets[b.key];
      }
    }
    if(!state.startedAt){
      state.startedAt=now;
      const currentlyBlocked=baskets.filter(b=>b.tickers.some(t=>!results.get(t.toLowerCase()).ok)).length;
      await slack(`👀 Stax monitor started: watching ${baskets.length} baskets / ${tokens.length} tokens every ${INTERVAL/1000}s. Currently blocked: ${currentlyBlocked}.`);
    }
    if(blocked.length||recovered.length) await slack([...blocked,...recovered].join("\n"));
    await saveState();
    console.log(new Date().toISOString(),`tick ${tick}: ${baskets.length} baskets, ${tokens.length} tokens, blocked ${Object.keys(state.baskets).length}, ${Date.now()-started}ms`);
  }catch(e){
    rpcFailures++;
    console.error(new Date().toISOString(),`tick ${tick} failed (${rpcFailures}):`,e.shortMessage??e.message);
    if(rpcFailures===RPC_FAILS_BEFORE_ALERT&&!state.rpcDown){state.rpcDown=true;await saveState();await slack(`⚠️ Monitor could not reach the RPC ${RPC_FAILS_BEFORE_ALERT} times in a row: ${(e.shortMessage??e.message).slice(0,100)}. Will report when it's back.`);}
  }
  tick++;
  await new Promise(r=>setTimeout(r,Math.max(0,INTERVAL-(Date.now()-started))));
}
