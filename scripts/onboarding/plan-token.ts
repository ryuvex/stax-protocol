import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { Contract, JsonRpcProvider, ZeroAddress, getAddress, keccak256 } from "ethers";
import type { AbstractProvider } from "ethers";

const VAULT_ABI = [
  "function owner() view returns(address)", "function usdg() view returns(address)",
  "function usdgDecimals() view returns(uint8)", "function universalRouter() view returns(address)",
  "function routeValidator() view returns(address)", "function previewer() view returns(address)",
  "function oracleSettings(address) view returns(uint8 oracleType,address registry)",
  "function tickerSlippageBps(address) view returns(uint16)",
  "function priceFeeds(address) view returns(address feed,uint48 maxStaleness)",
  "function tickerPoolsV3(address) view returns(uint24 fee,bool exists)",
  "function tickerIsV3(address) view returns(bool)",
  "function tickerPools(address) view returns(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)",
  "function getOraclePriceUsd18(address) view returns(uint256)",
  "function setTickerPoolV3(address,uint24)", "function setPriceFeed(address,address,uint48)",
  "function setTickerPool(address,address,address,uint24,int24,address)",
  "function setTickerSlippage(address,uint16)", "function setTwapOracle(address,address,uint16)",
];
const VALIDATOR_ABI = [
  "function router() view returns(address)", "function factory() view returns(address)",
  "function poolInitCodeHash() view returns(bytes32)",
  "function validate(address,address,uint24) view returns(address)",
];
const PARAMS = "(address pool,uint32 twapWindow,uint32 maxObservationAge,uint128 minCurrentLiquidity,uint128 minHarmonicLiquidity,uint16 maxDeviationBps)";
const REGISTRY_ABI = [
  "function owner() view returns(address)", "function usdg() view returns(address)",
  "function usdgDecimals() view returns(uint8)", "function trustedFactory() view returns(address)",
  "function tokenDecimals(address) view returns(uint8)",
  `function tokenConfigurations(address) view returns${PARAMS}`,
  `function configureToken(address,${PARAMS})`,
];
const FEED_ABI = ["function decimals() view returns(uint8)",
  "function latestRoundData() view returns(uint80,int256,uint256,uint256,uint80)"];

type Safety = { twapWindow: number; maxObservationAge: number; minCurrentLiquidity: string;
  minHarmonicLiquidity: string; maxDeviationBps: number };
export type V4Route = { currency0: string; currency1: string; fee: number; tickSpacing: number; hooks: string };
export type TokenConfig = {
  chainId: number; vault: string; expectedVaultCodeHash: string; expectedOwner: string;
  usdg: string; expectedUsdgDecimals: number; token: string; expectedTokenDecimals: number;
  router: string; factory: string; poolInitCodeHash: string; pool: string; fee: number;
  slippageBps: number;
  /// Present only for Chainlink tokens executing on a hookless Uniswap V4 pool; pool/fee are then ignored.
  v4?: V4Route;
  oracle: { type: "CHAINLINK"; feed: string; maxStaleness: number }
    | { type: "TWAP"; registry: string; expectedRegistryOwner: string; safety: Safety };
  review: { tokenBehavior: string; routerDeployment: string; roundTripFork: string;
    chainlinkFeedSearch: string; riskParameters: string };
};
class PreflightError extends Error {}
function check(ok: unknown, message: string): asserts ok { if (!ok) throw new PreflightError(message); }
function same(a: string, b: string) { return a.toLowerCase() === b.toLowerCase(); }
function address(v: unknown, label: string) {
  check(typeof v === "string", `${label}: address required`);
  check(getAddress(v) !== ZeroAddress, `${label}: zero address`);
}
function integer(v: unknown, lo: number, hi: number, label: string) {
  check(Number.isSafeInteger(v) && Number(v) >= lo && Number(v) <= hi, `${label}: invalid integer`);
}
export function validateConfig(value: unknown): TokenConfig {
  check(value && typeof value === "object", "Configuration must be an object");
  const c = value as TokenConfig;
  integer(c.chainId, 1, Number.MAX_SAFE_INTEGER, "chainId");
  for (const key of ["vault", "expectedOwner", "usdg", "token", "router", "factory"] as const) address(c[key], key);
  if (c.v4) {
    check(c.oracle?.type === "CHAINLINK", "V4 routes are supported for Chainlink-priced tokens only");
    address(c.v4.currency0, "v4.currency0"); address(c.v4.currency1, "v4.currency1");
    check(c.v4.currency0.toLowerCase() < c.v4.currency1.toLowerCase(), "v4 currencies must be ordered");
    check([c.v4.currency0, c.v4.currency1].some(x => same(x, c.token)) && [c.v4.currency0, c.v4.currency1].some(x => same(x, c.usdg)), "v4 pool must pair token with USDG");
    integer(c.v4.fee, 0, 999999, "v4.fee"); integer(c.v4.tickSpacing, 1, 32767, "v4.tickSpacing");
    check(typeof c.v4.hooks === "string" && getAddress(c.v4.hooks) === ZeroAddress, "Only hookless V4 pools are supported");
  } else address(c.pool, "pool");
  check(!same(c.token, c.usdg), "Token must differ from USDG");
  for (const key of ["expectedVaultCodeHash", "poolInitCodeHash"] as const)
    check(/^0x[0-9a-fA-F]{64}$/.test(c[key]) && BigInt(c[key]) !== 0n, `${key}: nonzero bytes32 required`);
  integer(c.expectedTokenDecimals, 0, 18, "expectedTokenDecimals");
  integer(c.expectedUsdgDecimals, 0, 18, "expectedUsdgDecimals");
  integer(c.fee, 1, 999999, "V3 fee");
  integer(c.slippageBps, 1, 500, "slippageBps");
  check(c.review && typeof c.review === "object", "Review references required");
  for (const key of ["tokenBehavior", "routerDeployment", "roundTripFork", "chainlinkFeedSearch", "riskParameters"] as const)
    check(typeof c.review[key] === "string" && c.review[key].trim().length > 0, `Missing review reference: ${key}`);
  check(c.oracle && ["CHAINLINK", "TWAP"].includes(c.oracle.type), "Explicit CHAINLINK or TWAP oracle required");
  if (c.oracle.type === "CHAINLINK") {
    address(c.oracle.feed, "feed"); integer(c.oracle.maxStaleness, 1, 2 ** 48 - 1, "maxStaleness");
  } else {
    address(c.oracle.registry, "registry"); address(c.oracle.expectedRegistryOwner, "expectedRegistryOwner");
    const p = c.oracle.safety; check(p, "TWAP safety settings required; no defaults are supplied");
    integer(p.twapWindow, 1, 2 ** 32 - 1, "twapWindow");
    integer(p.maxObservationAge, 1, p.twapWindow, "maxObservationAge");
    integer(p.maxDeviationBps, 1, 9999, "maxDeviationBps");
    for (const key of ["minCurrentLiquidity", "minHarmonicLiquidity"] as const)
      check(typeof p[key] === "string" && /^[1-9][0-9]*$/.test(p[key]) && BigInt(p[key]) < 2n ** 128n,
        `${key}: positive uint128 decimal string required`);
  }
  return c;
}

export async function buildPlan(provider: AbstractProvider, input: unknown) {
  const c = validateConfig(input);
  check((await provider.getNetwork()).chainId === BigInt(c.chainId), "Wrong RPC chain ID");
  const block = await provider.getBlock("latest"); check(block, "Missing block"); check(block.hash, "Missing block hash");
  const blockNumber = block.number;
  const at = { blockTag: blockNumber };
  const contract = (a: string, abi: string[]) => new Contract(a, abi, provider);
  async function hasCode(a: string) {
    const code = await provider.getCode(a, blockNumber); check(code !== "0x", `No deployed code: ${a}`); return code;
  }
  const code = await hasCode(c.vault);
  check(same(keccak256(code), c.expectedVaultCodeHash), "Vault bytecode differs from reviewed V2 deployment");
  await Promise.all([c.token, c.usdg, c.router, c.factory, ...(c.v4 ? [] : [c.pool])].map(hasCode));
  const v = contract(c.vault, VAULT_ABI);
  check(same(await v.owner(at), c.expectedOwner), "Vault owner mismatch");
  check(same(await v.usdg(at), c.usdg), "Vault USDG mismatch");
  check(same(await v.universalRouter(at), c.router), "Vault router mismatch");
  const token = contract(c.token, ["function decimals() view returns(uint8)", "function oraclePaused() view returns(bool)"]);
  check(Number(await token.decimals(at)) === c.expectedTokenDecimals, "Token decimals mismatch");
  check(Number(await v.usdgDecimals(at)) === c.expectedUsdgDecimals, "Cached USDG decimals mismatch");
  check(Number(await contract(c.usdg, ["function decimals() view returns(uint8)"]).decimals(at)) === c.expectedUsdgDecimals,
    "Live USDG decimals mismatch");
  const preview = await v.previewer(at); await hasCode(preview);
  check(same(await contract(preview, ["function vault() view returns(address)"]).vault(at), c.vault), "Preview helper binding mismatch");
  check(await v.getOraclePriceUsd18(c.usdg, at) > 0n, "USDG oracle unavailable");
  const validatorAddress = await v.routeValidator(at); await hasCode(validatorAddress);
  const validator = contract(validatorAddress, VALIDATOR_ABI);
  check(same(await validator.router(at), c.router), "Validator router mismatch");
  check(same(await validator.factory(at), c.factory), "Validator factory mismatch");
  check(same(await validator.poolInitCodeHash(at), c.poolInitCodeHash), "Validator pool hash mismatch");
  if (!c.v4) check(same(await validator.validate(c.token, c.usdg, c.fee, at), c.pool), "Canonical V3 pool mismatch");
  const currentOracle = await v.oracleSettings(c.token, at);
  const currentType = Number(currentOracle.oracleType), desiredType = c.oracle.type === "CHAINLINK" ? 1 : 2;
  check(currentType === 0 || currentType === desiredType, "Existing oracle type conflicts; automatic migration prohibited");
  const route = await v.tickerPoolsV3(c.token, at), v4 = await v.tickerPools(c.token, at);
  const hasV4 = v4.currency0 !== ZeroAddress || v4.currency1 !== ZeroAddress;
  if (c.v4) {
    check(!route.exists && !await v.tickerIsV3(c.token, at), "Existing V3 route conflicts with requested V4 route");
    if (hasV4) check(same(v4.currency0, c.v4.currency0) && same(v4.currency1, c.v4.currency1) && Number(v4.fee) === c.v4.fee
      && Number(v4.tickSpacing) === c.v4.tickSpacing && same(v4.hooks, c.v4.hooks), "Existing V4 route conflicts");
  } else {
    check(!hasV4, "Existing V4 route conflicts with requested V3 route");
    if (route.exists) check(Number(route.fee) === c.fee && await v.tickerIsV3(c.token, at), "Existing V3 route conflicts");
    else check(!await v.tickerIsV3(c.token, at), "Inconsistent V3 route state");
  }
  const steps: { label: string; owner: string; to: string; value: string; data: string }[] = [];
  function add(label: string, owner: string, target: Contract, method: string, args: unknown[]) {
    steps.push({ label, owner: getAddress(owner), to: String(target.target), value: "0", data: target.interface.encodeFunctionData(method, args) });
  }
  if (c.oracle.type === "TWAP") {
    const o = c.oracle; await hasCode(o.registry);
    const r = contract(o.registry, REGISTRY_ABI);
    check(same(await r.owner(at), o.expectedRegistryOwner), "Registry owner mismatch");
    check(same(await r.usdg(at), c.usdg) && Number(await r.usdgDecimals(at)) === c.expectedUsdgDecimals, "Registry quote asset mismatch");
    check(same(await r.trustedFactory(at), c.factory), "Registry factory mismatch");
    const params = { pool: c.pool, ...o.safety };
    const prior = await r.tokenConfigurations(c.token, at);
    if (prior.pool !== ZeroAddress) {
      check(same(prior.pool, c.pool), "Existing registry pool conflicts; do not alter shared pricing automatically");
      for (const key of Object.keys(o.safety))
        check(BigInt(prior[key]) === BigInt(o.safety[key as keyof Safety]), `Existing registry ${key} conflicts`);
      check(Number(await r.tokenDecimals(c.token, at)) === c.expectedTokenDecimals, "Registry cached token decimals mismatch");
    }
    // Actual registry oracle checks, with owner impersonation ONLY inside read-only eth_call.
    // This neither signs nor broadcasts a transaction and does not persist configuration.
    await r.configureToken.staticCall(c.token, params, { ...at, from: o.expectedRegistryOwner });
    if (prior.pool === ZeroAddress) add("Configure reviewed TWAP parameters", o.expectedRegistryOwner, r, "configureToken", [c.token, params]);
    if (currentType === 2) check(same(currentOracle.registry, o.registry), "Existing vault registry conflicts");
  } else {
    const o = c.oracle; await hasCode(o.feed);
    check(await token.oraclePaused(at) === false, "Chainlink token oracle is paused");
    const f = contract(o.feed, FEED_ABI), round = await f.latestRoundData(at);
    check(Number(await f.decimals(at)) <= 18, "Feed decimals exceed vault support");
    check(round[1] > 0n && round[3] > 0n && round[3] <= BigInt(block.timestamp)
      && BigInt(block.timestamp) - round[3] <= BigInt(o.maxStaleness), "Invalid/stale Chainlink answer");
    const prior = await v.priceFeeds(c.token, at);
    if (currentType === 1) check(same(prior.feed, o.feed) && Number(prior.maxStaleness) === o.maxStaleness, "Existing Chainlink feed settings conflict");
    else check(prior.feed === ZeroAddress, "Unexpected existing feed");
  }
  if (c.v4) { if (!hasV4) add("Register V4 execution pool", c.expectedOwner, v, "setTickerPool", [c.token, c.v4.currency0, c.v4.currency1, c.v4.fee, c.v4.tickSpacing, c.v4.hooks]); }
  else if (!route.exists) add("Register V3 execution pool", c.expectedOwner, v, "setTickerPoolV3", [c.token, c.fee]);
  if (currentType === 0) {
    if (c.oracle.type === "TWAP") add("Activate TWAP pricing", c.expectedOwner, v, "setTwapOracle", [c.token, c.oracle.registry, c.slippageBps]);
    else {
      add("Register Chainlink pricing at 200 bps", c.expectedOwner, v, "setPriceFeed", [c.token, c.oracle.feed, c.oracle.maxStaleness]);
      if (c.slippageBps !== 200) add("Set reviewed ticker slippage", c.expectedOwner, v, "setTickerSlippage", [c.token, c.slippageBps]);
    }
  } else {
    check(Number(await v.tickerSlippageBps(c.token, at)) === c.slippageBps, "Existing slippage conflicts; no automatic update");
    check(await v.getOraclePriceUsd18(c.token, at) > 0n, "Existing token oracle unavailable");
  }
  check((await provider.getBlock(block.number))?.hash === block.hash, "Block changed during planning; retry");
  // Only group adjacent steps with the same owner: registry must execute before activation.
  const batches: { owner: string; safeTransactionBuilder: object }[] = [];
  for (let i = 0; i < steps.length;) {
    const owner = steps[i].owner, transactions = [];
    do { const { to, value, data } = steps[i++]; transactions.push({ to, value, data }); }
    while (i < steps.length && same(steps[i].owner, owner));
    batches.push({ owner, safeTransactionBuilder: { version: "1.0", chainId: String(c.chainId), createdAt: block.timestamp * 1000,
      meta: { name: `Stax token onboarding ${c.token}`, description: "Execute batches in order; revalidate current state before approval." }, transactions } });
  }
  return { mode: "PLAN_ONLY", chainId: c.chainId, blockNumber: block.number, blockHash: block.hash,
    config: c, steps, batches,
    limitations: ["No transactions broadcast. Review references are operator attestations, not independently verified approvals.",
      "Registry configureToken eth_call checks current oracle conditions, not economic safety or a full mint/redeem.",
      "Dependent transactions have not been simulated as a sequence. Fork-simulate the full plan before execution.",
      "V4 routes only for Chainlink tokens on hookless pools; V4 pool existence/depth is not validated on-chain here (fork round trips are the evidence). No automatic Chainlink-to-TWAP fallback, frontend edits or token transfers.",
      "Re-run before approval: pool state, ownership and configuration can change after this block."],
  };
}

async function main() {
  const [configFile, outputFile = "token-onboarding-plan.json", ...extra] = process.argv.slice(2);
  check(configFile && extra.length === 0, "Usage: npm run onboard:plan -- CONFIG.json [OUTPUT.json]");
  const c = validateConfig(JSON.parse(await readFile(configFile, "utf8")));
  check(process.env.STAX_RPC_URL, "Set STAX_RPC_URL (no private key needed)");
  const provider = new JsonRpcProvider(process.env.STAX_RPC_URL);
  try {
    const plan = await buildPlan(provider, c);
    await writeFile(outputFile, JSON.stringify(plan, null, 2) + "\n", { flag: "wx" });
    for (let i = 0; i < plan.batches.length; ++i) {
      await writeFile(`${outputFile}.batch-${i + 1}.safe.json`, JSON.stringify(plan.batches[i].safeTransactionBuilder, null, 2) + "\n", { flag: "wx" });
    }
    console.log(`Prepared ${plan.steps.length} transactions in ${plan.batches.length} ordered owner batches. Saved ${resolve(outputFile)}. Nothing sent.`);
  } finally { provider.destroy(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error: unknown) => { if (error instanceof PreflightError) console.error(error.message); console.error("Onboarding preflight/export failed. Check the configuration, deployed state and RPC access. No transactions sent. Import buildPlan for detailed local diagnostics; RPC errors may contain credentials."); process.exitCode = 1; });
}
