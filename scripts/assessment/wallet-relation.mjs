// What does a wallet have to do with Stax? Read-only: node scripts/assessment/wallet-relation.mjs 0xWALLET
import {Contract,JsonRpcProvider,formatUnits,getAddress} from "ethers";
const W=getAddress(process.argv[2]);
const p=new JsonRpcProvider(process.env.STAX_RPC_URL??"https://rpc.mainnet.chain.robinhood.com",4663,{staticNetwork:true});
const USDG="0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
const KNOWN={treasury:"0xFF843Bc76C276086569D081E02DAC467C2aDa5cE",rewardsPool:"0xc02F399cBbF90CEc6DD3a7c2D90fcA84C0a3a5ad",gachaTreasury:"0x14D3D296947973C5AD9Cf6d235C9a582Fb7b2f8a",
 deployerV2Owner:"0x79F7c8aB5360c9902dD23ADf99cdAb54F2A6449D",v1Owner:"0xCECa5491a16ea73F29990313924285EEB9771e3b",danOwnerLater:"0x2d713bbB76d08D1a94D68d944B5Eb0D163F1a524",
 vaultV1:"0x13045D3Dab253fDB15181C16f135D612fa8546E6",vaultV2:"0xAda84161033C0Cc54EF21CEeF913A8fEC4239b33",factoryV1:"0x164D9dFBe901421B560D054aA61D1fe1E9d6D078",factoryV2:"0x1de6a6bD0C62097A7559A29a76e41985558f9918"};
const f=x=>Number(formatUnits(x,6)).toLocaleString(undefined,{maximumFractionDigits:2});
const block=await p.getBlockNumber();
const logs=async(c,fl,from=0)=>{try{return await c.queryFilter(fl,from,block);}catch{const m=Math.floor((from+block)/2);return [...await c.queryFilter(fl,from,m),...await c.queryFilter(fl,m+1,block)];}};
console.log("wallet",W,"| block",block);
for(const [k,v] of Object.entries(KNOWN))if(v.toLowerCase()===W.toLowerCase())console.log("MATCHES known app address:",k);
console.log("is contract:",(await p.getCode(W))!=="0x","| ETH:",formatUnits(await p.getBalance(W),18),"| USDG:",f(await new Contract(USDG,["function balanceOf(address) view returns(uint256)"],p).balanceOf(W)));
const VABI=["event Minted(uint256 indexed basketId,address indexed user,uint256 usdgIn,uint256 valueReceivedUsd,uint256 tokensOut)","event Redeemed(uint256 indexed basketId,address indexed user,uint256 tokensIn,uint256 usdgOut,uint256 valueReturnedUsd)","function owner() view returns(address)"];
for(const [name,addr] of [["V1",KNOWN.vaultV1],["V2",KNOWN.vaultV2]]){
  const c=new Contract(addr,VABI,p);
  const m=await logs(c,c.filters.Minted(null,W)),r=await logs(c,c.filters.Redeemed(null,W));
  console.log(`${name} vault: owner=${await c.owner()} | mints by wallet: ${m.length} ($${f(m.reduce((a,e)=>a+e.args.usdgIn,0n))}) | redeems: ${r.length} ($${f(r.reduce((a,e)=>a+e.args.usdgOut,0n))})`);
  for(const e of m)console.log(`   mint basket ${e.args.basketId} $${f(e.args.usdgIn)} block ${e.blockNumber}`);
}
for(const [name,addr,from] of [["V1 factory",KNOWN.factoryV1,0],["V2 factory",KNOWN.factoryV2,70863402]]){
  const c=new Contract(addr,["event BasketCreated(address indexed clone,address indexed creator,string name,address[] tickers,uint256[] weights)"],p);
  let ev=[];try{ev=await logs(c,c.filters.BasketCreated(null,W),from);}catch{}
  console.log(`${name}: user baskets created by wallet: ${ev.length}`,ev.map(e=>e.args.name));
}
const usdg=new Contract(USDG,["event Transfer(address indexed from,address indexed to,uint256 value)"],p);
const outs=await logs(usdg,usdg.filters.Transfer(W)),ins=await logs(usdg,usdg.filters.Transfer(null,W));
console.log(`USDG transfers: ${ins.length} in ($${f(ins.reduce((a,e)=>a+e.args.value,0n))}), ${outs.length} out ($${f(outs.reduce((a,e)=>a+e.args.value,0n))})`);
const label=a=>Object.entries(KNOWN).find(([k,v])=>v.toLowerCase()===a.toLowerCase())?.[0]??a.slice(0,10);
const cp={};for(const e of ins)cp["from "+label(e.args.from)]=(cp["from "+label(e.args.from)]??0n)+e.args.value;for(const e of outs)cp["to "+label(e.args.to)]=(cp["to "+label(e.args.to)]??0n)+e.args.value;
for(const [k,v] of Object.entries(cp).sort((a,b)=>Number(b[1]-a[1])).slice(0,15))console.log(`   ${k}: $${f(v)}`);
const first=[...ins,...outs].sort((a,b)=>a.blockNumber-b.blockNumber)[0];
if(first){const b=await p.getBlock(first.blockNumber);console.log("first USDG activity:",new Date(b.timestamp*1000).toISOString().slice(0,10));}
// Every ERC20 (not just USDG) that ever landed in the wallet, grouped by token and sender.
import {id as topicId,zeroPadValue} from "ethers";
const TOPIC=topicId("Transfer(address,address,uint256)"),padW=zeroPadValue(W,32);
async function rawLogs(topics,from,to){try{return await p.getLogs({fromBlock:from,toBlock:to,topics});}catch{const m=Math.floor((from+to)/2);return [...await rawLogs(topics,from,m),...await rawLogs(topics,m+1,to)];}}
const allIn=(await rawLogs([TOPIC,null,padW],0,block)).filter(l=>l.topics.length===3&&l.data.length===66);
const byTok={};
for(const l of allIn){const t=l.address.toLowerCase();const fromA="0x"+l.topics[1].slice(26);(byTok[t]??={total:0n,n:0,senders:{}});byTok[t].total+=BigInt(l.data);byTok[t].n++;byTok[t].senders[fromA]=(byTok[t].senders[fromA]??0n)+BigInt(l.data);}
console.log("\nALL token inflows (any ERC20):");
for(const [t,v] of Object.entries(byTok)){
  let sym="?",dec=18;try{const c=new Contract(t,["function symbol() view returns(string)","function decimals() view returns(uint8)"],p);sym=await c.symbol();dec=Number(await c.decimals());}catch{}
  console.log(` ${sym} (${t.slice(0,10)}): ${v.n} transfers, ${Number(formatUnits(v.total,dec)).toLocaleString()} total`);
  for(const [a,amt] of Object.entries(v.senders).sort((x,y)=>Number(y[1]-x[1])).slice(0,8))console.log(`    from ${label(a)}${label(a).length<12?" "+a:""}: ${Number(formatUnits(amt,dec)).toLocaleString()}`);
}
p.destroy();
