// Pause (or unpause) minting on a V2 basket. Redemptions are unaffected.
// Usage: npm run basket:pause -- BASKET_ID [--vault v1|v2] [--unpause] [--broadcast]
// v2 (default) signs with the V2 deployer key file; v1 requires STAX_PRIVATE_KEY for V1's owner.
import {readFile} from "node:fs/promises";
import {parseArgs} from "node:util";
import {Contract,JsonRpcProvider,Wallet} from "ethers";
const {values,positionals}=parseArgs({allowPositionals:true,options:{broadcast:{type:"boolean"},unpause:{type:"boolean"},vault:{type:"string"}}});
if(positionals.length!==1||!/^\d+$/.test(positionals[0])||(values.vault&&!["v1","v2"].includes(values.vault)))throw Error("Usage: npm run basket:pause -- BASKET_ID [--vault v1|v2] [--unpause] [--broadcast]");
const isV1=values.vault==="v1";
const id=BigInt(positionals[0]),paused=!values.unpause;
const manifest=JSON.parse(await readFile(new URL("../../reports/mainnet-v2-deployment/deployment.json",import.meta.url),"utf8"));
const vaultAddress=isV1?"0x13045D3Dab253fDB15181C16f135D612fa8546E6":manifest.contracts.find((c:any)=>c.name==="StaxVaultV2").address;
const provider=new JsonRpcProvider(process.env.STAX_RPC_URL??"https://rpc.mainnet.chain.robinhood.com");
try{
 const vault=new Contract(vaultAddress,["function owner() view returns(address)",
  "function baskets(uint256) view returns(string name,address token,uint256 depositCapUsd,uint256 maxMintUsd,bool mintPaused,bool exists)",
  "function setMintPaused(uint256,bool)"],provider);
 const b=await vault.baskets(id);
 if(!b.exists)throw Error(`Basket ${id} does not exist on ${vaultAddress}`);
 console.log(`Basket ${id} "${b.name}" token ${b.token} mintPaused=${b.mintPaused} -> ${paused}`);
 if(b.mintPaused===paused){console.log("Already in requested state. Nothing to do.");}
 else if(!values.broadcast){console.log("DRY RUN. Add --broadcast to send setMintPaused.");}
 else{
  if(isV1&&!process.env.STAX_PRIVATE_KEY)throw Error("V1 is owned by a different wallet: set STAX_PRIVATE_KEY to V1's owner key for this run");
  const key=(process.env.STAX_PRIVATE_KEY??await readFile(new URL("../../../deployer-private-key.txt",import.meta.url),"utf8")).trim();
  const signer=new Wallet(key,provider);
  if((await vault.owner()).toLowerCase()!==signer.address.toLowerCase())throw Error("Signer is not the vault owner");
  const tx=await (vault.connect(signer) as any).setMintPaused(id,paused);
  console.log("SUBMITTED",tx.hash);const r=await tx.wait(1,60000);
  if(!r||r.status!==1)throw Error(`Transaction failed: ${tx.hash}`);
  console.log("CONFIRMED",tx.hash,"block",r.blockNumber,"mintPaused now",(await vault.baskets(id)).mintPaused);
 }
}finally{provider.destroy();}
