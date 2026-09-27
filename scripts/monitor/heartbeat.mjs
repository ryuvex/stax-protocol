// Stax TWAP heartbeat: keeps TWAP pools "fresh" by doing a tiny USDG->token->USDG round trip
// when a pool's last observation is older than STAX_HEARTBEAT_AFTER_SEC (default 2h).
// A ~$1 trade cannot move the price; it only refreshes the pool's observation so 3h oracle windows never go stale.
//
// Usage:
//   node scripts/monitor/heartbeat.mjs                 loop: check every 5 min, trade only when needed
//   node scripts/monitor/heartbeat.mjs --once          check all TWAP tokens once, trade the stale ones, exit
//   node scripts/monitor/heartbeat.mjs --once NFLX     trade NFLX now (by symbol or address), exit
//   add --dry-run to print what would be sent without signing anything
// Key: STAX_HEARTBEAT_PRIVATE_KEY env, or file at STAX_HEARTBEAT_KEY_FILE (default ../../../heartbeat-private-key.txt, outside the repo).
// Use a small dedicated wallet (a few USDG + a little ETH). Never the deployer key.
import {Contract,JsonRpcProvider,Wallet,AbiCoder,solidityPacked,MaxUint256,formatUnits,parseUnits} from "ethers";
import {readFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import "dotenv/config";

const args=process.argv.slice(2);
const ONCE=args.includes("--once"), DRY=args.includes("--dry-run"), ALLOW_OWNER=args.includes("--allow-owner-key");
const PICK=args.filter(a=>!a.startsWith("--"));
const RPC=process.env.STAX_RPC_URL??"https://rpc.mainnet.chain.robinhood.com";
const AFTER=Number(process.env.STAX_HEARTBEAT_AFTER_SEC??7200);
const EVERY=Math.max(60,Number(process.env.STAX_HEARTBEAT_CHECK_SEC??300))*1000;
// A Uniswap V3 pool only records a new observation when a swap MOVES THE TICK (0.01% price step).
// So the heartbeat buys just enough to cross the next tick boundary (computed from the pool state), verifies the tick moved, then sells everything back.
const MAX_USDG=Number(process.env.STAX_HEARTBEAT_MAX_USDG??150); // refuse heartbeats that would need more than this
const AMOUNT_USDG=MAX_USDG; // top-up sizing
const ROUTER="0x8876789976dEcBfCbBbe364623C63652db8C0904", PERMIT2="0x000000000022D473030F116dDEE9F6B43aC78BA3";
const WETH="0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73", WETH_USDG_POOL="0x52e65B17fB6E5BA00Ed806f37Afcd2DaA50271Ca", WETH_USDG_FEE=100; // $9.8M USDG V3 pool
const ROUTER_ADDRESS_THIS="0x0000000000000000000000000000000000000002";
const TOPUP_USDG=Number(process.env.STAX_HEARTBEAT_TOPUP_USDG??AMOUNT_USDG); // when the wallet has no USDG, buy this much with ETH

const deployment=JSON.parse(await readFile(new URL("../../reports/mainnet-v2-deployment/deployment.json",import.meta.url),"utf8"));
const userDeployment=JSON.parse(await readFile(new URL("../../reports/userbasket-v2-deployment/deployment.json",import.meta.url),"utf8"));
const addr=n=>deployment.contracts.find(c=>c.name===n).address;
const VAULT=addr("StaxVaultV2"), REGISTRY=addr("UnifiedTwapRegistry"), FACTORY=userDeployment.factory.address;
const abi=async f=>{const a=JSON.parse(await readFile(new URL(`../../abi/${f}.json`,import.meta.url),"utf8"));return Array.isArray(a)?a:a.abi;};
const provider=new JsonRpcProvider(RPC,4663,{staticNetwork:true});
const vault=new Contract(VAULT,await abi("StaxVaultV2"),provider);
const registry=new Contract(REGISTRY,await abi("UnifiedTwapRegistry"),provider);
const factory=new Contract(FACTORY,await abi("StaxUserBasketFactoryV2"),provider);
const cloneAbi=await abi("StaxUserBasketV2");
const USDG=await vault.usdg();
const ERC20=["function balanceOf(address) view returns(uint256)","function approve(address,uint256) returns(bool)","function allowance(address,address) view returns(uint256)","function decimals() view returns(uint8)","function symbol() view returns(string)"];
const POOL=["function liquidity() view returns(uint128)","function fee() view returns(uint24)","function token0() view returns(address)","function slot0() view returns(uint160 sqrtPriceX96,int24 tick,uint16 observationIndex,uint16,uint16,uint8,bool)","function observations(uint256) view returns(uint32 blockTimestamp,int56,uint160,bool)"];
const short=a=>`${a.slice(0,6)}…${a.slice(-4)}`;

// wallet
let signer=null;
if(!DRY){
  const keyFile=process.env.STAX_HEARTBEAT_KEY_FILE??fileURLToPath(new URL(ALLOW_OWNER?"../../../deployer-private-key.txt":"../../../heartbeat-private-key.txt",import.meta.url));
  const key=(process.env.STAX_HEARTBEAT_PRIVATE_KEY??await readFile(keyFile,"utf8")).trim();
  signer=new Wallet(key,provider);
  const owner=await vault.owner();
  if(signer.address.toLowerCase()===owner.toLowerCase()){
    if(!ALLOW_OWNER||!ONCE) throw Error("Refusing to use the vault owner/deployer key for heartbeat trades. Use a small dedicated wallet (or --once --allow-owner-key for a single manual run).");
    console.warn("WARNING: using the vault owner key for a one-off heartbeat. Do not run the loop with this key.");
  }
  console.log("heartbeat wallet",signer.address);
}

// discover TWAP tokens in all baskets
async function twapTokens(){
  const set=new Set();
  let misses=0;
  for(let id=1;misses<5&&id<200;id++){const b=await vault.baskets(id);if(!b.exists){misses++;continue;}misses=0;if(b.mintPaused)continue;for(const t of (await vault.getBasketComposition(id))[0])set.add(t.toLowerCase());}
  const n=Number(await factory.basketCount());
  for(let i=0;i<n;i++){const c=new Contract(await factory.baskets(i),cloneAbi,provider);for(const t of (await c.getComposition())[0])set.add(t.toLowerCase());}
  const out=[];
  for(const t of set){const s=await vault.oracleSettings(t);if(Number(s.oracleType)!==2)continue;const sym=await new Contract(t,ERC20,provider).symbol().catch(()=>short(t));out.push({token:t,sym});}
  return out;
}
async function poolState(token,now){
  const c=await registry.tokenConfigurations(token);
  const pool=new Contract(c.pool,POOL,provider);
  const [fee,s0]=await Promise.all([pool.fee(),pool.slot0()]);
  const obs=await pool.observations(s0.observationIndex);
  const token0=(await pool.token0()).toLowerCase();
  const sqrt=Number(s0.sqrtPriceX96)/2**96; const p01=sqrt*sqrt; // token1 per token0 (raw units)
  const liq=await pool.liquidity();
  return {pool:c.pool,fee:Number(fee),age:now-Number(obs.blockTimestamp),maxAge:Number(c.maxObservationAge),usdgIsToken0:token0===USDG.toLowerCase(),p01,sqrt,tick:Number(s0.tick),liquidity:Number(liq)};
}

async function ensureApprovals(tokenAddr){
  const erc=new Contract(tokenAddr,ERC20,signer);
  if((await erc.allowance(signer.address,PERMIT2))<MaxUint256/2n){console.log("approve",short(tokenAddr),"-> Permit2");await (await erc.approve(PERMIT2,MaxUint256)).wait();}
  const permit=new Contract(PERMIT2,["function allowance(address,address,address) view returns(uint160 amount,uint48 expiration,uint48 nonce)","function approve(address,address,uint160,uint48)"],signer);
  const a=await permit.allowance(signer.address,tokenAddr,ROUTER);
  const now=Math.floor(Date.now()/1000);
  if(a.amount<(1n<<159n)||Number(a.expiration)<now+86400*30){console.log("permit2 approve",short(tokenAddr),"-> router");await (await permit.approve(tokenAddr,ROUTER,(1n<<160n)-1n,(1n<<48n)-1n)).wait();}
}
async function swap(input,output,fee,amountIn,minOut){
  const router=new Contract(ROUTER,["function execute(bytes,bytes[],uint256) payable"],signer);
  const path=solidityPacked(["address","uint24","address"],[input,fee,output]);
  const data=AbiCoder.defaultAbiCoder().encode(["address","uint256","uint256","bytes","bool","uint256[]"],[signer.address,amountIn,minOut,path,true,[]]);
  const deadline=Math.floor(Date.now()/1000)+300;
  // simulate first so a revert comes back with its reason instead of a bare failed tx
  try{await router.execute.staticCall("0x00",[data],deadline);}
  catch(e){const d=e?.data??e?.error?.data??e?.info?.error?.data;throw Error(`swap ${short(input)}->${short(output)} would revert: ${e.shortMessage??e.message}${typeof d==="string"?` data=${d.slice(0,138)}`:""}`);}
  const tx=await router.execute("0x00",[data],deadline,{gasLimit:600_000});
  try{const r=await tx.wait();return r.hash;}
  catch(e){throw Error(`swap tx ${e.receipt?.hash??tx.hash} reverted on-chain`);}
}
// Buy USDG with ETH through the router (WRAP_ETH + V3 swap) when the wallet is short.
async function ensureUsdg(needRaw,ud){
  const usdg=new Contract(USDG,ERC20,provider);
  if((await usdg.balanceOf(signer.address))>=needRaw) return;
  const pool=new Contract(WETH_USDG_POOL,POOL,provider);
  const [s0,t0]=await Promise.all([pool.slot0(),pool.token0()]);
  const sqrt=Number(s0.sqrtPriceX96)/2**96, p01=sqrt*sqrt; // token1 per token0, raw
  const usdgPerWethRaw=t0.toLowerCase()===WETH.toLowerCase()?p01:1/p01;
  const have=await usdg.balanceOf(signer.address);
  const usdgRaw=needRaw-have+parseUnits("0.05",ud); // shortfall + a little for rounding
  const ethIn=BigInt(Math.ceil(Number(usdgRaw)/usdgPerWethRaw*1.02)); // 2% headroom
  const ethBal=await provider.getBalance(signer.address);
  if(ethBal<ethIn+parseUnits("0.0002",18)) throw Error(`need ${formatUnits(ethIn,18)} ETH to buy ${TOPUP_USDG} USDG, wallet has ${formatUnits(ethBal,18)}`);
  console.log(`  buying ${formatUnits(usdgRaw,ud)} USDG with ~${formatUnits(ethIn,18)} ETH`);
  if(DRY) return;
  const router=new Contract(ROUTER,["function execute(bytes,bytes[],uint256) payable"],signer);
  const wrap=AbiCoder.defaultAbiCoder().encode(["address","uint256"],[ROUTER_ADDRESS_THIS,ethIn]);
  const path=solidityPacked(["address","uint24","address"],[WETH,WETH_USDG_FEE,USDG]);
  const swapIn=AbiCoder.defaultAbiCoder().encode(["address","uint256","uint256","bytes","bool","uint256[]"],[signer.address,ethIn,usdgRaw*97n/100n,path,false,[]]);
  const tx=await router.execute("0x0b00",[wrap,swapIn],Math.floor(Date.now()/1000)+300,{value:ethIn,gasLimit:600_000});
  const r=await tx.wait();
  console.log(`  topup ${r.hash} USDG now ${formatUnits(await usdg.balanceOf(signer.address),ud)}`);
}
// USDG needed to push the price across the nearest tick boundary (so the pool writes an observation).
function usdgToCrossTick(st,ud){
  const L=st.liquidity;
  let raw;
  if(st.usdgIsToken0){ // USDG in = token0 in -> price (token1/token0) falls -> cross the LOWER edge of the current tick
    const sqrtLower=Math.pow(1.0001,st.tick/2);
    raw=L*(1/sqrtLower-1/st.sqrt);
  } else {              // USDG in = token1 in -> price rises -> cross the UPPER edge
    const sqrtUpper=Math.pow(1.0001,(st.tick+1)/2);
    raw=L*(sqrtUpper-st.sqrt);
  }
  raw=raw/(1-st.fee/1e6)*1.05+1000; // + fee + 5% margin + dust so we land strictly past the edge
  return BigInt(Math.ceil(Math.max(raw,0)));
}
async function currentTick(pool){return Number((await new Contract(pool,POOL,provider).slot0()).tick);}
async function heartbeat(t,st){
  const usdg=new Contract(USDG,ERC20,provider), tok=new Contract(t.token,ERC20,provider);
  const [ud,td]=[Number(await usdg.decimals()),Number(await tok.decimals())];
  let amountIn=usdgToCrossTick(st,ud);
  const cap=parseUnits(String(MAX_USDG),ud);
  console.log(`${t.sym}: last trade ${Math.round(st.age/60)} min ago (limit ${Math.round(st.maxAge/60)}), pool ${short(st.pool)} fee ${st.fee}, tick ${st.tick}. Need ~${formatUnits(amountIn,ud)} USDG to cross the next tick (cap ${MAX_USDG}).`);
  if(amountIn>cap){console.log(`  skipped: would cost more than the cap`);return;}
  if(DRY){console.log("  dry run: would buy, verify tick moved, then sell back");return;}
  await ensureUsdg(amountIn>parseUnits("1",ud)?amountIn:parseUnits("1",ud),ud);
  const eth=await provider.getBalance(signer.address); if(eth<parseUnits("0.0002",18)) throw Error(`wallet ETH too low: ${formatUnits(eth,18)}`);
  await ensureApprovals(USDG); await ensureApprovals(t.token);
  const tokPerUsdgRaw=st.usdgIsToken0?st.p01:1/st.p01;
  const before=await tok.balanceOf(signer.address), usdgStart=await usdg.balanceOf(signer.address);
  let spent=0n, tries=0;
  for(;;){
    const bal=await usdg.balanceOf(signer.address); if(bal<amountIn) throw Error(`wallet has ${formatUnits(bal,ud)} USDG, needs ${formatUnits(amountIn,ud)}`);
    const minOut=BigInt(Math.floor(Number(amountIn)*tokPerUsdgRaw*0.9));
    const h=await swap(USDG,t.token,st.fee,amountIn,minOut); spent+=amountIn;
    const tickNow=await currentTick(st.pool);
    console.log(`  buy  ${h} (${formatUnits(amountIn,ud)} USDG) tick ${st.tick} -> ${tickNow}`);
    if(tickNow!==st.tick) break;
    if(++tries>=3||spent*2n>cap){console.log("  tick did not move within the cap; selling back");break;}
    amountIn=amountIn*2n; // fallback if the estimate was short
  }
  const got=(await tok.balanceOf(signer.address))-before;
  if(got>0n){const h2=await swap(t.token,USDG,st.fee,got,spent*95n/100n);const usdgEnd=await usdg.balanceOf(signer.address);console.log(`  sell ${h2} — round trip cost ${formatUnits(usdgStart-usdgEnd,ud)} USDG`);}
}
async function tick(){
  const now=(await provider.getBlock("latest")).timestamp;
  let tokens=await twapTokens();
  if(PICK.length) tokens=tokens.filter(t=>PICK.some(p=>p.toLowerCase()===t.sym.toLowerCase()||p.toLowerCase()===t.token));
  if(PICK.length&&!tokens.length) throw Error(`no TWAP basket token matches ${PICK.join(",")}`);
  for(const t of tokens){
    const st=await poolState(t.token,now);
    const due=PICK.length||st.age>AFTER;
    if(!due){console.log(`${t.sym}: fresh (${Math.round(st.age/60)} min)`);continue;}
    try{await heartbeat(t,st);}catch(e){console.error(`${t.sym}: heartbeat failed:`,e.shortMessage??e.message);}
  }
}
if(ONCE){await tick();process.exit(0);}
console.log(`heartbeat loop: every ${EVERY/1000}s, trade when last observation > ${AFTER}s, ${AMOUNT_USDG} USDG`);
for(;;){try{await tick();}catch(e){console.error(new Date().toISOString(),"tick failed:",e.shortMessage??e.message);}await new Promise(r=>setTimeout(r,EVERY));}
