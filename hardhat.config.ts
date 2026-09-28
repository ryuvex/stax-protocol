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
    robinhoodMainnetFork: {
      type: "edr-simulated",
      chainType: "l1",
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
    robinhoodMainnet: {
      type: "http",
      chainType: "l1",
      url: "https://rpc.mainnet.chain.robinhood.com",
      accounts: [configVariable("ROBINHOOD_MAINNET_PRIVATE_KEY")],
    },
  },
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
      // Lets the local fork execute calls at any block (EDR needs a hardfork
      // history for non-standard chains; the chain has been cancun-compatible
      // since genesis for our purposes).
      hardforkHistory: { cancun: { blockNumber: 0 } },
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
