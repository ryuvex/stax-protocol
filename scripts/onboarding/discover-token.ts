import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Contract, FetchRequest, JsonRpcProvider, ZeroAddress, getAddress } from "ethers";
import type { AbstractProvider } from "ethers";

// Discovery starting points only. Validate chain, code and pool metadata on every run.
// No V2 deployment, registry, wallet, reviewed parameters or approval file is needed here.
export const ROBINHOOD_DISCOVERY = {
  chainId: 4663,
  rpc: "https://rpc.mainnet.chain.robinhood.com",
  usdg: "0x5fc5360d0400a0fd4f2af552add042d716f1d168",
  factory: "0x1f7d7550b1b028f7571e69a784071f0205fd2efa",
  feeTiers: [100, 500, 3000, 10000],
  feedSourceVaults: ["0x13045d3dab253fdb15181c16f135d612fa8546e6"],
};
export type DiscoveryNetwork = Omit<typeof ROBINHOOD_DISCOVERY, "rpc">;
function requireCheck(ok: unknown, reason: string): asserts ok { if (!ok) throw new Error(reason); }
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const METADATA = ["function decimals() view returns(uint8)", "function symbol() view returns(string)"];
const POOL = ["function token0() view returns(address)", "function token1() view returns(address)",
  "function factory() view returns(address)", "function fee() view returns(uint24)",
  "function liquidity() view returns(uint128)",
  "function slot0() view returns(uint160 sqrtPriceX96,int24 tick,uint16 observationIndex,uint16 observationCardinality,uint16 observationCardinalityNext,uint8 feeProtocol,bool unlocked)",
  "function observations(uint256) view returns(uint32 blockTimestamp,int56 tickCumulative,uint160 secondsPerLiquidityCumulativeX128,bool initialized)"];

export async function discoverWithoutVault(provider: AbstractProvider, input: string, network: DiscoveryNetwork = ROBINHOOD_DISCOVERY) {
  const tokenAddress = getAddress(input), usdgAddress = getAddress(network.usdg), factoryAddress = getAddress(network.factory);
  requireCheck(tokenAddress !== ZeroAddress && !same(tokenAddress, usdgAddress), "Provide a token other than USDG");
  requireCheck((await provider.getNetwork()).chainId === BigInt(network.chainId), "Unexpected RPC chain");
  const block = await provider.getBlock("latest"); requireCheck(block?.hash, "Missing discovery block");
  const blockNumber = block.number, at = { blockTag: blockNumber };
  await Promise.all([tokenAddress, usdgAddress, factoryAddress].map(async a =>
    requireCheck(await provider.getCode(a, blockNumber) !== "0x", `No code at ${a}`)));
  const token = new Contract(tokenAddress, METADATA, provider), usdg = new Contract(usdgAddress, METADATA, provider);
  const decimals = Number(await token.decimals(at)), usdgDecimals = Number(await usdg.decimals(at));
  let symbol: string | null = null;
  try { symbol = await token.symbol(at); } catch { /* Optional metadata; never used to identify the asset. */ }
  const factory = new Contract(factoryAddress, ["function getPool(address,address,uint24) view returns(address)"], provider);
  const pools = [];
  for (const fee of network.feeTiers) {
    const address = await factory.getPool(tokenAddress, usdgAddress, fee, at);
    if (address === ZeroAddress) continue;
    requireCheck(await provider.getCode(address, blockNumber) !== "0x", "Factory returned a pool without code");
    const pool = new Contract(address, POOL, provider);
    const [a, b, origin, actualFee, liquidity, slot] = await Promise.all([
      pool.token0(at), pool.token1(at), pool.factory(at), pool.fee(at), pool.liquidity(at), pool.slot0(at),
    ]);
    requireCheck(same(origin, factoryAddress) && Number(actualFee) === fee
      && ((same(a, tokenAddress) && same(b, usdgAddress)) || (same(b, tokenAddress) && same(a, usdgAddress))),
    "Pool metadata does not match factory/pair/fee");
    let oldestObservationTimestamp: number | null = null, latestObservationTimestamp: number | null = null;
    if (Number(slot.observationCardinality) > 0) {
      const latest = await pool.observations(slot.observationIndex, at);
      let oldest = await pool.observations((Number(slot.observationIndex) + 1) % Number(slot.observationCardinality), at);
      if (!oldest.initialized) oldest = await pool.observations(0, at);
      if (oldest.initialized) oldestObservationTimestamp = Number(oldest.blockTimestamp);
      if (latest.initialized) latestObservationTimestamp = Number(latest.blockTimestamp);
    }
    // V3 timestamps wrap at 2^32; report elapsed times using the same modulo convention.
    const age = (timestamp: number | null) => timestamp === null ? null : (block.timestamp - timestamp + 2 ** 32) % 2 ** 32;
    pools.push({ address, version: "V3", fee, token0: a, token1: b,
      currentLiquidityRaw: String(liquidity), unlocked: Boolean(slot.unlocked), tick: Number(slot.tick),
      observationCardinality: Number(slot.observationCardinality),
      oldestObservationTimestamp, latestObservationTimestamp,
      availableHistorySeconds: age(oldestObservationTimestamp), latestObservationAgeSeconds: age(latestObservationTimestamp) });
  }
  // Existing V1 is an optional candidate source, not a dependency on deploying/configuring V2.
  const feedLookups = [];
  for (const source of network.feedSourceVaults) {
    try {
      const result = await new Contract(source, ["function priceFeeds(address) view returns(address feed,uint48 maxStaleness)"], provider)
        .priceFeeds(tokenAddress, at);
      feedLookups.push({ source, status: result.feed === ZeroAddress ? "not-configured" : "candidate",
        feed: result.feed === ZeroAddress ? null : result.feed, maxStaleness: Number(result.maxStaleness) });
    } catch { feedLookups.push({ source, status: "lookup-failed", feed: null, maxStaleness: null }); }
  }
  requireCheck((await provider.getBlock(blockNumber))?.hash === block.hash, "Discovery block changed; retry");
  return { mode: "DISCOVERY_ONLY", chainId: network.chainId, blockNumber, blockHash: block.hash,
    token: { address: tokenAddress, symbol, decimals }, usdg: { address: usdgAddress, decimals: usdgDecimals },
    factory: factoryAddress, checkedFeeTiers: network.feeTiers, pools, feedLookups,
    registrationStatus: "NOT_PREPARED", tokenDecimalsSupportedByV2: decimals <= 18 && usdgDecimals <= 18,
    limitations: ["No V2 configuration used; no transactions prepared or sent.",
      "Only the listed V3 factory/fee tiers were searched. Missing pools do not prove no other V3 or V4 pool exists.",
      "Feed lookups are candidates from existing vault configuration, not an exhaustive Chainlink search.",
      "Raw liquidity and available observations do not establish economically safe TWAP settings or mint/redeem depth.",
      "Pool metadata checks are discovery only; registration still verifies reviewed deployment inputs, CREATE2 identity and risk settings."],
  };
}

export async function runDiscovery(token: string) {
  getAddress(token); // Fail on malformed input before touching the RPC.
  const request = new FetchRequest(process.env.STAX_RPC_URL ?? ROBINHOOD_DISCOVERY.rpc);
  request.timeout = 20_000;
  const provider = new JsonRpcProvider(request, ROBINHOOD_DISCOVERY.chainId, { staticNetwork: true, batchMaxCount: 1 });
  try {
    // staticNetwork avoids indefinite startup retries; explicitly verify the actual endpoint instead.
    requireCheck(BigInt(await provider.send("eth_chainId", [])) === BigInt(ROBINHOOD_DISCOVERY.chainId), "RPC is not Robinhood Chain");
    const result = await discoverWithoutVault(provider, token);
    const output = resolve(dirname(fileURLToPath(import.meta.url)), "discovery", `${result.token.address.toLowerCase()}-${Date.now()}.json`);
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, JSON.stringify(result, null, 2) + "\n", { flag: "wx" });
    console.log(JSON.stringify(result, null, 2));
    console.log(`Saved ${output}`);
    return result;
  } finally { provider.destroy(); }
}
