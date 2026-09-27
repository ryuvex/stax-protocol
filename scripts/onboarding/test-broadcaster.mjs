import {readdir} from 'node:fs/promises';
import {spawn} from 'node:child_process';
// Explicit roots avoid compiling the independent flattened explorer upload.
const files=(await readdir('contracts',{recursive:true})).filter(f=>f.endsWith('.sol')&&!f.endsWith('.t.sol')&&f!=='VaultV2Flattened.sol').map(f=>`contracts/${f}`);
async function run(args){
 const code=await new Promise((resolve,reject)=>{const p=spawn(process.execPath,['node_modules/hardhat/dist/src/cli.js',...args],{stdio:'inherit',windowsHide:true});p.once('error',reject);p.once('close',resolve);});
 if(code!==0)process.exit(code??1);
}
await run(['compile','--no-tests',...files]);
if(process.argv[2]==='userbasket')await run(['test','mocha','test/StaxUserBasketV2.local.test.ts','--no-compile']);
else await run(['test','mocha','test/StaxVaultV2.local.test.ts','--no-compile','--grep','broadcaster']);
