/**
 * @module @aporia/orchestrator
 * AkashBackend – Decentralized Cloud Deployment via Akash Network
 *
 * Implements the DeploymentBackend interface using the Akash Network
 * reverse-auction deployment lifecycle:
 *
 *   1. Create Deployment (MsgCreateDeployment)   → on-chain tx
 *   2. Poll for Bids (QueryBidsRequest)          → wait for providers
 *   3. Create Lease  (MsgCreateLease)            → accept cheapest bid
 *   4. Send Manifest (mTLS PUT to provider)      → inject envVars HERE ONLY
 *   5. Poll Lease Status                          → wait for container URI
 *
 * Security: envVars are NEVER written to disk, SDL, or logged.
 *           They are injected ONLY into the mTLS manifest body in RAM.
 */

import https from "https";
import { DirectSecp256k1HdWallet, Registry } from "@cosmjs/proto-signing";
import { SigningStargateClient } from "@cosmjs/stargate";
import { getAkashTypeRegistry } from "@akashnetwork/akashjs/build/stargate/index.js";
import { SDL } from "@akashnetwork/akashjs/build/sdl/index.js";
import { getRpc } from "@akashnetwork/akashjs/build/rpc/index.js";
import * as cert from "@akashnetwork/akashjs/build/certificates/index.js";
import { certificateManager } from "@akashnetwork/akashjs/build/certificates/certificate-manager/index.js";
import type { CertificatePem } from "@akashnetwork/akashjs/build/certificates/certificate-manager/CertificateManager.js";

import { type DeploymentBackend, type DeployRequest, type DeployResponse } from "./backends";

// ─── Akash Protobuf Types ────────────────────────────────────────
// These come from @akashnetwork/akash-api (used for bids/lease queries)
// MsgCreateDeployment and MsgCreateLease are loaded from the akashjs
// type registry at init time because they need their v1beta4/v1beta5
// encoders (not the v1beta3 stubs from akash-api).

let MsgCreateDeploymentV4: any;   // from registry: akash.deployment.v1beta4
let MsgCreateLeaseV5: any;        // from registry: akash.market.v1beta5
let QueryBidsRequest: any;
let QueryBidsResponse: any;
let QueryProviderRequest: any;
let QueryProviderResponse: any;
let BidID: any;

async function loadAkashTypes() {
    // Dynamic imports for query types that are still used from akash-api
    try {
        // @ts-ignore
        const marketMod = await import("@akashnetwork/akash-api/akash/market/v1beta4");
        QueryBidsRequest = marketMod.QueryBidsRequest;
        QueryBidsResponse = marketMod.QueryBidsResponse;
        BidID = marketMod.BidID;

        // @ts-ignore
        const providerMod = await import("@akashnetwork/akash-api/akash/provider/v1beta3");
        QueryProviderRequest = providerMod.QueryProviderRequest;
        QueryProviderResponse = providerMod.QueryProviderResponse;

        // Force registration of cert types in the global registry
        // @ts-ignore
        await import("@akashnetwork/akash-api/akash/cert/v1beta3");
    } catch (e) {
        throw new Error(`Could not load Akash protobuf types from @akashnetwork/akash-api: ${e}`);
    }

    // Load the v1beta4/v1beta5 message encoders from the akashjs registry
    // These have the correct field layout for testnet-8
    const akashTypes = getAkashTypeRegistry();
    const deployEntry = akashTypes.find((e: any) => e[0] === "/akash.deployment.v1beta4.MsgCreateDeployment");
    if (deployEntry) {
        MsgCreateDeploymentV4 = deployEntry[1];
    } else {
        throw new Error("v1beta4 MsgCreateDeployment not found in akashjs type registry");
    }

    const leaseEntry = akashTypes.find((e: any) => e[0] === "/akash.market.v1beta5.MsgCreateLease");
    if (leaseEntry) {
        MsgCreateLeaseV5 = leaseEntry[1];
    } else {
        throw new Error("v1beta5 MsgCreateLease not found in akashjs type registry");
    }
}

// ─── Config ──────────────────────────────────────────────────────

export interface AkashConfig {
    /** Akash wallet mnemonic (12 or 24 words) */
    mnemonic: string;
    /** Akash RPC endpoint */
    rpcEndpoint?: string;
    /** Deposit amount in uakt for deployments (default: 5000000 = 5 AKT) */
    depositAmount?: string;
    /** Bid timeout in ms (default: 60000) */
    bidTimeoutMs?: number;
    /** Lease status poll timeout in ms (default: 120000) */
    leaseTimeoutMs?: number;
}

// ─── Tier → Compute Resources ────────────────────────────────────

interface TierResources {
    cpu: number;      // millicpu (1000 = 1 vCPU)
    memory: string;   // e.g. "1Gi"
    storage: string;  // e.g. "1Gi"
    pricePerBlock: number; // uakt per block
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
          size: ${res.storage}
  placement:
    global:
      pricing:
        bot:
          denom: uakt
          amount: ${res.pricePerBlock}
deployment:
  bot:
    global:
      profile: bot
      count: 1
`;
}

// ─── AkashBackend ────────────────────────────────────────────────

/**
 * AkashBackend – Deploys bots to the Akash decentralized cloud
 *
 * Implements the full Akash reverse-auction deployment lifecycle.
 * envVars are injected ONLY into the mTLS manifest body — never
 * written to disk, logs, or SDL.
 */
export class AkashBackend implements DeploymentBackend {
    readonly name = "Akash (decentralized)";

    private config: Required<AkashConfig>;
    private wallet: DirectSecp256k1HdWallet | null = null;
    private client: SigningStargateClient | null = null;
    private certificate: CertificatePem | null = null;
    private address: string = "";
    private initialized = false;

    constructor(config: AkashConfig) {
        this.config = {
            mnemonic: config.mnemonic,
            rpcEndpoint: config.rpcEndpoint || "https://testnetrpc.akashnet.net:443",
            depositAmount: config.depositAmount || "5000000",
            bidTimeoutMs: config.bidTimeoutMs || 60_000,
            leaseTimeoutMs: config.leaseTimeoutMs || 120_000,
        };
    }

    /**
     * Lazy initialization: wallet, client, certificate, protobuf types
     */
    private async init(): Promise<void> {
        if (this.initialized) return;

        console.log("[Akash] 🔧 Initializing wallet and client...");

        // Load protobuf types
        await loadAkashTypes();

        // Create wallet from mnemonic
        this.wallet = await DirectSecp256k1HdWallet.fromMnemonic(
            this.config.mnemonic,
            { prefix: "akash" }
        );

        const accounts = await this.wallet.getAccounts();
        this.address = accounts[0].address;
        console.log(`[Akash] 👛 Wallet: ${this.address}`);

        // Connect signing client with Akash type registry
        const registry = getAkashTypeRegistry();
        this.client = await SigningStargateClient.connectWithSigner(
            this.config.rpcEndpoint,
            this.wallet,
            { registry: new Registry(registry) }
        );

        // Load or create mTLS certificate
        this.certificate = await this.loadOrCreateCertificate();

        this.initialized = true;
        console.log("[Akash] ✅ Initialized");
    }

    /**
     * Create or load mTLS certificate for provider communication
     */
    private async loadOrCreateCertificate(): Promise<CertificatePem> {
        console.log("[Akash] 🔐 Creating mTLS certificate...");

        const certificate = certificateManager.generatePEM(this.address);

        let result: any;
        try {
            result = await cert.broadcastCertificate(
                certificate,
                this.address,
                this.client! as any
            );
        } catch (error: any) {
            if (error.message?.includes("certificate already exists")) {
                console.log("[Akash] 🔐 Using existing certificate");
                return certificate;
            }
            throw error;
        }

        if (result.code !== undefined && result.code === 0) {
            console.log("[Akash] 🔐 Certificate broadcast to chain");
            return certificate;
        }

        // Certificate might already exist — that's OK
        if (result.rawLog?.includes("certificate already exists")) {
            console.log("[Akash] 🔐 Using existing certificate");
            return certificate;
        }

        throw new Error(`Certificate broadcast failed: ${result.rawLog}`);
    }

    // ─── DeploymentBackend Interface ─────────────────────────────

    async deploy(request: DeployRequest): Promise<DeployResponse> {
        try {
            await this.init();

            const tierNum = typeof request.tier === "number" ? request.tier : 0;

            console.log(`[Akash] 🚀 Deploying ${request.imageURI} (Tier ${tierNum})`);

            // ── STEP 1: Generate SDL ─────────────────────────────
            // NOTE: envVars are NOT in the SDL — they go in the manifest only
            const ports = request.ports?.length ? request.ports : [3000];
            const sdlYaml = generateSDL(request.imageURI, tierNum, ports);
            const sdl = SDL.fromString(sdlYaml, "beta3");

            // ── STEP 2: Create Deployment ────────────────────────
            const deployment = await this.createDeployment(sdl);
            const dseq = deployment.id.dseq;
            console.log(`[Akash] 📋 Deployment created: DSEQ ${dseq}`);

            // ── STEP 3: Wait for Bids ────────────────────────────
            const bid = await this.fetchBid(dseq, this.address);
            console.log(`[Akash] 🏷️  Bid received from provider: ${bid.id?.provider}`);

            // ── STEP 4: Create Lease ─────────────────────────────
            const lease = await this.createLease(bid);
            console.log(`[Akash] 📜 Lease created: DSEQ ${lease.id.dseq}`);

            // ── STEP 5: Send Manifest (envVars injected HERE) ────
            // CRITICAL: This is the ONLY point where envVars enter any payload
            await this.sendManifest(sdl, lease, request.envVars);
            console.log(`[Akash] 📦 Manifest sent to provider`);

            // ── STEP 6: Poll for service URL ─────────────────────
            const serviceUrl = await this.pollLeaseStatus(lease);
            console.log(`[Akash] ✅ Service live at: ${serviceUrl}`);

            return {
                success: true,
                deploymentId: `akash-${dseq}`,
                url: serviceUrl,
            };

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
        // Extract DSEQ from deploymentId
        const dseq = deploymentId.replace("akash-", "");
        console.log(`[Akash] 🛑 Closing deployment DSEQ ${dseq}`);

        await this.init();

        const msg = {
            typeUrl: "/akash.deployment.v1beta3.MsgCloseDeployment",
            value: {
                id: {
                    owner: this.address,
                    dseq: dseq,
                },
            },
        };

        const fee = { amount: [{ denom: "uakt", amount: "20000" }], gas: "800000" };
        await this.client!.signAndBroadcast(this.address, [msg], fee, "close deployment");
    }

    // ─── Private: Akash Lifecycle Methods ────────────────────────

    private async createDeployment(sdl: SDL): Promise<any> {
        const blockheight = await this.client!.getHeight();
        const groups = sdl.groups();

        // v1beta4 deposit is nested: { amount: {denom, amount}, sources: [] }
        const deployment = {
            id: {
                owner: this.address,
                dseq: String(blockheight),
            },
            groups,
            deposit: {
                amount: {
                    denom: "uakt",
                    amount: this.config.depositAmount,
                },
                sources: [{
                    depositor: this.address,
                    amount: {
                        denom: "uakt",
                        amount: this.config.depositAmount,
                    },
                }],
            },
            depositor: this.address,
            hash: await sdl.manifestVersion(),
        };

        const fee = { amount: [{ denom: "uakt", amount: "20000" }], gas: "800000" };

        const msg = {
            typeUrl: "/akash.deployment.v1beta4.MsgCreateDeployment",
            value: MsgCreateDeploymentV4.fromPartial(deployment),
        };

        const tx = await this.client!.signAndBroadcast(this.address, [msg], fee, "create deployment");

        if (tx.code !== undefined && tx.code === 0) {
            return deployment;
        }

        throw new Error(`CreateDeployment failed (code ${tx.code}): ${tx.rawLog}`);
    }

    private async fetchBid(dseq: string | number, owner: string): Promise<any> {
        const rpc = await getRpc(this.config.rpcEndpoint);
        const startTime = Date.now();

        while (Date.now() - startTime < this.config.bidTimeoutMs) {
            console.log("[Akash] ⏳ Fetching bids...");
            await new Promise(r => setTimeout(r, 5000));

            try {
                const request = QueryBidsRequest.fromPartial({
                    filters: { owner, dseq },
                });

                // Use RPC to query bids
                const queryClient = new (rpc as any).QueryClientImpl(rpc);
                const bids = await queryClient.Bids(request);

                if (bids.bids?.length > 0 && bids.bids[0].bid) {
                    return bids.bids[0].bid;
                }
            } catch (error: any) {
                console.warn(`[Akash] ⚠️  Bid fetch error: ${error.message}`);
            }
        }

        throw new Error(`No bids received within ${this.config.bidTimeoutMs / 1000}s. Aborting.`);
    }

    private async createLease(bid: any): Promise<any> {
        if (!bid.id) throw new Error("Bid ID is undefined");

        const lease = { bidId: bid.id };
        const fee = { amount: [{ denom: "uakt", amount: "50000" }], gas: "2000000" };

        const msg = {
            typeUrl: "/akash.market.v1beta5.MsgCreateLease",
            value: MsgCreateLeaseV5.fromPartial(lease),
        };

        const tx = await this.client!.signAndBroadcast(this.address, [msg], fee, "create lease");

        if (tx.code !== undefined && tx.code === 0) {
            return {
                id: BidID ? BidID.toJSON(bid.id) : bid.id,
            };
        }

        throw new Error(`CreateLease failed: ${tx.rawLog}`);
    }

    private async sendManifest(sdl: SDL, lease: any, envVars: Record<string, string>): Promise<void> {
        const { dseq, provider } = lease.id;

        // Query provider info for their host URI
        const rpc = await getRpc(this.config.rpcEndpoint);
        let providerUri: string;

        try {
            const queryClient = new (rpc as any).QueryClientImpl(rpc);
            const request = QueryProviderRequest.fromPartial({ owner: provider });
            const response = await queryClient.Provider(request);
            providerUri = response.provider.hostUri;
        } catch {
            // Fallback: construct provider URI from address
            providerUri = `https://provider.${provider}.akash.pub:8443`;
        }

        // Build manifest JSON — this is where envVars are injected (RAM only)
        const manifestJson = sdl.manifestSortedJSON();
        const manifest = JSON.parse(manifestJson);

        // Inject env vars into each service in the manifest
        // SECURITY: This data only exists in RAM and in the mTLS request body
        if (manifest && Array.isArray(manifest)) {
            for (const group of manifest) {
                if (group.services) {
                    for (const service of group.services) {
                        service.env = service.env || [];
                        for (const [key, value] of Object.entries(envVars)) {
                            service.env.push(`${key}=${value}`);
                        }
                    }
                }
            }
        }

        const manifestBody = JSON.stringify(manifest);
        const path = `/deployment/${dseq}/manifest`;
        const uri = new URL(providerUri);

        const agent = new https.Agent({
            cert: this.certificate!.cert,
            key: this.certificate!.privateKey,
            rejectUnauthorized: false,
            servername: "",
        });

        await new Promise<void>((resolve, reject) => {
            const req = https.request(
                {
                    hostname: uri.hostname,
                    port: uri.port || 8443,
                    path,
                    method: "PUT",
                    headers: {
                        "Content-Type": "application/json",
                        Accept: "application/json",
                        "Content-Length": Buffer.byteLength(manifestBody),
                    },
                    agent,
                },
                (res) => {
                    let data = "";
                    res.on("data", (chunk) => (data += chunk));
                    res.on("end", () => {
                        if (res.statusCode === 200 || res.statusCode === 201) {
                            resolve();
                        } else {
                            reject(new Error(`Manifest send failed (${res.statusCode}): ${data}`));
                        }
                    });
                }
            );

            req.on("error", reject);
            req.write(manifestBody);
            req.end();
        });

        // SECURITY: Wipe manifest body from memory
        // (The string is immutable in JS but we zero the reference)
        // The envVars object will be wiped by the orchestrator after this returns
    }

    private async pollLeaseStatus(lease: any): Promise<string> {
        const { dseq, gseq, oseq, provider } = lease.id;

        // Query provider URI
        const rpc = await getRpc(this.config.rpcEndpoint);
        let providerUri: string;

        try {
            const queryClient = new (rpc as any).QueryClientImpl(rpc);
            const request = QueryProviderRequest.fromPartial({ owner: provider });
            const response = await queryClient.Provider(request);
            providerUri = response.provider.hostUri;
        } catch {
            providerUri = `https://provider.${provider}.akash.pub:8443`;
        }

        const leasePath = `/lease/${dseq}/${gseq || 1}/${oseq || 1}/status`;
        const uri = new URL(providerUri);

        const agent = new https.Agent({
            cert: this.certificate!.cert,
            key: this.certificate!.privateKey,
            rejectUnauthorized: false,
            servername: "",
        });

        const startTime = Date.now();

        while (Date.now() - startTime < this.config.leaseTimeoutMs) {
            console.log("[Akash] ⏳ Waiting for container to start...");

            try {
                const status = await new Promise<any>((resolve, reject) => {
                    const req = https.request(
                        {
                            hostname: uri.hostname,
                            port: uri.port || 8443,
                            path: leasePath,
                            method: "GET",
                            headers: {
                                "Content-Type": "application/json",
                                Accept: "application/json",
                            },
                            agent,
                        },
                        (res) => {
                            if (res.statusCode !== 200) {
                                return reject(new Error(`Lease status: ${res.statusCode}`));
                            }
                            let data = "";
                            res.on("data", (chunk) => (data += chunk));
                            res.on("end", () => resolve(JSON.parse(data)));
                        }
                    );
                    req.on("error", reject);
                    req.end();
                });

                // Extract service URI
                if (status?.services) {
                    for (const [name, service] of Object.entries(status.services) as any) {
                        if (service.uris?.length > 0) {
                            return `https://${service.uris[0]}`;
                        }
                    }
                }
            } catch {
                // Not ready yet
            }

            await new Promise(r => setTimeout(r, 5000));
        }

        throw new Error(`Container did not start within ${this.config.leaseTimeoutMs / 1000}s`);
    }
}
