// Native ETH inflows for a wallet via Blockscout, grouped by sender. Usage:
//   $env:BLOCKSCOUT_API_KEY="..."; node scripts/assessment/wallet-eth-inflows.mjs 0xWALLET [chainId ...]
// Default chains: 4663 Robinhood, 1 Ethereum, 42161 Arbitrum, 8453 Base, 10 Optimism.
const W=process.argv[2].toLowerCase();
const chains=process.argv.slice(3).length?process.argv.slice(3):["4663","1","42161","8453","10"];
const NAMES={"4663":"Robinhood Chain","1":"Ethereum","42161":"Arbitrum","8453":"Base","10":"Optimism"};
const key=process.env.BLOCKSCOUT_API_KEY;
async function get(chain,path){
  const u=new URL(`https://api.blockscout.com/${chain}${path}`);if(key)u.searchParams.set("apikey",key);
  const r=await fetch(u,{headers:key?{"x-api-key":key}:{},signal:AbortSignal.timeout(30000)});
  if(!r.ok)throw Error(`HTTP ${r.status}`);return r.json();
}
for(const chain of chains){
  console.log(`\n=== ${NAMES[chain]??chain} (chain ${chain}) ===`);
  try{
    const info=await get(chain,`/api/v2/addresses/${W}`);
    console.log(`balance: ${(Number(info.coin_balance??0)/1e18).toFixed(6)} ETH | txs: ${info.transactions_count??"?"} | contract: ${info.is_contract}`);
    const bySender={};let n=0,page="";
    for(let i=0;i<20;i++){
      const d=await get(chain,`/api/v2/addresses/${W}/transactions?filter=to${page}`);
      for(const tx of d.items??[]){
        if(tx.to?.hash?.toLowerCase()!==W||BigInt(tx.value??0)===0n)continue;
        const s=tx.from?.hash?.toLowerCase();n++;(bySender[s]??={total:0n,count:0,first:tx.timestamp,last:tx.timestamp,name:tx.from?.name??tx.from?.ens_domain_name??""});
        bySender[s].total+=BigInt(tx.value);bySender[s].count++;if(tx.timestamp<bySender[s].first)bySender[s].first=tx.timestamp;if(tx.timestamp>bySender[s].last)bySender[s].last=tx.timestamp;
      }
      if(!d.next_page_params)break;page="&"+new URLSearchParams(Object.entries(d.next_page_params).map(([k,v])=>[k,String(v)])).toString();
    }
    // internal (contract-originated) ETH transfers, e.g. from a multisig or bridge
    let ni=0;try{const d=await get(chain,`/api/v2/addresses/${W}/internal-transactions?filter=to`);for(const t of d.items??[]){if(BigInt(t.value??0)===0n)continue;const s=(t.from?.hash??"").toLowerCase();ni++;(bySender[s]??={total:0n,count:0,first:t.timestamp,last:t.timestamp,name:(t.from?.name??"")+" (internal)"});bySender[s].total+=BigInt(t.value);bySender[s].count++;}}catch{}
    console.log(`incoming ETH transfers: ${n} direct + ${ni} internal`);
    for(const [s,v] of Object.entries(bySender).sort((a,b)=>Number(b[1].total-a[1].total)))console.log(`  ${(Number(v.total)/1e18).toFixed(6)} ETH in ${v.count} tx from ${s} ${v.name} (${v.first?.slice(0,10)} .. ${v.last?.slice(0,10)})`);
  }catch(e){console.log("error:",e.message);}
}
