// Mainnet deployment of StaxStaking + StaxRewardsDistributor (Robinhood Chain 4663).
//   node scripts/rewards/deploy.mjs --owner 0x... --publisher 0x... [--dry-run]
// Signer: ../deployer-private-key.txt (outside the repo) or STAX_DEPLOY_PRIVATE_KEY. Any funded key works:
// the owner is passed to the constructors, not taken from the signer. setPublisher is only possible
// when the signer IS the owner; otherwise the owner calls it afterwards (printed at the end).
// Writes reports/rewards/deployment.json. Nothing touches the vault: setRewardsPool is the vault owner's call.
import {ContractFactory, Contract, JsonRpcProvider, Wallet, formatUnits, isAddress} from "ethers";
import {readFile, writeFile, mkdir} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import "dotenv/config";

const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => a.startsWith("--") ? [a.slice(2), arr[i + 1] ?? true] : []).filter((x) => x.length));
const DRY = "dry-run" in args;
const OWNER = args.owner, PUBLISHER = args.publisher;
if (!isAddress(OWNER ?? "")) throw new Error("--owner <address> required");
if (!isAddress(PUBLISHER ?? "")) throw new Error("--publisher <address> required");
const STAX = "0x9CC546a4091f184898C4155C1B9F6290075eF8Fb";
const USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
const VAULT = "0xAda84161033C0Cc54EF21CEeF913A8fEC4239b33";
const provider = new JsonRpcProvider(process.env.STAX_RPC_URL ?? "https://rpc.mainnet.chain.robinhood.com", 4663, {staticNetwork: true});
const key = (process.env.STAX_DEPLOY_PRIVATE_KEY ?? await readFile(fileURLToPath(new URL("../../../deployer-private-key.txt", import.meta.url)), "utf8")).trim();
const signer = new Wallet(key, provider);
const artifact = async (p) => JSON.parse(await readFile(new URL(`../../artifacts/contracts/${p}.json`, import.meta.url), "utf8"));

// sanity: the token and USDG are what we think they are
const erc = ["function symbol() view returns(string)", "function decimals() view returns(uint8)"];
const [staxSym, staxDec, usdgSym, usdgDec] = await Promise.all([new Contract(STAX, erc, provider).symbol(), new Contract(STAX, erc, provider).decimals(), new Contract(USDG, erc, provider).symbol(), new Contract(USDG, erc, provider).decimals()]);
if (staxSym !== "STAX" || staxDec !== 18n) throw new Error(`unexpected STAX token: ${staxSym} ${staxDec}`);
if (usdgSym !== "USDG" || usdgDec !== 6n) throw new Error(`unexpected USDG token: ${usdgSym} ${usdgDec}`);
const vaultUsdg = await new Contract(VAULT, ["function usdg() view returns(address)"], provider).usdg();
if (vaultUsdg.toLowerCase() !== USDG.toLowerCase()) throw new Error("vault.usdg() != USDG constant");
const bal = await provider.getBalance(signer.address);
console.log(`signer ${signer.address}  balance ${formatUnits(bal, 18)} ETH\nowner ${OWNER}\npublisher ${PUBLISHER}\nSTAX ${STAX} (${staxSym}, ${staxDec} dec)  USDG ${USDG} (${usdgDec} dec)`);
if (bal < 2n * 10n ** 15n) throw new Error("signer needs at least 0.002 ETH");
if (DRY) { console.log("dry run: nothing sent"); process.exit(0); }

const st = await artifact("StaxStaking.sol/StaxStaking"), ds = await artifact("StaxRewardsDistributor.sol/StaxRewardsDistributor");
console.log("deploying StaxStaking...");
const staking = await new ContractFactory(st.abi, st.bytecode, signer).deploy(OWNER, STAX);
const r1 = await staking.deploymentTransaction().wait();
console.log(`  StaxStaking ${await staking.getAddress()}  block ${r1.blockNumber}  tx ${r1.hash}`);
console.log("deploying StaxRewardsDistributor...");
const dist = await new ContractFactory(ds.abi, ds.bytecode, signer).deploy(OWNER, USDG);
const r2 = await dist.deploymentTransaction().wait();
console.log(`  StaxRewardsDistributor ${await dist.getAddress()}  block ${r2.blockNumber}  tx ${r2.hash}`);

let publisherTx = null;
if (signer.address.toLowerCase() === OWNER.toLowerCase()) {
  const tx = await dist.setPublisher(PUBLISHER); const r = await tx.wait(); publisherTx = r.hash;
  console.log(`  setPublisher(${PUBLISHER})  tx ${r.hash}`);
} else {
  console.log(`  signer is not the owner: owner must call distributor.setPublisher(${PUBLISHER})`);
}
// read back
expectEq(await staking.owner(), OWNER, "staking owner"); expectEq(await dist.owner(), OWNER, "distributor owner");
expectEq(await staking.stakingToken(), STAX, "stakingToken"); expectEq(await dist.token(), USDG, "distributor token");
function expectEq(a, b, what) { if (a.toLowerCase() !== b.toLowerCase()) throw new Error(`${what}: ${a} != ${b}`); console.log(`  ok ${what} = ${a}`); }

const out = {chainId: 4663, deployedAt: new Date().toISOString(), deployer: signer.address, owner: OWNER, publisher: PUBLISHER, stax: STAX, usdg: USDG, vault: VAULT,
  staking: {address: await staking.getAddress(), block: r1.blockNumber, tx: r1.hash},
  distributor: {address: await dist.getAddress(), block: r2.blockNumber, tx: r2.hash, setPublisherTx: publisherTx},
  next: [`vault owner (0x79F7c8AB5360c9902DD23AdF99cDaB54f2a6449D) calls StaxVaultV2.setRewardsPool(${await dist.getAddress()})`, publisherTx ? null : `owner calls distributor.setPublisher(${PUBLISHER})`].filter(Boolean)};
await mkdir(new URL("../../reports/rewards/", import.meta.url), {recursive: true});
await writeFile(new URL("../../reports/rewards/deployment.json", import.meta.url), JSON.stringify(out, null, 2));
console.log("\nwritten reports/rewards/deployment.json\nnext:", out.next.join("\n      "));
