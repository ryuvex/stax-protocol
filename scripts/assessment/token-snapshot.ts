import { Contract, JsonRpcProvider, FetchRequest, keccak256, AbiCoder, getCreate2Address } from "ethers";
import { readFile, writeFile } from "node:fs/promises";
import type { AbstractProvider } from "ethers";
export async function collectSnapshot(provider: AbstractProvider, discovery: any, poolAddress: string, directory: string) {
  const block = await provider.getBlock(discovery.blockNumber); if (!block?.hash || block.hash !== discovery.blockHash) throw Error("Discovery block changed");
  const at = {blockTag: block.number};
  const addresses = {token:discovery.token.address, usdg:discovery.usdg.address,
    pool:poolAddress, v1:"0x13045D3Dab253fDB15181C16f135D612fa8546E6"};
  const tokenDecimals = discovery.token.decimals, usdgDecimals = discovery.usdg.decimals;
  const v1 = new Contract(addresses.v1, ["function universalRouter() view returns(address)", "function permit2() view returns(address)",
    "function usdgUsdFeed() view returns(address)", "function usdgUsdMaxStaleness() view returns(uint48)", "function sequencerUptimeFeed() view returns(address)"], provider);
  const pool = new Contract(addresses.pool, ["function factory() view returns(address)", "function token0() view returns(address)", "function token1() view returns(address)",
    "function fee() view returns(uint24)", "function tickSpacing() view returns(int24)", "function liquidity() view returns(uint128)",
    "function slot0() view returns(uint160,int24,uint16,uint16,uint16,uint8,bool)",
    "function observe(uint32[]) view returns(int56[],uint160[])"], provider);
  const router = await v1.universalRouter(at), factory = await pool.factory(at);
  const [slot, liquidity, token0, token1, fee] = await Promise.all([pool.slot0(at),pool.liquidity(at),pool.token0(at),pool.token1(at),pool.fee(at)]);
  const artifact = JSON.parse(await readFile("node_modules/@uniswap/v3-core/artifacts/contracts/UniswapV3Pool.sol/UniswapV3Pool.json", "utf8"));
  const hash = keccak256(artifact.bytecode);
  const predicted = getCreate2Address(factory, keccak256(AbiCoder.defaultAbiCoder().encode(["address","address","uint24"],[token0,token1,fee])), hash);
  const routerCode = await provider.getCode(router, block.number);
  const hourly: {hoursAgo:number;meanTick:number;priceUsdg:number}[] = [];
  // Hourly TWAP samples are observations, not trade-by-trade spot volatility.
  for (let hour=0; hour<72; hour++) {
    try {
      const [ticks] = await pool.observe([(hour+1)*3600,hour*3600],at);
      const meanTick = Math.floor(Number(ticks[1]-ticks[0])/3600);
      hourly.push({hoursAgo:hour,meanTick,priceUsdg:(token0.toLowerCase()===addresses.token.toLowerCase() ? Math.pow(1.0001,meanTick) : 1/Math.pow(1.0001,meanTick))*10**(tokenDecimals-usdgDecimals)});
    } catch { break; }
  }
  const windowDiagnostics = [];
  const spot = (token0.toLowerCase()===addresses.token.toLowerCase() ? (Number(slot[0])/2**96)**2 : 1/(Number(slot[0])/2**96)**2)*10**(tokenDecimals-usdgDecimals);
  for (const seconds of [300,900,1800,3600,7200,14400]) {
    try {
      const [ticks, accumulators] = await pool.observe([seconds,0],at);
      const tick = Math.floor(Number(ticks[1]-ticks[0])/seconds);
      const average = (token0.toLowerCase()===addresses.token.toLowerCase() ? Math.pow(1.0001,tick) : 1/Math.pow(1.0001,tick))*10**(tokenDecimals-usdgDecimals);
      const delta = (BigInt(accumulators[1])-BigInt(accumulators[0])+(1n<<160n))%(1n<<160n);
      windowDiagnostics.push({seconds,twapUsdg:average,spotDeviationBps:Math.abs(spot/average-1)*10000,
        harmonicLiquidityRaw:delta===0n?null:String(BigInt(seconds)*((1n<<160n)-1n)/(delta<<32n))});
    } catch { windowDiagnostics.push({seconds,error:"Observation call failed; do not infer sufficient history"}); }
  }
  const balances: Record<string,string> = {};
  const usdg = new Contract(addresses.usdg,["function balanceOf(address) view returns(uint256)"],provider);
  for (const a of [addresses.v1,addresses.pool,"0xCECa5491a16ea73F29990313924285EEB9771e3b"]) balances[a] = String(await usdg.balanceOf(a,at));
  const logReturns=hourly.slice(1).map((p,i)=>Math.log(hourly[i].priceUsdg/p.priceUsdg));
  const mean=logReturns.reduce((s,x)=>s+x,0)/Math.max(logReturns.length,1);
  const std=Math.sqrt(logReturns.reduce((s,x)=>s+(x-mean)**2,0)/Math.max(logReturns.length-1,1));
  const result={blockNumber:block.number,blockHash:block.hash,timestamp:block.timestamp,addresses,router,factory,
    permit2:await v1.permit2(at),usdgFeed:await v1.usdgUsdFeed(at),usdgMaxStaleness:String(await v1.usdgUsdMaxStaleness(at)),sequencerFeed:await v1.sequencerUptimeFeed(at),
    poolInitCodeHash:hash,predictedPool:predicted,derivationMatches:predicted.toLowerCase()===addresses.pool.toLowerCase(),
    routerCodeHash:keccak256(routerCode),routerContainsFactory:routerCode.toLowerCase().includes(factory.toLowerCase().slice(2)),
    routerContainsPoolHash:routerCode.toLowerCase().includes(hash.slice(2)),
    tokenDecimals,usdgDecimals,token0,token1,spotPriceUsdg:(token0.toLowerCase()===addresses.token.toLowerCase() ? (Number(slot[0])/2**96)**2 : 1/(Number(slot[0])/2**96)**2)*10**(tokenDecimals-usdgDecimals),tick:Number(slot[1]),fee:Number(fee),tickSpacing:Number(await pool.tickSpacing(at)),liquidity:String(liquidity),
    usdgBalancesRaw:balances,hourly,windowDiagnostics,statistics:{hourlyTwapSamples:hourly.length,hourlyLogReturnStd:std,maxAbsoluteHourlyLogReturn:Math.max(0,...logReturns.map(Math.abs))},
    caveats:["Bytecode substring matches do not prove full router immutable provenance or verified source equivalence.","Hourly TWAP returns smooth intrahour jumps and are insufficient alone for production parameter selection."]};
  await writeFile(directory+"/snapshot.json",JSON.stringify(result,null,2)+"\n");
  return result;
}
