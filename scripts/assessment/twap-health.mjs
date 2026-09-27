// Read-only: is each TWAP token on V2 quotable right now, and why not if not.
import {Contract,JsonRpcProvider} from "ethers";
import {readFile} from "node:fs/promises";
const m=JSON.parse(await readFile(new URL("../../reports/mainnet-v2-deployment/deployment.json",import.meta.url),"utf8"));
const REG=m.contracts.find(c=>c.name==="UnifiedTwapRegistry").address,VAULT=m.contracts.find(c=>c.name==="StaxVaultV2").address;
const p=new JsonRpcProvider(process.env.STAX_RPC_URL??"https://rpc.mainnet.chain.robinhood.com",4663,{staticNetwork:true});
const reg=new Contract(REG,["function tokenConfigurations(address) view returns(address pool,uint32 twapWindow,uint32 maxObservationAge,uint128 minCurrentLiquidity,uint128 minHarmonicLiquidity,uint16 maxDeviationBps)","function quoteUsdg18(address) view returns(uint256,uint128)"],p);
const vault=new Contract(VAULT,["function getOraclePriceUsd18(address) view returns(uint256)"],p);
const now=(await p.getBlock("latest")).timestamp;
for(const [sym,t] of Object.entries({AMC:"0x05a3d1cd21d0c88145e82600e62e7e496e0f222b",NFLX:"0xE0444EF8BF4eD74f74FD73686e2ddF4C1c5591E8"})){
  const c=await reg.tokenConfigurations(t);
  const pool=new Contract(c.pool,["function liquidity() view returns(uint128)","function slot0() view returns(uint160,int24,uint16,uint16,uint16,uint8,bool)","function observations(uint256) view returns(uint32,int56,uint160,bool)"],p);
  const liq=await pool.liquidity(),s=await pool.slot0(),o=await pool.observations(s[2]);
  let quote="OK",err="";try{const q=await reg.quoteUsdg18(t);quote=`${Number(q[0])/1e18} USDG, harmonicLiq ${q[1]}`;}catch(e){quote="REVERT";err=(e.shortMessage??e.message).slice(0,80);}
  let vaultPrice="OK";try{vaultPrice=String(Number(await vault.getOraclePriceUsd18(t))/1e18);}catch(e){vaultPrice="REVERT";}
  console.log(sym,{pool:c.pool,floor:String(c.minCurrentLiquidity),currentLiquidity:String(liq),belowFloor:liq<c.minCurrentLiquidity,lastObsAgeSec:now-Number(o[0]),maxObsAge:Number(c.maxObservationAge),maxDeviationBps:Number(c.maxDeviationBps),quote,err,vaultPriceUsd:vaultPrice});
}
p.destroy();
