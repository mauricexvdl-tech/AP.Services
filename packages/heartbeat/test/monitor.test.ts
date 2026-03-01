import { describe, it, expect, vi, beforeEach } from "vitest";
import { HeartbeatMonitor, RestartHandler } from "../src/monitor";
import { Tier, BotStatus, HealthCheckConfig } from "../src/types";
import http from "http";

// ─── Mock HTTP Server ────────────────────────────────────────────

function createMockServer(port: number, healthy: boolean): Promise<http.Server> {
    return new Promise((resolve) => {
        const server = http.createServer((req, res) => {
            if (req.url === "/aporia-health") {
                if (healthy) {
                    res.writeHead(200, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ status: "ok" }));
                } else {
                    res.writeHead(500);
                    res.end("Internal Server Error");
                }
            } else {
                res.writeHead(404);
                res.end();
            }
        });

        server.listen(port, () => resolve(server));
    });
}

function closeServer(server: http.Server): Promise<void> {
    return new Promise((resolve) => server.close(() => resolve()));
}

// ─── Tests ───────────────────────────────────────────────────────

describe("HeartbeatMonitor", () => {
    const testConfig: Partial<HealthCheckConfig> = {
        timeoutMs: 2000,
        maxFailures: 3,
        intervalMs: 60000, // nicht automatisch triggern im Test
        concurrency: 10,
    };

    let restartHandler: RestartHandler;
    let restartCalls: any[];

    beforeEach(() => {
        restartCalls = [];
        restartHandler = vi.fn(async (event) => {
            restartCalls.push(event);
        });
    });

    it("should add and track bots", () => {
        const monitor = new HeartbeatMonitor(testConfig, restartHandler);
        monitor.addBot({
            botId: "bot-1",
            url: "http://localhost:9001",
            imageURI: "mybot:latest",
            tier: Tier.NANO,
        });

        expect(monitor.getAllBots()).toHaveLength(1);
        expect(monitor.getBotStatus("bot-1")?.status).toBe(BotStatus.HEALTHY);
    });

    it("should remove bots", () => {
        const monitor = new HeartbeatMonitor(testConfig, restartHandler);
        monitor.addBot({
            botId: "bot-1",
            url: "http://localhost:9001",
            imageURI: "mybot:latest",
            tier: Tier.NANO,
        });

        expect(monitor.removeBot("bot-1")).toBe(true);
        expect(monitor.getAllBots()).toHaveLength(0);
    });

    it("should detect healthy bot", async () => {
        const server = await createMockServer(9010, true);
        const monitor = new HeartbeatMonitor(testConfig, restartHandler);
        monitor.addBot({
            botId: "healthy-bot",
            url: "http://localhost:9010",
            imageURI: "mybot:latest",
            tier: Tier.NANO,
        });

        const results = await monitor.runHealthCheckRound();
        expect(results).toHaveLength(1);
        expect(results[0].healthy).toBe(true);
        expect(monitor.getBotStatus("healthy-bot")?.status).toBe(BotStatus.HEALTHY);

        monitor.stop();
        await closeServer(server);
    });

    it("should detect unhealthy bot and increment failure count", async () => {
        const server = await createMockServer(9011, false);
        const monitor = new HeartbeatMonitor(testConfig, restartHandler);
        monitor.addBot({
            botId: "sick-bot",
            url: "http://localhost:9011",
            imageURI: "mybot:latest",
            tier: Tier.NANO,
        });

        await monitor.runHealthCheckRound();
        expect(monitor.getBotStatus("sick-bot")?.failureCount).toBe(1);
        expect(monitor.getBotStatus("sick-bot")?.status).toBe(BotStatus.DEGRADED);

        monitor.stop();
        await closeServer(server);
    });

    it("should trigger restart after 3 consecutive failures", async () => {
        const server = await createMockServer(9012, false);
        const monitor = new HeartbeatMonitor(testConfig, restartHandler);
        monitor.addBot({
            botId: "dying-bot",
            url: "http://localhost:9012",
            imageURI: "mybot:latest",
            tier: Tier.LOGIC,
        });

        // 3 consecutive failures
        await monitor.runHealthCheckRound();
        await monitor.runHealthCheckRound();
        await monitor.runHealthCheckRound();

        expect(restartHandler).toHaveBeenCalledOnce();
        expect(restartCalls[0].botId).toBe("dying-bot");
        expect(monitor.getBotStatus("dying-bot")?.status).toBe(BotStatus.COOLDOWN);

        monitor.stop();
        await closeServer(server);
    });

    it("should reset failure count on recovery", async () => {
        let healthy = false;
        const server = await createMockServer(9013, healthy);
        const monitor = new HeartbeatMonitor(testConfig, restartHandler);
        monitor.addBot({
            botId: "flaky-bot",
            url: "http://localhost:9013",
            imageURI: "mybot:latest",
            tier: Tier.NANO,
        });

        // 1 failure
        await monitor.runHealthCheckRound();
        expect(monitor.getBotStatus("flaky-bot")?.failureCount).toBe(1);

        // Now we need to restart with healthy server
        await closeServer(server);
        const healthyServer = await createMockServer(9013, true);

        await monitor.runHealthCheckRound();
        expect(monitor.getBotStatus("flaky-bot")?.failureCount).toBe(0);
        expect(monitor.getBotStatus("flaky-bot")?.status).toBe(BotStatus.HEALTHY);

        monitor.stop();
        await closeServer(healthyServer);
    });

    it("should handle unreachable bots (connection refused)", async () => {
        const monitor = new HeartbeatMonitor(testConfig, restartHandler);
        monitor.addBot({
            botId: "ghost-bot",
            url: "http://localhost:9099", // kein Server auf diesem Port
            imageURI: "mybot:latest",
            tier: Tier.NANO,
        });

        const results = await monitor.runHealthCheckRound();
        expect(results[0].healthy).toBe(false);
        expect(results[0].error).toBeTruthy();
    });

    it("should batch health-checks with concurrency control", async () => {
        const servers: http.Server[] = [];
        const monitor = new HeartbeatMonitor({ ...testConfig, concurrency: 2 }, restartHandler);

        for (let i = 0; i < 5; i++) {
            const port = 9020 + i;
            const server = await createMockServer(port, true);
            servers.push(server);
            monitor.addBot({
                botId: `batch-bot-${i}`,
                url: `http://localhost:${port}`,
                imageURI: "mybot:latest",
                tier: Tier.NANO,
            });
        }

        const results = await monitor.runHealthCheckRound();
        expect(results).toHaveLength(5);
        expect(results.every((r) => r.healthy)).toBe(true);

        monitor.stop();
        for (const server of servers) {
            await closeServer(server);
        }
    });
});
