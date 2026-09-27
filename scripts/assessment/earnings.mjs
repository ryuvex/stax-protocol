// Protocol earnings to date, read-only: node scripts/assessment/earnings.mjs
import {Contract,JsonRpcProvider,formatUnits} from "ethers";
const p=new JsonRpcProvider(process.env.STAX_RPC_URL??"https://rpc.mainnet.chain.robinhood.com",4663,{staticNetwork:true});
const USDG="0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",TREASURY="0xFF843Bc76C276086569D081E02DAC467C2aDa5cE",REWARDS="0xc02F399cBbF90CEc6DD3a7c2D90fcA84C0a3a5ad";
const FACTORY_V2="0x1de6a6bD0C62097A7559A29a76e41985558f9918",FACTORY_V1="0x164D9dFBe901421B560D054aA61D1fe1E9d6D078";
const VAULTS={V1:{address:"0x13045D3Dab253fDB15181C16f135D612fa8546E6",from:0},V2:{address:"0xAda84161033C0Cc54EF21CEeF913A8fEC4239b33",from:68883165}};
const ABI=["event FeeSplit(uint256 toBurn,uint256 toRewardsPool,uint256 toTreasury)","event Minted(uint256 indexed basketId,address indexed user,uint256 usdgIn,uint256 valueReceivedUsd,uint256 tokensOut)",
 "event Redeemed(uint256 indexed basketId,address indexed user,uint256 tokensIn,uint256 usdgOut,uint256 valueReturnedUsd)","event TreasuryFeesClaimed(uint256 amount)","event RewardsPoolClaimed(uint256 amount)",
 "function pendingBuyBurn() view returns(uint256)","function pendingRewardsPool() view returns(uint256)","function pendingTreasuryFees() view returns(uint256)"];
const usdg=new Contract(USDG,["function balanceOf(address) view returns(uint256)","event Transfer(address indexed from,address indexed to,uint256 value)"],p);
const f=x=>Number(formatUnits(x,6)).toLocaleString(undefined,{maximumFractionDigits:2});
const block=await p.getBlockNumber();console.log("block",block);
async function logs(c,filter,from){try{return await c.queryFilter(filter,from,block);}catch(e){const mid=Math.floor((from+block)/2);return [...await c.queryFilter(filter,from,mid),...await c.queryFilter(filter,mid+1,block)];}}
let grand={fees:0n,mint:0n,redeem:0n};
for(const [name,v] of Object.entries(VAULTS)){
  const c=new Contract(v.address,ABI,p);
  const splits=await logs(c,c.filters.FeeSplit(),v.from),mints=await logs(c,c.filters.Minted(),v.from),redeems=await logs(c,c.filters.Redeemed(),v.from);
  const tc=await logs(c,c.filters.TreasuryFeesClaimed(),v.from),rc=await logs(c,c.filters.RewardsPoolClaimed(),v.from);
  const sum=(xs,k)=>xs.reduce((a,e)=>a+e.args[k],0n);
  const fees={burn:sum(splits,"toBurn"),rewards:sum(splits,"toRewardsPool"),treasury:sum(splits,"toTreasury")};
  const total=fees.burn+fees.rewards+fees.treasury;
  const mintVol=sum(mints,"usdgIn"),redeemVol=sum(redeems,"usdgOut");
  const users=new Set([...mints,...redeems].map(e=>e.args.user.toLowerCase())).size;
  const pending={burn:await c.pendingBuyBurn(),rewards:await c.pendingRewardsPool(),treasury:await c.pendingTreasuryFees()};
  console.log(`\n${name} ${v.address}`);
  console.log(`  mints: ${mints.length} ($${f(mintVol)} USDG in) | redeems: ${redeems.length} ($${f(redeemVol)} out) | unique wallets: ${users}`);
  console.log(`  fees earned: $${f(total)}  (burn $${f(fees.burn)} | rewards $${f(fees.rewards)} | treasury $${f(fees.treasury)})`);
  console.log(`  claimed: treasury $${f(sum(tc,"amount"))} (${tc.length} claims) | rewards $${f(sum(rc,"amount"))} (${rc.length}) | still in vault: burn $${f(pending.burn)} rewards $${f(pending.rewards)} treasury $${f(pending.treasury)}`);
  grand.fees+=total;grand.mint+=mintVol;grand.redeem+=redeemVol;
}
// User-basket creation fees: 2 USDG per basket paid to treasury by the factories' callers.
let creation=0n;
for(const [name,addr,from] of [["V1 factory",FACTORY_V1,0],["V2 factory",FACTORY_V2,70863402]]){
  const fc=new Contract(addr,["event BasketCreated(address indexed clone,address indexed creator,string name,address[] tickers,uint256[] weights)","function basketCount() view returns(uint256)"],p);
  let n=0;try{n=Number(await fc.basketCount());}catch{const ev=await logs(fc,fc.filters.BasketCreated(),from);n=ev.length;}
  console.log(`\n${name}: ${n} user baskets created -> $${f(BigInt(n)*2000000n)} creation fees`);creation+=BigInt(n)*2000000n;
}
// Gacha pulls: the frontend sends 2 USDG per pull straight to a separate treasury wallet.
const GACHA_TREASURY="0x14D3D296947973C5AD9Cf6d235C9a582Fb7b2f8a";
for(const [label,addr] of [["Gacha treasury",GACHA_TREASURY],["Protocol treasury",TREASURY]]){
  const inb=await logs(usdg,usdg.filters.Transfer(null,addr),0);
  const total=inb.reduce((a,e)=>a+e.args.value,0n);
  const byDay={};for(const e of inb){const b=await p.getBlock(e.blockNumber);const d=new Date(b.timestamp*1000).toISOString().slice(0,10);byDay[d]=(byDay[d]??0n)+e.args.value;}
  const days=Object.keys(byDay).sort();
  console.log(`\n${label} ${addr}: ${inb.length} USDG transfers in, $${f(total)} total, balance now $${f(await usdg.balanceOf(addr))}`);
  console.log(`  active days: ${days.length}${days.length?` (${days[0]} .. ${days.at(-1)})`:""}; last 10 days:`);
  for(const d of days.slice(-10))console.log(`    ${d}  $${f(byDay[d])}`);
}
console.log(`\nTreasury USDG balance now: $${f(await usdg.balanceOf(TREASURY))} | Rewards pool USDG balance: $${f(await usdg.balanceOf(REWARDS))}`);
console.log(`\nTOTAL protocol fees (V1+V2 mint/redeem): $${f(grand.fees)} + creation fees $${f(creation)} = $${f(grand.fees+creation)} | volume: $${f(grand.mint)} minted, $${f(grand.redeem)} redeemed`);
p.destroy();
