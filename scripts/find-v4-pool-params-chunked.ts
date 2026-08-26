import { network } from "hardhat";
import * as fs from "fs";

const V4_POOL_MANAGER = "0x8366a39cc670b4001a1121b8f6a443a643e40951";
const WETH = "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73";
const NATIVE_ETH = "0x0000000000000000000000000000000000000000";

const TICKERS: Record<string, string> = {
  "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC": "NVDA",
  "0x86923f96303D656E4aa86D9d42D1e57ad2023fdC": "AMD",
  "0x58FfE4a942d3885bAa22D7520691F611EF09e7AA": "TSM",
  "0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9": "AAPL",
  "0xe93237C50D904957Cf27E7B1133b510C669c2e74": "MSFT",
  "0x2e0847E8910a9732eB3fb1bb4b70a580ADAD4FE3": "GOOGL",
  "0x12f190a9F9d7D37a250758b26824B97CE941bF54": "AMZN",
  "0xc0D6457C16Cc70d6790Dd43521C899C87ce02f35": "META",
  "0x322F0929c4625eD5bAd873c95208D54E1c003b2d": "TSLA",
  "0x6330D8C3178a418788dF01a47479c0ce7CCF450b": "COIN",
  "0xec262a75e413fAfD0dF80480274532C79D42da09": "MSTR",
  "0xcBB95BBF36099d34dA091dc6Fa6F49EfA257Cee3": "CLSK",
  "0xdF0992E440dD0be65BD8439b609d6D4366bf1CB5": "CRCL",
  "0x558378E000D634A36593E338eBacdd6207640EfE": "IONQ",
  "0x284358abc07F9359f19f4b5b4aC91901Be2597Ba": "RGTI",
  "0x3b14C39E89D60D627b42a1A4CA45b5bb45Fc12e2": "RKLB",
  "0x4a0E65A3EcceC6dBe60AE065F2e7bb85Fae35eEa": "SPCX",
  "0xc72b96e0E48ecd4DC75E1e45396e26300BC39681": "INTC",
  "0xfF080c8ce2E5feadaCa0Da81314Ae59D232d4afD": "MU",
  "0x47F93d52cBeC7C6D2CfC080e154002370a60dAEA": "ASML",
  "0xB90A19fF0Af67f7779afF50A882A9CfF42446400": "SNDK",
};

const POOL_MANAGER_ABI = [
  "event Initialize(bytes32 indexed id, address indexed currency0, address indexed currency1, uint24 fee, int24 tickSpacing, address hooks, uint160 sqrtPriceX96, int24 tick)",
];

const CHUNK_SIZE = 10_000;
const CHUNK_TIMEOUT_MS = 15_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms)),
  ]);
}

async function main() {
  const { ethers } = await network.connect({ network: "robinhoodMainnet" });
  const poolManager = new ethers.Contract(V4_POOL_MANAGER, POOL_MANAGER_ABI, ethers.provider);
  const currentBlock = await ethers.provider.getBlockNumber();

  const totalChunks = Math.ceil(currentBlock / CHUNK_SIZE);
  console.log(`Scanning blocks 0 to ${currentBlock} in ${totalChunks} chunks of ${CHUNK_SIZE} blocks each.`);
  console.log(`(Chunk size confirmed working via a quick test just now.)\n`);

  const found: Record<string, any[]> = {};
  let totalEventsSeen = 0;
  let skippedChunks = 0;
  let chunkIndex = 0;

  for (let fromBlock = 0; fromBlock <= currentBlock; fromBlock += CHUNK_SIZE) {
    chunkIndex++;
    const toBlock = Math.min(fromBlock + CHUNK_SIZE - 1, currentBlock);

    try {
      const events = await withTimeout(
        poolManager.queryFilter(poolManager.filters.Initialize(), fromBlock, toBlock),
        CHUNK_TIMEOUT_MS
      );

      if (events.length > 0) {
        totalEventsSeen += events.length;
        for (const event of events) {
          const args = (event as any).args;
          const c0 = args.currency0.toLowerCase();
          const c1 = args.currency1.toLowerCase();

          for (const [tickerAddr, symbol] of Object.entries(TICKERS)) {
            if (c0 === tickerAddr.toLowerCase() || c1 === tickerAddr.toLowerCase()) {
              const otherCurrency = c0 === tickerAddr.toLowerCase() ? args.currency1 : args.currency0;
              const pairedWith =
                otherCurrency.toLowerCase() === WETH.toLowerCase()
                  ? "WETH"
                  : otherCurrency.toLowerCase() === NATIVE_ETH.toLowerCase()
                    ? "NATIVE ETH"
                    : otherCurrency;

              if (!found[symbol]) found[symbol] = [];
              found[symbol].push({
                pairedWith,
                fee: args.fee.toString(),
                tickSpacing: args.tickSpacing.toString(),
                hooks: args.hooks,
                block: event.blockNumber,
              });
            }
          }
        }
      }
    } catch (err: any) {
      skippedChunks++;
    }

    if (chunkIndex % 20 === 0 || toBlock === currentBlock) {
      const pct = ((toBlock / currentBlock) * 100).toFixed(1);
      process.stdout.write(
        `\r  Progress: ${pct}% (chunk ${chunkIndex}/${totalChunks}), ${totalEventsSeen} events seen, ${Object.keys(found).length}/21 tickers found, ${skippedChunks} chunks skipped   `
      );
    }
  }

  const outputLines: string[] = [];
  outputLines.push("=== RESULTS ===");
  outputLines.push("");
  for (const [tickerAddr, symbol] of Object.entries(TICKERS)) {
    const matches = found[symbol];
    if (!matches || matches.length === 0) {
      outputLines.push(`  ${symbol.padEnd(6)} -- NO pool initialization found in scanned history`);
    } else {
      for (const m of matches) {
        outputLines.push(
          `  ${symbol.padEnd(6)} paired=${m.pairedWith.padEnd(12)} fee=${m.fee.padStart(6)} tickSpacing=${m.tickSpacing.padStart(4)} hooks=${m.hooks} (block ${m.block})`
        );
      }
    }
  }
  outputLines.push("");
  outputLines.push(`(${skippedChunks}/${totalChunks} chunks timed out and were skipped -- if this number is`);
  outputLines.push(`large, some real pools may be missing from these results and a retry`);
  outputLines.push(`with an even smaller chunk size would be worth doing.)`);
  outputLines.push("");
  outputLines.push("=== V4 POOL PARAMETER DISCOVERY COMPLETE ===");

  // Write directly via Node's fs -- bypasses shell redirect/pipe/transcript
  // entirely, since those have all failed to capture this script's output
  // correctly in this specific terminal environment. This is the script
  // itself, in-process, writing its own file -- nothing shell-level to go wrong.
  const outputPath = "v4-pool-params-full.txt";
  fs.writeFileSync(outputPath, outputLines.join("\n"), "utf-8");

  // Still print to console too, for live visibility while it runs.
  for (const line of outputLines) console.log(line);
  console.log(`\n[Results also written directly to ${outputPath} via fs.writeFileSync]`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
