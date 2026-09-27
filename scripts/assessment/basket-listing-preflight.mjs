import fs from 'node:fs';
import {Contract,JsonRpcProvider,formatUnits,keccak256} from 'ethers';
const root='reports/mainnet-v2-deployment';
const m=JSON.parse(fs.readFileSync(`${root}/deployment.json`));
const provider=new JsonRpcProvider('https://rpc.mainnet.chain.robinhood.com');
const abi=name=>JSON.parse(fs.readFileSync(`${root}/build/${name}.json`)).abi;
const vault=new Contract(m.contracts.find(c=>c.name==='StaxVaultV2').address,abi('StaxVaultV2'),provider);
const registry=new Contract(m.contracts.find(c=>c.name==='UnifiedTwapRegistry').address,abi('UnifiedTwapRegistry'),provider);
try {
 if((await provider.getNetwork()).chainId!==4663n)throw Error('Wrong chain');
 const block=await provider.getBlock('latest'),at={blockTag:block.number};
 if(keccak256(await provider.getCode(vault.target,block.number))!==m.contracts.find(c=>c.name==='StaxVaultV2').runtimeCodeHash)throw Error('Vault code mismatch');
 const owner=await vault.owner(at),registryOwner=await registry.owner(at);
 const usd=await vault.usdg(at),usdPrice=await vault.getOraclePriceUsd18(usd,at);
 const tokenAbi=['function balanceOf(address) view returns(uint256)','function decimals() view returns(uint8)'];
 const usdToken=new Contract(usd,tokenAbi,provider);
 const result={block:block.number,owner,registryOwner,usdgDecimals:Number(await usdToken.decimals(at)),usdgPrice:formatUnits(usdPrice,18),tokens:[]};
 for(const [symbol,token,pool,minimum,deviation] of [
 ['AMC','0x05a3d1cd21d0c88145e82600e62e7e496e0f222b','0xaA34feA710a1A737840329051D81D3B0B7C564d5','3900000000000000000',150],
 ['NFLX','0xE0444EF8BF4eD74f74FD73686e2ddF4C1c5591E8','0x59895C0302F41aEaa129D2fa2442CEc01E7eF45E','150000000000000000',100]]){
  const p=new Contract(pool,['function liquidity() view returns(uint128)','function token0() view returns(address)','function observe(uint32[]) view returns(int56[],uint160[])'],provider);
  const t=new Contract(token,tokenAbi,provider);
  const [usdBalance,tokenBalance,decimals,liquidity,observed,token0]=await Promise.all([usdToken.balanceOf(pool,at),t.balanceOf(pool,at),t.decimals(at),p.liquidity(at),p.observe([3600,0],at),p.token0(at)]);
  const delta=observed[0][1]-observed[0][0];let mean=delta/3600n;if(delta<0n&&delta%3600n!==0n)mean--;
  const ratio=1.0001**Number(mean);
  const priceUsdg=(token0.toLowerCase()===token.toLowerCase()?ratio:1/ratio)*10**(Number(decimals)-result.usdgDecimals);
  const reserveUsd=Number(formatUnits(usdBalance,result.usdgDecimals))*Number(result.usdgPrice);
  const tvlUsd=reserveUsd+Number(formatUnits(tokenBalance,decimals))*priceUsdg*Number(result.usdgPrice);
  const params={pool,twapWindow:3600,maxObservationAge:3600,minCurrentLiquidity:minimum,minHarmonicLiquidity:minimum,maxDeviationBps:deviation};
  let configureCheck='PASS';try{await registry.configureToken.staticCall(token,params,{...at,from:registryOwner});}catch(e){configureCheck=e.revert?.name??e.shortMessage;}
  const entry={symbol,token,pool,decimals:Number(decimals),params,slippageBps:200,liquidity:liquidity.toString(),configureCheck,existingOracle:Array.from(await vault.oracleSettings(token,at)),reserveUsd,tvlUsd,
   totalValueBasis:{capUsd:Math.floor(tvlUsd*0.075),perDepositUsd:Math.floor(Math.floor(tvlUsd*0.075)*0.15)},reserveBasis:{capUsd:Math.floor(reserveUsd*0.075),perDepositUsd:Math.floor(Math.floor(reserveUsd*0.075)*0.15)}};
  result.tokens.push(entry);
 }
 const logs=await vault.queryFilter(vault.filters.BasketCreated(),m.contracts.find(c=>c.name==='StaxVaultV2').blockNumber,block.number);
 result.existingBaskets=logs.map(l=>({id:l.args[0].toString(),token:l.args[1],name:l.args[2]}));
 const json=JSON.stringify(result,(_,v)=>typeof v==='bigint'?v.toString():v,2);
 fs.mkdirSync('reports/basket-listing',{recursive:true});fs.writeFileSync('reports/basket-listing/preflight.json',json);
 console.log(json);
}finally{provider.destroy();}
