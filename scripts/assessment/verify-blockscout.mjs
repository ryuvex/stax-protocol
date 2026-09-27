import fs from 'node:fs';
import path from 'node:path';
import {Interface} from 'ethers';
const dir='reports/mainnet-v2-deployment';
const build=JSON.parse(fs.readFileSync(`${dir}/build/build-info/solc-0_8_28-ae60a25b621166090c9f45af20ca164b44256cef.json`));
const manifest=JSON.parse(fs.readFileSync(`${dir}/deployment.json`));
const contracts=[...manifest.contracts,{name:'StaxVaultPreview',address:manifest.preview.address,constructorArgs:[]}];
const results=[];
async function api(action,extra={},body){
 const url=new URL('https://api.blockscout.com/4663/api');
 Object.entries({module:'contract',action,apikey:process.env.BLOCKSCOUT_API_KEY,...extra}).forEach(([k,v])=>url.searchParams.set(k,v));
 const r=await fetch(url,{method:body?'POST':'GET',headers:body?{'content-type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(45000)});
 if(!r.ok)throw Error(`HTTP ${r.status}`);
 return r.json();
}
function inputFor(root){
 const sources={};
 function add(name){
  if(sources[name])return;
  const source=build.input.sources[name];if(!source)throw Error(`Missing source ${name}`);
  sources[name]=source;
  for(const match of source.content.matchAll(/import\s+(?:[^;]*?from\s*)?["']([^"']+)["']\s*;/g)){
   let target=match[1];
   if(target.startsWith('.'))target=path.posix.normalize(path.posix.join(path.posix.dirname(name),target));
   else for(const mapping of build.input.settings.remappings??[]){
    const [left,right]=mapping.split('=');const colon=left.indexOf(':');const context=colon<0?'':left.slice(0,colon);const prefix=colon<0?left:left.slice(colon+1);
    if(name.startsWith(context)&&target.startsWith(prefix)){target=right+target.slice(prefix.length);break;}
   }
   add(target);
  }
 }
 add(root);return JSON.stringify({...build.input,sources});
}
for(const c of contracts){
 try{
  const existing=await api('getsourcecode',{address:c.address});
  if(existing.result?.[0]?.SourceCode){console.log(c.name,'VERIFIED');results.push({...c,status:'VERIFIED'});continue;}
  const artifact=JSON.parse(fs.readFileSync(`${dir}/build/${c.name}.json`));
  const root=build.userSourceNameMap[artifact.sourceName]??artifact.sourceName;
  const sourceCode=inputFor(root);
  console.log(c.name,'upload bytes',Buffer.byteLength(sourceCode));
  let response=await api('verifysourcecode',{}, {contractaddress:c.address,sourceCode,codeformat:'solidity-standard-json-input',contractname:`${root}:${c.name}`,compilerversion:`v${build.solcLongVersion}`,constructorArguments:new Interface(artifact.abi).encodeDeploy(c.constructorArgs).slice(2)});
  if(response.status==='1'){
   const guid=response.result;
   for(let i=0;i<12;i++){
    await new Promise(r=>setTimeout(r,3000));
    response=await api('checkverifystatus',{guid});
    if(!/pending|queue/i.test(response.result))break;
   }
  }
  console.log(c.name,JSON.stringify(response));results.push({name:c.name,address:c.address,response});
 }catch(e){console.log(c.name,e.message);results.push({name:c.name,address:c.address,error:e.message});}
 fs.writeFileSync(`${dir}/verification/blockscout-results.json`,JSON.stringify(results,null,2));
}
