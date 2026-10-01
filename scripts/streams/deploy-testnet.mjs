// Robinhood Testnet rehearsal for Chainlink Data Streams pricing.
// Deploys mock USDG + mock USDG/USD feed + three mock stock tokens + StreamsRegistryAdapter
// against Chainlink's TESTNET verifier, maps the 11 testnet streams onto the three tokens
// (grouped by the prices they report), and writes reports/streams-testnet/deployment.json.
// Only testnet ETH is spent. Key: STAX_STREAMS_PRIVATE_KEY or ../streams-keeper-private-key.txt.
//
//   node scripts/streams/deploy-testnet.mjs            deploy
//   node scripts/streams/deploy-testnet.mjs --dry-run  print plan + wallet balance only
import {Contract, ContractFactory, JsonRpcProvider, Wallet, formatUnits} from "ethers";
import {readFile, writeFile, mkdir} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import "dotenv/config";

const DRY = process.argv.includes("--dry-run");
const RPC = process.env.STAX_TESTNET_RPC_URL ?? "https://rpc.testnet.chain.robinhood.com";
const CHAIN_ID = 46630;
const VERIFIER = "0x72790f9eB82db492a7DDb6d2af22A270Dcc3Db64"; // Data Streams verifier proxy, Robinhood Chain Testnet
const MASK_24_5 = (1 << 1) | (1 << 2) | (1 << 3) | (1 << 4);     // v11: pre, regular, post, overnight
const MAX_AGE = 900;

// Testnet streams visible to our credentials, grouped by reported price (names are not exposed
// on testnet). v8 streams are left out: their status codes differ from v11 and a token's mask
// must be unambiguous. A = ~$1161, B = ~$69.9, C = ~$3.00.
const GROUPS = [
  {symbol: "tSTOCK_A", feedIds: ["0x000b6d125fa41f65c4196eab967c61af23e73490dc3b887cbbe3a866728ea654", "0x000b726b1973c3ceb5d4c18db1b2d01f26ae6a92f7012d755ce501a07129d169", "0x000bdaefb4eec872e1249fee2d50388d062771bf9664633bd3cb356607b0045f"]},
  {symbol: "tSTOCK_B", feedIds: ["0x000bef8509c0438698f7e41ca236816fc4d6491e724df942d804576978f6e670", "0x000b835e14e462214ae21ad86e8181f797e690bca07b7ace6a364ddc9b2e44db", "0x000b9fd0f7943e31c696e1749381f3e24dc7f7a5c0e3f8071321aa3fd358f8a8"]},
  {symbol: "tSTOCK_C", feedIds: ["0x000b6e7325461602b39169e795854532ab95f757224760210ba8236fe17c46cb", "0x000b930bb9d864a2be1bbf01f7c0204163df9a0ff4e7e51d6a5f11185b93ae3e", "0x000b51e1f5f83d8cb93cdf47130384b7caa1a1692546906de25bcb98b00ca1f5"]},
];

const artifact = async (p) => JSON.parse(await readFile(new URL(`../../artifacts/contracts/${p}.json`, import.meta.url), "utf8"));
const provider = new JsonRpcProvider(RPC, CHAIN_ID, {staticNetwork: true});
const key = (process.env.STAX_STREAMS_PRIVATE_KEY ?? await readFile(process.env.STAX_STREAMS_KEY_FILE ?? fileURLToPath(new URL("../../../streams-keeper-private-key.txt", import.meta.url)), "utf8")).trim();
const wallet = new Wallet(key, provider);
const bal = await provider.getBalance(wallet.address);
console.log(`testnet wallet ${wallet.address}  balance ${formatUnits(bal, 18)} ETH  chain ${CHAIN_ID}`);
if (bal < 5n * 10n ** 15n) throw Error("wallet needs at least 0.005 testnet ETH (faucet: see Robinhood Chain testnet docs)");
if (DRY) { console.log("dry run: would deploy mocks + adapter and map", GROUPS.map((g) => `${g.symbol}:${g.feedIds.length} feeds`).join(", ")); process.exit(0); }

async function deploy(name, path, ...args) {
  const a = await artifact(path);
  const c = await new ContractFactory(a.abi, a.bytecode, wallet).deploy(...args);
  await c.waitForDeployment();
  console.log(`  ${name} ${await c.getAddress()}`);
  return c;
}
console.log("deploying mocks");
const usdg = await deploy("USDG (mock, 6 dec)", "mocks/MockERC20Decimals.sol/MockERC20Decimals", "USDG", "USDG", 6);
const usdgUsd = await deploy("USDG/USD feed (mock, $1.00)", "mocks/MockPriceOracle.sol/MockPriceOracle", 100_000_000n, 8);
const tokens = [];
for (const g of GROUPS) tokens.push(await deploy(`${g.symbol} (mock, 18 dec)`, "mocks/MockERC20Decimals.sol/MockERC20Decimals", g.symbol, g.symbol, 18));
console.log("deploying adapter");
const adapter = await deploy("StreamsRegistryAdapter", "StreamsRegistryAdapter.sol/StreamsRegistryAdapter", VERIFIER, await usdg.getAddress(), await usdgUsd.getAddress(), 97_200);

console.log("configuring feeds");
const out = {chainId: CHAIN_ID, verifier: VERIFIER, usdg: await usdg.getAddress(), usdgUsdFeed: await usdgUsd.getAddress(), adapter: await adapter.getAddress(), tokens: []};
for (let i = 0; i < GROUPS.length; i++) {
  const g = GROUPS[i], token = await tokens[i].getAddress();
  const pool = Wallet.createRandom().address; // placeholder: no vault/route validator on testnet
  await (await adapter.setToken(token, g.feedIds[0], pool, MAX_AGE, MASK_24_5)).wait();
  for (const f of g.feedIds.slice(1)) await (await adapter.addFeed(token, f)).wait();
  console.log(`  ${g.symbol} ${token}: ${g.feedIds.length} feeds`);
  out.tokens.push({symbol: g.symbol, token, feedIds: g.feedIds});
}
await mkdir(new URL("../../reports/streams-testnet/", import.meta.url), {recursive: true});
await writeFile(new URL("../../reports/streams-testnet/deployment.json", import.meta.url), JSON.stringify(out, null, 2));
console.log("\nwritten reports/streams-testnet/deployment.json");
console.log("\nkeeper env for testnet (add to .env):");
console.log(`STAX_STREAMS_RPC_URL=${RPC}\nSTAX_STREAMS_CHAIN_ID=${CHAIN_ID}\nSTAX_STREAMS_ADAPTER=${out.adapter}\nSTAX_STREAMS_TOKENS=${JSON.stringify(out.tokens.map((t) => ({symbol: t.symbol, token: t.token, feedIds: t.feedIds})))}`);
