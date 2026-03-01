import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import * as dotenv from "dotenv";

// Load .env from contracts package
dotenv.config();

const DEPLOYER_PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY || "";
const ALCHEMY_API_KEY = process.env.ALCHEMY_API_KEY || "";
const BASE_SEPOLIA_RPC_URL = process.env.BASE_SEPOLIA_RPC_URL ||
    (ALCHEMY_API_KEY ? `https://base-sepolia.g.alchemy.com/v2/${ALCHEMY_API_KEY}` : "https://sepolia.base.org");
const BASE_RPC_URL = process.env.BASE_RPC_URL ||
    (ALCHEMY_API_KEY ? `https://base-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}` : "https://mainnet.base.org");
const BASESCAN_API_KEY = process.env.BASESCAN_API_KEY || "";

const config: HardhatUserConfig = {
    solidity: {
        version: "0.8.24",
        settings: {
            optimizer: {
                enabled: true,
                runs: 200,
            },
        },
    },
    networks: {
        hardhat: {},
        // Base Sepolia Testnet
        baseSepolia: {
            url: BASE_SEPOLIA_RPC_URL,
            accounts: DEPLOYER_PRIVATE_KEY ? [DEPLOYER_PRIVATE_KEY] : [],
            chainId: 84532,
        },
        // Base L2 Mainnet (späteres Production Deployment)
        base: {
            url: BASE_RPC_URL,
            accounts: DEPLOYER_PRIVATE_KEY ? [DEPLOYER_PRIVATE_KEY] : [],
            chainId: 8453,
        },
    },
    etherscan: {
        apiKey: {
            baseSepolia: BASESCAN_API_KEY,
            base: BASESCAN_API_KEY,
        },
        customChains: [
            {
                network: "baseSepolia",
                chainId: 84532,
                urls: {
                    apiURL: "https://api.etherscan.io/v2/api?chainid=84532",
                    browserURL: "https://sepolia.basescan.org",
                },
            },
            {
                network: "base",
                chainId: 8453,
                urls: {
                    apiURL: "https://api.etherscan.io/v2/api?chainid=8453",
                    browserURL: "https://basescan.org",
                },
            },
        ],
    },
};

export default config;
