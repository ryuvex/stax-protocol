// Deploys StaxUserBasketFactoryV2 (which deploys its own StaxUserBasketV2 implementation) bound to the live V2 vault.
// Dry run:   npm run userbasket:deploy
// Broadcast: npm run userbasket:deploy -- --broadcast
// Writes reports/userbasket-v2-deployment/deployment.json and ABIs under reports/userbasket-v2-deployment/abi/.
import { JsonRpcProvider, Wallet, ContractFactory, Contract, formatEther, keccak256 } from "ethers";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: { broadcast: { type: "boolean", default: false } } });
const root = new URL("../../", import.meta.url);
const manifest = JSON.parse(await readFile(new URL("reports/mainnet-v2-deployment/deployment.json", root), "utf8"));
const VAULT: string = manifest.contracts.find((c: any) => c.name === "StaxVaultV2").address;
const outDir = new URL("reports/userbasket-v2-deployment/", root);
await mkdir(new URL("abi/", outDir), { recursive: true });

const art = async (p: string) => JSON.parse(await readFile(new URL(`artifacts/contracts/${p}`, root), "utf8"));
const factoryArt = await art("StaxUserBasketFactoryV2.sol/StaxUserBasketFactoryV2.json");
const cloneArt = await art("StaxUserBasketV2.sol/StaxUserBasketV2.json");
const tokenArt = await art("StaxUserBasketV2.sol/StaxUserBasketToken.json");

const provider = new JsonRpcProvider(process.env.STAX_RPC_URL ?? "https://rpc.mainnet.chain.robinhood.com");
try {
  const net = await provider.getNetwork();
  if (net.chainId !== 4663n) throw Error(`Wrong chain ${net.chainId}`);
  const vault = new Contract(VAULT, ["function usdg() view returns (address)", "function treasury() view returns (address)"], provider);
  console.log("V2 vault:", VAULT, "| usdg:", await vault.usdg(), "| treasury:", await vault.treasury());

  const key = (process.env.STAX_PRIVATE_KEY ?? await readFile(new URL("../deployer-private-key.txt", root), "utf8")).trim();
  const signer = new Wallet(key, provider);
  const balance = await provider.getBalance(signer.address);
  const cf = new ContractFactory(factoryArt.abi, factoryArt.bytecode, signer);
  const deployTx = await cf.getDeployTransaction(VAULT);
  const gas = await provider.estimateGas({ ...deployTx, from: signer.address });
  const feeData = await provider.getFeeData();
  const gasPrice = feeData.gasPrice ?? 0n;
  console.log("deployer:", signer.address, "| balance:", formatEther(balance), "ETH");
  console.log("estimated gas:", String(gas), "| gasPrice:", String(gasPrice), "wei | est. cost:", formatEther(gas * gasPrice), "ETH");
  if (balance < gas * gasPrice * 2n) throw Error("Deployer balance too low for 2x the estimated cost");
  if (!values.broadcast) { console.log("DRY RUN only. Re-run with --broadcast to deploy."); process.exit(0); }

  const factory: any = await cf.deploy(VAULT);
  const receipt = await factory.deploymentTransaction().wait();
  const factoryAddr = await factory.getAddress();
  const implAddr: string = await factory.implementation();
  const impl = new Contract(implAddr, cloneArt.abi, provider);
  const checks = {
    factoryMainVault: await factory.mainVault(), implMainVault: await impl.mainVault(), implFactory: await impl.factory(),
    usdg: await factory.usdg(), depositCapUsd: String(await impl.DEPOSIT_CAP_USD()), creationFeeUsdg: String(await factory.CREATION_FEE_USDG()),
  };
  if (checks.factoryMainVault !== VAULT || checks.implMainVault !== VAULT || checks.implFactory !== factoryAddr) throw Error("Post-deploy binding check failed: " + JSON.stringify(checks));
  const out = {
    chainId: 4663, deployer: signer.address, vault: VAULT,
    factory: { name: "StaxUserBasketFactoryV2", address: factoryAddr, constructorArgs: [VAULT], transactionHash: receipt.hash, blockNumber: receipt.blockNumber,
      gasUsed: String(receipt.gasUsed), feeETH: formatEther(receipt.gasUsed * (receipt.gasPrice ?? gasPrice)), runtimeCodeHash: keccak256(await provider.getCode(factoryAddr)) },
    implementation: { name: "StaxUserBasketV2", address: implAddr, constructorArgs: [VAULT], deployedBy: "factory constructor (same tx)", runtimeCodeHash: keccak256(await provider.getCode(implAddr)) },
    checks, deployedAt: new Date().toISOString(),
  };
  await writeFile(new URL("deployment.json", outDir), JSON.stringify(out, null, 2) + "\n");
  await writeFile(new URL("abi/StaxUserBasketFactoryV2.json", outDir), JSON.stringify(factoryArt.abi, null, 2) + "\n");
  await writeFile(new URL("abi/StaxUserBasketV2.json", outDir), JSON.stringify(cloneArt.abi, null, 2) + "\n");
  await writeFile(new URL("abi/StaxUserBasketToken.json", outDir), JSON.stringify(tokenArt.abi, null, 2) + "\n");
  console.log(JSON.stringify(out, null, 2));
} finally { provider.destroy(); }
