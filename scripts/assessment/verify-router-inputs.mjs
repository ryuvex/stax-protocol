// Read-only: bind verified-source immutable locations to live Robinhood bytecode.
import {readFile,writeFile} from 'node:fs/promises';
import {JsonRpcProvider,Contract,keccak256,AbiCoder,getCreate2Address} from 'ethers';
const dir='reports/deployment-preparation/provenance';
const router='0x8876789976dEcBfCbBbe364623C63652db8C0904';
const factory='0x1f7d7550B1b028f7571E69A784071F0205FD2EfA';
const hash='0xe34f199b19b2b4f47f68442619d555527d244f78a3297ea89325f843f87b8b54';
const j=JSON.parse(await readFile(`${dir}/sourcify.json`,'utf8'));
if(j.chainId!=='4663' && j.chainId!==4663)throw Error('Wrong source chain');
if(j.address.toLowerCase()!==router.toLowerCase() || !j.runtimeMatch)throw Error('Wrong source match');
const variables={};
function visit(x){if(!x||typeof x!=='object')return;if(x.nodeType==='VariableDeclaration'&&x.mutability==='immutable')variables[x.id]=x.name;for(const v of Object.values(x))if(typeof v==='object')visit(v);}
visit(JSON.parse(await readFile(`${dir}/source-ast.json`,'utf8')));
const p=new JsonRpcProvider('https://rpc.mainnet.chain.robinhood.com',4663,{staticNetwork:true});
try {
 if(BigInt(await p.send('eth_chainId',[]))!==4663n)throw Error('Wrong RPC chain');
 const b=await p.getBlock('latest'), code=(await p.getCode(router,b.number)).toLowerCase();
 if(code!==j.runtimeBytecode.onchainBytecode.toLowerCase())throw Error('Live code differs from verified record');
 let patched=j.runtimeBytecode.recompiledBytecode.toLowerCase();
 const immutables={};
 for(const [id,locations]of Object.entries(j.runtimeBytecode.immutableReferences)){
  const values=locations.map(({start,length})=>'0x'+code.slice(2+start*2,2+(start+length)*2));
  if(new Set(values).size!==1)throw Error('Inconsistent immutable locations');
  immutables[variables[id]??id]={value:values[0],locations};
  for(const {start,length}of locations)patched=patched.slice(0,2+start*2)+values[0].slice(2)+patched.slice(2+(start+length)*2);
 }
 if(patched!==code)throw Error('Recompiled runtime mismatch after immutable substitution');
 if(immutables.UNISWAP_V3_FACTORY?.value.slice(-40)!==factory.slice(2).toLowerCase())throw Error('Factory mismatch');
 if(immutables.UNISWAP_V3_POOL_INIT_CODE_HASH?.value!==hash)throw Error('Hash mismatch');
 const f=new Contract(factory,['function getPool(address,address,uint24) view returns(address)'],p);
 const token='0x020bfC650A365f8BB26819deAAbF3E21291018b4',usd='0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168';
 const [a,z]=[token,usd].sort((a,b)=>a.toLowerCase().localeCompare(b.toLowerCase()));
 const pools=[];
 for(const fee of [500,3000,10000]){
  const actual=await f.getPool(a,z,fee,{blockTag:b.number});
  const predicted=getCreate2Address(factory,keccak256(AbiCoder.defaultAbiCoder().encode(['address','address','uint24'],[a,z,fee])),hash);
  if(actual.toLowerCase()!==predicted.toLowerCase() || await p.getCode(actual,b.number)==='0x')throw Error('Pool derivation mismatch');
  pools.push({fee,actual,predicted});
 }
 const result={status:'CONFIRMED',blockNumber:b.number,blockHash:b.hash,router,factory,poolInitCodeHash:hash,routerCodeHash:keccak256(code),verifiedSource:`https://sourcify.dev/server/v2/contract/4663/${router}?fields=all`,runtimeMatch:j.runtimeMatch,recompiledRuntimeMatchesAfterImmutableSubstitution:true,immutables,pools,limitation:'Confirms deployed router source correspondence and V3 configuration, not a full router/factory security audit. Original creation transaction is absent from the Sourcify record.'};
 await writeFile(`${dir}/confirmed-inputs.json`,JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify({status:result.status,block:b.number,router,factory,hash,pools},null,2));
}finally{p.destroy();}
