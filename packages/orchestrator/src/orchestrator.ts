/**
 * @module @aporia/orchestrator
 * ResurrectionOrchestrator – The 7-phase autonomous resurrection pipeline
 *
 * Phase 1: TRIGGER  – HeartbeatMonitor fires RestartEvent
 * Phase 2: VERIFY   – On-chain balance + cooldown check
 * Phase 3: FETCH    – Pull imageURI, tier, encryptedEnv from chain
 * Phase 4: DECRYPT  – Decrypt env vars in RAM via @aporia/secrets
 * Phase 5: BUILD    – Generate deployment config
 * Phase 6: DEPLOY   – Execute via DeploymentBackend (Docker/Akash)
 * Phase 7: SETTLE   – triggerRestart() on-chain, deduct escrow
 */

import { ethers } from "ethers";
import { decryptEnv, bytesToEnvelope, type EncryptedEnvelope } from "@aporia/secrets";
import { Tier } from "@aporia/deployer";
import type { RestartEvent } from "@aporia/heartbeat";
import { DeploymentBackend, type DeployRequest, type DeployResponse } from "./backends";

// ─── ABI for contract interaction ────────────────────────────────

const REGISTRY_ABI = [
  "function getBotDetails(bytes32 botId) view returns (string imageURI, bytes32 envHash, uint8 tier, uint256 balance, uint256 lastRestart, bool isActive, address owner)",
  "function canMonitor(bytes32 botId) view returns (bool)",
  "function cooldownRemaining(bytes32 botId) view returns (uint256)",
  "function restartCost(uint8 tier) view returns (uint256)",
  "function triggerRestart(bytes32 botId)",
  // Direct access to bots mapping for encrypted env bytes
  "function bots(bytes32 botId) view returns (string imageURI, bytes encryptedEnv, bytes32 envHash, uint8 tier, uint256 balance, uint256 lastRestart, bool isActive, address owner)",
];

// ─── Types ───────────────────────────────────────────────────────

/** Phase in the resurrection pipeline */
export type ResurrectionPhase =
  | "trigger"
  | "verify"
  | "fetch"
  | "decrypt"
  | "build"
  | "deploy"
  | "settle";

/** Result of a resurrection attempt */
export interface ResurrectionResult {
  /** Whether the resurrection completed successfully */
  success: boolean;
  /** Bot ID */
  botId: string;
  /** Phase where the process stopped (or "settle" if complete) */
  phase: ResurrectionPhase;
  /** Container/deployment ID if deployed */
  deploymentId?: string;
  /** URL of the resurrected bot */
  url?: string;
  /** On-chain transaction hash for triggerRestart */
  txHash?: string;
  /** Error message if failed */
  error?: string;
  /** Total duration in milliseconds */
  durationMs: number;
}

/** Configuration for the orchestrator */
export interface OrchestratorConfig {
  /** ethers.js provider for reading chain state */
  provider: ethers.Provider;
  /** Wallet (signer) for sending triggerRestart transactions */
  signer: ethers.Signer;
  /** AporiaRegistry contract address */
  contractAddress: string;
  /** Deployer secret key for decrypting env vars (Uint8Array) */
  deployerSecretKey: Uint8Array;
  /** Deployment backend (Docker, Akash, etc.) */
  backend: DeploymentBackend;
  /** Default ports to expose (default: [3000]) */
  defaultPorts?: number[];
}

// ─── Orchestrator ────────────────────────────────────────────────

/**
 * ResurrectionOrchestrator – Autonomous bot resurrection pipeline
 *
 * Connects the HeartbeatMonitor trigger to on-chain verification,
 * secret decryption, container deployment, and state settlement
 * into one atomic pipeline.
 *
 * Usage:
 *   const orchestrator = new ResurrectionOrchestrator(config);
 *   // Use as RestartHandler for HeartbeatMonitor:
 *   const monitor = new HeartbeatMonitor(healthConfig, (event) => orchestrator.handleRestart(event));
 */
export class ResurrectionOrchestrator {
  private registry: ethers.Contract;
  private config: OrchestratorConfig;
  private activeResurrections: Set<string> = new Set();
  private stats = { total: 0, success: 0, failed: 0 };

  constructor(config: OrchestratorConfig) {
    this.config = config;
    this.registry = new ethers.Contract(config.contractAddress, REGISTRY_ABI, config.signer);
  }

  /**
   * Handle a restart event from the HeartbeatMonitor
   * This is the main entry point — implements the full 7-phase pipeline
   */
  async handleRestart(event: RestartEvent): Promise<ResurrectionResult> {
    const startTime = Date.now();
    const { botId } = event;

    console.log(`\n[Orchestrator] ⚡ RESURRECTION INITIATED for ${botId}`);
    console.log(`[Orchestrator]    Reason: ${event.reason}`);
    console.log(`[Orchestrator]    Image:  ${event.imageURI}`);

    // Prevent concurrent resurrections for the same bot
    if (this.activeResurrections.has(botId)) {
      return this.result(
        botId,
        "trigger",
        false,
        startTime,
        "Resurrection already in progress for this bot",
      );
    }

    this.activeResurrections.add(botId);
    this.stats.total++;

    try {
      // ─── Phase 2: VERIFY (on-chain balance + cooldown) ────
      console.log(`[Orchestrator] 🔍 Phase 2/7: VERIFY – Checking on-chain state...`);

      const verifyResult = await this.verifyOnChain(botId);
      if (!verifyResult.ok) {
        return this.result(botId, "verify", false, startTime, verifyResult.error);
      }

      // ─── Phase 3: FETCH (pull bot data from chain) ────────
      console.log(`[Orchestrator] 📥 Phase 3/7: FETCH – Pulling bot data from chain...`);

      const botData = await this.fetchBotData(botId);
      if (!botData) {
        return this.result(botId, "fetch", false, startTime, "Failed to fetch bot data from chain");
      }

      console.log(`[Orchestrator]    Image: ${botData.imageURI}`);
      console.log(`[Orchestrator]    Tier:  ${Tier[botData.tier]}`);
      console.log(`[Orchestrator]    Encrypted env: ${botData.encryptedEnv.length} bytes`);

      // ─── Phase 4: DECRYPT (unlock env vars in RAM) ────────
      console.log(`[Orchestrator] 🔓 Phase 4/7: DECRYPT – Decrypting environment variables...`);

      let envVars: Record<string, string>;
      try {
        envVars = this.decryptSecrets(botData.encryptedEnv);
        console.log(
          `[Orchestrator]    ✅ Decrypted ${Object.keys(envVars).length} env vars (in RAM)`,
        );
      } catch (error: any) {
        return this.result(
          botId,
          "decrypt",
          false,
          startTime,
          `Decryption failed: ${error.message}`,
        );
      }

      // ─── Phase 5: BUILD (generate deployment config) ──────
      console.log(`[Orchestrator] 🔧 Phase 5/7: BUILD – Generating deployment config...`);

      const deployRequest: DeployRequest = {
        botId,
        imageURI: botData.imageURI,
        tier: botData.tier,
        envVars,
        ports: this.config.defaultPorts || [3000],
      };

      // ─── Phase 6: DEPLOY (execute via backend) ────────────
      console.log(
        `[Orchestrator] 🚀 Phase 6/7: DEPLOY – Deploying via ${this.config.backend.name}...`,
      );

      const deployResult = await this.config.backend.deploy(deployRequest);

      // Wipe env vars from RAM immediately after deployment
      for (const key of Object.keys(envVars)) {
        envVars[key] = "";
      }
      envVars = {};

      if (!deployResult.success) {
        return this.result(
          botId,
          "deploy",
          false,
          startTime,
          `Deployment failed: ${deployResult.error}`,
        );
      }

      console.log(`[Orchestrator]    ✅ Deployed: ${deployResult.deploymentId}`);
      console.log(`[Orchestrator]    URL: ${deployResult.url}`);

      // ─── Phase 7: SETTLE (triggerRestart on-chain) ────────
      console.log(`[Orchestrator] ⛓️  Phase 7/7: SETTLE – Sending triggerRestart transaction...`);

      let txHash: string;
      try {
        const tx = await this.registry.triggerRestart(botId);
        console.log(`[Orchestrator]    Tx sent: ${tx.hash}`);
        const receipt = await tx.wait();
        txHash = receipt.hash;
        console.log(`[Orchestrator]    ✅ Confirmed in block ${receipt.blockNumber}`);
      } catch (error: any) {
        // Deploy succeeded but settlement failed — log but still report partial success
        console.error(`[Orchestrator]    ⚠️  Settlement failed: ${error.message}`);
        console.error(
          `[Orchestrator]       Container ${deployResult.deploymentId} is running but not settled on-chain`,
        );
        return this.result(
          botId,
          "settle",
          false,
          startTime,
          `Settlement failed (container running): ${error.message}`,
          deployResult.deploymentId,
          deployResult.url,
        );
      }

      // ─── SUCCESS ──────────────────────────────────────────
      this.stats.success++;
      const duration = Date.now() - startTime;

      console.log(`\n[Orchestrator] 🎉 RESURRECTION COMPLETE for ${botId}`);
      console.log(`[Orchestrator]    Duration: ${duration}ms`);
      console.log(`[Orchestrator]    Deployment: ${deployResult.deploymentId}`);
      console.log(`[Orchestrator]    Tx: ${txHash}`);
      console.log(
        `[Orchestrator]    Stats: ${this.stats.success}/${this.stats.total} successful\n`,
      );

      return {
        success: true,
        botId,
        phase: "settle",
        deploymentId: deployResult.deploymentId,
        url: deployResult.url,
        txHash,
        durationMs: duration,
      };
    } finally {
      this.activeResurrections.delete(botId);
    }
  }

  // ─── Phase 2: On-chain verification ──────────────────────────

  private async verifyOnChain(botId: string): Promise<{ ok: boolean; error?: string }> {
    try {
      // Check if bot can be monitored (balance >= 2x restart cost + is active)
      const canMonitor = await this.registry.canMonitor(botId);
      if (!canMonitor) {
        return { ok: false, error: "Bot cannot be monitored (insufficient balance or inactive)" };
      }

      // Check cooldown
      const cooldown: bigint = await this.registry.cooldownRemaining(botId);
      if (cooldown > 0n) {
        const remainingSecs = Number(cooldown);
        const remainingMins = Math.ceil(remainingSecs / 60);
        return {
          ok: false,
          error: `Cooldown active: ${remainingMins} minutes remaining (${remainingSecs}s)`,
        };
      }

      // Check balance vs restart cost
      const details = await this.registry.getBotDetails(botId);
      const tier = Number(details.tier);
      const balance: bigint = details.balance;
      const cost: bigint = await this.registry.restartCost(tier);

      if (balance < cost) {
        return {
          ok: false,
          error: `Insufficient balance: ${ethers.formatEther(balance)} ETH < ${ethers.formatEther(cost)} ETH (restart cost)`,
        };
      }

      console.log(
        `[Orchestrator]    ✅ Balance: ${ethers.formatEther(balance)} ETH (cost: ${ethers.formatEther(cost)} ETH)`,
      );
      console.log(`[Orchestrator]    ✅ Cooldown: clear`);

      return { ok: true };
    } catch (error: any) {
      return { ok: false, error: `On-chain verification failed: ${error.message}` };
    }
  }

  // ─── Phase 3: Fetch bot data from chain ──────────────────────

  private async fetchBotData(botId: string): Promise<{
    imageURI: string;
    encryptedEnv: string;
    tier: Tier;
  } | null> {
    try {
      // Use the bots() mapping directly to get encryptedEnv bytes
      const bot = await this.registry.bots(botId);
      return {
        imageURI: bot.imageURI,
        encryptedEnv: bot.encryptedEnv, // hex-encoded bytes
        tier: Number(bot.tier) as Tier,
      };
    } catch (error: any) {
      console.error(`[Orchestrator]    ❌ Fetch failed: ${error.message}`);
      return null;
    }
  }

  // ─── Phase 4: Decrypt secrets ────────────────────────────────

  private decryptSecrets(encryptedEnvHex: string): Record<string, string> {
    // Convert hex bytes from chain to Uint8Array
    const bytes = ethers.getBytes(encryptedEnvHex);

    // Parse the EncryptedEnvelope from bytes
    const envelope: EncryptedEnvelope = bytesToEnvelope(bytes);

    // Decrypt using the deployer's secret key (result stays in RAM)
    return decryptEnv(envelope, this.config.deployerSecretKey);
  }

  // ─── Helpers ─────────────────────────────────────────────────

  private result(
    botId: string,
    phase: ResurrectionPhase,
    success: boolean,
    startTime: number,
    error?: string,
    deploymentId?: string,
    url?: string,
  ): ResurrectionResult {
    if (!success) {
      this.stats.failed++;
      console.error(`[Orchestrator] ❌ RESURRECTION FAILED at phase ${phase}: ${error}`);
    }

    return {
      success,
      botId,
      phase,
      deploymentId,
      url,
      error,
      durationMs: Date.now() - startTime,
    };
  }

  /** Get resurrection statistics */
  getStats() {
    return { ...this.stats, active: this.activeResurrections.size };
  }

  /** Check if a resurrection is currently in progress for a bot */
  isResurrecting(botId: string): boolean {
    return this.activeResurrections.has(botId);
  }
}
