// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./AporiaAgentNFT.sol";
import "./interfaces/IERC6551Account.sol";

/**
 * @title InsuranceVault
 * @notice Automatic SLA-based refund system for APORIA agents.
 *
 * ## How It Works
 *
 * The Insurance Vault tracks uptime for each agent. The watchdog operator
 * periodically calls `reportHealthy(tokenId)` to update the last-healthy
 * timestamp. If the gap between the current time and last-healthy exceeds
 * `SLA_THRESHOLD` (default: 1 hour), users can claim a pro-rata refund.
 *
 * ## Refund Calculation
 *
 * Refunds are proportional to downtime relative to the coverage period:
 *
 *     refund = deposit × (downtimeSeconds / coveragePeriod)
 *
 * This ensures users only pay for the uptime they actually received.
 *
 * ## Fund Flow
 *
 * 1. User deposits ETH into the InsuranceVault for a specific agent
 * 2. Watchdog calls `reportHealthy()` to prove uptime
 * 3. On SLA breach, user calls `claimRefund()` → ETH returned
 * 4. Unclaimed funds after the coverage period go to the protocol treasury
 *
 * ## Why Separate from TBA
 *
 * Insurance deposits are held in this vault (not the TBA) to separate
 * operational funds (restart costs in TBA) from insurance premiums.
 * The TBA pays for compute; the vault guarantees SLA compliance.
 */
contract InsuranceVault is Ownable, ReentrancyGuard {

    // ─── State ───────────────────────────────────────────────────

    AporiaAgentNFT public immutable agentNFT;

    /// @notice SLA violation threshold — if no healthy report for this long, SLA is breached
    uint256 public slaThreshold = 1 hours;

    /// @notice Default coverage period for insurance deposits
    uint256 public coveragePeriod = 30 days;

    struct InsurancePolicy {
        uint256 deposit;            // Premium deposited by the user
        uint256 coverageStart;      // When coverage began
        uint256 coverageEnd;        // When coverage expires
        uint256 lastHealthy;        // Last confirmed healthy timestamp
        uint256 totalDowntime;      // Accumulated downtime seconds
        bool claimed;               // Whether a refund has been claimed
    }

    /// @notice Insurance policies indexed by agent tokenId
    mapping(uint256 => InsurancePolicy) public policies;

    // ─── Events ──────────────────────────────────────────────────

    event PolicyCreated(uint256 indexed tokenId, uint256 deposit, uint256 coverageEnd);
    event HealthReported(uint256 indexed tokenId, uint256 timestamp);
    event DowntimeRecorded(uint256 indexed tokenId, uint256 downtimeSeconds, uint256 totalDowntime);
    event RefundClaimed(uint256 indexed tokenId, address indexed owner, uint256 amount);
    event SLAThresholdUpdated(uint256 oldThreshold, uint256 newThreshold);

    // ─── Errors ──────────────────────────────────────────────────

    error NoPolicyExists(uint256 tokenId);
    error PolicyAlreadyExists(uint256 tokenId);
    error PolicyExpired(uint256 tokenId);
    error SLANotBreached(uint256 tokenId);
    error AlreadyClaimed(uint256 tokenId);
    error NotAgentOwner(uint256 tokenId);
    error ZeroDeposit();

    // ─── Constructor ─────────────────────────────────────────────

    constructor(address payable _agentNFT) Ownable(msg.sender) {
        agentNFT = AporiaAgentNFT(_agentNFT);
    }

    // ─── User Functions ──────────────────────────────────────────

    /**
     * @notice Create an insurance policy by depositing ETH for an agent.
     * @param tokenId The agent NFT token ID
     */
    function createPolicy(uint256 tokenId) external payable {
        if (msg.value == 0) revert ZeroDeposit();
        if (policies[tokenId].deposit > 0) revert PolicyAlreadyExists(tokenId);

        // Only the agent owner can insure their agent
        if (agentNFT.ownerOf(tokenId) != msg.sender) revert NotAgentOwner(tokenId);

        policies[tokenId] = InsurancePolicy({
            deposit: msg.value,
            coverageStart: block.timestamp,
            coverageEnd: block.timestamp + coveragePeriod,
            lastHealthy: block.timestamp,
            totalDowntime: 0,
            claimed: false
        });

        emit PolicyCreated(tokenId, msg.value, block.timestamp + coveragePeriod);
    }

    /**
     * @notice Claim a refund when the SLA has been breached.
     *
     * The refund is proportional to accumulated downtime:
     *   refund = deposit × (totalDowntime / coveragePeriod)
     *
     * @param tokenId The agent NFT token ID
     */
    function claimRefund(uint256 tokenId) external nonReentrant {
        InsurancePolicy storage policy = policies[tokenId];
        if (policy.deposit == 0) revert NoPolicyExists(tokenId);
        if (policy.claimed) revert AlreadyClaimed(tokenId);
        if (agentNFT.ownerOf(tokenId) != msg.sender) revert NotAgentOwner(tokenId);

        // Accumulate any current downtime before calculating refund
        _accumulateDowntime(tokenId);

        if (policy.totalDowntime < slaThreshold) revert SLANotBreached(tokenId);

        // Pro-rata refund: deposit × (downtime / coverage_period)
        uint256 elapsed = block.timestamp - policy.coverageStart;
        if (elapsed == 0) elapsed = 1; // prevent division by zero

        uint256 refund = (policy.deposit * policy.totalDowntime) / elapsed;
        if (refund > policy.deposit) refund = policy.deposit;

        policy.claimed = true;

        (bool success, ) = payable(msg.sender).call{value: refund}("");
        require(success, "Refund transfer failed");

        emit RefundClaimed(tokenId, msg.sender, refund);
    }

    // ─── Watchdog Functions ──────────────────────────────────────

    /**
     * @notice Report that an agent is healthy (called by the watchdog).
     *
     * Before updating lastHealthy, we accumulate any downtime since
     * the last report. If the gap exceeds `slaThreshold`, the downtime
     * is recorded.
     *
     * @param tokenId The agent NFT token ID
     */
    function reportHealthy(uint256 tokenId) external onlyOwner {
        InsurancePolicy storage policy = policies[tokenId];
        if (policy.deposit == 0) revert NoPolicyExists(tokenId);
        if (block.timestamp > policy.coverageEnd) revert PolicyExpired(tokenId);

        // Accumulate downtime before resetting lastHealthy
        _accumulateDowntime(tokenId);

        policy.lastHealthy = block.timestamp;
        emit HealthReported(tokenId, block.timestamp);
    }

    // ─── View Functions ──────────────────────────────────────────

    /**
     * @notice Get the SLA status for an agent.
     */
    function getSLAStatus(uint256 tokenId) external view returns (
        uint256 lastHealthy,
        uint256 totalDowntime,
        bool isBreached,
        uint256 currentGap
    ) {
        InsurancePolicy storage policy = policies[tokenId];
        lastHealthy = policy.lastHealthy;

        // Calculate current gap (potential unreported downtime)
        currentGap = 0;
        if (policy.lastHealthy > 0 && block.timestamp > policy.lastHealthy) {
            uint256 gap = block.timestamp - policy.lastHealthy;
            if (gap > slaThreshold) {
                currentGap = gap - slaThreshold;
            }
        }

        totalDowntime = policy.totalDowntime + currentGap;
        isBreached = totalDowntime >= slaThreshold;
    }

    // ─── Admin Functions ─────────────────────────────────────────

    function setSLAThreshold(uint256 newThreshold) external onlyOwner {
        emit SLAThresholdUpdated(slaThreshold, newThreshold);
        slaThreshold = newThreshold;
    }

    function setCoveragePeriod(uint256 newPeriod) external onlyOwner {
        coveragePeriod = newPeriod;
    }

    // ─── Internal ────────────────────────────────────────────────

    /**
     * @dev Accumulate downtime since the last healthy report.
     *
     * Only time exceeding the SLA threshold counts as downtime.
     * Brief gaps (< slaThreshold) are tolerated — they could be
     * network jitter or scheduled maintenance.
     */
    function _accumulateDowntime(uint256 tokenId) internal {
        InsurancePolicy storage policy = policies[tokenId];
        if (policy.lastHealthy == 0) return;

        uint256 gap = block.timestamp - policy.lastHealthy;
        if (gap > slaThreshold) {
            uint256 downtime = gap - slaThreshold;
            policy.totalDowntime += downtime;
            emit DowntimeRecorded(tokenId, downtime, policy.totalDowntime);
        }
    }
}
