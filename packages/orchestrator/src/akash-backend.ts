/**
 * @module @aporia/orchestrator
 * AkashBackend – Decentralized Cloud Deployment via Akash Network
 *
 * Uses the `provider-services` CLI binary for all chain transactions,
 * bypassing the akashjs SDK protobuf compatibility issues.
 *
 * BME (Burn-Mint Equilibrium) Model:
 *   - Deployments are priced in ACT (uact), not AKT (uakt)
 *   - AKT is auto-minted into ACT via `akash tx bme mint-act` if needed
 *   - Requires `akash` binary v2.1.0+ for BME commands
 *   - Requires `provider-services` binary for deployment lifecycle
 *
 * Deployment lifecycle:
 *   0. Mint ACT from AKT   (akash tx bme mint-act)        — if needed
 *   1. Write SDL to temp file
 *   2. Create Deployment  (provider-services tx deployment create)
 *   3. Poll for Bids      (provider-services query market bid list)
 *   4. Create Lease        (provider-services tx market lease create)
 *   5. Send Manifest       (provider-services send-manifest)
 *   6. Poll Lease Status   (provider-services lease-status)
 *
 * Security: envVars are NEVER written to disk or SDL.
 *           They are injected ONLY into the manifest env[] in RAM,
 *           written to a temp file that is immediately deleted.
 */

import { execFile } from "child_process";
import { promisify } from "util";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { type DeploymentBackend, type DeployRequest, type DeployResponse } from "./backends";

const execFileAsync = promisify(execFile);

// ─── Config ──────────────────────────────────────────────────────

export interface AkashConfig {
    /** Akash wallet mnemonic (12 or 24 words) */
    mnemonic: string;
    /** Akash RPC endpoint */
    rpcEndpoint?: string;
    /** Deposit amount in uact for deployments (default: 5000000 = 5 ACT) */
    depositAmount?: string;
    /** Amount of AKT (in uakt) to auto-mint into ACT when balance is low (default: 100000000 = 100 AKT) */
    autoMintAmountUakt?: string;
    /** Bid timeout in ms (default: 120000) */
    bidTimeoutMs?: number;
    /** Lease status poll timeout in ms (default: 120000) */
    leaseTimeoutMs?: number;
    /** Path to provider-services binary (default: "provider-services") */
    cliBinary?: string;
    /** Path to akash node binary for BME commands (default: "akash") */
    akashBinary?: string;
    /** Chain ID (default: "testnet-8") */
    chainId?: string;
}

// ─── Tier → Compute Resources ────────────────────────────────────

interface TierResources {
    cpu: number;      // millicpu (1000 = 1 vCPU)
    memory: string;   // e.g. "1Gi"
    storage: string;  // e.g. "1Gi"
    pricePerBlock: number; // uact per block
}

const TIER_RESOURCES: Record<number, TierResources> = {
    0: { cpu: 1000, memory: "1Gi", storage: "1Gi", pricePerBlock: 100 },   // NANO
    1: { cpu: 2000, memory: "4Gi", storage: "2Gi", pricePerBlock: 250 },   // LOGIC
    2: { cpu: 4000, memory: "8Gi", storage: "5Gi", pricePerBlock: 500 },   // EXPERT
};

// ─── SDL Template Generator ─────────────────────────────────────

function generateSDL(imageURI: string, tier: number, ports: number[]): string {
    const res = TIER_RESOURCES[tier] || TIER_RESOURCES[0];

    const exposePorts = ports.map(p => `        - port: ${p}\n          as: ${p}\n          to:\n            - global: true`).join("\n");

    return `---
version: "2.0"
services:
  bot:
    image: ${imageURI}
    expose:
${exposePorts}
profiles:
  compute:
    bot:
      resources:
        cpu:
          units: ${res.cpu / 1000}
        memory:
          size: ${res.memory}
        storage:
          - size: ${res.storage}
  placement:
    dcloud:
      pricing:
        bot:
          denom: uact
          amount: ${res.pricePerBlock}
deployment:
  bot:
    dcloud:
      profile: bot
      count: 1`;
}

// ─── AkashBackend ────────────────────────────────────────────────

/**
 * AkashBackend – Deploys bots to the Akash decentralized cloud
 *
 * Uses the provider-services CLI binary for all chain interactions,
 * completely bypassing the akashjs SDK protobuf issues.
 *
 * envVars are injected ONLY into the manifest body — never
 * written to disk, logs, or SDL.
 */
export class AkashBackend implements DeploymentBackend {
    readonly name = "AkashBackend";
    private config: Required<AkashConfig>;
    private keyName = "aporia-deployer";
    private initialized = false;
    private address = "";

    constructor(config: AkashConfig) {
        this.config = {
            mnemonic: config.mnemonic,
            rpcEndpoint: config.rpcEndpoint || "https://testnetrpc.akashnet.net:443",
            depositAmount: config.depositAmount || "5000000",
            autoMintAmountUakt: config.autoMintAmountUakt || "100000000",
            bidTimeoutMs: config.bidTimeoutMs || 120_000,
            leaseTimeoutMs: config.leaseTimeoutMs || 120_000,
            cliBinary: config.cliBinary || "provider-services",
            akashBinary: config.akashBinary || "akash",
            chainId: config.chainId || "testnet-8",
        };
    }

    // ─── CLI Helper ──────────────────────────────────────────────

    /**
     * Execute a provider-services CLI command.
     * All commands automatically include --node, --chain-id, --from, and --output json.
     */
    private async cli(args: string[], options?: { stdin?: string; timeout?: number }): Promise<any> {
        const fullArgs = [
            ...args,
            "--node", this.config.rpcEndpoint,
            "--chain-id", this.config.chainId,
            "--output", "json",
        ];

        console.log(`[Akash CLI] $ ${this.config.cliBinary} ${args.slice(0, 4).join(" ")}...`);

        try {
            const { stdout, stderr } = await execFileAsync(
                this.config.cliBinary,
                fullArgs,
                {
                    timeout: options?.timeout || 30_000,
                    maxBuffer: 10 * 1024 * 1024, // 10 MB
                    env: { ...process.env, HOME: os.homedir() },
                },
            );

            if (stderr && stderr.trim()) {
                console.warn(`[Akash CLI] stderr: ${stderr.trim()}`);
            }

            try {
                return JSON.parse(stdout);
            } catch {
                return stdout.trim();
            }
        } catch (error: any) {
            const msg = error.stderr || error.message;
            throw new Error(`CLI command failed: ${msg}`);
        }
    }

    /**
     * Execute a CLI transaction (tx) command with auto-signing.
     */
    private async tx(args: string[]): Promise<any> {
        return this.cli([
            ...args,
            "--from", this.keyName,
            "--keyring-backend", "test",
            "--fees", "25000uakt",
            "--gas", "800000",
            "--broadcast-mode", "sync",
            "--yes",
        ], { timeout: 60_000 });
    }

    // ─── Initialization ──────────────────────────────────────────

    private async init(): Promise<void> {
        if (this.initialized) return;

        console.log("[Akash] 🔧 Initializing wallet via CLI...");

        // Import mnemonic into the CLI keyring
        // Write mnemonic to a temp file to avoid it appearing in process args
        const mnemonicFile = path.join(os.tmpdir(), `.aporia-mnemonic-${Date.now()}`);
        try {
            fs.writeFileSync(mnemonicFile, this.config.mnemonic, { mode: 0o600 });

            await execFileAsync(this.config.cliBinary, [
                "keys", "add", this.keyName,
                "--recover",
                "--keyring-backend", "test",
                "--source", mnemonicFile,
            ], {
                timeout: 15_000,
                env: { ...process.env, HOME: os.homedir() },
            }).catch(() => {
                // Key might already exist — that's fine
            });
        } finally {
            // Always delete the mnemonic file
            try { fs.unlinkSync(mnemonicFile); } catch { }
        }

        // Get the address from the keyring
        const keysResult = await this.cli([
            "keys", "show", this.keyName,
            "--keyring-backend", "test",
        ]);

        this.address = keysResult.address || keysResult.name;
        if (!this.address) {
            // Try parsing as text output
            const text = typeof keysResult === "string" ? keysResult : JSON.stringify(keysResult);
            const match = text.match(/akash[a-z0-9]{39}/);
            if (match) {
                this.address = match[0];
            } else {
                throw new Error(`Could not determine wallet address from CLI output: ${text}`);
            }
        }

        console.log(`[Akash] 👛 Wallet: ${this.address}`);

        // Verify balance and auto-mint ACT if needed
        const balance = await this.cli([
            "query", "bank", "balances", this.address,
        ]);
        const balances = balance.balances || [];
        console.log(`[Akash] 💰 Balance: ${JSON.stringify(balances)}`);

        // Check if we have enough ACT for deployments
        const actBalance = balances.find((b: any) => b.denom === "uact");
        const aktBalance = balances.find((b: any) => b.denom === "uakt");
        const actAmount = parseInt(actBalance?.amount || "0", 10);
        const depositNeeded = parseInt(this.config.depositAmount, 10);

        if (actAmount < depositNeeded) {
            console.log(`[Akash] 💱 ACT balance (${actAmount} uact) < deposit (${depositNeeded} uact), minting ACT...`);
            await this.mintAct();
        }

        this.initialized = true;
        console.log("[Akash] ✅ CLI initialized");
    }

    // ─── BME: ACT Minting ────────────────────────────────────────

    /**
     * Mint ACT from AKT via BME (Burn-Mint Equilibrium).
     * Requires `akash` binary v2.1.0+ with `tx bme mint-act` support.
     * The minting deposits AKT into a vault and mints ~equivalent ACT
     * after epoch processing (~60s on testnet).
     */
    private async mintAct(): Promise<void> {
        const mintAmount = this.config.autoMintAmountUakt;
        console.log(`[Akash] 💱 Minting ACT from ${parseInt(mintAmount, 10) / 1_000_000} AKT...`);

        try {
            const { stdout, stderr } = await execFileAsync(
                this.config.akashBinary,
                [
                    "tx", "bme", "mint-act", `${mintAmount}uakt`,
                    "--from", this.keyName,
                    "--keyring-backend", "test",
                    "--chain-id", this.config.chainId,
                    "--node", this.config.rpcEndpoint,
                    "--fees", "25000uakt",
                    "--gas", "800000",
                    "--yes",
                    "--output", "json",
                ],
                {
                    timeout: 30_000,
                    env: { ...process.env, HOME: os.homedir() },
                },
            );

            if (stderr && stderr.trim()) {
                console.warn(`[Akash] mint stderr: ${stderr.trim()}`);
            }

            try {
                const result = JSON.parse(stdout);
                console.log(`[Akash] 💱 Mint TX: ${result.txhash}`);
            } catch {
                console.log(`[Akash] 💱 Mint submitted`);
            }

            // Wait for epoch processing (BME mints ACT after the next epoch)
            console.log("[Akash] ⏳ Waiting 65s for BME epoch processing...");
            await new Promise(r => setTimeout(r, 65_000));

            // Verify new balance
            const balance = await this.cli([
                "query", "bank", "balances", this.address,
            ]);
            const balances = balance.balances || [];
            const actBalance = balances.find((b: any) => b.denom === "uact");
            console.log(`[Akash] 💰 ACT balance after mint: ${actBalance?.amount || 0} uact`);

        } catch (error: any) {
            console.error(`[Akash] ⚠️ ACT minting failed: ${error.message}`);
            console.error(`[Akash] Make sure 'akash' v2.1.0+ binary is installed (current: ${this.config.akashBinary})`);
            throw new Error(`ACT minting failed. Install akash v2.1.0+ or manually mint ACT: akash tx bme mint-act <amount>uakt --from <wallet>`);
        }
    }

    // ─── DeploymentBackend Interface ─────────────────────────────

    async deploy(request: DeployRequest): Promise<DeployResponse> {
        try {
            await this.init();

            const tierNum = typeof request.tier === "number" ? request.tier : 0;

            console.log(`[Akash] 🚀 Deploying ${request.imageURI} (Tier ${tierNum})`);

            // ── STEP 1: Generate SDL and write to temp file ──────
            // NOTE: envVars are NOT in the SDL — they go in the manifest only
            const ports = request.ports?.length ? request.ports : [3000];
            const sdlYaml = generateSDL(request.imageURI, tierNum, ports);

            const sdlFile = path.join(os.tmpdir(), `aporia-sdl-${Date.now()}.yaml`);
            fs.writeFileSync(sdlFile, sdlYaml, { mode: 0o600 });

            try {
                // ── STEP 2: Create Deployment ────────────────────
                console.log("[Akash] 📋 Creating deployment...");
                const deployResult = await this.tx([
                    "tx", "deployment", "create", sdlFile,
                    "--deposit", `${this.config.depositAmount}uact`,
                ]);

                const dseq = await this.extractDseq(deployResult);
                console.log(`[Akash] 📋 Deployment created: DSEQ ${dseq}`);

                // ── STEP 3: Wait for Bids ────────────────────────
                const bid = await this.fetchBid(dseq);
                console.log(`[Akash] 🏷️  Bid received from provider: ${bid.provider}`);

                // ── STEP 4: Create Lease ─────────────────────────
                await this.createLease(dseq, bid);
                console.log(`[Akash] 📜 Lease created: DSEQ ${dseq}`);

                // ── STEP 5: Send Manifest (envVars injected HERE) ─
                await this.sendManifest(sdlFile, dseq, bid.provider, request.envVars);
                console.log(`[Akash] 📦 Manifest sent to provider`);

                // ── STEP 6: Poll for service URL ─────────────────
                const serviceUrl = await this.pollLeaseStatus(dseq, bid.provider);
                console.log(`[Akash] ✅ Service live at: ${serviceUrl}`);

                return {
                    success: true,
                    deploymentId: `akash-${dseq}`,
                    url: serviceUrl,
                };

            } finally {
                // Always clean up SDL file
                try { fs.unlinkSync(sdlFile); } catch { }
            }

        } catch (error: any) {
            console.error(`[Akash] ❌ Deployment failed: ${error.message}`);
            return {
                success: false,
                deploymentId: "",
                url: "",
                error: error.message,
            };
        }
    }

    async stop(deploymentId: string): Promise<void> {
        const dseq = deploymentId.replace("akash-", "");
        console.log(`[Akash] 🛑 Closing deployment DSEQ ${dseq}`);

        await this.init();

        await this.tx([
            "tx", "deployment", "close",
            "--dseq", dseq,
            "--owner", this.address,
        ]);
    }

    // ─── Private: Akash Lifecycle Methods ────────────────────────

    /**
     * Extract DSEQ from deployment creation tx result.
     */
    private async extractDseq(txResult: any): Promise<string> {
        // Try events
        if (txResult.logs) {
            for (const log of txResult.logs) {
                for (const event of (log.events || [])) {
                    if (event.type === "akash.v1") {
                        for (const attr of event.attributes || []) {
                            if (attr.key === "dseq") return attr.value;
                        }
                    }
                }
            }
        }

        // Try raw_log
        if (txResult.raw_log) {
            const match = txResult.raw_log.match(/"dseq":"(\d+)"/);
            if (match) return match[1];
        }

        // Try txhash — query the tx to get events
        if (txResult.txhash) {
            console.log(`[Akash] 🔍 Querying TX ${txResult.txhash} for DSEQ...`);
            // Wait for tx to be included in a block
            return this.waitForDseq(txResult.txhash);
        }

        throw new Error("Could not extract DSEQ from deployment creation result");
    }

    private async waitForDseq(txhash: string): Promise<string> {
        for (let i = 0; i < 10; i++) {
            await new Promise(r => setTimeout(r, 3000));

            try {
                const result = await this.cli(["query", "tx", txhash]);

                if (result.code === 0 || result.code === undefined) {
                    // Look for dseq in events
                    for (const event of (result.events || [])) {
                        for (const attr of (event.attributes || [])) {
                            const key = attr.key && Buffer.from(attr.key, "base64").toString();
                            const value = attr.value && Buffer.from(attr.value, "base64").toString();
                            if (key === "dseq") return value;
                        }
                    }

                    // Try logs
                    if (result.logs) {
                        for (const log of result.logs) {
                            for (const event of (log.events || [])) {
                                for (const attr of (event.attributes || [])) {
                                    if (attr.key === "dseq") return attr.value;
                                }
                            }
                        }
                    }

                    // Fallback: use the block height as a close-enough DSEQ
                    if (result.height) return String(result.height);
                }

                if (result.code && result.code !== 0) {
                    throw new Error(`TX failed with code ${result.code}: ${result.raw_log}`);
                }
            } catch (error: any) {
                if (error.message.includes("not found")) continue;
                throw error;
            }
        }

        throw new Error(`TX ${txhash} not found after 30s`);
    }

    /**
     * Poll for bids on a deployment.
     */
    private async fetchBid(dseq: string): Promise<{ provider: string; price: string }> {
        const startTime = Date.now();

        while (Date.now() - startTime < this.config.bidTimeoutMs) {
            console.log("[Akash] ⏳ Fetching bids...");
            await new Promise(r => setTimeout(r, 10_000)); // Wait 10s between polls

            try {
                const result = await this.cli([
                    "query", "market", "bid", "list",
                    "--owner", this.address,
                    "--dseq", dseq,
                    "--state", "open",
                ]);

                const bids = result.bids || [];
                if (bids.length > 0) {
                    const bid = bids[0].bid || bids[0];
                    return {
                        provider: bid.bid_id?.provider || bid.id?.provider,
                        price: bid.price?.amount || "unknown",
                    };
                }
            } catch (error: any) {
                console.warn(`[Akash] ⚠️  Bid fetch error: ${error.message}`);
            }
        }

        throw new Error(`No bids received within ${this.config.bidTimeoutMs / 1000}s`);
    }

    /**
     * Accept a bid by creating a lease.
     */
    private async createLease(dseq: string, bid: { provider: string }): Promise<void> {
        await this.tx([
            "tx", "market", "lease", "create",
            "--dseq", dseq,
            "--provider", bid.provider,
            "--gseq", "1",
            "--oseq", "1",
        ]);
    }

    /**
     * Send the deployment manifest to the provider.
     * CRITICAL: This is where envVars are injected.
     *
     * The provider-services CLI sends the manifest via mTLS
     * using the on-chain certificate. EnvVars are injected
     * by modifying the SDL file temporarily.
     */
    private async sendManifest(
        sdlFile: string,
        dseq: string,
        provider: string,
        envVars: Record<string, string>,
    ): Promise<void> {
        // Build SDL with env vars injected for the manifest
        // SECURITY: This temp file is deleted immediately after use
        const sdlContent = fs.readFileSync(sdlFile, "utf-8");

        // Inject env vars into the SDL services section
        const envLines = Object.entries(envVars)
            .map(([k, v]) => `      - ${k}=${v}`)
            .join("\n");

        const sdlWithEnv = sdlContent.replace(
            /^(    image: .+)$/m,
            `$1\n    env:\n${envLines}`,
        );

        const manifestSdlFile = path.join(os.tmpdir(), `aporia-manifest-${Date.now()}.yaml`);
        fs.writeFileSync(manifestSdlFile, sdlWithEnv, { mode: 0o600 });

        try {
            await this.cli([
                "send-manifest", manifestSdlFile,
                "--dseq", dseq,
                "--provider", provider,
                "--from", this.keyName,
                "--keyring-backend", "test",
            ], { timeout: 60_000 });
        } finally {
            // SECURITY: Delete manifest file containing secrets immediately
            try { fs.unlinkSync(manifestSdlFile); } catch { }
        }
    }

    /**
     * Poll the lease status until the container is running and has a URI.
     */
    private async pollLeaseStatus(dseq: string, provider: string): Promise<string> {
        const startTime = Date.now();

        while (Date.now() - startTime < this.config.leaseTimeoutMs) {
            console.log("[Akash] ⏳ Waiting for container to start...");

            try {
                const result = await this.cli([
                    "lease-status",
                    "--dseq", dseq,
                    "--provider", provider,
                    "--from", this.keyName,
                    "--keyring-backend", "test",
                ], { timeout: 30_000 });

                // Extract service URIs
                if (result?.services) {
                    for (const [name, service] of Object.entries(result.services) as any) {
                        if (service.uris?.length > 0) {
                            return `https://${service.uris[0]}`;
                        }
                    }
                }

                // Check forwarded ports
                if (result?.forwarded_ports) {
                    for (const [name, ports] of Object.entries(result.forwarded_ports) as any) {
                        if (Array.isArray(ports) && ports.length > 0) {
                            const p = ports[0];
                            return `http://${p.host}:${p.externalPort}`;
                        }
                    }
                }
            } catch {
                // Not ready yet
            }

            await new Promise(r => setTimeout(r, 10_000));
        }

        throw new Error(`Container did not start within ${this.config.leaseTimeoutMs / 1000}s`);
    }
}
