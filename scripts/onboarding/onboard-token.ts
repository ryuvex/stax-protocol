import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Contract, JsonRpcProvider, ZeroAddress, getAddress, keccak256 } from "ethers";
import type { AbstractProvider } from "ethers";
import { assessToken } from "../assessment/assess-token.ts";
import { runDiscovery } from "./discover-token.ts";
import { buildPlan, validateConfig } from "./plan-token.ts";
import type { TokenConfig } from "./plan-token.ts";

type Shared = Pick<TokenConfig, "chainId" | "vault" | "expectedVaultCodeHash" | "expectedOwner" |
  "usdg" | "expectedUsdgDecimals" | "router" | "factory" | "poolInitCodeHash">;
export type ProjectConfig = Shared & {
  v3FeeTiers: number[];
  registry?: string; expectedRegistryOwner?: string;
  chainlinkSourceVaults: string[];
  chainlinkCandidates: Record<string, string[]>;
  routerDeploymentReview: string;
};
class InputError extends Error {}
function requireInput(ok: unknown, message: string): asserts ok { if (!ok) throw new InputError(message); }
function equal(a: string, b: string) { return a.toLowerCase() === b.toLowerCase(); }
function addr(a: string) { requireInput(getAddress(a) !== ZeroAddress, "Zero address is not allowed"); return getAddress(a); }
function shared(p: ProjectConfig): Shared {
  const { chainId, vault, expectedVaultCodeHash, expectedOwner, usdg, expectedUsdgDecimals, router, factory, poolInitCodeHash } = p;
  return { chainId, vault, expectedVaultCodeHash, expectedOwner, usdg, expectedUsdgDecimals, router, factory, poolInitCodeHash };
}
export function validateProject(raw: unknown): ProjectConfig {
  const p = raw as ProjectConfig;
  requireInput(p && typeof p === "object", "Project configuration is required");
  requireInput(Number.isSafeInteger(p.chainId) && p.chainId > 0, "Invalid project chain ID");
  for (const a of [p.vault, p.expectedOwner, p.usdg, p.router, p.factory]) addr(a);
  for (const hash of [p.expectedVaultCodeHash, p.poolInitCodeHash])
    requireInput(/^0x[0-9a-fA-F]{64}$/.test(hash) && BigInt(hash) > 0n, "Reviewed deployment hashes required");
  requireInput(Number.isInteger(p.expectedUsdgDecimals) && p.expectedUsdgDecimals >= 0 && p.expectedUsdgDecimals <= 18, "Invalid USDG decimals");
  requireInput(Array.isArray(p.v3FeeTiers) && p.v3FeeTiers.length > 0 && p.v3FeeTiers.length <= 32,
    "Configure 1-32 fee tiers to discover");
  requireInput(p.v3FeeTiers.every(f => Number.isInteger(f) && f > 0 && f < 1_000_000), "Invalid V3 fee tiers");
  requireInput(Array.isArray(p.chainlinkSourceVaults), "chainlinkSourceVaults must be an array");
  p.chainlinkSourceVaults.forEach(addr);
  requireInput(p.chainlinkCandidates && typeof p.chainlinkCandidates === "object", "Provide chainlinkCandidates catalog (may be empty)");
  for (const [token, feeds] of Object.entries(p.chainlinkCandidates)) {
    addr(token); requireInput(Array.isArray(feeds), "Feed candidates must be arrays"); feeds.forEach(addr);
  }
  if (p.registry) { addr(p.registry); requireInput(p.expectedRegistryOwner, "Registry owner required"); addr(p.expectedRegistryOwner); }
  requireInput(typeof p.routerDeploymentReview === "string" && p.routerDeploymentReview.trim().length > 0,
    "Reviewed router deployment reference required");
  return p;
}

export async function discoverToken(provider: AbstractProvider, rawProject: unknown, rawToken: string) {
  const p = validateProject(rawProject), tokenAddress = addr(rawToken);
  requireInput(!equal(tokenAddress, p.usdg), "USDG cannot be added as a basket ticker");
  requireInput((await provider.getNetwork()).chainId === BigInt(p.chainId), "Wrong RPC chain");
  const block = await provider.getBlock("latest"); requireInput(block?.hash, "No current block");
  const at = { blockTag: block.number };
  requireInput(equal(keccak256(await provider.getCode(p.vault, block.number)), p.expectedVaultCodeHash), "Saved V2 bytecode hash mismatch");
  const v = new Contract(p.vault, ["function usdg() view returns(address)", "function universalRouter() view returns(address)",
    "function owner() view returns(address)", "function routeValidator() view returns(address)",
    "function tickerPoolsV3(address) view returns(uint24 fee,bool exists)"], provider);
  requireInput(equal(await v.usdg(at), p.usdg) && equal(await v.universalRouter(at), p.router)
    && equal(await v.owner(at), p.expectedOwner), "Saved vault dependencies/owner mismatch");
  const validator = new Contract(await v.routeValidator(at), ["function factory() view returns(address)",
    "function poolInitCodeHash() view returns(bytes32)", "function validate(address,address,uint24) view returns(address)"], provider);
  requireInput(equal(await validator.factory(at), p.factory) && equal(await validator.poolInitCodeHash(at), p.poolInitCodeHash),
    "Saved factory or pool hash mismatch");
  requireInput(await provider.getCode(tokenAddress, block.number) !== "0x", "Token has no deployed code");
  const token = new Contract(tokenAddress, ["function decimals() view returns(uint8)", "function symbol() view returns(string)"], provider);
  const decimals = Number(await token.decimals(at)); requireInput(decimals <= 18, "Unsupported token decimals");
  let symbol: string | null = null;
  try { symbol = await token.symbol(at); } catch { /* Symbol is optional metadata, never used as identity. */ }
  const existing = await v.tickerPoolsV3(tokenAddress, at);
  const tiers = [...new Set([...p.v3FeeTiers, ...(existing.exists ? [Number(existing.fee)] : [])])];
  const factory = new Contract(p.factory, ["function getPool(address,address,uint24) view returns(address)"], provider);
  const pools: { address: string; fee: number; currentLiquidity: string; validation: string }[] = [];
  for (const fee of tiers) {
    const poolAddress = await factory.getPool(tokenAddress, p.usdg, fee, at);
    if (poolAddress === ZeroAddress) continue;
    const pool = new Contract(poolAddress, ["function liquidity() view returns(uint128)"], provider);
    const currentLiquidity = String(await pool.liquidity(at));
    let validation = "canonical-active-pool";
    try { requireInput(equal(await validator.validate(tokenAddress, p.usdg, fee, at), poolAddress), "Pool mismatch"); }
    catch { validation = "failed-validation-do-not-use"; }
    pools.push({ address: poolAddress, fee, currentLiquidity, validation });
  }
  // Match token addresses, never symbols. This is bounded candidate discovery, not proof of global feed absence.
  const feedMap = new Map<string, { address: string; sources: string[] }>();
  function candidate(feed: string, source: string) {
    const key = feed.toLowerCase(), item = feedMap.get(key) ?? { address: addr(feed), sources: [] };
    item.sources.push(source); feedMap.set(key, item);
  }
  for (const [token, feeds] of Object.entries(p.chainlinkCandidates))
    if (equal(token, tokenAddress)) for (const feed of feeds) candidate(feed, "saved feed catalog");
  for (const source of [...new Set([p.vault, ...p.chainlinkSourceVaults])]) {
    const feed = await new Contract(source, ["function priceFeeds(address) view returns(address feed,uint48 maxStaleness)"], provider)
      .priceFeeds(tokenAddress, at);
    if (feed.feed !== ZeroAddress) candidate(feed.feed, `configured vault ${source}`);
  }
  requireInput((await provider.getBlock(block.number))?.hash === block.hash, "Discovery block changed; retry");
  return { chainId: p.chainId, vault: p.vault, token: tokenAddress, decimals, symbol,
    blockNumber: block.number, blockHash: block.hash, checkedV3FeeTiers: tiers, pools,
    chainlinkCandidates: [...feedMap.values()],
    limitations: ["Pool enumeration covers configured V3 fee tiers and the existing V2 route, not every possible pool or V4.",
      "Feed candidates come from saved address mappings and configured source vaults. No candidate is NOT proof that Chainlink has no feed.",
      "Liquidity is raw active liquidity, not USD depth or an economic safety assessment. No pool is selected by liquidity rank."],
  };
}

export async function onboardAddress(provider: AbstractProvider, project: ProjectConfig, token: string, approval?: unknown) {
  const discovery = await discoverToken(provider, project, token);
  if (!approval || (approval as { approved?: boolean }).approved !== true) {
    const usable = discovery.pools.filter(pool => pool.validation === "canonical-active-pool");
    const pool = usable.length === 1 ? usable[0] : null;
    const feed = discovery.chainlinkCandidates.length === 1 ? discovery.chainlinkCandidates[0] : null;
    return { status: "NEEDS_REVIEW" as const, discovery,
      missing: ["Approve token behaviour and real-chain mint/redeem evidence", "Complete Chainlink feed availability review",
        "Select pricing and approve pool, slippage and token-specific risk settings"],
      draft: { approved: false, ...shared(project), token: discovery.token, expectedTokenDecimals: discovery.decimals,
        pool: pool?.address ?? null, fee: pool?.fee ?? null, slippageBps: null,
        oracle: feed ? { type: "CHAINLINK", feed: feed.address, maxStaleness: null } : null,
        review: { tokenBehavior: "", routerDeployment: project.routerDeploymentReview, roundTripFork: "", chainlinkFeedSearch: "", riskParameters: "" } },
    };
  }
  const c = validateConfig(approval);
  requireInput(equal(c.token, discovery.token), "Approval is for another token");
  requireInput(c.expectedTokenDecimals === discovery.decimals, "Approved decimals changed");
  for (const [key, value] of Object.entries(shared(project))) {
    const approved = c[key as keyof Shared];
    requireInput(typeof value === "string" ? typeof approved === "string" && equal(value, approved) : value === approved,
      `Approval differs from saved project: ${key}`);
  }
  // Require renewed pool discovery; never silently substitute another fee tier or pool.
  requireInput(discovery.pools.some(pool => pool.validation === "canonical-active-pool" && equal(pool.address, c.pool) && pool.fee === c.fee),
    "Approved pool not found among configured, valid V3 tiers");
  if (c.oracle.type === "TWAP") {
    requireInput(project.registry && equal(c.oracle.registry, project.registry), "TWAP registry differs from saved project");
    requireInput(project.expectedRegistryOwner && equal(c.oracle.expectedRegistryOwner, project.expectedRegistryOwner), "Registry owner differs from saved project");
  }
  return { status: "READY" as const, discovery, plan: await buildPlan(provider, c) };
}

async function loadOptional(path: string): Promise<unknown | undefined> {
  try { return JSON.parse(await readFile(path, "utf8")); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
}
async function main() {
  const [rawToken, ...extra] = process.argv.slice(2);
  requireInput(rawToken && (extra.length === 0 || (extra.length === 1 && ["--plan", "--discover"].includes(extra[0]))), "Usage: npm run onboard -- 0xTOKEN_ADDRESS [--plan|--discover]");
  if (extra.length === 0) { const result = await assessToken(rawToken); if (result.status === "BLOCKED") process.exitCode = 1; return; }
  if (extra[0] === "--discover") { await runDiscovery(rawToken); return; }
  const token = addr(rawToken);
  const home = dirname(fileURLToPath(import.meta.url));
  const projectPath = resolve(process.env.STAX_ONBOARDING_PROJECT ?? resolve(home, "project.json"));
  const rawProject = await loadOptional(projectPath);
  requireInput(rawProject, "One-time setup required: copy scripts/onboarding/project.example.json to project.json and fill the reviewed V2 deployment settings.");
  const project = validateProject(rawProject);
  requireInput(process.env.STAX_RPC_URL, "Set STAX_RPC_URL once in your environment; no private key needed.");
  const tokenHome = resolve(dirname(projectPath), "tokens", String(project.chainId), project.vault.toLowerCase(), token.toLowerCase());
  const approvalPath = resolve(tokenHome, "approval.json");
  const approval = await loadOptional(approvalPath);
  const provider = new JsonRpcProvider(process.env.STAX_RPC_URL);
  try {
    const result = await onboardAddress(provider, project, token, approval);
    const run = resolve(tokenHome, `run-${Date.now()}`);
    await mkdir(run, { recursive: true });
    await writeFile(resolve(run, "discovery.json"), JSON.stringify(result.discovery, null, 2) + "\n", { flag: "wx" });
    if (result.status === "NEEDS_REVIEW") {
      // Never overwrite a human's in-progress or approved configuration.
      if (!approval) await writeFile(approvalPath, JSON.stringify(result.draft, null, 2) + "\n", { flag: "wx" });
      console.log(`Discovery complete. Found ${result.discovery.pools.length} V3 pool candidates and ${result.discovery.chainlinkCandidates.length} feed candidates.`);
      console.log(`Needs review: ${result.missing.join("; ")}.\nReview file: ${approvalPath}\nNothing sent. After review, set approved=true and run the same token command with --plan again.`);
      process.exitCode = 2;
    } else {
      await writeFile(resolve(run, "plan.json"), JSON.stringify(result.plan, null, 2) + "\n", { flag: "wx" });
      for (let i = 0; i < result.plan.batches.length; ++i)
        await writeFile(resolve(run, `batch-${i + 1}.safe.json`), JSON.stringify(result.plan.batches[i].safeTransactionBuilder, null, 2) + "\n", { flag: "wx" });
      console.log(`Prepared ${result.plan.steps.length} transactions. Output: ${run}\nNothing sent. Review and execute owner batches in order.`);
    }
  } finally { provider.destroy(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error: unknown) => {
    if (error instanceof InputError) console.error(error.message);
    console.error("Onboarding stopped. Discovery requires only a valid token and a working Robinhood RPC (STAX_RPC_URL can override the public endpoint). Registration planning additionally requires reviewed project settings. No transactions sent; RPC error details redacted.");
    process.exitCode = 1;
  });
}
