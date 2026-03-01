/**
 * @module @aporia/orchestrator
 * OrchestratorService – Long-running watchdog service
 *
 * Reads active bots from chain, populates HeartbeatMonitor,
 * and wires the ResurrectionOrchestrator as the restart handler.
 *
 * This is the "main" process you run to have a fully autonomous
 * self-healing system.
 */

import { ethers } from "ethers";
import { HeartbeatMonitor, type HealthCheckConfig, Tier } from "@aporia/heartbeat";
import { ResurrectionOrchestrator, type OrchestratorConfig } from "./orchestrator";
import { type DeploymentBackend, DockerBackend } from "./backends";
import { AkashBackend } from "./akash-backend";

// ─── ABI for reading bot list ────────────────────────────────────

const REGISTRY_ABI_READ = [
    "function getAllBotIds() view returns (bytes32[])",
    "function getBotDetails(bytes32 botId) view returns (string imageURI, bytes32 envHash, uint8 tier, uint256 balance, uint256 lastRestart, bool isActive, address owner)",
    "function canMonitor(bytes32 botId) view returns (bool)",
];

// ─── Types ───────────────────────────────────────────────────────

export interface ServiceConfig {
    /** RPC URL for Base L2 */
    rpcUrl: string;
    /** Private key of the watchdog operator (sends triggerRestart txs) */
    operatorPrivateKey: string;
    /** AporiaRegistry contract address */
    contractAddress: string;
    /** Deployer secret key (Base64 or Uint8Array) for decrypting env vars */
    deployerSecretKey: Uint8Array;
    /** Deployment backend (default: auto-detect AkashBackend or DockerBackend) */
    backend?: DeploymentBackend;
    /** Health-check configuration overrides */
    healthCheckConfig?: Partial<HealthCheckConfig>;
    /** How often to sync bot list from chain (ms, default: 60000) */
    syncIntervalMs?: number;
    /** Default ports to expose on deployed bots */
    defaultPorts?: number[];
}

/**
 * Auto-detect the best available deployment backend
 * Priority: explicit config > AkashBackend (if AKASH_MNEMONIC set) > DockerBackend
 */
function resolveBackend(config: ServiceConfig): DeploymentBackend {
    if (config.backend) return config.backend;

    const mnemonic = process.env.AKASH_MNEMONIC;
    if (mnemonic) {
        console.log("[Service] 🌐 AKASH_MNEMONIC detected → using AkashBackend");
        return new AkashBackend({
            mnemonic,
            rpcEndpoint: process.env.AKASH_RPC_ENDPOINT,
        });
    }

    console.log("[Service] 🐳 No AKASH_MNEMONIC → using DockerBackend (local)");
    return new DockerBackend();
}

// ─── Service ─────────────────────────────────────────────────────

/**
 * OrchestratorService – Autonomous bot watchdog
 *
 * 1. Reads all active bots from the AporiaRegistry contract
 * 2. Creates a HeartbeatMonitor populated with those bots
 * 3. Wires ResurrectionOrchestrator.handleRestart as the restart handler
 * 4. Starts the monitoring loop
 * 5. Periodically syncs the bot list from chain (new registrations, deactivations)
 */
export class OrchestratorService {
    private provider: ethers.JsonRpcProvider;
    private signer: ethers.Wallet;
    private registry: ethers.Contract;
    private orchestrator: ResurrectionOrchestrator;
    private monitor: HeartbeatMonitor;
    private syncInterval: ReturnType<typeof setInterval> | null = null;
    private running = false;
    private config: ServiceConfig;

    constructor(config: ServiceConfig) {
        this.config = config;
        this.provider = new ethers.JsonRpcProvider(config.rpcUrl);
        this.signer = new ethers.Wallet(config.operatorPrivateKey, this.provider);
        this.registry = new ethers.Contract(config.contractAddress, REGISTRY_ABI_READ, this.provider);

        const backend = resolveBackend(config);

        const orchestratorConfig: OrchestratorConfig = {
            provider: this.provider,
            signer: this.signer,
            contractAddress: config.contractAddress,
            deployerSecretKey: config.deployerSecretKey,
            backend,
            defaultPorts: config.defaultPorts || [3000],
        };

        this.orchestrator = new ResurrectionOrchestrator(orchestratorConfig);

        // Create HeartbeatMonitor with orchestrator as restart handler
        this.monitor = new HeartbeatMonitor(
            config.healthCheckConfig || {},
            async (event) => {
                const result = await this.orchestrator.handleRestart(event);
                if (result.success && result.url) {
                    // Update the bot's URL in the monitor after resurrection
                    this.monitor.removeBot(event.botId);
                    this.monitor.addBot({
                        botId: event.botId,
                        url: result.url,
                        imageURI: event.imageURI,
                        tier: event.tier,
                    });
                }
            }
        );
    }

    /**
     * Start the orchestrator service
     */
    async start(): Promise<void> {
        console.log("\n╔════════════════════════════════════════════╗");
        console.log("║   🛡️  APORIA – ResurrectionOrchestrator    ║");
        console.log("╚════════════════════════════════════════════╝\n");
        console.log(`[Service] Operator:  ${this.signer.address}`);
        console.log(`[Service] Contract:  ${this.config.contractAddress}`);
        console.log(`[Service] RPC:       ${this.config.rpcUrl}`);
        console.log(`[Service] Backend:   ${(this.config.backend || new DockerBackend()).name}`);

        // Initial bot sync
        await this.syncBots();

        // Start health monitoring
        this.monitor.start();
        this.running = true;

        // Periodic sync (new bots, deactivated bots)
        const syncMs = this.config.syncIntervalMs || 60_000;
        this.syncInterval = setInterval(() => this.syncBots(), syncMs);

        console.log(`\n[Service] ✅ Monitoring active. Sync every ${syncMs / 1000}s.`);
        console.log(`[Service]    Press Ctrl+C to stop.\n`);
    }

    /**
     * Stop the orchestrator service
     */
    async stop(): Promise<void> {
        this.running = false;
        this.monitor.stop();

        if (this.syncInterval) {
            clearInterval(this.syncInterval);
            this.syncInterval = null;
        }

        console.log("[Service] Stopped.");
    }

    /**
     * Sync bot list from chain – add new bots, remove deactivated ones
     */
    async syncBots(): Promise<void> {
        try {
            const botIds: string[] = await this.registry.getAllBotIds();
            const currentBots = new Set(this.monitor.getAllBots().map(b => b.botId));
            let added = 0;
            let removed = 0;

            for (const botId of botIds) {
                try {
                    const canMonitor = await this.registry.canMonitor(botId);

                    if (canMonitor && !currentBots.has(botId)) {
                        // New bot to monitor
                        const details = await this.registry.getBotDetails(botId);

                        this.monitor.addBot({
                            botId,
                            // URL will be set when we know where the bot runs
                            // For now, use a placeholder that will fail health checks
                            // until the bot is actually deployed
                            url: `http://unknown-${botId.substring(0, 10)}:3000`,
                            imageURI: details.imageURI,
                            tier: Number(details.tier) as Tier,
                        });
                        added++;
                    } else if (!canMonitor && currentBots.has(botId)) {
                        // Bot deactivated – remove from monitoring
                        this.monitor.removeBot(botId);
                        removed++;
                    }

                    currentBots.delete(botId);
                } catch (error: any) {
                    console.warn(`[Service] ⚠️  Error syncing bot ${botId}: ${error.message}`);
                }
            }

            // Remove bots no longer on chain
            for (const orphanId of currentBots) {
                this.monitor.removeBot(orphanId);
                removed++;
            }

            const total = this.monitor.getAllBots().length;
            if (added > 0 || removed > 0) {
                console.log(`[Service] 🔄 Sync: +${added} -${removed} (total: ${total} bots)`);
            }
        } catch (error: any) {
            console.warn(`[Service] ⚠️  Bot sync failed: ${error.message}`);
        }
    }

    /** Get the underlying orchestrator */
    getOrchestrator(): ResurrectionOrchestrator {
        return this.orchestrator;
    }

    /** Get the underlying monitor */
    getMonitor(): HeartbeatMonitor {
        return this.monitor;
    }

    /** Check if the service is running */
    isRunning(): boolean {
        return this.running;
    }
}
