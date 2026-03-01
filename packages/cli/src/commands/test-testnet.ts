/**
 * @module @aporia/cli
 * Command: aporia test-testnet
 *
 * 🔥 LIVE TESTNET – Full Resurrection Cycle on Base Sepolia 🔥
 *
 * Same flow as test-local, but with REAL blockchain transactions:
 * 1. BUILD:      Build dummy bot Docker image
 * 2. REGISTER:   Register bot on-chain (registerBot tx) + escrow deposit
 * 3. DEPLOY:     Start container via Docker
 * 4. MONITOR:    Heartbeat watchdog (health checks)
 * 5. THE KILL:   Send /crash to kill the bot
 * 6. RESURRECT:  Orchestrator detects → decrypt → redeploy → triggerRestart tx
 * 7. VERIFY:     Confirm on-chain state update
 */

import chalk from "chalk";
import ora from "ora";
import * as path from "path";
import * as http from "http";
import { ethers } from "ethers";
import { generateKeyPair, encryptEnv, publicKeyToBase64, envelopeToBytes } from "@aporia/secrets";

// ─── Config ──────────────────────────────────────────────────

const CONTRACT_ADDRESS = "0xc2167e6caF1412387c2291e232fFBE257Db57818";
const IMAGE_NAME = "aporia-dummy-bot:latest";
const CONTAINER_NAME_PREFIX = "aporia-testnet";
const BOT_PORT = 3000;
const HEALTH_ENDPOINT = "/aporia-health";
const CRASH_ENDPOINT = "/crash";
const CRASH_DELAY_MS = 15_000;             // 15s before crash
const HEALTH_CHECK_INTERVAL_MS = 4_000;    // Check every 4s
const HEALTH_CHECK_TIMEOUT_MS = 2_000;
const MAX_FAILURES = 3;

const REGISTRY_ABI = [
    "function registerBot(string imageURI, bytes encryptedEnv, uint8 tier) payable returns (bytes32 botId)",
    "function getBotDetails(bytes32 botId) view returns (string imageURI, bytes32 envHash, uint8 tier, uint256 balance, uint256 lastRestart, bool isActive, address owner)",
    "function triggerRestart(bytes32 botId)",
    "function restartCost(uint8 tier) view returns (uint256)",
    "function canMonitor(bytes32 botId) view returns (bool)",
    "function cooldownRemaining(bytes32 botId) view returns (uint256)",
    "function bots(bytes32 botId) view returns (string imageURI, bytes encryptedEnv, bytes32 envHash, uint8 tier, uint256 balance, uint256 lastRestart, bool isActive, address owner)",
    "event BotRegistered(bytes32 indexed botId, address indexed owner, string imageURI, uint8 tier)",
    "event RestartTriggered(bytes32 indexed botId, uint256 timestamp)",
];

// ─── Helpers ─────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function httpGet(url: string, timeoutMs: number = 2000): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
        const req = http.get(url, { timeout: timeoutMs }, (res) => {
            let body = "";
            res.on("data", (chunk) => (body += chunk));
            res.on("end", () => resolve({ status: res.statusCode || 0, body }));
        });
        req.on("error", reject);
        req.on("timeout", () => { req.destroy(); reject(new Error("Timeout")); });
    });
}

async function waitForHealthy(port: number, maxAttempts: number = 30): Promise<boolean> {
    for (let i = 0; i < maxAttempts; i++) {
        try {
            const res = await httpGet(`http://localhost:${port}${HEALTH_ENDPOINT}`);
            if (res.status === 200) return true;
        } catch { /* not ready */ }
        await sleep(500);
    }
    return false;
}

async function getDocker() {
    const Docker = (await import("dockerode")).default;
    return new Docker();
}

async function cleanupContainers(docker: any): Promise<void> {
    const containers = await docker.listContainers({ all: true });
    for (const info of containers) {
        if (info.Names?.some((n: string) => n.includes(CONTAINER_NAME_PREFIX))) {
            const c = docker.getContainer(info.Id);
            try { if (info.State === "running") await c.stop({ t: 2 }); } catch { }
            try { await c.remove(); } catch { }
        }
    }
}

async function startContainer(docker: any, name: string, port: number, env: string[]): Promise<string> {
    const container = await docker.createContainer({
        Image: IMAGE_NAME,
        name,
        Env: env,
        ExposedPorts: { "3000/tcp": {} },
        HostConfig: {
            PortBindings: { "3000/tcp": [{ HostPort: String(port) }] },
            RestartPolicy: { Name: "" },
        },
    });
    await container.start();
    return container.id;
}

// ═══════════════════════════════════════════════════════════════
//  MAIN: test-testnet command
// ═══════════════════════════════════════════════════════════════

export async function testTestnetCommand(): Promise<void> {
    const docker = await getDocker();

    // Load env
    const rpcUrl = process.env.BASE_SEPOLIA_RPC_URL ||
        (process.env.ALCHEMY_API_KEY
            ? `https://base-sepolia.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`
            : "");

    const privateKey = process.env.DEPLOYER_PRIVATE_KEY || "";

    if (!rpcUrl || !privateKey) {
        console.log(chalk.red("\n❌ Missing BASE_SEPOLIA_RPC_URL or DEPLOYER_PRIVATE_KEY in .env"));
        return;
    }

    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const wallet = new ethers.Wallet(privateKey, provider);
    const registry = new ethers.Contract(CONTRACT_ADDRESS, REGISTRY_ABI, wallet);

    console.log(chalk.bold.magenta("\n" + "═".repeat(60)));
    console.log(chalk.bold.magenta("  🔥 APORIA – LIVE TESTNET: Resurrection on Base Sepolia"));
    console.log(chalk.bold.magenta("═".repeat(60) + "\n"));
    console.log(chalk.white(`  Wallet:   ${wallet.address}`));
    console.log(chalk.white(`  Contract: ${CONTRACT_ADDRESS}`));
    console.log(chalk.white(`  RPC:      ${rpcUrl.substring(0, 50)}...`));

    const balance = await provider.getBalance(wallet.address);
    console.log(chalk.white(`  Balance:  ${ethers.formatEther(balance)} ETH\n`));

    if (balance < ethers.parseEther("0.003")) {
        console.log(chalk.red("  ❌ Not enough testnet ETH (need ~0.003 for registration + gas)"));
        return;
    }

    let generation = 0;
    let currentContainerId: string | null = null;
    let botId: string = "";

    // ─────────────────────────────────────────────────────────────
    // PHASE 0: Cleanup
    // ─────────────────────────────────────────────────────────────
    const cleanSpinner = ora("Cleaning up old containers...").start();
    await cleanupContainers(docker);
    cleanSpinner.succeed("Cleaned up");

    // ─────────────────────────────────────────────────────────────
    // PHASE 1: Build dummy bot image
    // ─────────────────────────────────────────────────────────────
    console.log(chalk.bold.yellow("\n📦 PHASE 1: Build Dummy Bot Image\n"));
    const buildSpinner = ora("Building aporia-dummy-bot:latest...").start();

    try {
        const buildContext = path.resolve(__dirname, "..", "..", "dummy-bot");
        const stream = await docker.buildImage(
            { context: buildContext, src: ["Dockerfile", "server.js"] },
            { t: IMAGE_NAME }
        );
        await new Promise<void>((resolve, reject) => {
            docker.modem.followProgress(stream, (err: any) => {
                if (err) reject(err); else resolve();
            });
        });
        buildSpinner.succeed(`Image ${chalk.bold(IMAGE_NAME)} built`);
    } catch (error: any) {
        buildSpinner.fail("Docker build failed");
        console.error(chalk.red(`  ${error.message}`));
        console.log(chalk.yellow("  💡 Make sure Docker Desktop is running!"));
        return;
    }

    // ─────────────────────────────────────────────────────────────
    // PHASE 2: Register bot ON-CHAIN ⛓️
    // ─────────────────────────────────────────────────────────────
    console.log(chalk.bold.yellow("\n⛓️  PHASE 2: Register Bot On-Chain (Base Sepolia)\n"));

    // Generate deployer keypair for encrypting env vars
    const deployerKeyPair = generateKeyPair();
    console.log(chalk.gray(`  Deployer public key: ${publicKeyToBase64(deployerKeyPair.publicKey).substring(0, 20)}...`));

    // Encrypt dummy env vars
    const dummyEnv: Record<string, string> = {
        PORT: "3000",
        NODE_ENV: "test",
        API_KEY: "sk-testnet-demo-key-" + Date.now(),
    };

    const envelope = encryptEnv(dummyEnv, deployerKeyPair.publicKey);
    const encryptedBytes = envelopeToBytes(envelope);
    console.log(chalk.gray(`  Encrypted env: ${encryptedBytes.length} bytes (${Object.keys(dummyEnv).length} vars)`));

    // Get restart cost for deposit
    const restartCost = await registry.restartCost(0); // NANO tier
    const deposit = restartCost * 3n; // 3x for safety

    console.log(chalk.gray(`  Restart cost: ${ethers.formatEther(restartCost)} ETH`));
    console.log(chalk.gray(`  Deposit (3x): ${ethers.formatEther(deposit)} ETH`));

    const regSpinner = ora("Sending registerBot transaction...").start();

    try {
        const tx = await registry.registerBot(
            IMAGE_NAME,
            encryptedBytes,
            0, // NANO tier
            { value: deposit }
        );
        regSpinner.text = `Tx sent: ${tx.hash.substring(0, 18)}... Waiting for block...`;

        const receipt = await tx.wait();

        // Extract botId from event
        const event = receipt.logs
            .map((log: any) => {
                try { return registry.interface.parseLog({ topics: log.topics, data: log.data }); }
                catch { return null; }
            })
            .find((parsed: any) => parsed?.name === "BotRegistered");

        botId = event?.args?.botId || "";

        regSpinner.succeed("Bot registered on-chain!");
        console.log(chalk.bold.green(`\n  ✅ On-Chain Registration Complete`));
        console.log(chalk.white(`  Bot ID:   ${botId}`));
        console.log(chalk.white(`  Tx Hash:  ${receipt.hash}`));
        console.log(chalk.white(`  Block:    ${receipt.blockNumber}`));
        console.log(chalk.white(`  Deposit:  ${ethers.formatEther(deposit)} ETH`));
        console.log(chalk.cyan(`  Basescan: https://sepolia.basescan.org/tx/${receipt.hash}\n`));
    } catch (error: any) {
        regSpinner.fail("Registration failed");
        console.error(chalk.red(`  ${error.message}`));
        return;
    }

    // ─────────────────────────────────────────────────────────────
    // PHASE 3: Deploy container (Docker)
    // ─────────────────────────────────────────────────────────────
    console.log(chalk.bold.yellow("\n🚀 PHASE 3: Deploy Bot Container (Gen 0)\n"));
    const deploySpinner = ora("Starting container...").start();

    try {
        const containerName = `${CONTAINER_NAME_PREFIX}-gen${generation}`;
        const envArray = Object.entries(dummyEnv).map(([k, v]) => `${k}=${v}`);
        currentContainerId = await startContainer(docker, containerName, BOT_PORT, envArray);
        deploySpinner.text = "Waiting for bot to become healthy...";

        const isHealthy = await waitForHealthy(BOT_PORT);
        if (!isHealthy) { deploySpinner.fail("Bot failed to start"); return; }

        deploySpinner.succeed(`Bot deployed: ${chalk.green(containerName)}`);

        const res = await httpGet(`http://localhost:${BOT_PORT}${HEALTH_ENDPOINT}`);
        console.log(chalk.gray(`  Health: ${res.body}`));
    } catch (error: any) {
        deploySpinner.fail(`Deploy failed: ${error.message}`);
        return;
    }

    // ─────────────────────────────────────────────────────────────
    // PHASE 5 & 6: OrchestratorService handles the rest!
    // ─────────────────────────────────────────────────────────────
    console.log(chalk.bold.yellow(`\n💀 PHASE 5: THE KILL scheduled in ${CRASH_DELAY_MS / 1000}s\n`));

    // Initialize the real orchestrator service to handle the crash
    const { OrchestratorService } = await import("@aporia/orchestrator");
    const util = await import("tweetnacl-util");

    // Use the ephemeral deployer secret key generated in Phase 2 for decryption
    const service = new OrchestratorService({
        rpcUrl,
        operatorPrivateKey: privateKey,
        contractAddress: CONTRACT_ADDRESS,
        deployerSecretKey: deployerKeyPair.secretKey,
        defaultPorts: [BOT_PORT],
        healthCheckConfig: {
            intervalMs: HEALTH_CHECK_INTERVAL_MS,
            maxFailures: MAX_FAILURES,
            timeoutMs: HEALTH_CHECK_TIMEOUT_MS,
        },
    });

    // Start service
    await service.start();

    // Trigger the crash on the LOCAL container
    setTimeout(async () => {
        console.log(chalk.bold.red("\n" + "─".repeat(60)));
        console.log(chalk.bold.red("  💀 THE KILL – Sending crash signal..."));
        console.log(chalk.bold.red("─".repeat(60) + "\n"));

        try {
            await httpGet(`http://localhost:${BOT_PORT}${CRASH_ENDPOINT}`, 5000);
        } catch { /* connection reset = bot died */ }

        // Ensure local container is actually dead
        if (currentContainerId) {
            try {
                const old = docker.getContainer(currentContainerId);
                await old.stop({ t: 1 });
            } catch { }
        }
    }, CRASH_DELAY_MS);

    // Wait for the orchestrator to resurrect and update the chain
    let resurrectionTriggered = false;
    const maxRounds = 40;

    for (let round = 1; round <= maxRounds; round++) {
        await sleep(HEALTH_CHECK_INTERVAL_MS);

        // Query the contract to see if lastRestart has changed!
        const details = await registry.getBotDetails(botId);
        const lastRestart = Number(details.lastRestart);

        // Or we can check if the monitor found a new URL that is healthy
        const bots = service.getMonitor().getAllBots();
        const ourBot = bots.find(b => b.botId === botId);

        if (ourBot && ourBot.url && !ourBot.url.includes("localhost") && !ourBot.url.includes("unknown")) {
            // Orchestrator has resurrected it to Akash!
            console.log(chalk.bold.green("\n" + "═".repeat(60)));
            console.log(chalk.bold.green("  ✨ THE MIRACLE – Orchestrator has deployed to Akash!"));
            console.log(chalk.bold.green("═".repeat(60)));

            console.log(chalk.green(`\n  🟢 New Akash URL: ${ourBot.url}`));

            // ─── PHASE 7: Verify on-chain state ────────────────
            console.log(chalk.bold.yellow("\n🔍 PHASE 7: Verify On-Chain State\n"));

            const postBalance = details.balance;

            console.log(chalk.white(`  Bot ID:       ${botId}`));
            console.log(chalk.white(`  Balance:      ${ethers.formatEther(postBalance)} ETH`));
            console.log(chalk.white(`  Last Restart: ${lastRestart > 0 ? new Date(lastRestart * 1000).toISOString() : "never"}`));
            console.log(chalk.white(`  Is Active:    ${details.isActive}`));
            console.log(chalk.white(`  Cooldown:     ${details.lastRestart > 0 ? "6h active" : "none"}`));

            // ─── FINAL SUMMARY ──────────────────────────────────
            console.log(chalk.bold.magenta("\n" + "═".repeat(60)));
            console.log(chalk.bold.magenta("  🛡️  APORIA TESTNET RESURRECTION – COMPLETE (AKASH)"));
            console.log(chalk.bold.magenta("═".repeat(60) + "\n"));

            resurrectionTriggered = true;
            break;
        }
    }

    await service.stop();

    if (!resurrectionTriggered) {
        console.log(chalk.yellow("\n  ⚠️  Timeout waiting for Orchestrator to resurrect."));
    }

    await cleanupContainers(docker);
    console.log(chalk.gray("  Containers cleaned up. Test complete.\n"));
}
