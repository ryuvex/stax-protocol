// Read-only: what the adapter would answer the vault right now, per token.
import {Contract, JsonRpcProvider, formatUnits} from "ethers";
import "dotenv/config";
const RPC = process.env.STAX_STREAMS_RPC_URL ?? process.env.STAX_RPC_URL ?? "https://rpc.mainnet.chain.robinhood.com";
const provider = new JsonRpcProvider(RPC, Number(process.env.STAX_STREAMS_CHAIN_ID ?? 4663), {staticNetwork: true});
const adapter = new Contract(process.env.STAX_STREAMS_ADAPTER, [
  "function prices(address) view returns (uint192 usd18, uint32 observedAt, uint32 marketStatus)",
  "function configs(address) view returns (bytes32 feedId, address pool, uint8 decimals, uint32 maxAge, uint32 allowedStatusMask)",
  "function quoteUsdg18(address) view returns (uint256 usdgAmount18, uint128 harmonicLiquidity)",
  "function isFresh(address) view returns (bool)",
], provider);
const now = (await provider.getBlock("latest")).timestamp;
for (const t of JSON.parse(process.env.STAX_STREAMS_TOKENS ?? "[]")) {
  const p = await adapter.prices(t.token), c = await adapter.configs(t.token);
  let quote; try { const [q] = await adapter.quoteUsdg18(t.token); quote = `${formatUnits(q, 18)} USDG`; } catch (e) { quote = `REVERT ${e.shortMessage ?? e.message}`.slice(0, 80); }
  console.log(`${t.symbol}: stored $${formatUnits(p.usd18, 18)} status ${p.marketStatus} age ${now - Number(p.observedAt)}s (max ${c.maxAge}s) fresh=${await adapter.isFresh(t.token)} -> quoteUsdg18 = ${quote}`);
}
