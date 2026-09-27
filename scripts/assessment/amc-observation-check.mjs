import {JsonRpcProvider,Contract,Interface} from 'ethers';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
const dir='reports/amc-liquidity-age';await mkdir(dir,{recursive:true});
const p=new JsonRpcProvider('https://rpc.mainnet.chain.robinhood.com',4663,{staticNetwork:true,batchMaxCount:40});
try{
 if(BigInt(await p.send('eth_chainId',[]))!==4663n)throw Error('Wrong chain');
 const address='0xaA34feA710a1A737840329051D81D3B0B7C564d5',b=await p.getBlock('latest'),at={blockTag:b.number};
 const abi=['function slot0() view returns(uint160,int24,uint16,uint16,uint16,uint8,bool)','function liquidity() view returns(uint128)','function observations(uint256) view returns(uint32,int56,uint160,bool)','function observe(uint32[]) view returns(int56[],uint160[])'];
 const pool=new Contract(address,abi,p),iface=new Interface(abi),slot=await pool.slot0(at),liquidity=await pool.liquidity(at);
 const observations=[];
 const multiAddress='0xcA11bde05977b3631167028862bE2a173976CA11';
 const hasMulti=await p.getCode(multiAddress,b.number)!=='0x';
 const multi=new Contract(multiAddress,['function aggregate3((address target,bool allowFailure,bytes callData)[]) payable returns((bool success,bytes returnData)[])'],p);
 for(let start=0;start<Number(slot[3]);start+=hasMulti?300:40){
  const ids=Array.from({length:Math.min(hasMulti?300:40,Number(slot[3])-start)},(_,i)=>start+i);
  const rows=hasMulti?(await multi.aggregate3.staticCall(ids.map(i=>({target:address,allowFailure:false,callData:iface.encodeFunctionData('observations',[i])})),at)).map(r=>iface.decodeFunctionResult('observations',r.returnData)):await Promise.all(ids.map(i=>pool.observations(i,at)));
  rows.forEach((r,i)=>{if(r[3])observations.push({index:ids[i],timestamp:Number(r[0]),tickCumulative:String(r[1]),secondsPerLiquidity:String(r[2])});});
 }
 observations.sort((a,z)=>a.timestamp-z.timestamp);
 const gaps=observations.slice(1).map((o,i)=>o.timestamp-observations[i].timestamp).sort((a,z)=>a-z);
 const percentile=q=>gaps[Math.min(gaps.length-1,Math.floor(gaps.length*q))];
 const offsets=Array.from({length:73},(_,i)=>i*3600),[ticks,cumulative]=await pool.observe(offsets,at);
 const hours=offsets.slice(1).map((_,i)=>{const delta=(cumulative[i]-cumulative[i+1]+(1n<<160n))%(1n<<160n);return {hoursAgo:i,harmonicLiquidity:String(3600n*((1n<<160n)-1n)/(delta<<32n)),meanTick:Math.floor(Number(ticks[i]-ticks[i+1])/3600)};});
 const ls=hours.map(h=>BigInt(h.harmonicLiquidity)).sort((a,z)=>a<z?-1:1);
 const result={blockNumber:b.number,blockHash:b.hash,timestamp:b.timestamp,pool:address,currentLiquidity:String(liquidity),observationCount:observations.length,historySeconds:b.timestamp-observations[0].timestamp,latestObservationAge:b.timestamp-observations.at(-1).timestamp,gaps:{p50:percentile(.5),p95:percentile(.95),p99:percentile(.99),max:Math.max(...gaps),over1800:gaps.filter(g=>g>1800).length,over3600:gaps.filter(g=>g>3600).length},hourlyLiquidity:{min:String(ls[0]),p10:String(ls[Math.floor(ls.length*.1)]),median:String(ls[Math.floor(ls.length*.5)])},hours,observations};
 await writeFile(`${dir}/measurements.json`,JSON.stringify(result,null,2));
 const s=JSON.parse(await readFile('reports/amc-focused-risk/snapshot.json','utf8'));Object.assign(s,{blockNumber:b.number,blockHash:b.hash,timestamp:b.timestamp,tick:Number(slot[1]),liquidity:String(liquidity),spotPriceUsdg:(Number(slot[0])/2**96)**2*1e12});await writeFile(`${dir}/snapshot.json`,JSON.stringify(s,null,2));
 console.log(JSON.stringify({...result,hours:undefined,observations:undefined},null,2));
}finally{p.destroy();}
