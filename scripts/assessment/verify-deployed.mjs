// One command, no private key: node scripts/assessment/verify-deployed.mjs
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {spawn} from 'node:child_process';
const dir='reports/mainnet-v2-deployment',m=JSON.parse(await readFile(`${dir}/deployment.json`,'utf8'));
await mkdir(`${dir}/verification`,{recursive:true});
const contracts=[...m.contracts,{name:'StaxVaultPreview',address:m.preview.address,constructorArgs:[],transactionHash:m.contracts.find(c=>c.name==='StaxVaultV2').transactionHash}];
const results=[];
for(const c of contracts){
 const argsPath=`${dir}/verification/${c.name}.mjs`;
 await writeFile(argsPath,`export default ${JSON.stringify(c.constructorArgs)};\n`);
 console.log(`Verifying ${c.name} ${c.address}`);
 const args=['node_modules/hardhat/dist/src/cli.js','verify','--config','hardhat.verify.config.ts','--network','robinhoodMainnet','--build-profile','default','--constructor-args-path',argsPath,'--creation-tx-hash',c.transactionHash,c.address];
 const code=await new Promise((resolve,reject)=>{const child=spawn(process.execPath,args,{stdio:'inherit',windowsHide:true});child.once('error',reject);child.once('close',resolve);});
 results.push({name:c.name,address:c.address,provider:'sourcify',exitCode:code,checkedAt:new Date().toISOString()});
 await writeFile(`${dir}/verification/results.json`,JSON.stringify(results,null,2));
}
if(results.some(r=>r.exitCode!==0))process.exitCode=1;
