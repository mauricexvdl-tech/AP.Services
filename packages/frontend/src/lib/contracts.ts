export const APORIA_AGENT_NFT_ADDRESS = "0x"; // We will inject this after a deployment
export const APORIA_ACCOUNT_IMPLEMENTATION = "0x"; // Will inject
export const ERC6551_REGISTRY = "0x000000006551c19487814612e58FE06813775758"; // Standard Base Sepolia Address

export const APORIA_AGENT_NFT_ABI = [
    {
        "inputs": [
            { "internalType": "string", "name": "imageURI", "type": "string" },
            { "internalType": "bytes", "name": "encryptedEnv", "type": "bytes" },
            { "internalType": "enum AporiaAgentNFT.Tier", "name": "tier", "type": "uint8" }
        ],
        "name": "registerAgent",
        "outputs": [
            { "internalType": "uint256", "name": "tokenId", "type": "uint256" },
            { "internalType": "address", "name": "tba", "type": "address" }
        ],
        "stateMutability": "payable",
        "type": "function"
    },
    {
        "anonymous": false,
        "inputs": [
            { "indexed": true, "internalType": "uint256", "name": "tokenId", "type": "uint256" },
            { "indexed": true, "internalType": "address", "name": "owner", "type": "address" },
            { "indexed": false, "internalType": "address", "name": "tba", "type": "address" },
            { "indexed": false, "internalType": "string", "name": "imageURI", "type": "string" },
            { "indexed": false, "internalType": "enum AporiaAgentNFT.Tier", "name": "tier", "type": "uint8" }
        ],
        "name": "AgentRegistered",
        "type": "event"
    }
] as const;
