/**
 * @module @aporia/orchestrator
 * AkashBackend – Deploys containers to the Akash decentralized cloud.
 *
 * ## Architecture Decision: CLI over SDK
 *
 * We shell out to the native `provider-services` CLI binary instead of using
 * the akashjs SDK directly. This is a deliberate engineering choice:
 *
 *   akashjs@1.0.0 bundles two incompatible protobuf runtimes — the SDL parser
 *   uses `protobufjs` (Long objects, Uint8Array values) while the v1beta4
 *   encoder uses `@bufbuild/protobuf` (BigInt, native numbers). Mixing them
 *   causes "invalid denom" and "invalid int32: object" errors at broadcast
 *   time. The native CLI binary embeds a single, consistent Go protobuf
 *   stack and guarantees 100% reliable TX encoding on both testnet and mainnet.
 *
 * This approach was validated end-to-end on Akash testnet-8 with TX Code 0.
 *
 * ## BME (Burn-Mint Equilibrium)
 *
 * Since the Akash BME upgrade (Feb 2026), deployments are priced in ACT
 * (denom: `uact`), a stable compute credit pegged to ~$1 USD. AKT is no
 * longer accepted for placement pricing. If the wallet lacks sufficient ACT,
 * this backend auto-mints it from AKT via `akash tx bme mint-act`.
 *
 * ## Security Model
 *
 * Environment variables (API keys, credentials) are NEVER written to the SDL
 * or persisted to disk. They are injected only into a temporary manifest file
 * that is deleted immediately after the mTLS upload to the provider.
 *
 * ## Binary Requirements
 *
 *   - `provider-services` v0.10+ — deployment lifecycle (create, bid, lease, manifest)
 *   - `akash` v2.1.0+ — BME minting (`tx bme mint-act`)
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
  cpu: number; // millicpu (1000 = 1 vCPU)
  memory: string; // e.g. "1Gi"
  storage: string; // e.g. "1Gi"
  pricePerBlock: number; // uact per block
}

const TIER_RESOURCES: Record<number, TierResources> = {
  0: { cpu: 1000, memory: "1Gi", storage: "1Gi", pricePerBlock: 100 }, // NANO
  1: { cpu: 2000, memory: "4Gi", storage: "2Gi", pricePerBlock: 250 }, // LOGIC
  2: { cpu: 4000, memory: "8Gi", storage: "5Gi", pricePerBlock: 500 }, // EXPERT
};

// ─── SDL Template Generator ─────────────────────────────────────

function generateSDL(imageURI: string, tier: number, ports: number[]): string {
  const res = TIER_RESOURCES[tier] || TIER_RESOURCES[0];

  const exposePorts = ports
    .map(
      (p) => `        - port: ${p}\n          as: ${p}\n          to:\n            - global: true`,
    )
    .join("\n");

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

  // ─── CLI Helpers ─────────────────────────────────────────────

  /**
   * Execute a provider-services CLI command as a subprocess.
   *
   * Using execFile (not exec) to avoid shell injection. The HOME env var
   * is explicitly set because the CLI reads keyring and cert state from
   * ~/.akash — which may differ between the Node process user and the
   * OS login user in containerized environments.
   */
  private async cli(args: string[], options?: { stdin?: string; timeout?: number }): Promise<any> {
    const fullArgs = [
      ...args,
      "--node",
      this.config.rpcEndpoint,
      "--chain-id",
      this.config.chainId,
      "--output",
      "json",
    ];

    console.log(`[Akash CLI] $ ${this.config.cliBinary} ${args.slice(0, 4).join(" ")}...`);

    try {
      const { stdout, stderr } = await execFileAsync(this.config.cliBinary, fullArgs, {
        timeout: options?.timeout || 30_000,
        maxBuffer: 10 * 1024 * 1024,
        env: { ...process.env, HOME: os.homedir() },
      });

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
   * Execute a transaction command with signing flags.
   *
   * Uses fixed gas (800k) and fees (25000 uakt) instead of `--gas auto`
   * because the gas simulation RPC endpoint on testnet-8 returns
   * "unknown request" errors for deployment messages. Fixed values
   * are safe — typical deployment TXs consume 200k–400k gas.
   */
  private async tx(args: string[]): Promise<any> {
    return this.cli(
      [
        ...args,
        "--from",
        this.keyName,
        "--keyring-backend",
        "test",
        "--fees",
        "25000uakt",
        "--gas",
        "800000",
        "--broadcast-mode",
        "sync",
        "--yes",
      ],
      { timeout: 60_000 },
    );
  }

  // ─── Initialization ──────────────────────────────────────────

  private async init(): Promise<void> {
    if (this.initialized) return;

    console.log("[Akash] 🔧 Initializing wallet via CLI...");

    // SECURITY: Mnemonic is written to a temp file (mode 0600) rather than
    // passed as a CLI argument, because process arguments are visible in
    // /proc/<pid>/cmdline on Linux and via `ps` on macOS.
    const mnemonicFile = path.join(os.tmpdir(), `.aporia-mnemonic-${Date.now()}`);
    try {
      fs.writeFileSync(mnemonicFile, this.config.mnemonic, { mode: 0o600 });

      await execFileAsync(
        this.config.cliBinary,
        [
          "keys",
          "add",
          this.keyName,
          "--recover",
          "--keyring-backend",
          "test",
          "--source",
          mnemonicFile,
        ],
        {
          timeout: 15_000,
          env: { ...process.env, HOME: os.homedir() },
        },
      ).catch(() => {
        // Idempotent: key may already exist in the keyring from a previous run
      });
    } finally {
      try {
        fs.unlinkSync(mnemonicFile);
      } catch {}
    }

    // Resolve the bech32 address — the CLI may return JSON or plain text
    // depending on the version, so we use regex fallback for robustness
    const keysResult = await this.cli(["keys", "show", this.keyName, "--keyring-backend", "test"]);

    this.address = keysResult.address || keysResult.name;
    if (!this.address) {
      const text = typeof keysResult === "string" ? keysResult : JSON.stringify(keysResult);
      const match = text.match(/akash[a-z0-9]{39}/);
      if (match) {
        this.address = match[0];
      } else {
        throw new Error(`Could not determine wallet address from CLI output: ${text}`);
      }
    }

    console.log(`[Akash] 👛 Wallet: ${this.address}`);

    // BME: Ensure we hold enough ACT to cover the escrow deposit.
    // If not, auto-convert AKT → ACT so the user doesn't need to
    // manually call `akash tx bme mint-act` before every deployment.
    const balance = await this.cli(["query", "bank", "balances", this.address]);
    const balances = balance.balances || [];
    console.log(`[Akash] 💰 Balance: ${JSON.stringify(balances)}`);

    const actBalance = balances.find((b: any) => b.denom === "uact");
    const actAmount = parseInt(actBalance?.amount || "0", 10);
    const depositNeeded = parseInt(this.config.depositAmount, 10);

    if (actAmount < depositNeeded) {
      console.log(
        `[Akash] 💱 ACT balance (${actAmount} uact) < deposit (${depositNeeded} uact), minting ACT...`,
      );
      await this.mintAct();
    }

    this.initialized = true;
    console.log("[Akash] ✅ CLI initialized");
  }

  // ─── BME: ACT Minting ────────────────────────────────────────

  /**
   * Burns AKT and mints ACT via the Akash Burn-Mint Equilibrium.
   *
   * This uses the `akash` binary (not `provider-services`) because the
   * BME module was added in the node binary v2.1.0 and is not available
   * in the provider-services CLI.
   *
   * ACT is minted asynchronously — the chain processes it during the
   * next epoch (~60s on testnet). We block until the balance updates.
   */
  private async mintAct(): Promise<void> {
    const mintAmount = this.config.autoMintAmountUakt;
    console.log(`[Akash] 💱 Minting ACT from ${parseInt(mintAmount, 10) / 1_000_000} AKT...`);

    try {
      const { stdout, stderr } = await execFileAsync(
        this.config.akashBinary,
        [
          "tx",
          "bme",
          "mint-act",
          `${mintAmount}uakt`,
          "--from",
          this.keyName,
          "--keyring-backend",
          "test",
          "--chain-id",
          this.config.chainId,
          "--node",
          this.config.rpcEndpoint,
          "--fees",
          "25000uakt",
          "--gas",
          "800000",
          "--yes",
          "--output",
          "json",
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

      // BME minting is asynchronous — wait for the next chain epoch
      console.log("[Akash] ⏳ Waiting 65s for BME epoch processing...");
      await new Promise((r) => setTimeout(r, 65_000));

      const balance = await this.cli(["query", "bank", "balances", this.address]);
      const actBalance = (balance.balances || []).find((b: any) => b.denom === "uact");
      console.log(`[Akash] 💰 ACT balance after mint: ${actBalance?.amount || 0} uact`);
    } catch (error: any) {
      console.error(`[Akash] ⚠️ ACT minting failed: ${error.message}`);
      console.error(
        `[Akash] Make sure 'akash' v2.1.0+ binary is installed (current: ${this.config.akashBinary})`,
      );
      throw new Error(
        `ACT minting failed. Install akash v2.1.0+ or manually mint ACT: akash tx bme mint-act <amount>uakt --from <wallet>`,
      );
    }
  }

  // ─── DeploymentBackend Interface ─────────────────────────────

  async deploy(request: DeployRequest): Promise<DeployResponse> {
    try {
      await this.init();

      const tierNum = typeof request.tier === "number" ? request.tier : 0;

      console.log(`[Akash] 🚀 Deploying ${request.imageURI} (Tier ${tierNum})`);

      // SECURITY: envVars are deliberately excluded from the SDL.
      // They are injected only at manifest-send time (step 5).
      const ports = request.ports?.length ? request.ports : [3000];
      const sdlYaml = generateSDL(request.imageURI, tierNum, ports);

      const sdlFile = path.join(os.tmpdir(), `aporia-sdl-${Date.now()}.yaml`);
      fs.writeFileSync(sdlFile, sdlYaml, { mode: 0o600 });

      try {
        // Broadcast MsgCreateDeployment — escrow deposit is locked on-chain
        console.log("[Akash] 📋 Creating deployment...");
        const deployResult = await this.tx([
          "tx",
          "deployment",
          "create",
          sdlFile,
          "--deposit",
          `${this.config.depositAmount}uact`,
        ]);

        const dseq = await this.extractDseq(deployResult);
        console.log(`[Akash] 📋 Deployment created: DSEQ ${dseq}`);

        // Poll for provider bids (providers auto-bid on open deployments)
        const bid = await this.fetchBid(dseq);
        console.log(`[Akash] 🏷️  Bid received from provider: ${bid.provider}`);

        // Accept the first bid — creates an on-chain lease agreement
        await this.createLease(dseq, bid);
        console.log(`[Akash] 📜 Lease created: DSEQ ${dseq}`);

        // Upload container spec + secrets to the provider via mTLS
        await this.sendManifest(sdlFile, dseq, bid.provider, request.envVars);
        console.log(`[Akash] 📦 Manifest sent to provider`);

        // Wait for the provider to pull the image and assign an ingress URI
        const serviceUrl = await this.pollLeaseStatus(dseq, bid.provider);
        console.log(`[Akash] ✅ Service live at: ${serviceUrl}`);

        return {
          success: true,
          deploymentId: `akash-${dseq}`,
          url: serviceUrl,
        };
      } finally {
        // SDL contains no secrets, but clean up to avoid disk clutter
        try {
          fs.unlinkSync(sdlFile);
        } catch {}
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

    await this.tx(["tx", "deployment", "close", "--dseq", dseq, "--owner", this.address]);
  }

  // ─── Private: Akash Lifecycle Methods ────────────────────────

  /**
   * Extract the Deployment Sequence (DSEQ) from a deployment creation TX.
   *
   * The DSEQ can appear in three places depending on the broadcast mode
   * and node version: (1) in tx.logs[].events[], (2) in tx.raw_log as JSON,
   * or (3) in the full TX query result when using broadcast-mode=sync.
   * We try all three strategies in order of cheapest-to-evaluate.
   */
  private async extractDseq(txResult: any): Promise<string> {
    if (txResult.logs) {
      for (const log of txResult.logs) {
        for (const event of log.events || []) {
          if (event.type === "akash.v1") {
            for (const attr of event.attributes || []) {
              if (attr.key === "dseq") return attr.value;
            }
          }
        }
      }
    }

    // Strategy 2: raw_log contains inline JSON on some node versions
    if (txResult.raw_log) {
      const match = txResult.raw_log.match(/"dseq":"(\d+)"/);
      if (match) return match[1];
    }

    // Strategy 3: with broadcast-mode=sync, events are not included in
    // the response — we must wait for the TX to land in a block, then query it
    if (txResult.txhash) {
      console.log(`[Akash] 🔍 Querying TX ${txResult.txhash} for DSEQ...`);
      return this.waitForDseq(txResult.txhash);
    }

    throw new Error("Could not extract DSEQ from deployment creation result");
  }

  private async waitForDseq(txhash: string): Promise<string> {
    for (let i = 0; i < 10; i++) {
      await new Promise((r) => setTimeout(r, 3000));

      try {
        const result = await this.cli(["query", "tx", txhash]);

        if (result.code === 0 || result.code === undefined) {
          // Event attributes are base64-encoded in Cosmos SDK responses
          for (const event of result.events || []) {
            for (const attr of event.attributes || []) {
              const key = attr.key && Buffer.from(attr.key, "base64").toString();
              const value = attr.value && Buffer.from(attr.value, "base64").toString();
              if (key === "dseq") return value;
            }
          }

          // Some node versions include decoded events in logs instead
          if (result.logs) {
            for (const log of result.logs) {
              for (const event of log.events || []) {
                for (const attr of event.attributes || []) {
                  if (attr.key === "dseq") return attr.value;
                }
              }
            }
          }

          // Last resort: block height is a valid DSEQ approximation
          // since DSEQs are monotonically increasing block-height-based IDs
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
   * Poll the on-chain order book until a provider places a bid.
   *
   * Providers run an automated bidding engine that evaluates open
   * deployments every ~6s. On mainnet, bids typically arrive within
   * 15–30s. On testnet, providers may be intermittently offline.
   */
  private async fetchBid(dseq: string): Promise<{ provider: string; price: string }> {
    const startTime = Date.now();

    while (Date.now() - startTime < this.config.bidTimeoutMs) {
      console.log("[Akash] ⏳ Fetching bids...");
      await new Promise((r) => setTimeout(r, 10_000)); // Wait 10s between polls

      try {
        const result = await this.cli([
          "query",
          "market",
          "bid",
          "list",
          "--owner",
          this.address,
          "--dseq",
          dseq,
          "--state",
          "open",
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

  /** Accept a bid by creating an on-chain lease (locks the provider's resources). */
  private async createLease(dseq: string, bid: { provider: string }): Promise<void> {
    await this.tx([
      "tx",
      "market",
      "lease",
      "create",
      "--dseq",
      dseq,
      "--provider",
      bid.provider,
      "--gseq",
      "1",
      "--oseq",
      "1",
    ]);
  }

  /**
   * Upload the container manifest to the leased provider.
   *
   * SECURITY-CRITICAL: This is the ONLY point where envVars touch disk.
   * A temporary SDL copy with env[] injected is written (mode 0600),
   * sent to the provider over mTLS (authenticated by the on-chain
   * certificate), and deleted in the `finally` block — even on error.
   */
  private async sendManifest(
    sdlFile: string,
    dseq: string,
    provider: string,
    envVars: Record<string, string>,
  ): Promise<void> {
    // Inject env vars into a throwaway copy of the SDL
    const sdlContent = fs.readFileSync(sdlFile, "utf-8");

    // Env vars go under the services.bot.env key in SDL v2.0 format
    const envLines = Object.entries(envVars)
      .map(([k, v]) => `      - ${k}=${v}`)
      .join("\n");

    const sdlWithEnv = sdlContent.replace(/^(    image: .+)$/m, `$1\n    env:\n${envLines}`);

    const manifestSdlFile = path.join(os.tmpdir(), `aporia-manifest-${Date.now()}.yaml`);
    fs.writeFileSync(manifestSdlFile, sdlWithEnv, { mode: 0o600 });

    try {
      await this.cli(
        [
          "send-manifest",
          manifestSdlFile,
          "--dseq",
          dseq,
          "--provider",
          provider,
          "--from",
          this.keyName,
          "--keyring-backend",
          "test",
        ],
        { timeout: 60_000 },
      );
    } finally {
      // SECURITY: Wipe the file containing secrets from disk immediately
      try {
        fs.unlinkSync(manifestSdlFile);
      } catch {}
    }
  }

  /**
   * Poll the provider's lease endpoint until the container is running
   * and an ingress URI or forwarded port is assigned.
   */
  private async pollLeaseStatus(dseq: string, provider: string): Promise<string> {
    const startTime = Date.now();

    while (Date.now() - startTime < this.config.leaseTimeoutMs) {
      console.log("[Akash] ⏳ Waiting for container to start...");

      try {
        const result = await this.cli(
          [
            "lease-status",
            "--dseq",
            dseq,
            "--provider",
            provider,
            "--from",
            this.keyName,
            "--keyring-backend",
            "test",
          ],
          { timeout: 30_000 },
        );

        // Prefer HTTPS ingress URIs (assigned by the provider's reverse proxy)
        if (result?.services) {
          for (const [name, service] of Object.entries(result.services) as any) {
            if (service.uris?.length > 0) {
              return `https://${service.uris[0]}`;
            }
          }
        }

        // Fallback: raw TCP forwarded ports (no TLS termination)
        if (result?.forwarded_ports) {
          for (const [name, ports] of Object.entries(result.forwarded_ports) as any) {
            if (Array.isArray(ports) && ports.length > 0) {
              const p = ports[0];
              return `http://${p.host}:${p.externalPort}`;
            }
          }
        }
      } catch {
        // Provider returns 5xx until the container is scheduled
      }

      await new Promise((r) => setTimeout(r, 10_000));
    }

    throw new Error(`Container did not start within ${this.config.leaseTimeoutMs / 1000}s`);
  }
}
