// Explicit deployment runner: network preparation/broadcast and offline signing are separate.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {JsonRpcProvider,Wallet,ContractFactory,Contract,getCreateAddress,keccak256,Transaction,formatEther} from 'ethers';
const dir='reports/mainnet-v2-deployment';await mkdir(`${dir}/abi`,{recursive:true});
const deployer='0x79F7c8aB5360c9902dD23ADf99cdAb54F2A6449D';
const router='0x8876789976dEcBfCbBbe364623C63652db8C0904',factory='0x1f7d7550B1b028f7571E69A784071F0205FD2EfA';
const hash='0xe34f199b19b2b4f47f68442619d555527d244f78a3297ea89325f843f87b8b54';
const usd='0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168',feed='0x61B7e5650328764B076A108EFF5fa7282a1B9aD2';
const permit='0x000000000022D473030F116dDEE9F6B43aC78BA3',zero='0x0000000000000000000000000000000000000000';
const treasury='0xFF843Bc76C276086569D081E02DAC467C2aDa5cE',rewards='0xc02F399cBbF90CEc6DD3a7c2D90fcA84C0a3a5ad';
const predicted=[0,1,2,3].map(nonce=>getCreateAddress({from:deployer,nonce}));
const specs=[['StaxBasketTokenDeployer.sol','StaxBasketTokenDeployer',[]],['StaxV3RouteValidator.sol','StaxV3RouteValidator',[router,factory,hash]],['Twap.sol','UnifiedTwapRegistry',[deployer,usd,factory]],['StaxVaultV2.sol','StaxVaultV2',[deployer,predicted[0],[],rewards,treasury,router,permit,usd,feed,97200,zero,predicted[1]]]];
const serialize=x=>JSON.stringify(x,(_,v)=>typeof v==='bigint'?v.toString():v,2)+'\n';
const artifacts=await Promise.all(specs.map(async([f,n])=>JSON.parse(await readFile(`artifacts/contracts/${f}/${n}.json`,'utf8'))));
for(let i=0;i<specs.length;i++)if((artifacts[i].deployedBytecode.length-2)/2>24576)throw Error('Runtime too large');
const data=await Promise.all(artifacts.map(async(a,i)=>(await new ContractFactory(a.abi,a.bytecode).getDeployTransaction(...specs[i][2])).data));
const mode=process.argv[2];
if(mode==='sign'){
 const req=JSON.parse(await readFile(`${dir}/unsigned.json`,'utf8'));
 const i=Number(req.nonce);
 if(req.chainId!==4663 || i<0 || i>3 || req.to || BigInt(req.value??0)!==0n || req.data!==data[i])throw Error('Unexpected transaction');
 if(BigInt(req.gasLimit)>20_000_000n || BigInt(req.gasPrice)*BigInt(req.gasLimit)>4_000_000_000_000_000n)throw Error('Transaction exceeds budget');
 const w=await Wallet.fromEncryptedJson(await readFile('../.deployment-wallet/deployer.json','utf8'),process.env.STAX_NEW_WALLET_PASSWORD);
 if(w.address!==deployer)throw Error('Unexpected signer');
 await writeFile(`${dir}/signed.txt`,await w.signTransaction(req));console.log(`Signed deployment ${i+1} locally`);
}else{
 const p=new JsonRpcProvider('https://rpc.mainnet.chain.robinhood.com',4663,{staticNetwork:true});
 try{
  if(BigInt(await p.send('eth_chainId',[]))!==4663n)throw Error('Wrong chain');
  const prior=JSON.parse(await readFile('reports/deployment-preparation/provenance/confirmed-inputs.json','utf8'));
  if(keccak256(await p.getCode(router))!==prior.routerCodeHash)throw Error('Router changed');
  let manifest;try{manifest=JSON.parse(await readFile(`${dir}/deployment.json`,'utf8'));}catch{manifest={chainId:4663,deployer,danOwnerLater:'0x2d713bbB76d08D1a94D68d944B5Eb0D163F1a524',contracts:[],ownershipTransferred:false,tokensRegistered:false};}
  if(mode==='prepare'){
   const nonce=await p.getTransactionCount(deployer,'pending');
   if(nonce!==manifest.contracts.length || nonce>=4)throw Error('Unexpected nonce or deployment complete');
   const request={from:deployer,data:data[nonce],value:0n};
   const gas=await p.estimateGas(request),fees=await p.getFeeData();
   const gasPrice=fees.gasPrice*2n,gasLimit=(gas*120n+99n)/100n;
   if(await p.getBalance(deployer)<gasPrice*gasLimit)throw Error('Insufficient funds for next deployment');
   await writeFile(`${dir}/unsigned.json`,serialize({chainId:4663,type:0,nonce,data:data[nonce],value:'0',gasPrice,gasLimit}));
   await writeFile(`${dir}/abi/${specs[nonce][1]}.json`,serialize(artifacts[nonce].abi));
   console.log(JSON.stringify({next:specs[nonce][1],address:predicted[nonce],estimatedGas:gas.toString(),maximumFeeETH:formatEther(gasPrice*gasLimit)}));
  }else if(mode==='broadcast'){
   const signed=await readFile(`${dir}/signed.txt`,'utf8'),tx=Transaction.from(signed),i=tx.nonce;
   if(tx.from!==deployer || tx.chainId!==4663n || tx.data!==data[i] || tx.to || tx.value!==0n)throw Error('Signed transaction mismatch');
   await writeFile(`${dir}/pending-${i}.json`,serialize({hash:tx.hash,address:predicted[i],nonce:i}));
   let receipt=await p.getTransactionReceipt(tx.hash);
   if(!receipt){await p.broadcastTransaction(signed);console.log(`Broadcast ${specs[i][1]}: ${tx.hash}`);receipt=await p.waitForTransaction(tx.hash,1,120000);}
   if(!receipt || receipt.status!==1 || receipt.contractAddress?.toLowerCase()!==predicted[i].toLowerCase())throw Error('Deployment receipt failed or pending');
   const code=await p.getCode(predicted[i]);if(code==='0x')throw Error('No deployed code');
   const entry={name:specs[i][1],address:predicted[i],transactionHash:tx.hash,blockNumber:receipt.blockNumber,gasUsed:receipt.gasUsed.toString(),feeETH:formatEther(receipt.fee),runtimeCodeHash:keccak256(code),constructorArgs:specs[i][2],creationCodeHash:keccak256(artifacts[i].bytecode)};
   manifest.contracts[i]=entry;
   await writeFile(`${dir}/deployment.json`,serialize(manifest));await writeFile(`${dir}/receipt-${i}.json`,serialize(receipt));
   console.log(JSON.stringify(entry));
  }else if(mode==='verify'){
   if(manifest.contracts.length!==4)throw Error('Incomplete deployment');
   const v=new Contract(predicted[3],artifacts[3].abi,p),r=new Contract(predicted[2],artifacts[2].abi,p),val=new Contract(predicted[1],artifacts[1].abi,p);
   for(const [c,method,expected]of [[v,'owner',deployer],[v,'pendingOwner',zero],[r,'owner',deployer],[r,'pendingOwner',zero],[v,'treasury',treasury],[v,'rewardsPool',rewards],[v,'universalRouter',router],[v,'permit2',permit],[v,'usdg',usd],[v,'usdgUsdFeed',feed],[v,'sequencerUptimeFeed',zero],[v,'routeValidator',predicted[1]],[v,'basketTokenDeployer',predicted[0]],[r,'usdg',usd],[r,'trustedFactory',factory],[val,'router',router],[val,'factory',factory],[val,'poolInitCodeHash',hash]])if(String(await c[method]()).toLowerCase()!==expected.toLowerCase())throw Error(`Mismatch ${method}`);
   if(await v.usdgUsdMaxStaleness()!==97200n || await v.usdgDecimals()!==6n)throw Error('USDG settings mismatch');
   const preview=await v.previewer();const helper=new Contract(preview,['function vault() view returns(address)'],p);if(await helper.vault()!==predicted[3])throw Error('Helper mismatch');
   manifest.preview={address:preview,runtimeCodeHash:keccak256(await p.getCode(preview))};manifest.settingsVerified=true;manifest.remainingETH=formatEther(await p.getBalance(deployer));
   await writeFile(`${dir}/deployment.json`,serialize(manifest));console.log(serialize(manifest));
  }else throw Error('Use prepare, sign, broadcast or verify');
 }finally{p.destroy();}
}
