import {readFile,writeFile} from "node:fs/promises";
import {dirname,resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {parseArgs} from "node:util";
import {Contract,JsonRpcProvider,Wallet,parseUnits,formatUnits} from "ethers";
import type {AbstractProvider,Signer} from "ethers";
import {buildPlan} from "./plan-token.ts";
import type {TokenConfig} from "./plan-token.ts";

const BASKET_ABI=[
 "function baskets(uint256) view returns(string name,address token,uint256 depositCapUsd,uint256 maxMintUsd,bool mintPaused,bool exists)",
 "function getBasketComposition(uint256) view returns(address[],uint256[])",
 "function createBasket(uint256,string,string,address[],uint256[],uint256,uint256)",
];
export type BasketInput={id:string;name:string;symbol:string;capUsd:string};
const BASKET_CREATED="event BasketCreated(uint256 indexed basketId,address token,string name)";
/// Basket share symbols are permanent ERC20 metadata: refuse any symbol already used on the listed vaults (V1, V2, ...).
export async function findSymbolCollision(provider:AbstractProvider,vaults:string[],symbol:string):Promise<{vault:string;basketId:string;token:string}|null>{
 for(const vaultAddress of vaults){
  const vault=new Contract(vaultAddress,[BASKET_CREATED],provider);
  let events:any[]=[];
  try{events=await vault.queryFilter(vault.filters.BasketCreated());}catch{throw Error(`Could not read BasketCreated history from ${vaultAddress}; symbol collision check failed closed`);}
  for(const ev of events){
   const token=new Contract(ev.args.token,["function symbol() view returns(string)"],provider);
   let existing="";try{existing=await token.symbol();}catch{continue;}
   if(existing.toLowerCase()===symbol.toLowerCase())return {vault:vaultAddress,basketId:String(ev.args.basketId),token:ev.args.token};
  }
 }
 return null;
}
export type Component={proposal:any;base:TokenConfig;weightBps:number};
const same=(a:string,b:string)=>a.toLowerCase()===b.toLowerCase();

/// Turns a passing assessment proposal (TWAP or CHAINLINK) into the exact registration config.
export function configurationFromProposal(proposal:any,base:TokenConfig):TokenConfig {
 const s=proposal.recommendedSetting;
 if(proposal.status!=="PROPOSED_FOR_REVIEW"||s?.status!=="PROPOSED_FOR_REVIEW")throw Error("No recommended passing configuration. Run onboarding first.");
 if(!same(s.token,base.token))throw Error("Proposal token mismatch");
 if(s.oracleType==="CHAINLINK"){
  if(base.oracle.type!=="CHAINLINK")throw Error("Proposal token/oracle mismatch");
  const {feed,maxStaleness,route,slippageBps}=s.params;
  if(route?.venue==="v4"){
   const {currency0,currency1,fee,tickSpacing,hooks}=route;
   return {...base,pool:base.usdg,fee,slippageBps,v4:{currency0,currency1,fee,tickSpacing,hooks},oracle:{type:"CHAINLINK",feed,maxStaleness}};
  }
  if(route?.venue!=="v3")throw Error("Unknown route venue in proposal");
  return {...base,pool:route.pool,fee:route.fee,slippageBps,oracle:{type:"CHAINLINK",feed,maxStaleness}};
 }
 if(base.oracle.type!=="TWAP")throw Error("Proposal token/oracle mismatch");
 const {slippageBps,...safety}=s.params;
 return {...base,pool:s.pool,fee:s.fee,slippageBps,oracle:{...base.oracle,safety}};
}

/// Single-token basket (original entry point; kept for tests and the AMC/NFLX flow).
export async function executeListing(provider:AbstractProvider,signer:Signer|null,proposal:any,base:TokenConfig,basket:BasketInput,
 options:{broadcast?:boolean;record?:(entry:any)=>Promise<void>;singleTokenApproved?:boolean}={}) {
 return executeBasketListing(provider,signer,[{proposal,base,weightBps:10000}],basket,options);
}

/// Registers every component token that is not yet registered, then creates one basket with the given weights.
export async function executeBasketListing(provider:AbstractProvider,signer:Signer|null,components:Component[],basket:BasketInput,
 options:{broadcast?:boolean;record?:(entry:any)=>Promise<void>;singleTokenApproved?:boolean;symbolCheckVaults?:string[]}={}) {
 if(!components.length||components.length>20)throw Error("1-20 basket components required");
 // Baskets are designed and signed off by Dan; a single token is not a basket unless explicitly approved.
 if(components.length===1&&!options.singleTokenApproved)throw Error("Single-token basket refused: baskets need Dan's sign-off. Pass --single-token-approved only with explicit approval.");
 if(components.reduce((s,c)=>s+c.weightBps,0)!==10000||components.some(c=>!Number.isInteger(c.weightBps)||c.weightBps<=0))throw Error("Weights must be positive integers summing to 10000 bps");
 const configs=components.map(c=>configurationFromProposal(c.proposal,c.base));
 const tokens=configs.map(c=>c.token);
 if(new Set(tokens.map(t=>t.toLowerCase())).size!==tokens.length)throw Error("Duplicate component token");
 if(configs.some(c=>!same(c.vault,configs[0].vault)||!same(c.expectedOwner,configs[0].expectedOwner)))throw Error("Components must target one vault/owner");
 const vaultConfig=configs[0];
 if(!/^\d+$/.test(basket.id)||BigInt(basket.id)>=2n**256n||!basket.name?.trim()||!basket.symbol?.trim())throw Error("Basket ID, name and symbol required");
 const cap=parseUnits(basket.capUsd,18),maximum=cap*15n/100n;
 if(cap<=0n||cap>=2n**256n||maximum===0n)throw Error("Invalid basket cap");
 if(options.broadcast){
  if(!signer)throw Error("Signer required");
  const who=await signer.getAddress();
  if(!same(who,vaultConfig.expectedOwner))throw Error("Signer must own both vault and registry");
  for(const c of configs)if(c.oracle.type==="TWAP"&&!same(who,c.oracle.expectedRegistryOwner))throw Error("Signer must own both vault and registry");
 }
 // All preflight checks for every component run before the first transaction, including existing basket conflicts.
 const plans=async()=>{
  const steps:{label:string;owner:string;to:string;value:string;data:string}[]=[];
  for(const c of configs)for(const s of (await buildPlan(provider,c)).steps)if(!steps.some(x=>same(x.to,s.to)&&x.data===s.data))steps.push(s);
  return steps;
 };
 const vault=new Contract(vaultConfig.vault,BASKET_ABI,provider);
 const weights=components.map(c=>BigInt(c.weightBps));
 async function basketExists(){
  const existing=await vault.baskets(basket.id);
  if(!existing.exists)return false;
  const [tickers,w]=await vault.getBasketComposition(basket.id);
  const token=new Contract(existing.token,["function symbol() view returns(string)"],provider);
  const sameComposition=tickers.length===tokens.length&&tickers.every((t:string,i:number)=>same(t,tokens[i])&&w[i]===weights[i]);
  if(existing.name!==basket.name||await token.symbol()!==basket.symbol||existing.depositCapUsd!==cap||existing.maxMintUsd!==maximum||!sameComposition)throw Error("Basket ID already exists with different settings");
  return true;
 }
 const registration=await plans();
 const exists=await basketExists();
 if(!exists&&options.symbolCheckVaults?.length){
  const hit=await findSymbolCollision(provider,options.symbolCheckVaults,basket.symbol);
  if(hit)throw Error(`Symbol ${basket.symbol} already exists: basket ${hit.basketId} on vault ${hit.vault} (token ${hit.token}). Pick a distinct symbol.`);
 }
 const create={label:`Create basket (${tokens.length} token${tokens.length>1?"s":""})`,owner:vaultConfig.expectedOwner,to:vaultConfig.vault,value:"0",
  data:vault.interface.encodeFunctionData("createBasket",[basket.id,basket.name,basket.symbol,tokens,weights,cap,maximum])};
 const steps=[...registration,...(exists?[]:[create])];
 if(!options.broadcast)return {mode:"DRY_RUN",steps,tokens,weightsBps:components.map(c=>c.weightBps),capUsd:basket.capUsd,maxMintUsd:maximum.toString(),
  oracles:configs.map(c=>c.oracle.type),note:"Dependent calls are not simulated together; use local tests. Nothing sent."};
 for(const step of steps){
  // Recheck owners, routes, prices and all existing settings before each send.
  if(step===create){if(await basketExists())continue;}
  else if(!(await plans()).some(s=>same(s.to,step.to)&&s.data===step.data))continue;
  const request={to:step.to,data:step.data,value:0n};
  const gas=await signer!.estimateGas(request);
  const tx=await signer!.sendTransaction({...request,gasLimit:gas*120n/100n});
  await options.record?.({label:step.label,hash:tx.hash,status:"SUBMITTED"});
  const receipt=await tx.wait(1,60000);
  if(!receipt||receipt.status!==1)throw Error(`Transaction failed or pending: ${tx.hash}`);
  await options.record?.({label:step.label,hash:tx.hash,status:"CONFIRMED",blockNumber:receipt.blockNumber});
 }
 if((await plans()).length||!await basketExists())throw Error("Final state verification failed");
 return {mode:"COMPLETE",vault:vaultConfig.vault,basketId:basket.id,basketToken:(await vault.baskets(basket.id)).token,tokens,transactions:steps.length};
}

/// Registers component tokens on V2 (pricing + execution route) WITHOUT creating any basket.
/// Used to widen the user-basket Create page: tokens must be registered and priceable before the frontend can offer them.
export async function executeRegistration(provider:AbstractProvider,signer:Signer|null,components:Component[],
 options:{broadcast?:boolean;record?:(entry:any)=>Promise<void>}={}) {
 if(!components.length||components.length>40)throw Error("1-40 tokens required");
 const configs=components.map(c=>configurationFromProposal(c.proposal,c.base));
 const tokens=configs.map(c=>c.token);
 if(new Set(tokens.map(t=>t.toLowerCase())).size!==tokens.length)throw Error("Duplicate token");
 if(configs.some(c=>!same(c.vault,configs[0].vault)||!same(c.expectedOwner,configs[0].expectedOwner)))throw Error("Components must target one vault/owner");
 const vaultConfig=configs[0];
 if(options.broadcast){
  if(!signer)throw Error("Signer required");
  const who=await signer.getAddress();
  if(!same(who,vaultConfig.expectedOwner))throw Error("Signer must own both vault and registry");
  for(const c of configs)if(c.oracle.type==="TWAP"&&!same(who,c.oracle.expectedRegistryOwner))throw Error("Signer must own both vault and registry");
 }
 const plans=async()=>{
  const steps:{label:string;owner:string;to:string;value:string;data:string;token:string}[]=[];
  for(const c of configs)for(const s of (await buildPlan(provider,c)).steps)if(!steps.some(x=>same(x.to,s.to)&&x.data===s.data))steps.push({...s,token:c.token});
  return steps;
 };
 const vault=new Contract(vaultConfig.vault,[...BASKET_ABI,"function oracleSettings(address) view returns(uint8,address)","function getOraclePriceUsd18(address) view returns(uint256)","function tickerIsV3(address) view returns(bool)"],provider);
 const verify=async()=>{const out:any[]=[];for(const c of configs){const [ot]=await vault.oracleSettings(c.token);let price:string|null=null,error:string|null=null;
  try{price=formatUnits(await vault.getOraclePriceUsd18(c.token),18);}catch(e:any){error=(e.shortMessage??e.message).slice(0,80);}
  out.push({token:c.token,oracle:c.oracle.type,registered:Number(ot)!==0,priceable:price!==null,priceUsd:price,route:(await vault.tickerIsV3(c.token))?"v3":"v4",error});}return out;};
 const steps=await plans();
 if(!options.broadcast)return {mode:"DRY_RUN",steps,tokens,oracles:configs.map(c=>c.oracle.type),alreadyRegistered:tokens.filter(t=>!steps.some(s=>same(s.token,t))),verification:await verify(),note:"Registration only, no basket. Nothing sent."};
 for(const step of steps){
  // Re-check only this token's plan against live state (not all tokens) right before sending.
  const cfg=configs.find(c=>same(c.token,step.token))!;
  if(!(await buildPlan(provider,cfg)).steps.some(s=>same(s.to,step.to)&&s.data===step.data))continue;
  const request={to:step.to,data:step.data,value:0n};
  const gas=await signer!.estimateGas(request);
  const tx=await signer!.sendTransaction({...request,gasLimit:gas*120n/100n});
  await options.record?.({label:`${step.label} (${step.token})`,hash:tx.hash,status:"SUBMITTED"});
  const receipt=await tx.wait(1,60000);
  if(!receipt||receipt.status!==1)throw Error(`Transaction failed or pending: ${tx.hash}`);
  await options.record?.({label:`${step.label} (${step.token})`,hash:tx.hash,status:"CONFIRMED",blockNumber:receipt.blockNumber});
 }
 if((await plans()).length)throw Error("Final state verification failed");
 return {mode:"COMPLETE",vault:vaultConfig.vault,tokens,transactions:steps.length,verification:await verify()};
}

/// Builds the base config for one proposal file from its own snapshot plus the archived deployment manifest.
async function loadComponent(file:string,weightBps:number,manifest:any):Promise<Component>{
 const proposal=JSON.parse(await readFile(file,"utf8")),s=proposal.recommendedSetting;
 if(!s||proposal.status!=="PROPOSED_FOR_REVIEW")throw Error(`No recommended configuration in ${file}; rerun assessment with the updated script.`);
 const chainlink=s.oracleType==="CHAINLINK";
 const snapshot=JSON.parse(await readFile(chainlink?resolve(dirname(file),"chainlink","snapshot.json"):resolve(dirname(file),"pools",String(s.pool).toLowerCase(),"snapshot.json"),"utf8"));
 const v=manifest.contracts.find((c:any)=>c.name==="StaxVaultV2"),r=manifest.contracts.find((c:any)=>c.name==="UnifiedTwapRegistry");
 const base:any={chainId:manifest.chainId,vault:v.address,expectedVaultCodeHash:v.runtimeCodeHash,expectedOwner:manifest.deployer,
  usdg:snapshot.addresses.usdg,expectedUsdgDecimals:snapshot.usdgDecimals,token:snapshot.addresses.token,expectedTokenDecimals:snapshot.tokenDecimals,
  router:snapshot.router,factory:snapshot.factory,poolInitCodeHash:snapshot.poolInitCodeHash,
  oracle:chainlink?{type:"CHAINLINK",feed:s.params.feed,maxStaleness:s.params.maxStaleness}:{type:"TWAP",registry:r.address,expectedRegistryOwner:manifest.deployer},
  review:{tokenBehavior:file,routerDeployment:"archived deployment and live validator",roundTripFork:file,chainlinkFeedSearch:file,riskParameters:file}};
 return {proposal,base,weightBps};
}

async function main(){
 const {values,positionals}=parseArgs({allowPositionals:true,options:{broadcast:{type:"boolean"},"basket-id":{type:"string"},name:{type:"string"},symbol:{type:"string"},"cap-usd":{type:"string"},"basket-file":{type:"string"},"single-token-approved":{type:"boolean"},"allow-symbol-collision":{type:"boolean"},"register-only":{type:"boolean"}}});
 const usage="Usage: npm run onboard:broadcast -- PROPOSED_SETTINGS.json --basket-id ID --name NAME --symbol SYMBOL --cap-usd USD [--broadcast]\n   or: npm run onboard:broadcast -- --basket-file BASKET.json [--broadcast]  (BASKET.json: {id,name,symbol,capUsd,components:[{proposal,weightBps}]})";
 const manifest=JSON.parse(await readFile(new URL("../../reports/mainnet-v2-deployment/deployment.json",import.meta.url),"utf8"));
 let components:Component[],basket:BasketInput,logBase:string;
 if(values["basket-file"]){
  if(positionals.length)throw Error(usage);
  const file=resolve(values["basket-file"]),spec=JSON.parse(await readFile(file,"utf8"));
  if(!Array.isArray(spec.components)||!spec.components.length)throw Error(usage);
  components=await Promise.all(spec.components.map((c:any)=>loadComponent(resolve(dirname(file),c.proposal),Number(c.weightBps??10000),manifest)));
  basket={id:String(spec.id??"0"),name:spec.name??"",symbol:spec.symbol??"",capUsd:String(spec.capUsd??"0")};logBase=file;
 } else {
  if(positionals.length!==1||!values["basket-id"]||!values.name||!values.symbol||!values["cap-usd"])throw Error(usage);
  const file=resolve(positionals[0]);
  components=[await loadComponent(file,10000,manifest)];
  basket={id:values["basket-id"],name:values.name,symbol:values.symbol,capUsd:values["cap-usd"]};logBase=file;
 }
 const provider=new JsonRpcProvider(process.env.STAX_RPC_URL??"https://rpc.mainnet.chain.robinhood.com");
 try{
  // Load only for an explicitly requested broadcast; never log key contents.
  let signer:Wallet|null=null;
  if(values.broadcast){
   const key=(process.env.STAX_PRIVATE_KEY??await readFile(new URL("../../../deployer-private-key.txt",import.meta.url),"utf8")).trim();
   signer=new Wallet(key,provider);
  }
  // Symbol uniqueness is checked across V2 and the V1 vault (V1 share tokens live forever).
  // --allow-symbol-collision: Dan explicitly accepted a duplicate ticker (e.g. sRETAIL on both V1 and V2).
  if(values["register-only"]){
   const result=await executeRegistration(provider,signer,components,{broadcast:values.broadcast,record:async entry=>{await writeFile(`${logBase}.register-${Date.now()}-${entry.hash}.json`,JSON.stringify(entry,null,2));console.log(`${entry.label}: ${entry.status} ${entry.hash}`);}});
   console.log(JSON.stringify(result,null,2));return;
  }
  const symbolCheckVaults=values["allow-symbol-collision"]?[]:[manifest.contracts.find((c:any)=>c.name==="StaxVaultV2").address,"0x13045D3Dab253fDB15181C16f135D612fa8546E6"];
  const result=await executeBasketListing(provider,signer,components,basket,
   {broadcast:values.broadcast,singleTokenApproved:values["single-token-approved"],symbolCheckVaults,record:async entry=>{await writeFile(`${logBase}.broadcast-${Date.now()}-${entry.hash}.json`,JSON.stringify(entry,null,2));console.log(`${entry.label}: ${entry.status} ${entry.hash}`);}});
  console.log(JSON.stringify(result,null,2));
 }finally{provider.destroy();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch((e:unknown)=>{console.error(e instanceof Error?e.message:String(e));console.error("Listing stopped. Check inputs, signer ownership and live oracle conditions. Confirm recorded transaction hashes before retrying; confirmed steps are retained. No private keys are logged.");process.exitCode=1;});
