// List every Uniswap V4 pool on Robinhood Chain that contains a token (any pair, hooked or not), with live liquidity + price.
// Usage: node scripts/assessment/v4-pools-of.mjs 0xTOKEN
import {Contract, JsonRpcProvider, keccak256, solidityPacked, toBeHex, getAddress, formatUnits} from "ethers";
import "dotenv/config";
const RPC = process.env.STAX_RPC_URL ?? "https://rpc.mainnet.chain.robinhood.com";
const POOL_MANAGER = "0x8366a39CC670B4001A1121B8F6A443A643e40951";
const ABI = ["event Initialize(bytes32 indexed id,address indexed currency0,address indexed currency1,uint24 fee,int24 tickSpacing,address hooks,uint160 sqrtPriceX96,int24 tick)", "function extsload(bytes32) view returns(bytes32)"];
const p = new JsonRpcProvider(RPC, 4663, {staticNetwork: true});
const pm = new Contract(POOL_MANAGER, ABI, p);
const stateSlot = (id) => keccak256(solidityPacked(["bytes32", "uint256"], [id, 6n]));
const meta = async (t) => t === "0x0000000000000000000000000000000000000000" ? {sym: "ETH", dec: 18} : (async () => { const c = new Contract(t, ["function symbol() view returns(string)", "function decimals() view returns(uint8)"], p); return {sym: await c.symbol(), dec: Number(await c.decimals())}; })();
const token = getAddress(process.argv[2]);
const latest = await p.getBlockNumber();
async function logsFor(filter) { const out = []; const STEP = 9_999_999; for (let f = 0; f <= latest; f += STEP) out.push(...await pm.queryFilter(filter, f, Math.min(f + STEP - 1, latest))); return out; }
const events = [...await logsFor(pm.filters.Initialize(null, token, null)), ...await logsFor(pm.filters.Initialize(null, null, token))];
console.log(`PoolManager ${POOL_MANAGER}  token ${token}  pools ${events.length}  (block ${latest})`);
for (const ev of events) {
  const {id, currency0, currency1, fee, tickSpacing, hooks} = ev.args;
  const base = BigInt(stateSlot(id));
  const liquidity = BigInt(await pm.extsload(toBeHex(base + 3n, 32)));
  const slot0 = BigInt(await pm.extsload(toBeHex(base, 32)));
  const sqrt = slot0 & ((1n << 160n) - 1n); let tick = Number((slot0 >> 160n) & 0xffffffn); if (tick >= 1 << 23) tick -= 1 << 24;
  const [m0, m1] = [await meta(currency0), await meta(currency1)];
  const p1per0 = (Number(sqrt) / 2 ** 96) ** 2 * 10 ** (m0.dec - m1.dec); // price of currency0 in currency1
  const tokenIs0 = currency0.toLowerCase() === token.toLowerCase();
  const other = tokenIs0 ? m1 : m0, priceInOther = tokenIs0 ? p1per0 : 1 / p1per0;
  // reserves implied by current liquidity at the current tick (lower bound of what's reachable near price)
  const amt0 = Number(liquidity) / (Number(sqrt) / 2 ** 96), amt1 = Number(liquidity) * (Number(sqrt) / 2 ** 96);
  console.log(`\npoolId ${id}\n  currency0 ${currency0} (${m0.sym})  currency1 ${currency1} (${m1.sym})\n  fee ${Number(fee) === 0x800000 ? "dynamic (0x800000)" : Number(fee) / 1e4 + "%"}  tickSpacing ${tickSpacing}  hooks ${hooks}\n  liquidity ${liquidity}  tick ${tick}  sqrtPriceX96 ${sqrt}\n  price: 1 ${tokenIs0 ? m0.sym : m1.sym} = ${priceInOther.toPrecision(6)} ${other.sym}\n  ~virtual reserves at tick: ${formatUnits(BigInt(Math.floor(amt0)), m0.dec)} ${m0.sym} / ${formatUnits(BigInt(Math.floor(amt1)), m1.dec)} ${m1.sym}\n  initialized at block ${ev.blockNumber} tx ${ev.transactionHash}`);
}
