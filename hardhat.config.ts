import hardhatToolboxMochaEthersPlugin from "@nomicfoundation/hardhat-toolbox-mocha-ethers";
import hardhatVerify from "@nomicfoundation/hardhat-verify";
import { configVariable, defineConfig } from "hardhat/config";

export default defineConfig({
  plugins: [hardhatToolboxMochaEthersPlugin, hardhatVerify],
  solidity: {
    profiles: {
      default: {
        version: "0.8.28",
        settings: {
          viaIR: true,
          optimizer: {
            enabled: true,
            // v18.1: testing runs=50 -- runs=200 was still 16 bytes over
            // the 24,576-byte EIP-170 limit (confirmed: 24,592 bytes).
            // Trying a moderate reduction before jumping to the extreme
            // of runs=1, since runs=1 permanently taxes every future
            // user's gas on every mint/redeem/claim call -- better to
            // find the highest value that actually fits.
            runs: 10,
          },
        },
      },
      production: {
        version: "0.8.28",
        settings: {
          viaIR: true,
          optimizer: {
            enabled: true,
            // Kept identical to `default` deliberately -- testing
            // against different optimizer settings than what actually
            // deploys risks a "works in dev, fails at deploy" surprise.
            runs: 10,
          },
        },
      },
    },
  },
  networks: {
    hardhatMainnet: {
      type: "edr-simulated",
      chainType: "l1",
    },
    // v18.1 addition: dedicated forking network for real gas
    // estimation before the mainnet deploy. Hardhat 3 removed the
    // hardhat_reset RPC method used for runtime forking in Hardhat 2 --
    // forking must now be declared statically here instead. No
    // blockNumber pinned deliberately: for a "what would this cost
    // RIGHT NOW" question, we want current state and current gas
    // price, not a fixed historical snapshot.
    robinhoodMainnetFork: {
      type: "edr-simulated",
      chainType: "l1",
      // v18.2 fix: Hardhat 3's default hardfork ("osaka") doesn't
      // match Robinhood Chain's real EVM target -- and since this is
      // a newer, less-common chain, Hardhat has no built-in
      // hardfork-activation-history for it, so it can't auto-detect
      // the right one the way it would for a well-known network. Set
      // explicitly to match tonight's confirmed real compiler output
      // ("evm target: cancun") every time this contract was compiled.
      hardfork: "cancun",
      forking: {
        url: "https://rpc.mainnet.chain.robinhood.com",
      },
    },
    hardhatOp: {
      type: "edr-simulated",
      chainType: "op",
    },
    sepolia: {
      type: "http",
      chainType: "l1",
      url: configVariable("SEPOLIA_RPC_URL"),
      accounts: [configVariable("SEPOLIA_PRIVATE_KEY")],
    },
    robinhoodTestnet: {
      type: "http",
      chainType: "l1",
      url: "https://rpc.testnet.chain.robinhood.com",
      accounts: [
        configVariable("ROBINHOOD_TESTNET_PRIVATE_KEY"),
        configVariable("TEST_USER_PRIVATE_KEY"),
      ],
    },
    // Robinhood Chain MAINNET. Deliberately uses its OWN, SEPARATE private
    // key variable (ROBINHOOD_MAINNET_PRIVATE_KEY) -- do not reuse the
    // testnet deployer key here. This account will pay real gas and, if
    // used for self-seeding, will hold real funds. Set this key via:
    //   npx hardhat keystore set ROBINHOOD_MAINNET_PRIVATE_KEY
    // (same mechanism already used for the testnet keys tonight) rather
    // than ever placing it in a plaintext .env file.
    robinhoodMainnet: {
      type: "http",
      chainType: "l1",
      url: "https://rpc.mainnet.chain.robinhood.com",
      accounts: [configVariable("ROBINHOOD_MAINNET_PRIVATE_KEY")],
    },
  },
  // Chain descriptor for Blockscout verification on mainnet, same pattern
  // already proven working for testnet tonight.
  chainDescriptors: {
    46630: {
      name: "Robinhood Chain Testnet",
      blockExplorers: {
        blockscout: {
          name: "Robinhood Chain Testnet Explorer",
          url: "https://explorer.testnet.chain.robinhood.com",
          apiUrl: "https://explorer.testnet.chain.robinhood.com/api",
        },
      },
    },
    4663: {
      name: "Robinhood Chain",
      blockExplorers: {
        blockscout: {
          name: "Robinhood Chain Explorer",
          url: "https://robinhoodchain.blockscout.com",
          apiUrl: "https://robinhoodchain.blockscout.com/api",
        },
      },
    },
  },
  verify: {
    blockscout: {
      enabled: true,
    },
  },
});
