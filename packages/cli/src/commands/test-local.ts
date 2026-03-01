/**
 * @module @aporia/cli
 * Command: aporia test-local
 *
 * "God Mode" – Full Resurrection Cycle Demo
 *
 * Orchestrates:
 * 1. BUILD:     Build the dummy bot Docker image
 * 2. DEPLOY:    Start container via Dockerode
 * 3. MONITOR:   Start Heartbeat watchdog
 * 4. THE KILL:  Send GET /crash after 10s
 * 5. RESURRECT: Heartbeat detects failure → Deployer spins up new container
 */

import chalk from "chalk";
import ora from "ora";
import * as path from "path";
import * as http from "http";

// We use dynamic imports to avoid issues with module resolution
async function getDocker() {
    const Docker = (await import("dockerode")).default;
    return new Docker();
}

const IMAGE_NAME = "aporia-dummy-bot:latest";
const CONTAINER_NAME_PREFIX = "aporia-dummy";
const BOT_PORT = 3000;
const HEALTH_ENDPOINT = "/aporia-health";
const CRASH_ENDPOINT = "/crash";
const CRASH_DELAY_MS = 12_000;              // Wait 12s before crashing
const HEALTH_CHECK_INTERVAL_MS = 3_000;     // Check every 3s for the demo (faster than prod)
const HEALTH_CHECK_TIMEOUT_MS = 2_000;
const MAX_FAILURES = 3;

// ─── Helper: Sleep ───────────────────────────────────────────
function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Helper: HTTP GET ────────────────────────────────────────
function httpGet(url: string, timeoutMs: number = 2000): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
        const req = http.get(url, { timeout: timeoutMs }, (res) => {
            let body = "";
            res.on("data", (chunk) => (body += chunk));
            res.on("end", () => resolve({ status: res.statusCode || 0, body }));
        });
        req.on("error", reject);
        req.on("timeout", () => {
            req.destroy();
            reject(new Error("Timeout"));
        });
    });
}

// ─── Helper: Wait for container to be healthy ────────────────
async function waitForHealthy(port: number, maxAttempts: number = 20): Promise<boolean> {
    for (let i = 0; i < maxAttempts; i++) {
        try {
            const res = await httpGet(`http://localhost:${port}${HEALTH_ENDPOINT}`);
            if (res.status === 200) return true;
        } catch {
            // Not ready yet
        }
        await sleep(500);
    }
    return false;
}

// ─── Helper: Find and remove existing containers ─────────────
async function cleanupContainers(docker: any): Promise<void> {
    const containers = await docker.listContainers({ all: true });
    for (const containerInfo of containers) {
        if (containerInfo.Names?.some((n: string) => n.includes(CONTAINER_NAME_PREFIX))) {
            const container = docker.getContainer(containerInfo.Id);
            try {
                if (containerInfo.State === "running") {
                    await container.stop({ t: 2 });
                }
                await container.remove();
            } catch {
                // Ignore removal errors
            }
        }
    }
}

// ─── Helper: Start a container ───────────────────────────────
async function startContainer(docker: any, name: string, port: number): Promise<string> {
    const container = await docker.createContainer({
        Image: IMAGE_NAME,
        name,
        Env: ["PORT=3000", "NODE_ENV=test", "API_KEY=sk-test-demo-key"],
        ExposedPorts: { "3000/tcp": {} },
        HostConfig: {
            PortBindings: { "3000/tcp": [{ HostPort: String(port) }] },
            RestartPolicy: { Name: "" }, // NO auto-restart (we handle it)
        },
    });
    await container.start();
    return container.id;
}

// ═══════════════════════════════════════════════════════════════
//  MAIN: test-local command
// ═══════════════════════════════════════════════════════════════

export async function testLocalCommand(): Promise<void> {
    const docker = await getDocker();

    console.log(chalk.bold.cyan("\n" + "═".repeat(60)));
    console.log(chalk.bold.cyan("  🛡️  APORIA – ALPHA TEST: Local Resurrection Demo"));
    console.log(chalk.bold.cyan("═".repeat(60) + "\n"));

    let generation = 0;
    let currentContainerId: string | null = null;

    // ─────────────────────────────────────────────────────────────
    // PHASE 0: Cleanup old containers
    // ─────────────────────────────────────────────────────────────
    const cleanSpinner = ora("Cleaning up old test containers...").start();
    await cleanupContainers(docker);
    cleanSpinner.succeed("Cleaned up old containers");

    // ─────────────────────────────────────────────────────────────
    // PHASE 1: Build the dummy bot image
    // ─────────────────────────────────────────────────────────────
    console.log(chalk.bold.yellow("\n📦 PHASE 1: Building Dummy Bot Image\n"));

    const buildSpinner = ora("Building aporia-dummy-bot:latest...").start();

    try {
        const buildContext = path.resolve(__dirname, "..", "..", "dummy-bot");
        const stream = await docker.buildImage(
            { context: buildContext, src: ["Dockerfile", "server.js"] },
            { t: IMAGE_NAME }
        );

        // Follow build progress
        await new Promise<void>((resolve, reject) => {
            docker.modem.followProgress(stream, (err: any) => {
                if (err) reject(err);
                else resolve();
            });
        });

        buildSpinner.succeed(`Image ${chalk.bold(IMAGE_NAME)} built successfully`);
    } catch (error: any) {
        buildSpinner.fail("Failed to build Docker image");
        console.error(chalk.red(`\n❌ ${error.message}`));
        console.log(chalk.yellow("\n💡 Make sure Docker Desktop is running!\n"));
        return;
    }

    // ─────────────────────────────────────────────────────────────
    // PHASE 2: Deploy the first container
    // ─────────────────────────────────────────────────────────────
    console.log(chalk.bold.yellow("\n🚀 PHASE 2: Deploying Bot (Generation 0)\n"));

    const deploySpinner = ora("Starting container...").start();

    try {
        generation = 0;
        const containerName = `${CONTAINER_NAME_PREFIX}-gen${generation}`;
        currentContainerId = await startContainer(docker, containerName, BOT_PORT);
        deploySpinner.text = "Waiting for bot to become healthy...";

        const isHealthy = await waitForHealthy(BOT_PORT);
        if (!isHealthy) {
            deploySpinner.fail("Bot failed to start");
            return;
        }

        deploySpinner.succeed(`Bot deployed: ${chalk.green(containerName)} (${currentContainerId.substring(0, 12)})`);

        // Show health
        const res = await httpGet(`http://localhost:${BOT_PORT}${HEALTH_ENDPOINT}`);
        console.log(chalk.gray(`   Health: ${res.body}`));
    } catch (error: any) {
        deploySpinner.fail("Deployment failed");
        console.error(chalk.red(`\n❌ ${error.message}`));
        return;
    }

    // ─────────────────────────────────────────────────────────────
    // PHASE 3: Start Heartbeat Monitor
    // ─────────────────────────────────────────────────────────────
    console.log(chalk.bold.yellow("\n💓 PHASE 3: Starting Heartbeat Monitor\n"));
    console.log(chalk.gray(`   Interval: ${HEALTH_CHECK_INTERVAL_MS}ms  |  Timeout: ${HEALTH_CHECK_TIMEOUT_MS}ms  |  Max Failures: ${MAX_FAILURES}`));

    let failureCount = 0;
    let botIsDown = false;
    let resurrectionTriggered = false;

    // ─────────────────────────────────────────────────────────────
    // PHASE 4: Schedule THE KILL
    // ─────────────────────────────────────────────────────────────
    console.log(chalk.bold.yellow(`\n💀 PHASE 4: THE KILL scheduled in ${CRASH_DELAY_MS / 1000}s\n`));

    const killTimer = setTimeout(async () => {
        console.log(chalk.bold.red("\n" + "─".repeat(60)));
        console.log(chalk.bold.red("  💀 EXECUTING THE KILL – Sending crash signal..."));
        console.log(chalk.bold.red("─".repeat(60) + "\n"));

        try {
            await httpGet(`http://localhost:${BOT_PORT}${CRASH_ENDPOINT}`, 5000);
            console.log(chalk.red("  → Crash signal sent. Bot is dying...\n"));
        } catch {
            console.log(chalk.red("  → Crash signal sent (connection reset = bot already dead)\n"));
        }
    }, CRASH_DELAY_MS);

    // ─────────────────────────────────────────────────────────────
    // PHASE 5: THE MIRACLE – Monitor + Auto-Resurrect Loop
    // ─────────────────────────────────────────────────────────────

    const monitorLoop = async () => {
        const maxRounds = 30; // Safety limit
        for (let round = 1; round <= maxRounds; round++) {
            await sleep(HEALTH_CHECK_INTERVAL_MS);

            // Health check
            try {
                const res = await httpGet(`http://localhost:${BOT_PORT}${HEALTH_ENDPOINT}`, HEALTH_CHECK_TIMEOUT_MS);
                if (res.status === 200) {
                    if (resurrectionTriggered) {
                        // POST-RESURRECTION: New container is alive!
                        console.log(chalk.bold.green("\n" + "═".repeat(60)));
                        console.log(chalk.bold.green("  ✨ THE MIRACLE – Bot is ALIVE again!"));
                        console.log(chalk.bold.green("═".repeat(60)));

                        const info = JSON.parse(res.body);
                        console.log(chalk.green(`\n  🟢 Generation ${generation} is healthy`));
                        console.log(chalk.gray(`     Uptime: ${info.uptime?.toFixed(1)}s`));
                        console.log(chalk.gray(`     Requests: ${info.requests}`));

                        console.log(chalk.bold.cyan("\n" + "═".repeat(60)));
                        console.log(chalk.bold.cyan("  🛡️  APORIA RESURRECTION PROTOCOL – TEST PASSED"));
                        console.log(chalk.bold.cyan("═".repeat(60) + "\n"));

                        // Show summary
                        console.log(chalk.white("  📋 Summary:"));
                        console.log(chalk.white("     1. Bot deployed (Gen 0)      ✅"));
                        console.log(chalk.white("     2. Heartbeat monitoring      ✅"));
                        console.log(chalk.white("     3. Crash simulated           ✅"));
                        console.log(chalk.white(`     4. Failure detected (${MAX_FAILURES}x)     ✅`));
                        console.log(chalk.white("     5. Auto-resurrection (Gen 1) ✅"));
                        console.log(chalk.white("     6. Health restored           ✅\n"));

                        // Cleanup
                        await cleanupContainers(docker);
                        console.log(chalk.gray("  Containers cleaned up. Test complete.\n"));
                        return;
                    }

                    // Normal healthy state
                    failureCount = 0;
                    console.log(chalk.green(`  [Round ${round}] ✅ Healthy (Gen ${generation})`));
                    continue;
                }
            } catch {
                // Health check failed
            }

            // ─── FAILURE DETECTED ───────────────────────────────────
            failureCount++;
            console.log(chalk.red(`  [Round ${round}] ❌ FAILURE ${failureCount}/${MAX_FAILURES}`));

            if (failureCount >= MAX_FAILURES && !botIsDown) {
                botIsDown = true;
                clearTimeout(killTimer);

                console.log(chalk.bold.red(`\n  🚨 BOT IS DOWN – ${MAX_FAILURES} consecutive failures!`));
                console.log(chalk.bold.yellow("  🔄 TRIGGERING RESURRECTION...\n"));

                // ─── RESURRECT ─────────────────────────────────────────
                const resSpinner = ora("Removing dead container...").start();

                try {
                    // Stop and remove old container
                    if (currentContainerId) {
                        const oldContainer = docker.getContainer(currentContainerId);
                        try { await oldContainer.stop({ t: 1 }); } catch { /* already stopped */ }
                        try { await oldContainer.remove(); } catch { /* ignore */ }
                    }
                    resSpinner.text = `Deploying new container (Generation ${generation + 1})...`;

                    generation++;
                    const newName = `${CONTAINER_NAME_PREFIX}-gen${generation}`;
                    currentContainerId = await startContainer(docker, newName, BOT_PORT);

                    resSpinner.text = "Waiting for new bot to become healthy...";
                    const isHealthy = await waitForHealthy(BOT_PORT, 30);

                    if (isHealthy) {
                        resSpinner.succeed(`Resurrected: ${chalk.green(newName)} (${currentContainerId.substring(0, 12)})`);
                        resurrectionTriggered = true;
                        failureCount = 0;
                        botIsDown = false;
                        // Next loop iteration will detect the healthy state and celebrate
                    } else {
                        resSpinner.fail("Resurrection failed – new container not healthy");
                        await cleanupContainers(docker);
                        return;
                    }
                } catch (error: any) {
                    resSpinner.fail(`Resurrection error: ${error.message}`);
                    await cleanupContainers(docker);
                    return;
                }
            }
        }

        // Safety exit
        clearTimeout(killTimer);
        console.log(chalk.yellow("\n  ⚠️  Max rounds reached. Cleaning up..."));
        await cleanupContainers(docker);
    };

    await monitorLoop();
}
