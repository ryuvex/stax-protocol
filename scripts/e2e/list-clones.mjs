// Read-only: prints sHEALTH config and every V1/V2 community clone with its legs.
// Legs marked * are TWAP-priced (no Chainlink feed). Usage: node scripts/e2e/list-clones.mjs
import {JsonRpcProvider,Contract} from "ethers";
import {readFile} from "node:fs/promises";
const abi=async f=>{const a=JSON.parse(await readFile(new URL(`../../abi/${f}.json`,import.meta.url),"utf8"));return Array.isArray(a)?a:a.abi;};
const p=new JsonRpcProvider(process.env.STAX_RPC_URL??"https://rpc.mainnet.chain.robinhood.com",4663,{staticNetwork:true});
const VAULT="0xAda84161033C0Cc54EF21CEeF913A8fEC4239b33";
const F=["function basketCount() view returns(uint256)","function baskets(uint256) view returns(address)"];
const C=["function getComposition() view returns(address[],uint256[])","function symbol() view returns(string)","function totalSupply() view returns(uint256)"];
const E=["function symbol() view returns(string)"];
const v=new Contract(VAULT,await abi("StaxVaultV2"),p);
const b=await v.baskets(6); console.log("sHEALTH (id 6):",JSON.stringify(b.toObject(),(k,x)=>typeof x==="bigint"?x.toString():x));
const [t,w]=await v.getBasketComposition(6); for(let i=0;i<t.length;i++)console.log("  ",await new Contract(t[i],E,p).symbol(),(Number(w[i])/100).toFixed(1)+"%");
{
  const f=new Contract("0x1de6a6bD0C62097A7559A29a76e41985558f9918",F,p); const n=Number(await f.basketCount()); console.log(`\nV2 factory clones: ${n}`);
  for(let i=0;i<n;i++){const a=await f.baskets(i); const c=new Contract(a,C,p);
    const sym=await c.symbol().catch(()=>"?");
    let legs="(no getComposition)"; try{const [tk]=await c.getComposition(); const parts=[]; for(const x of tk){const s=await v.oracleSettings(x); parts.push((await new Contract(x,E,p).symbol())+(Number(s.oracleType)===2?"*":""));} legs=parts.join(", ");}catch{}
    console.log(`  ${a} ${sym} legs: ${legs}`);}
}
// V1 factory: no ABI in repo, so read its event logs and probe every address that appears in them.
{
  const V1F="0x164D9dFBe901421B560D054aA61D1fe1E9d6D078";
  const latest=await p.getBlockNumber(); const logs=[];
  for(let from=0;from<=latest;from+=10_000_000){ const to=Math.min(from+9_999_999,latest); logs.push(...await p.getLogs({address:V1F,fromBlock:from,toBlock:to})); }
  console.log(`\nV1 factory: ${logs.length} events`);
  const seen=new Set();
  for(const l of logs){
    const words=[...l.topics.slice(1),...(l.data.slice(2).match(/.{64}/g)??[])].map(w=>"0x"+w.slice(-40).replace(/^0x/,""));
    for(const w of words){ if(seen.has(w)||/^0x0{40}$/.test(w)) continue; seen.add(w);
      const code=await p.getCode(w).catch(()=>"0x"); if(code==="0x") continue;
      const c=new Contract(w,[...C,"function mainVault() view returns(address)","function name() view returns(string)"],p);
      const sym=await c.symbol().catch(()=>null); if(sym===null) continue;
      const name=await c.name().catch(()=>"?"), mv=await c.mainVault().catch(()=>"?");
      let legs="(no getComposition)"; try{const [tk]=await c.getComposition(); legs=(await Promise.all(tk.map(x=>new Contract(x,E,p).symbol()))).join(", ");}catch{}
      console.log(`  ${w} ${sym} "${name}" vault=${mv} legs: ${legs} (block ${l.blockNumber})`);
    }
  }
}
