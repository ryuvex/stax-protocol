// Prospect every token that has a USDG pool on Robinhood Chain (Uniswap V3 + V4), rank by USDG depth,
// and mark which listing path is open (Chainlink feed / TWAP-capable V3 pool) and what is already on V1/V2.
// Usage: node scripts/assessment/prospect-tokens.mjs   -> reports/prospects/prospects-<block>.{json,csv,md}
import {Contract,JsonRpcProvider,Interface,keccak256,solidityPacked,toBeHex,getAddress,formatUnits} from "ethers";
import {writeFile,mkdir} from "node:fs/promises";
const RPC=process.env.STAX_RPC_URL??"https://rpc.mainnet.chain.robinhood.com";
const USDG="0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",V3_FACTORY="0x1f7d7550B1b028f7571E69A784071F0205FD2EfA",POOL_MANAGER="0x8366a39CC670B4001A1121B8F6A443A643e40951";
const V1="0x13045D3Dab253fDB15181C16f135D612fa8546E6",V2="0xAda84161033C0Cc54EF21CEeF913A8fEC4239b33",MULTICALL="0xcA11bde05977b3631167028862bE2a173976CA11";
const DIRECTORY="https://reference-data-directory.vercel.app/feeds-robinhood-mainnet.json";
// The public RPC throws 5xx under load: retry with backoff instead of dying mid-scan.
class RetryProvider extends JsonRpcProvider{
  async _send(payload){
    for(let attempt=0;;attempt++){
      try{return await super._send(payload);}
      catch(e){
        if(attempt>=6||!(e.code==="SERVER_ERROR"||e.code==="TIMEOUT"||e.code==="NETWORK_ERROR"))throw e;
        const wait=2000*(attempt+1);process.stdout.write(`\n  rpc ${e.shortMessage??e.code}; retry ${attempt+1}/6 in ${wait/1000}s\n`);
        await new Promise(r=>setTimeout(r,wait));
      }
    }
  }
}
const provider=new RetryProvider(RPC,4663,{staticNetwork:true,batchMaxCount:1});
const multi=new Contract(MULTICALL,["function aggregate3((address target,bool allowFailure,bytes callData)[]) payable returns((bool success,bytes returnData)[])"],provider);
async function batch(calls,label="calls"){ // [{target,iface,fn,args}] -> decoded or null
  const out=[];
  for(let i=0;i<calls.length;i+=300){
    const chunk=calls.slice(i,i+300);
    process.stdout.write(`\r  ${label}: ${Math.min(i+300,calls.length)}/${calls.length}   `);
    const res=await multi.aggregate3.staticCall(chunk.map(c=>({target:c.target,allowFailure:true,callData:c.iface.encodeFunctionData(c.fn,c.args??[])})));
    res.forEach((r,j)=>{let v=null;if(r.success&&r.returnData!=="0x"){try{v=chunk[j].iface.decodeFunctionResult(chunk[j].fn,r.returnData);}catch{v=null;}}out.push(v);});
  }
  if(calls.length)process.stdout.write("\n");
  return out;
}
const erc20=new Interface(["function symbol() view returns(string)","function name() view returns(string)","function decimals() view returns(uint8)","function balanceOf(address) view returns(uint256)"]);
const v3f=new Contract(V3_FACTORY,["event PoolCreated(address indexed token0,address indexed token1,uint24 indexed fee,int24 tickSpacing,address pool)"],provider);
const pm=new Contract(POOL_MANAGER,["event Initialize(bytes32 indexed id,address indexed currency0,address indexed currency1,uint24 fee,int24 tickSpacing,address hooks,uint160 sqrtPriceX96,int24 tick)"],provider);
const pmI=new Interface(["function extsload(bytes32) view returns(bytes32)"]);
const v2I=new Interface(["function oracleSettings(address) view returns(uint8,address)"]);
const v1I=new Interface(["function priceFeeds(address) view returns(address feed,uint48 maxStaleness)"]);
// The RPC caps eth_getLogs at 10k matches: bisect the block range until every chunk fits.
async function logs(contract,filter,from,to){
  process.stdout.write(`\r  scanning logs: blocks ${from}-${to}   `);
  try{return await contract.queryFilter(filter,from,to);}
  catch(e){
    if(!/exceeds limit|too many|response size|range/i.test(e.error?.message??e.message??"")||to-from<2)throw e;
    const mid=Math.floor((from+to)/2);
    return [...await logs(contract,filter,from,mid),...await logs(contract,filter,mid+1,to)];
  }
}
const stateSlot=id=>keccak256(solidityPacked(["bytes32","uint256"],[id,6n]));
// Known Robinhood stock/ETF tokens (V1 + V2 listings): their runtime code hash is the issuer fingerprint.
const KNOWN_STOCKS={AAPL:"0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9",MSFT:"0xe93237C50D904957Cf27E7B1133b510C669c2e74",GOOGL:"0x2e0847E8910a9732eB3fb1bb4b70a580ADAD4FE3",AMZN:"0x12f190a9F9d7D37a250758b26824B97CE941bF54",
 NVDA:"0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC",META:"0xc0D6457C16Cc70d6790Dd43521C899C87ce02f35",TSLA:"0x322F0929c4625eD5bAd873c95208D54E1c003b2d",USO:"0xa30FA36Db767ad9eD3f7a60fC79526fB4d56D344",SLV:"0x411eFb0E7f985935DAec3D4C3ebaEa0d0AD7D89f",
 GME:"0x1b0E319c6A659F002271B69dB8A7df2F911c153E",PLTR:"0x894E1EC2D74FFE5AEF8Dc8A9e84686acCB964F2A",CRCL:"0xdF0992E440dD0be65BD8439b609d6D4366bf1CB5",AMC:"0x05a3d1cd21d0c88145e82600e62e7e496e0f222b",NFLX:"0xE0444EF8BF4eD74f74FD73686e2ddF4C1c5591E8",SPY:"0x117cc2133c37B721F49dE2A7a74833232B3B4C0C",QQQ:"0xD5f3879160bc7c32ebb4dC785F8a4F505888de68"};
const stockCodeHashes=new Set();
for(const a of Object.values(KNOWN_STOCKS)){const c=await provider.getCode(a);if(c!=="0x")stockCodeHashes.add(keccak256(c));}
console.log("issuer fingerprints:",stockCodeHashes.size);
// Stage cache: heavy scans are saved under reports/prospects/.cache and reused for 24h.
import {readFile} from "node:fs/promises";
await mkdir("reports/prospects/.cache",{recursive:true});
async function cached(name,fn){
  const f=`reports/prospects/.cache/${name}.json`;
  try{const c=JSON.parse(await readFile(f,"utf8"));if(Date.now()-c.at<86400e3){console.log(`  ${name}: from cache (${new Date(c.at).toISOString()})`);return c.data;}}catch{}
  const data=await fn();await writeFile(f,JSON.stringify({at:Date.now(),data},(k,v)=>typeof v==="bigint"?v.toString():v));return data;
}
const block=await provider.getBlockNumber();
console.log("block",block);
// --- V3 USDG pools
const v3=await cached("v3-pools",async()=>[...await logs(v3f,v3f.filters.PoolCreated(USDG),0,block),...await logs(v3f,v3f.filters.PoolCreated(null,USDG),0,block)].map(e=>({args:{token0:e.args.token0,token1:e.args.token1,fee:Number(e.args.fee),pool:e.args.pool}})));
console.log("\nV3 USDG pools:",v3.length);
const v3bal=await cached("v3-balances",async()=>(await batch(v3.map(e=>({target:USDG,iface:erc20,fn:"balanceOf",args:[e.args.pool]})),"V3 pool USDG balances")).map(r=>r?[r[0].toString()]:null));
// --- V4 USDG pools: 200k+ exist (spam). Only read state for pools of candidate tokens.
const v4=await cached("v4-pools",async()=>[...await logs(pm,pm.filters.Initialize(null,USDG),0,block),...await logs(pm,pm.filters.Initialize(null,null,USDG),0,block)].map(e=>({args:{id:e.args.id,currency0:e.args.currency0,currency1:e.args.currency1,fee:Number(e.args.fee),tickSpacing:Number(e.args.tickSpacing),hooks:e.args.hooks}})));
console.log("\nV4 USDG pools:",v4.length);
let feeds=[];try{feeds=await (await fetch(DIRECTORY)).json();}catch(e){console.log("Chainlink directory unavailable:",e.message);}
const feedBySym=new Map();for(const f of feeds){const m=/^Robinhood\s+([A-Z0-9.]+)\s*(?:-|\/)\s*USD$/i.exec(f.name??"");if(m)feedBySym.set(m[1].toUpperCase(),f.proxyAddress??f.contractAddress);}
console.log("Chainlink Robinhood feeds:",feedBySym.size);
const tokens=new Map();
const tok=a=>{a=getAddress(a);if(!tokens.has(a))tokens.set(a,{address:a,v3:[],v4:[]});return tokens.get(a);};
v3.forEach((e,i)=>{const t=e.args.token0.toLowerCase()===USDG.toLowerCase()?e.args.token1:e.args.token0;tok(t).v3.push({pool:e.args.pool,fee:Number(e.args.fee),usdgInPool:Number(formatUnits(BigInt(v3bal[i]?.[0]??0),6))});});
const v4Tokens=[...new Set(v4.map(e=>getAddress(e.args.currency0.toLowerCase()===USDG.toLowerCase()?e.args.currency1:e.args.currency0)))];
console.log("unique V4 tokens:",v4Tokens.length,"- reading symbols...");
const v4Sym=await cached("v4-symbols",async()=>(await batch(v4Tokens.map(a=>({target:a,iface:erc20,fn:"symbol"})),"V4 token symbols")).map(r=>r?[r[0]]:null));
// Candidates: any V3 pool with >= $100 USDG, or a V4 token whose symbol has a Robinhood Chainlink feed.
const candidates=new Set([...tokens.values()].filter(t=>t.v3.some(p=>p.usdgInPool>=100)).map(t=>t.address));
v4Tokens.forEach((a,i)=>{const sym=v4Sym[i]?.[0];if(sym&&feedBySym.has(sym.toUpperCase()))candidates.add(a);});
console.log("candidate tokens:",candidates.size);
const v4c=v4.filter(e=>candidates.has(getAddress(e.args.currency0.toLowerCase()===USDG.toLowerCase()?e.args.currency1:e.args.currency0)));
console.log("V4 pools of candidates:",v4c.length);
const v4state=await batch(v4c.flatMap(e=>{const b=BigInt(stateSlot(e.args.id));return [{target:POOL_MANAGER,iface:pmI,fn:"extsload",args:[toBeHex(b,32)]},{target:POOL_MANAGER,iface:pmI,fn:"extsload",args:[toBeHex(b+3n,32)]}];}),"V4 pool state");
v4c.forEach((e,i)=>{
  const isC0=e.args.currency0.toLowerCase()===USDG.toLowerCase();const t=isC0?e.args.currency1:e.args.currency0;
  const slot0=BigInt(v4state[2*i]?.[0]??0n),liq=BigInt(v4state[2*i+1]?.[0]??0n);if(liq===0n)return;
  const sqrt=Number(slot0&((1n<<160n)-1n))/2**96;
  // Full-range approximation of the USDG side of the position (upper bound-ish; real ranges are narrower).
  const usdgApprox=(isC0?Number(liq)/sqrt:Number(liq)*sqrt)/1e6;
  tok(t).v4.push({poolId:e.args.id,fee:Number(e.args.fee),tickSpacing:Number(e.args.tickSpacing),hooks:e.args.hooks,hookless:e.args.hooks==="0x0000000000000000000000000000000000000000",liquidity:liq.toString(),usdgApprox});
});
for(const a of [...tokens.keys()])if(!candidates.has(a))tokens.delete(a);
const list=[...tokens.values()];
const meta=await batch(list.flatMap(t=>[{target:t.address,iface:erc20,fn:"symbol"},{target:t.address,iface:erc20,fn:"name"},{target:t.address,iface:erc20,fn:"decimals"},{target:V2,iface:v2I,fn:"oracleSettings",args:[t.address]},{target:V1,iface:v1I,fn:"priceFeeds",args:[t.address]}]),"token metadata");
const codeHashes=[];for(const [i,t] of list.entries()){process.stdout.write(`\r  bytecode fingerprint: ${i+1}/${list.length}   `);const c=await provider.getCode(t.address);codeHashes.push(c==="0x"?null:keccak256(c));}
console.log();
const rows=list.map((t,i)=>{
  const m=meta.slice(5*i,5*i+5);
  const symbol=m[0]?.[0]??"?",name=m[1]?.[0]??"?",decimals=m[2]!=null?Number(m[2][0]):null;
  const onV2=m[3]?Number(m[3][0])!==0:false,onV1=m[4]?m[4][0]!=="0x0000000000000000000000000000000000000000":false;
  const bestV3=t.v3.sort((a,b)=>b.usdgInPool-a.usdgInPool)[0],bestV4=t.v4.sort((a,b)=>b.usdgApprox-a.usdgApprox)[0];
  const feed=feedBySym.get(symbol.toUpperCase())??null;
  const stockContract=codeHashes[i]!=null&&stockCodeHashes.has(codeHashes[i]);
  const kind=stockContract&&feed?"STOCK":stockContract?"STOCK (no feed)":feed?"feed-only (check)":"OTHER";
  const depth=Math.max(bestV3?.usdgInPool??0,bestV4?.usdgApprox??0);
  const path=feed&&(bestV3||bestV4?.hookless)?"CHAINLINK":bestV3?"TWAP (V3 only)":"NONE (V4 without feed)";
  const oracleFactor=path==="CHAINLINK"?1:path.startsWith("TWAP")?0.75:0;
  return {symbol,name,address:t.address,kind,decimals,v3UsdgInPool:bestV3?.usdgInPool??0,v3Pool:bestV3?.pool??null,v3Fee:bestV3?.fee??null,
    v4UsdgApprox:bestV4?Math.round(bestV4.usdgApprox):0,v4Hookless:bestV4?.hookless??null,v4Pools:t.v4.length,chainlinkFeed:feed,path,
    danCapUsd:Math.round(depth*0.2*oracleFactor*0.5),onV1,onV2};
}).filter(r=>r.v3UsdgInPool>=100||r.v4UsdgApprox>=100).sort((a,b)=>Math.max(b.v3UsdgInPool,b.v4UsdgApprox)-Math.max(a.v3UsdgInPool,a.v4UsdgApprox));
await mkdir("reports/prospects",{recursive:true});
const cols=["symbol","name","address","kind","path","v3UsdgInPool","v4UsdgApprox","v4Hookless","chainlinkFeed","danCapUsd","onV1","onV2"];
await writeFile(`reports/prospects/prospects-${block}.json`,JSON.stringify({block,rows},null,2)+"\n");
await writeFile(`reports/prospects/prospects-${block}.csv`,[cols.join(","),...rows.map(r=>cols.map(c=>JSON.stringify(r[c]??"")).join(","))].join("\n")+"\n");
const md=["| # | Symbol | Name | Kind | Path | V3 USDG in pool | V4 USDG (approx) | Feed | Dan cap est. | V1 | V2 |","|--|--|--|--|--|--|--|--|--|--|--|",
  ...rows.map((r,i)=>`| ${i+1} | ${r.symbol} | ${r.name} | ${r.kind} | ${r.path} | ${Math.round(r.v3UsdgInPool).toLocaleString()} | ${r.v4UsdgApprox.toLocaleString()}${r.v4Hookless===false?" (hooked)":""} | ${r.chainlinkFeed?"yes":"no"} | $${r.danCapUsd.toLocaleString()} | ${r.onV1?"yes":""} | ${r.onV2?"yes":""} |`)];
await writeFile(`reports/prospects/prospects-${block}.md`,md.join("\n")+"\n");
console.log(md.join("\n"));console.log(`\n${rows.length} tokens with >= $100 USDG depth. Files: reports/prospects/prospects-${block}.*`);
provider.destroy();
