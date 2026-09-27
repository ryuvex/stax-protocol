// Checks whether the listed stock tokens can change balances outside transfer/mint/burn (rebase / split).
// Usage: node scripts/assessment/token-rebase-check.mjs
import { ethers } from "ethers";
const rpc = process.env.STAX_RPC_URL ?? "https://rpc.mainnet.chain.robinhood.com";
const explorer = "https://robinhoodchain.blockscout.com/api/v2/smart-contracts/";
const TOKENS = {
  GME: "0x1b0E319c6A659F002271B69dB8A7df2F911c153E", PLTR: "0x894E1EC2D74FFE5AEF8Dc8A9e84686acCB964F2A",
  CRCL: "0xdF0992E440dD0be65BD8439b609d6D4366bf1CB5", AMC: "0x05a3d1cd21d0c88145e82600e62e7e496e0f222b",
  NFLX: "0xE0444EF8BF4eD74f74FD73686e2ddF4C1c5591E8", SPY: "0x117cc2133c37B721F49dE2A7a74833232B3B4C0C",
  QQQ: "0xD5f3879160bc7c32ebb4dC785F8a4F505888de68", NVDA: process.env.NVDA ?? "",
};
const SUSPECT = /rebase|scalingFactor|scaling_factor|multiplier|sharesOf|shares|split|adjust|reflect|elastic|totalPooled|index\(/i;
const IMPL_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
const provider = new ethers.JsonRpcProvider(rpc);
for (const [sym, addr] of Object.entries(TOKENS)) {
  if (!addr) continue;
  const row = { sym, addr };
  const impl = await provider.getStorage(addr, IMPL_SLOT);
  row.eip1967Impl = impl === ethers.ZeroHash ? null : ethers.getAddress("0x" + impl.slice(26));
  const target = row.eip1967Impl ?? addr;
  try {
    const r = await fetch(explorer + target, { headers: { accept: "application/json" } });
    const d = await r.json();
    row.verified = d.is_verified; row.name = d.name; row.compiler = d.compiler_version; row.proxyType = d.proxy_type ?? null;
    const abi = d.abi ?? [];
    row.functions = abi.filter(f => f.type === "function" && f.stateMutability !== "view" && f.stateMutability !== "pure").map(f => f.name);
    row.suspectFunctions = row.functions.filter(n => SUSPECT.test(n));
    const src = (d.source_code ?? "") + JSON.stringify(d.additional_sources ?? []);
    row.suspectSourceHits = [...new Set((src.match(SUSPECT) ? src.match(new RegExp(SUSPECT.source, "gi")) : []))].slice(0, 20);
    row.hasBalancesMapping = /mapping\s*\(\s*address\s*=>\s*uint256\s*\)\s*(private|internal|public)?\s*_?balances/.test(src);
  } catch (e) { row.explorerError = String(e.message ?? e).slice(0, 120); }
  console.log(JSON.stringify(row));
}
