// Read-only deployment evidence and ABI export. No signer or transactions.
import { Contract, JsonRpcProvider, FetchRequest, keccak256 } from 'ethers';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
const out = 'reports/deployment-preparation';
await mkdir(`${out}/abi`, { recursive: true });
const req = new FetchRequest(process.env.STAX_RPC_URL ?? 'https://rpc.mainnet.chain.robinhood.com');
req.timeout = 20000;
const p = new JsonRpcProvider(req, 4663, { staticNetwork: true });
try {
  if (BigInt(await p.send('eth_chainId', [])) !== 4663n) throw Error('Wrong chain');
  const block = await p.getBlock('latest'), at = { blockTag: block.number };
  const v1 = new Contract('0x13045D3Dab253fDB15181C16f135D612fa8546E6', [
    ...['universalRouter','permit2','usdg','usdgUsdFeed','sequencerUptimeFeed','treasury','rewardsPool'].map(n=>`function ${n}() view returns(address)`),
    'function usdgUsdMaxStaleness() view returns(uint48)'], p);
  const current = {};
  for (const name of ['universalRouter','permit2','usdg','usdgUsdFeed','sequencerUptimeFeed','treasury','rewardsPool','usdgUsdMaxStaleness']) current[name] = String(await v1[name](at));
  const factory = '0x1f7d7550B1b028f7571E69A784071F0205FD2EfA';
  const code = {};
  for (const [name,address] of Object.entries({...current, factory}).filter(([n])=>['universalRouter','permit2','usdg','usdgUsdFeed','factory'].includes(n))) {
    const bytes = await p.getCode(address, block.number);
    if (bytes === '0x') throw Error(`Missing code: ${name}`);
    code[name] = {address, runtimeBytes:(bytes.length-2)/2, codeHash:keccak256(bytes)};
  }
  const feed = new Contract(current.usdgUsdFeed,['function decimals() view returns(uint8)','function description() view returns(string)','function latestRoundData() view returns(uint80,int256,uint256,uint256,uint80)'],p);
  const round = await feed.latestRoundData(at);
  const usdg = new Contract(current.usdg,['function decimals() view returns(uint8)'],p);
  const compiled = {};
  for (const [file,name] of [['StaxVaultV2.sol','StaxVaultV2'],['Twap.sol','UnifiedTwapRegistry'],['StaxV3RouteValidator.sol','StaxV3RouteValidator'],['StaxBasketTokenDeployer.sol','StaxBasketTokenDeployer'],['StaxVaultPreview.sol','StaxVaultPreview'],['StaxVault.sol','StaxBasketToken']]) {
    const a = JSON.parse(await readFile(`artifacts/contracts/${file}/${name}.json`,'utf8'));
    compiled[name] = {runtimeBytes:(a.deployedBytecode.length-2)/2,creationBytes:(a.bytecode.length-2)/2,creationHash:keccak256(a.bytecode),constructor:a.abi.find(x=>x.type==='constructor')?.inputs??[]};
    await writeFile(`${out}/abi/${name}.json`,JSON.stringify(a.abi,null,2)+'\n');
  }
  const directoryUrl='https://reference-data-directory.vercel.app/feeds-robinhood-mainnet.json';
  const r=await fetch(directoryUrl,{signal:AbortSignal.timeout(20000)});
  if(!r.ok)throw Error('Feed directory unavailable');
  const entries=await r.json();
  const matches=entries.filter(x=>JSON.stringify(x).toLowerCase().includes(current.usdgUsdFeed.toLowerCase()));
  const evidence={checkedAt:new Date().toISOString(),chainId:4663,blockNumber:block.number,blockHash:block.hash,blockTimestamp:block.timestamp,currentV1:current,
    warning:'V1 settings are observations, not approved V2 recipients or verified dependency provenance.',factory,code,
    usdgDecimals:Number(await usdg.decimals(at)),feed:{decimals:Number(await feed.decimals(at)),description:await feed.description(at),round:round.map(String),ageSeconds:block.timestamp-Number(round[3]),directoryUrl,directoryMatches:matches},compiled};
  await writeFile(`${out}/evidence.json`,JSON.stringify(evidence,null,2)+'\n');
  console.log(JSON.stringify({block:evidence.blockNumber,current,usdgDecimals:evidence.usdgDecimals,feed:evidence.feed,sizes:Object.fromEntries(Object.entries(compiled).map(([k,v])=>[k,v.runtimeBytes]))},null,2));
} finally {p.destroy();}
