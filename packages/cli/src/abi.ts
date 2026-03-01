/**
 * @module @aporia/cli
 * ABI fragment for the AporiaRegistry contract (ethers.js human-readable format)
 */

export const REGISTRY_ABI = [
    // ─── Registration ──────────────────────────────────────────
    "function registerBot(string imageURI, bytes encryptedEnv, uint8 tier) payable returns (bytes32 botId)",

    // ─── Escrow ────────────────────────────────────────────────
    "function deposit(bytes32 botId) payable",
    "function withdraw(bytes32 botId, uint256 amount)",

    // ─── Restart ───────────────────────────────────────────────
    "function triggerRestart(bytes32 botId)",

    // ─── View Functions ────────────────────────────────────────
    "function getBotDetails(bytes32 botId) view returns (string imageURI, bytes32 envHash, uint8 tier, uint256 balance, uint256 lastRestart, bool isActive, address owner)",
    "function canMonitor(bytes32 botId) view returns (bool)",
    "function cooldownRemaining(bytes32 botId) view returns (uint256)",
    "function getAllBotIds() view returns (bytes32[])",
    "function getBotCount() view returns (uint256)",
    "function restartCost(uint8 tier) view returns (uint256)",
    "function bannedImages(string imageURI) view returns (bool)",

    // ─── Admin ─────────────────────────────────────────────────
    "function banImage(string imageURI)",
    "function unbanImage(string imageURI)",
    "function setRestartCost(uint8 tier, uint256 cost)",

    // ─── Events ────────────────────────────────────────────────
    "event BotRegistered(bytes32 indexed botId, address indexed owner, string imageURI, uint8 tier)",
    "event Deposited(bytes32 indexed botId, address indexed depositor, uint256 amount)",
    "event Withdrawn(bytes32 indexed botId, address indexed owner, uint256 amount)",
    "event RestartTriggered(bytes32 indexed botId, uint256 timestamp)",
];

/** Tier names matching the contract enum */
export const TIER_NAMES: Record<number, string> = {
    0: "NANO  (1 vCPU / 1 GB RAM)",
    1: "LOGIC (2 vCPU / 4 GB RAM)",
    2: "EXPERT (4 vCPU / 8 GB RAM)",
};
