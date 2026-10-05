// Live staking smoke test on Robinhood Chain (4663) with the e2e wallet.
//   node scripts/rewards/e2e-stake.mjs [--stake 1000] [--withdraw 400] [--exit] [--dry-run]
// Signer: ../e2e-private-key.txt (outside the repo) or STAX_E2E_PRIVATE_KEY.
// approve -> stake -> withdraw, checks balances + events after each step, prints tx hashes.
// Leaves (stake - withdraw) staked unless --exit. Never touches USDG.
import {Contract, JsonRpcProvider, Wallet, formatUnits, parseUnits} from "ethers";
import {readFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import "dotenv/config";

const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => a.startsWith("--") ? [a.slice(2), arr[i + 1]?.startsWith("--") ? true : arr[i + 1] ?? true] : []).filter((x) => x.length));
const DRY = "dry-run" in args, EXIT = "exit" in args;
const STAKE = parseUnits(String(args.stake ?? "1000"), 18), WITHDRAW = parseUnits(String(args.withdraw ?? "400"), 18);
if (WITHDRAW > STAKE) throw new Error("--withdraw > --stake");

const p = new JsonRpcProvider(process.env.STAX_RPC_URL ?? "https://rpc.mainnet.chain.robinhood.com", 4663, {staticNetwork: true});
const STAKING = process.env.STAX_STAKING; if (!STAKING) throw new Error("STAX_STAKING not set");
const key = (process.env.STAX_E2E_PRIVATE_KEY ?? await readFile(fileURLToPath(new URL("../../../e2e-private-key.txt", import.meta.url)), "utf8")).trim();
const signer = new Wallet(key, p);

const staking = new Contract(STAKING, [
  "function stakingToken() view returns(address)", "function balanceOf(address) view returns(uint256)", "function totalSupply() view returns(uint256)",
  "function stake(uint256)", "function withdraw(uint256)", "function exit()",
  "event Staked(address indexed user, uint256 amount, uint256 newBalance, uint256 timestamp)",
  "event Withdrawn(address indexed user, uint256 amount, uint256 newBalance, uint256 timestamp)",
], signer);
const stax = new Contract(await staking.stakingToken(), ["function balanceOf(address) view returns(uint256)", "function allowance(address,address) view returns(uint256)", "function approve(address,uint256) returns(bool)", "function symbol() view returns(string)"], signer);

const f = (x) => formatUnits(x, 18);
async function snap(label) {
  const [wallet, staked, total, eth] = await Promise.all([stax.balanceOf(signer.address), staking.balanceOf(signer.address), staking.totalSupply(), p.getBalance(signer.address)]);
  console.log(`[${label}] wallet ${f(wallet)} STAX | staked ${f(staked)} | totalSupply ${f(total)} | gas ${formatUnits(eth, 18)} ETH`);
  return {wallet, staked, total};
}
function expectEq(a, b, what) { if (a !== b) throw new Error(`${what}: expected ${f(b)}, got ${f(a)}`); }
async function send(label, fn) {
  const tx = await fn(); console.log(`${label}: sent ${tx.hash}`);
  const r = await tx.wait(); if (r.status !== 1) throw new Error(`${label} REVERTED`);
  const evs = r.logs.map((l) => { try { return staking.interface.parseLog(l); } catch { return null; } }).filter(Boolean);
  for (const e of evs) console.log(`  event ${e.name}(${e.args.user}, ${f(e.args.amount)}, newBalance ${f(e.args.newBalance)}, ts ${e.args.timestamp})`);
  return r;
}

console.log(`signer ${signer.address}  staking ${STAKING}  token ${await stax.getAddress()} (${await stax.symbol()})`);
const before = await snap("before");
if (before.wallet < STAKE) throw new Error(`wallet has ${f(before.wallet)} STAX, need ${f(STAKE)}`);
if (DRY) { console.log(`dry run: would approve+stake ${f(STAKE)}, withdraw ${f(WITHDRAW)}${EXIT ? ", then exit()" : ""}`); process.exit(0); }

if (await stax.allowance(signer.address, STAKING) < STAKE) await send("approve", () => stax.approve(STAKING, STAKE));
await send("stake", () => staking.stake(STAKE));
let s = await snap("after stake");
expectEq(s.staked, before.staked + STAKE, "staked after stake"); expectEq(s.wallet, before.wallet - STAKE, "wallet after stake"); expectEq(s.total, before.total + STAKE, "totalSupply after stake");

if (WITHDRAW > 0n) {
  await send("withdraw", () => staking.withdraw(WITHDRAW));
  s = await snap("after withdraw");
  expectEq(s.staked, before.staked + STAKE - WITHDRAW, "staked after withdraw"); expectEq(s.wallet, before.wallet - STAKE + WITHDRAW, "wallet after withdraw");
}
if (EXIT) {
  await send("exit", () => staking.exit());
  s = await snap("after exit");
  expectEq(s.staked, 0n, "staked after exit"); expectEq(s.wallet, before.wallet, "wallet after exit");
}
console.log(`\nOK. ${f(s.staked)} STAX left staked by ${signer.address}.`);
