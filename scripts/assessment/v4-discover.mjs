// Find hookless Uniswap V4 USDG pools for a token on Robinhood Chain and read live state via extsload.
// Usage: node scripts/assessment/v4-discover.mjs 0xTOKEN [0xTOKEN2 ...]
import {Contract,JsonRpcProvider,AbiCoder,keccak256,solidityPacked,toBeHex,getAddress} from "ethers";
const RPC=process.env.STAX_RPC_URL??"https://rpc.mainnet.chain.robinhood.com";
const POOL_MANAGER="0x8366a39CC670B4001A1121B8F6A443A643e40951",USDG="0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
const ABI=["event Initialize(bytes32 indexed id,address indexed currency0,address indexed currency1,uint24 fee,int24 tickSpacing,address hooks,uint160 sqrtPriceX96,int24 tick)",
 "function extsload(bytes32) view returns(bytes32)"];
const provider=new JsonRpcProvider(RPC,4663,{staticNetwork:true});
const pm=new Contract(POOL_MANAGER,ABI,provider);
const stateSlot=id=>keccak256(solidityPacked(["bytes32","uint256"],[id,6n]));           // StateLibrary.POOLS_SLOT = 6
const dec=async t=>Number(await new Contract(t,["function decimals() view returns(uint8)"],provider).decimals());
const usdgDec=await dec(USDG);
for(const raw of process.argv.slice(2)){
  const token=getAddress(raw),tokenDec=await dec(token);
  const [a,b]=token.toLowerCase()<USDG.toLowerCase()?[token,USDG]:[USDG,token];
  let events;
  try{events=await pm.queryFilter(pm.filters.Initialize(null,a,b));}
  catch(e){console.log(token,"queryFilter failed (RPC range limit?):",e.shortMessage??e.message);continue;}
  const rows=[];
  for(const ev of events){
    const {id,fee,tickSpacing,hooks}=ev.args;
    const base=BigInt(stateSlot(id));
    const liquidity=BigInt(await pm.extsload(toBeHex(base+3n,32)));                        // StateLibrary.LIQUIDITY_OFFSET = 3
    if(liquidity===0n)continue;
    const slot0=BigInt(await pm.extsload(toBeHex(base,32)));
    const sqrt=slot0&((1n<<160n)-1n);let tick=Number((slot0>>160n)&0xffffffn);if(tick>=1<<23)tick-=1<<24;
    const p=(Number(sqrt)/2**96)**2,price=(a.toLowerCase()===token.toLowerCase()?p:1/p)*10**(tokenDec-usdgDec);
    rows.push({poolId:id,currency0:a,currency1:b,fee:Number(fee),tickSpacing:Number(tickSpacing),hooks,hookless:hooks==="0x0000000000000000000000000000000000000000",
      liquidity:liquidity.toString(),tick,priceUsdg:price,initBlock:ev.blockNumber});
  }
  rows.sort((x,y)=>BigInt(y.liquidity)>BigInt(x.liquidity)?1:-1);
  console.log(`\n${token} (${tokenDec} dec): ${events.length} USDG V4 pool(s), ${rows.length} with liquidity. Top 5:`);
  for(const r of rows.slice(0,5))console.log(JSON.stringify(r));
}
provider.destroy();
