// Update a TWAP token's live registry settings (floors, window, freshness, deviation). Owner-only call, no redeploy.
// Usage: npm run registry:floor -- TOKEN [--fraction 0.5 | --floor RAW] [--window S] [--max-obs-age S] [--deviation BPS] [--from-proposal FILE] [--broadcast]
// --from-proposal applies the recommended TWAP params from an assessment's proposed-settings.json (window, obs age, deviation, floors).
// Default (no flags) proposes floor = 0.5 x min(current liquidity, current harmonic liquidity), 2 significant digits.
import {readFile} from "node:fs/promises";
import {parseArgs} from "node:util";
import {Contract,JsonRpcProvider,Wallet,getAddress} from "ethers";
const {values,positionals}=parseArgs({allowPositionals:true,options:{broadcast:{type:"boolean"},fraction:{type:"string"},floor:{type:"string"},window:{type:"string"},"max-obs-age":{type:"string"},deviation:{type:"string"},"from-proposal":{type:"string"}}});
if(positionals.length!==1)throw Error("Usage: npm run registry:floor -- TOKEN [--fraction 0.5 | --floor RAW] [--window S] [--max-obs-age S] [--deviation BPS] [--from-proposal FILE] [--broadcast]");
const token=getAddress(positionals[0]);
const m=JSON.parse(await readFile(new URL("../../reports/mainnet-v2-deployment/deployment.json",import.meta.url),"utf8"));
const REG=m.contracts.find((c:any)=>c.name==="UnifiedTwapRegistry").address;
const provider=new JsonRpcProvider(process.env.STAX_RPC_URL??"https://rpc.mainnet.chain.robinhood.com",4663,{staticNetwork:true});
const PARAMS="(address pool,uint32 twapWindow,uint32 maxObservationAge,uint128 minCurrentLiquidity,uint128 minHarmonicLiquidity,uint16 maxDeviationBps)";
const reg=new Contract(REG,["function owner() view returns(address)",`function tokenConfigurations(address) view returns${PARAMS}`,`function configureToken(address,${PARAMS})`,"function quoteUsdg18(address) view returns(uint256,uint128)"],provider);
try{
 const c=await reg.tokenConfigurations(token);
 if(c.pool==="0x0000000000000000000000000000000000000000")throw Error("Token not configured in registry");
 const pool=new Contract(c.pool,["function liquidity() view returns(uint128)","function observe(uint32[]) view returns(int56[],uint160[])"],provider);
 const current=BigInt(await pool.liquidity());
 const [,acc]=await pool.observe([Number(c.twapWindow),0]);
 const delta=(BigInt(acc[1])-BigInt(acc[0])+(1n<<160n))%(1n<<160n);
 const harmonic=delta===0n?0n:BigInt(c.twapWindow)*((1n<<160n)-1n)/(delta<<32n);
 let quoteNow="OK";try{await reg.quoteUsdg18(token);}catch(e:any){quoteNow="REVERT "+(e.shortMessage??e.message).slice(0,60);}
 const floorTwoDigits=(n:bigint)=>{const s=10n**BigInt(Math.max(0,n.toString().length-2));return n/s*s;};
 let proposed:bigint;
 let window=BigInt(c.twapWindow),obsAge=BigInt(c.maxObservationAge),deviation=BigInt(c.maxDeviationBps);
 if(values["from-proposal"]){
  const ps=JSON.parse(await readFile(values["from-proposal"],"utf8")),rs=ps.recommendedSetting;
  if(!rs||ps.status!=="PROPOSED_FOR_REVIEW"||!rs.params?.twapWindow)throw Error("Proposal has no recommended TWAP setting");
  if(rs.pool.toLowerCase()!==c.pool.toLowerCase())throw Error(`Proposal pool ${rs.pool} differs from registry pool ${c.pool}; refusing to switch pools here`);
  window=BigInt(rs.params.twapWindow);obsAge=BigInt(rs.params.maxObservationAge);deviation=BigInt(rs.params.maxDeviationBps);proposed=BigInt(rs.params.minHarmonicLiquidity);
 }else{
  if(values.window)window=BigInt(values.window);
  if(values["max-obs-age"])obsAge=BigInt(values["max-obs-age"]);
  if(values.deviation)deviation=BigInt(values.deviation);
  if(values.floor)proposed=BigInt(values.floor);
  else if(values.fraction||!(values.window||values["max-obs-age"]||values.deviation)){const f=Number(values.fraction??"0.5");if(!(f>0&&f<=1))throw Error("fraction must be in (0,1]");const base=current<harmonic?current:harmonic;proposed=floorTwoDigits(base*BigInt(Math.round(f*1000))/1000n);}
  else proposed=BigInt(c.minHarmonicLiquidity); // window/freshness change only: keep the current floor
 }
 if(proposed<=0n)throw Error("Proposed floor is zero; pool has no usable liquidity");
 if(obsAge<window)console.log("note: maxObservationAge is shorter than the window");
 const next={pool:c.pool,twapWindow:window,maxObservationAge:obsAge,minCurrentLiquidity:proposed,minHarmonicLiquidity:proposed,maxDeviationBps:deviation};
 console.log(JSON.stringify({token,pool:c.pool,current:{window:Number(c.twapWindow),maxObservationAge:Number(c.maxObservationAge),deviationBps:Number(c.maxDeviationBps),floor:String(c.minCurrentLiquidity)},
  currentLiquidity:String(current),harmonicLiquidity:String(harmonic),quoteNow,proposed:{window:Number(window),maxObservationAge:Number(obsAge),deviationBps:Number(deviation),floor:String(proposed)}},null,2));
 const owner=await reg.owner();
 // Read-only simulation as owner: configureToken re-runs every quote check with the new floors.
 try{await reg.configureToken.staticCall(token,next,{from:owner});console.log("Simulation with new floors: quote PASSES");}
 catch(e:any){console.log("Simulation with new floors: REVERTS",(e.shortMessage??e.message).slice(0,100));if(values.broadcast)throw Error("Refusing to broadcast a configuration that still reverts");}
 if(!values.broadcast){console.log("DRY RUN. Add --broadcast to send configureToken.");}
 else{
  const key=(process.env.STAX_PRIVATE_KEY??await readFile(new URL("../../../deployer-private-key.txt",import.meta.url),"utf8")).trim();
  const signer=new Wallet(key,provider);
  if(signer.address.toLowerCase()!==owner.toLowerCase())throw Error("Signer is not the registry owner");
  const tx=await (reg.connect(signer) as any).configureToken(token,next);
  console.log("SUBMITTED",tx.hash);const r=await tx.wait(1,60000);
  if(!r||r.status!==1)throw Error(`Transaction failed: ${tx.hash}`);
  const after=await reg.tokenConfigurations(token);
  console.log("CONFIRMED",tx.hash,"block",r.blockNumber,"now: window",Number(after.twapWindow),"maxObsAge",Number(after.maxObservationAge),"deviation",Number(after.maxDeviationBps),"floor",String(after.minCurrentLiquidity));
 }
}finally{provider.destroy();}
