import fs from 'node:fs';
import path from 'node:path';
import {Interface} from 'ethers';
const dir='reports/userbasket-v2-deployment';
const build=JSON.parse(fs.readFileSync(`${dir}/build/build-info/solc-0_8_28-56a4b0e6bab0b20af62f5ba4bec5ba4a71713d84.json`));
const manifest=JSON.parse(fs.readFileSync(`${dir}/deployment.json`));
const contracts=[manifest.factory,manifest.implementation];
const results=[];
async function api(action,extra={},body){
 let last;for(let i=0;i<(body?1:4);i++){try{return await apiOnce(action,extra,body);}catch(e){last=e;console.log(' retry',i+1,e.message.slice(0,60));await new Promise(r=>setTimeout(r,5000*(i+1)));}}
 throw last;
}
async function apiOnce(action,extra={},body){
 const url=new URL(process.env.BLOCKSCOUT_API??'https://api.blockscout.com/4663/api');
 Object.entries({module:'contract',action,apikey:process.env.BLOCKSCOUT_API_KEY,...extra}).forEach(([k,v])=>url.searchParams.set(k,v));
 const r=await fetch(url,{method:body?'POST':'GET',headers:body?{'content-type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(45000)});
 if(!r.ok)throw Error(`HTTP ${r.status} ${(await r.text()).slice(0,300)}`);
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
  fs.writeFileSync(`${dir}/verification/${c.name}.standard-input.json`,sourceCode);
  console.log(c.name,'upload bytes',Buffer.byteLength(sourceCode),'| standard-input saved to',`${dir}/verification/${c.name}.standard-input.json`);
  const ctorArgs=new Interface(artifact.abi).encodeDeploy(c.constructorArgs).slice(2);
  let response;
  try{response=await api('verifysourcecode',{}, {contractaddress:c.address,sourceCode,codeformat:'solidity-standard-json-input',contractname:`${root}:${c.name}`,compilerversion:`v${build.solcLongVersion}`,constructorArguments:ctorArgs});}
  catch(e){
   // v1 POST on the gateway is flaky (HTTP 500); fall back to the v2 REST verification endpoint.
   console.log(c.name,'v1 failed, trying v2 REST:',e.message.slice(0,80));
   const base=(process.env.BLOCKSCOUT_API??'https://api.blockscout.com/4663/api').replace(/\/api$/,'');
   const form=new FormData();
   form.set('compiler_version',`v${build.solcLongVersion}`);form.set('license_type','mit');
   form.set('autodetect_constructor_args','false');form.set('constructor_args',ctorArgs);
   form.set('files[0]',new Blob([sourceCode],{type:'application/json'}),`${c.name}.standard-input.json`);
   const headers={};if(process.env.BLOCKSCOUT_API_KEY)headers['x-api-key']=process.env.BLOCKSCOUT_API_KEY;
   const r=await fetch(`${base}/api/v2/smart-contracts/${c.address}/verification/via/standard-input${process.env.BLOCKSCOUT_API_KEY?`?apikey=${process.env.BLOCKSCOUT_API_KEY}`:''}`,{method:'POST',body:form,headers,signal:AbortSignal.timeout(60000)});
   const text=await r.text();console.log(c.name,'v2 submit',r.status,text.slice(0,200));
   if(!r.ok)throw Error(`v2 HTTP ${r.status}`);
   for(let i=0;i<20;i++){
    await new Promise(r=>setTimeout(r,6000));
    const existing=await api('getsourcecode',{address:c.address});
    if(existing.result?.[0]?.SourceCode){response={status:'1',result:'Pass - Verified (v2)'};break;}
    response={status:'0',result:'Pending after v2 submit'};
   }
  }
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
