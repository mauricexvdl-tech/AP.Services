// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title AporiaRegistry
 * @notice Dezentrales Resurrection-Protokoll: Registry & Escrow für Bot-Monitoring
 * @dev Deployed on Base L2. Manages bot registrations, escrow balances,
 *      cooldown logic, and admin kill-switch functionality.
 */
contract AporiaRegistry is Ownable, ReentrancyGuard {

    // ─── Enums ───────────────────────────────────────────────────
    enum Tier { NANO, LOGIC, EXPERT }

    // ─── Structs ─────────────────────────────────────────────────
    struct BotRecord {
        string imageURI;        // Docker image URI
        bytes encryptedEnv;     // Asymmetrisch verschlüsseltes env-blob
        bytes32 envHash;        // keccak256 des verschlüsselten Blobs
        Tier tier;              // Hardware-Klasse
        uint256 balance;        // Escrow-Guthaben in Wei
        uint256 lastRestart;    // Timestamp des letzten Restarts
        bool isActive;          // Monitoring aktiv?
        address owner;          // Bot-Besitzer
    }

    // ─── State ───────────────────────────────────────────────────
    mapping(bytes32 => BotRecord) public bots;          // botId => BotRecord
    mapping(string => bool) public bannedImages;         // imageURI => banned?
    mapping(Tier => uint256) public restartCost;          // Tier => Kosten pro Restart

    bytes32[] public botIds;   // Alle registrierten Bot-IDs

    uint256 public constant COOLDOWN_PERIOD = 6 hours;
    uint256 public constant MAX_IMAGE_SIZE = 2 * 1024 * 1024 * 1024; // 2 GB (informational)

    // ─── Events ──────────────────────────────────────────────────
    event BotRegistered(bytes32 indexed botId, address indexed owner, string imageURI, Tier tier);
    event Deposited(bytes32 indexed botId, address indexed depositor, uint256 amount);
    event Withdrawn(bytes32 indexed botId, address indexed owner, uint256 amount);
    event RestartTriggered(bytes32 indexed botId, uint256 timestamp);
    event ImageBanned(string imageURI);
    event ImageUnbanned(string imageURI);
    event BotDeactivated(bytes32 indexed botId);
    event RestartCostUpdated(Tier tier, uint256 newCost);

    // ─── Errors ──────────────────────────────────────────────────
    error BotAlreadyExists(bytes32 botId);
    error BotNotFound(bytes32 botId);
    error NotBotOwner(bytes32 botId, address caller);
    error ImageIsBanned(string imageURI);
    error InsufficientBalance(bytes32 botId, uint256 required, uint256 available);
    error CooldownActive(bytes32 botId, uint256 remainingSeconds);
    error BotNotActive(bytes32 botId);
    error InsufficientBalanceForMonitoring(bytes32 botId, uint256 required);
    error ZeroDeposit();

    // ─── Constructor ─────────────────────────────────────────────
    constructor() Ownable(msg.sender) {
        // Default restart costs (in Wei)
        // Ungefähre Werte: NANO ~$2, LOGIC ~$5, EXPERT ~$10 in ETH
        restartCost[Tier.NANO]   = 0.001 ether;
        restartCost[Tier.LOGIC]  = 0.0025 ether;
        restartCost[Tier.EXPERT] = 0.005 ether;
    }

    // ─── Modifiers ───────────────────────────────────────────────
    modifier botExists(bytes32 botId) {
        if (bots[botId].owner == address(0)) revert BotNotFound(botId);
        _;
    }

    modifier onlyBotOwner(bytes32 botId) {
        if (bots[botId].owner != msg.sender) revert NotBotOwner(botId, msg.sender);
        _;
    }

    // ─── Registration ────────────────────────────────────────────

    /**
     * @notice Registriert einen neuen Bot im Protokoll
     * @param imageURI Docker Image URI
     * @param encryptedEnv Verschlüsseltes Environment-Blob
     * @param tier Hardware-Tier (NANO, LOGIC, EXPERT)
     * @return botId Eindeutige Bot-ID
     */
    function registerBot(
        string calldata imageURI,
        bytes calldata encryptedEnv,
        Tier tier
    ) external payable returns (bytes32 botId) {
        if (bannedImages[imageURI]) revert ImageIsBanned(imageURI);

        botId = keccak256(abi.encodePacked(msg.sender, imageURI, block.timestamp));

        if (bots[botId].owner != address(0)) revert BotAlreadyExists(botId);

        bots[botId] = BotRecord({
            imageURI: imageURI,
            encryptedEnv: encryptedEnv,
            envHash: keccak256(encryptedEnv),
            tier: tier,
            balance: msg.value,
            lastRestart: 0,
            isActive: msg.value >= 2 * restartCost[tier],
            owner: msg.sender
        });

        botIds.push(botId);

        emit BotRegistered(botId, msg.sender, imageURI, tier);
        if (msg.value > 0) {
            emit Deposited(botId, msg.sender, msg.value);
        }
    }

    // ─── Escrow ──────────────────────────────────────────────────

    /**
     * @notice Guthaben für einen Bot einzahlen
     * @param botId Die Bot-ID
     */
    function deposit(bytes32 botId) external payable botExists(botId) {
        if (msg.value == 0) revert ZeroDeposit();

        BotRecord storage bot = bots[botId];
        bot.balance += msg.value;

        // Aktiviere Monitoring wenn genug Balance
        if (!bot.isActive && bot.balance >= 2 * restartCost[bot.tier]) {
            bot.isActive = true;
        }

        emit Deposited(botId, msg.sender, msg.value);
    }

    /**
     * @notice Guthaben aus dem Escrow abheben (nur Bot-Owner)
     * @param botId Die Bot-ID
     * @param amount Betrag zum Abheben
     */
    function withdraw(bytes32 botId, uint256 amount)
        external
        botExists(botId)
        onlyBotOwner(botId)
        nonReentrant
    {
        BotRecord storage bot = bots[botId];
        if (bot.balance < amount) {
            revert InsufficientBalance(botId, amount, bot.balance);
        }

        bot.balance -= amount;

        // Deaktiviere Monitoring wenn Balance zu niedrig
        if (bot.balance < 2 * restartCost[bot.tier]) {
            bot.isActive = false;
        }

        (bool success, ) = payable(msg.sender).call{value: amount}("");
        require(success, "Transfer failed");

        emit Withdrawn(botId, msg.sender, amount);
    }

    // ─── Restart Logic ───────────────────────────────────────────

    /**
     * @notice Triggert einen Restart für einen Bot (nur vom Watchdog aufrufbar)
     * @dev Im MVP: onlyOwner. Später: Watchdog-Whitelist
     * @param botId Die Bot-ID
     */
    function triggerRestart(bytes32 botId)
        external
        onlyOwner
        botExists(botId)
        nonReentrant
    {
        BotRecord storage bot = bots[botId];

        if (!bot.isActive) revert BotNotActive(botId);

        // Cooldown-Check
        if (bot.lastRestart != 0) {
            uint256 elapsed = block.timestamp - bot.lastRestart;
            if (elapsed < COOLDOWN_PERIOD) {
                revert CooldownActive(botId, COOLDOWN_PERIOD - elapsed);
            }
        }

        uint256 cost = restartCost[bot.tier];
        if (bot.balance < cost) {
            revert InsufficientBalance(botId, cost, bot.balance);
        }

        // Kosten abziehen
        bot.balance -= cost;
        bot.lastRestart = block.timestamp;

        // Monitoring deaktivieren wenn Balance zu niedrig
        if (bot.balance < 2 * restartCost[bot.tier]) {
            bot.isActive = false;
        }

        emit RestartTriggered(botId, block.timestamp);
    }

    // ─── Admin Functions ─────────────────────────────────────────

    /**
     * @notice Bannt ein Docker Image (Kill-Switch)
     * @param imageURI Das zu bannende Image
     */
    function banImage(string calldata imageURI) external onlyOwner {
        bannedImages[imageURI] = true;
        emit ImageBanned(imageURI);
    }

    /**
     * @notice Entbannt ein Docker Image
     * @param imageURI Das zu entbannende Image
     */
    function unbanImage(string calldata imageURI) external onlyOwner {
        bannedImages[imageURI] = false;
        emit ImageUnbanned(imageURI);
    }

    /**
     * @notice Aktualisiert die Restart-Kosten für einen Tier
     * @param tier Der Tier
     * @param cost Die neuen Kosten in Wei
     */
    function setRestartCost(Tier tier, uint256 cost) external onlyOwner {
        restartCost[tier] = cost;
        emit RestartCostUpdated(tier, cost);
    }

    // ─── View Functions ──────────────────────────────────────────

    /**
     * @notice Prüft ob Monitoring für einen Bot aktiv sein kann
     * @param botId Die Bot-ID
     * @return canMonitor true wenn Balance >= 2x Restart-Kosten
     */
    function canMonitor(bytes32 botId) external view botExists(botId) returns (bool canMonitor) {
        BotRecord storage bot = bots[botId];
        return bot.isActive && bot.balance >= 2 * restartCost[bot.tier];
    }

    /**
     * @notice Gibt die Cooldown-Restzeit zurück
     * @param botId Die Bot-ID
     * @return remaining Sekunden bis Cooldown endet (0 wenn bereit)
     */
    function cooldownRemaining(bytes32 botId) external view botExists(botId) returns (uint256 remaining) {
        BotRecord storage bot = bots[botId];
        if (bot.lastRestart == 0) return 0;

        uint256 elapsed = block.timestamp - bot.lastRestart;
        if (elapsed >= COOLDOWN_PERIOD) return 0;
        return COOLDOWN_PERIOD - elapsed;
    }

    /**
     * @notice Gibt alle registrierten Bot-IDs zurück
     * @return Die Bot-ID-Liste
     */
    function getAllBotIds() external view returns (bytes32[] memory) {
        return botIds;
    }

    /**
     * @notice Gibt die Gesamtanzahl registrierter Bots zurück
     */
    function getBotCount() external view returns (uint256) {
        return botIds.length;
    }

    /**
     * @notice Gibt Details eines Bots zurück
     * @param botId Die Bot-ID
     */
    function getBotDetails(bytes32 botId)
        external
        view
        botExists(botId)
        returns (
            string memory imageURI,
            bytes32 envHash,
            Tier tier,
            uint256 balance,
            uint256 lastRestart,
            bool isActive,
            address owner
        )
    {
        BotRecord storage bot = bots[botId];
        return (
            bot.imageURI,
            bot.envHash,
            bot.tier,
            bot.balance,
            bot.lastRestart,
            bot.isActive,
            bot.owner
        );
    }
}
