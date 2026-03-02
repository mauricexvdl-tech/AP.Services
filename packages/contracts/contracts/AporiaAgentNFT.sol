// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Strings.sol";
import "@openzeppelin/contracts/utils/Base64.sol";
import "./interfaces/IERC6551Registry.sol";

/**
 * @title AporiaAgentNFT
 * @notice Each registered agent is an ERC-721 NFT with a Token Bound Account.
 *
 * ## Architecture
 *
 * V1 AporiaRegistry used bytes32 bot IDs with a central escrow mapping.
 * V2 replaces this: each agent is an NFT whose TBA wallet acts as its
 * individual treasury. Transferring the NFT transfers the entire agent
 * identity — wallet, balance, and operational control.
 *
 * ## Minting Flow
 *
 * 1. User calls `registerAgent(imageURI, encryptedEnv, tier)`
 * 2. Contract mints an ERC-721 token to msg.sender
 * 3. Contract calls `ERC6551Registry.createAccount()` to deploy the TBA
 * 4. Any msg.value is forwarded to the TBA as the initial escrow deposit
 *
 * ## On-Chain Metadata
 *
 * tokenURI() returns a fully on-chain JSON (no IPFS dependency) containing
 * the agent's image URI, tier, TBA address, and active status.
 */
contract AporiaAgentNFT is ERC721Enumerable, Ownable, ReentrancyGuard {
    using Strings for uint256;

    // ─── Enums & Structs ─────────────────────────────────────────

    enum Tier { NANO, LOGIC, EXPERT }

    struct AgentMetadata {
        string imageURI;          // Docker image URI
        bytes encryptedEnv;       // Asymmetrically encrypted env blob
        bytes32 envHash;          // keccak256 of the encrypted blob
        Tier tier;                // Hardware class (NANO, LOGIC, EXPERT)
        uint256 lastRestart;      // Timestamp of last restart
        bool isActive;            // Whether monitoring is active
    }

    // ─── State ───────────────────────────────────────────────────

    /// @notice ERC-6551 registry for creating Token Bound Accounts
    IERC6551Registry public immutable registry;

    /// @notice Account implementation that TBAs delegate to
    address public immutable accountImplementation;

    /// @notice Agent metadata indexed by tokenId
    mapping(uint256 => AgentMetadata) public agents;

    /// @notice Restart cost per tier (in wei)
    mapping(Tier => uint256) public restartCost;

    /// @notice Banned Docker images (kill-switch)
    mapping(string => bool) public bannedImages;

    /// @notice Cooldown between restarts (prevents expensive infinite loops)
    uint256 public constant COOLDOWN_PERIOD = 6 hours;

    /// @notice Auto-incrementing token ID counter
    uint256 private _nextTokenId = 1;

    // ─── Events ──────────────────────────────────────────────────

    event AgentRegistered(
        uint256 indexed tokenId,
        address indexed owner,
        address tba,
        string imageURI,
        Tier tier
    );
    event RestartTriggered(uint256 indexed tokenId, uint256 timestamp, uint256 cost);
    event ImageBanned(string imageURI);
    event ImageUnbanned(string imageURI);
    event RestartCostUpdated(Tier tier, uint256 newCost);

    // ─── Errors ──────────────────────────────────────────────────

    error ImageIsBanned(string imageURI);
    error AgentNotActive(uint256 tokenId);
    error CooldownActive(uint256 tokenId, uint256 remainingSeconds);
    error InsufficientTBABalance(uint256 tokenId, uint256 required, uint256 available);

    // ─── Receive ─────────────────────────────────────────────────

    /// @notice Accept ETH from TBAs paying protocol fees
    receive() external payable {}

    // ─── Constructor ─────────────────────────────────────────────

    constructor(
        address _registry,
        address _accountImplementation
    ) ERC721("APORIA Agent", "AGENT") Ownable(msg.sender) {
        registry = IERC6551Registry(_registry);
        accountImplementation = _accountImplementation;

        // Default restart costs (~$2, ~$5, ~$10 at current ETH prices)
        restartCost[Tier.NANO]   = 0.001 ether;
        restartCost[Tier.LOGIC]  = 0.0025 ether;
        restartCost[Tier.EXPERT] = 0.005 ether;
    }

    // ─── Registration ────────────────────────────────────────────

    /**
     * @notice Register a new agent: mints an NFT, deploys a TBA, and
     *         forwards any ETH deposit to the agent's treasury.
     * @param imageURI Docker image URI for the agent
     * @param encryptedEnv Encrypted environment variables blob
     * @param tier Hardware tier (NANO, LOGIC, EXPERT)
     * @return tokenId The minted NFT token ID
     * @return tba The deployed Token Bound Account address
     */
    function registerAgent(
        string calldata imageURI,
        bytes calldata encryptedEnv,
        Tier tier
    ) external payable nonReentrant returns (uint256 tokenId, address tba) {
        if (bannedImages[imageURI]) revert ImageIsBanned(imageURI);

        tokenId = _nextTokenId++;
        _safeMint(msg.sender, tokenId);

        // Store agent metadata on-chain
        agents[tokenId] = AgentMetadata({
            imageURI: imageURI,
            encryptedEnv: encryptedEnv,
            envHash: keccak256(encryptedEnv),
            tier: tier,
            lastRestart: 0,
            isActive: true
        });

        // Deploy the agent's Token Bound Account via the ERC-6551 registry.
        // The salt is fixed (bytes32(0)) because each (contract, tokenId) pair
        // is already unique — no need for additional entropy.
        tba = registry.createAccount(
            accountImplementation,
            bytes32(0),
            block.chainid,
            address(this),
            tokenId
        );

        // Forward initial deposit to the TBA treasury
        if (msg.value > 0) {
            (bool success, ) = payable(tba).call{value: msg.value}("");
            require(success, "ETH transfer to TBA failed");
        }

        emit AgentRegistered(tokenId, msg.sender, tba, imageURI, tier);
    }

    // ─── Restart Logic ───────────────────────────────────────────

    /**
     * @notice Trigger a restart for an agent. Called by the watchdog operator.
     *
     * In V2, restart costs are deducted from the agent's TBA wallet
     * rather than a central escrow mapping. The watchdog calls this
     * function, which pulls ETH from the TBA via execute().
     *
     * @dev onlyOwner in MVP. Later: allowlist of approved watchdog addresses.
     */
    function triggerRestart(uint256 tokenId) external onlyOwner nonReentrant {
        AgentMetadata storage agent = agents[tokenId];
        require(_ownerOf(tokenId) != address(0), "Agent does not exist");
        if (!agent.isActive) revert AgentNotActive(tokenId);

        // Cooldown check: prevent expensive infinite restart loops
        if (agent.lastRestart != 0) {
            uint256 elapsed = block.timestamp - agent.lastRestart;
            if (elapsed < COOLDOWN_PERIOD) {
                revert CooldownActive(tokenId, COOLDOWN_PERIOD - elapsed);
            }
        }

        uint256 cost = restartCost[agent.tier];
        address tba = getTBA(tokenId);
        uint256 tbaBalance = tba.balance;

        if (tbaBalance < cost) {
            revert InsufficientTBABalance(tokenId, cost, tbaBalance);
        }

        agent.lastRestart = block.timestamp;

        // Pull restart cost from TBA
        (bool success, ) = tba.call(abi.encodeWithSignature("payProtocolFee(uint256)", cost));
        require(success, "Failed to pull protocol fee from TBA");

        // Deactivate if TBA balance drops below 2x restart cost
        if (tbaBalance - cost < 2 * cost) {
            agent.isActive = false;
        }

        emit RestartTriggered(tokenId, block.timestamp, cost);
    }

    // ─── View Functions ──────────────────────────────────────────

    /**
     * @notice Compute the TBA address for an agent without querying storage.
     * @dev Deterministic: same result as ERC6551Registry.account()
     */
    function getTBA(uint256 tokenId) public view returns (address) {
        return registry.account(
            accountImplementation,
            bytes32(0),
            block.chainid,
            address(this),
            tokenId
        );
    }

    /**
     * @notice Check if an agent can be monitored (active + sufficient balance).
     */
    function canMonitor(uint256 tokenId) external view returns (bool) {
        AgentMetadata storage agent = agents[tokenId];
        if (!agent.isActive) return false;
        address tba = getTBA(tokenId);
        return tba.balance >= 2 * restartCost[agent.tier];
    }

    /**
     * @notice Get remaining cooldown time for an agent.
     * @return remaining Seconds until cooldown ends (0 if ready)
     */
    function cooldownRemaining(uint256 tokenId) external view returns (uint256) {
        AgentMetadata storage agent = agents[tokenId];
        if (agent.lastRestart == 0) return 0;
        uint256 elapsed = block.timestamp - agent.lastRestart;
        if (elapsed >= COOLDOWN_PERIOD) return 0;
        return COOLDOWN_PERIOD - elapsed;
    }

    /**
     * @notice Fully on-chain tokenURI — no IPFS dependency.
     */
    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        require(_ownerOf(tokenId) != address(0), "Token does not exist");

        AgentMetadata storage agent = agents[tokenId];
        string memory tierName = agent.tier == Tier.NANO ? "NANO" :
                                  agent.tier == Tier.LOGIC ? "LOGIC" : "EXPERT";
        address tba = getTBA(tokenId);

        string memory json = string(abi.encodePacked(
            '{"name":"APORIA Agent #', tokenId.toString(),
            '","description":"Sovereign AI agent with Token Bound Account",',
            '"attributes":[',
                '{"trait_type":"Tier","value":"', tierName, '"},',
                '{"trait_type":"TBA","value":"', Strings.toHexString(uint160(tba), 20), '"},',
                '{"trait_type":"Active","value":"', agent.isActive ? "true" : "false", '"},',
                '{"trait_type":"Image","value":"', agent.imageURI, '"}',
            ']}'
        ));

        return string(abi.encodePacked(
            "data:application/json;base64,",
            Base64.encode(bytes(json))
        ));
    }

    // ─── Admin Functions ─────────────────────────────────────────

    function banImage(string calldata imageURI) external onlyOwner {
        bannedImages[imageURI] = true;
        emit ImageBanned(imageURI);
    }

    function unbanImage(string calldata imageURI) external onlyOwner {
        bannedImages[imageURI] = false;
        emit ImageUnbanned(imageURI);
    }

    function setRestartCost(Tier tier, uint256 cost) external onlyOwner {
        restartCost[tier] = cost;
        emit RestartCostUpdated(tier, cost);
    }

    function setAgentActive(uint256 tokenId, bool active) external {
        require(ownerOf(tokenId) == msg.sender, "Not agent owner");
        agents[tokenId].isActive = active;
    }
}
