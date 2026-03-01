/**
 * @module @aporia/heartbeat
 * Core monitoring engine: async-batched health-checks with failure detection
 */

import {
    MonitoredBot,
    HealthCheckResult,
    HealthCheckConfig,
    RestartEvent,
    BotStatus,
    DEFAULT_CONFIG,
} from "./types";

// Use dynamic import for p-limit (ESM module)
let pLimit: (concurrency: number) => <T>(fn: () => Promise<T>) => Promise<T>;

async function loadPLimit() {
    const mod = await import("p-limit");
    pLimit = mod.default;
}

export type RestartHandler = (event: RestartEvent) => Promise<void>;

/**
 * Heartbeat Monitor – watches registered bots and triggers restarts
 *
 * Architecture:
 * - Runs periodic health-check rounds with configurable interval
 * - Uses p-limit for async batching (concurrent pings without overload)
 * - 3 consecutive failures = trigger restart callback
 * - Integrates with AporiaRegistry via restart handler
 */
export class HeartbeatMonitor {
    private bots: Map<string, MonitoredBot> = new Map();
    private config: HealthCheckConfig;
    private onRestart: RestartHandler;
    private intervalHandle: ReturnType<typeof setInterval> | null = null;
    private isRunning = false;

    constructor(config: Partial<HealthCheckConfig> = {}, onRestart: RestartHandler) {
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.onRestart = onRestart;
    }

    /**
     * Register a bot for monitoring
     */
    addBot(bot: Omit<MonitoredBot, "status" | "failureCount" | "lastHealthy" | "lastRestart">): void {
        this.bots.set(bot.botId, {
            ...bot,
            status: BotStatus.HEALTHY,
            failureCount: 0,
            lastHealthy: null,
            lastRestart: null,
        });
    }

    /**
     * Remove a bot from monitoring
     */
    removeBot(botId: string): boolean {
        return this.bots.delete(botId);
    }

    /**
     * Get current status of a bot
     */
    getBotStatus(botId: string): MonitoredBot | undefined {
        return this.bots.get(botId);
    }

    /**
     * Get all monitored bots
     */
    getAllBots(): MonitoredBot[] {
        return Array.from(this.bots.values());
    }

    /**
     * Start the monitoring loop
     */
    async start(): Promise<void> {
        if (this.isRunning) return;

        await loadPLimit();
        this.isRunning = true;

        console.log(`[Heartbeat] Starting monitor with ${this.bots.size} bots`);
        console.log(`[Heartbeat] Config: interval=${this.config.intervalMs}ms, timeout=${this.config.timeoutMs}ms, maxFailures=${this.config.maxFailures}`);

        // Initial check
        await this.runHealthCheckRound();

        // Periodic checks
        this.intervalHandle = setInterval(async () => {
            await this.runHealthCheckRound();
        }, this.config.intervalMs);
    }

    /**
     * Stop the monitoring loop
     */
    stop(): void {
        if (this.intervalHandle) {
            clearInterval(this.intervalHandle);
            this.intervalHandle = null;
        }
        this.isRunning = false;
        console.log("[Heartbeat] Monitor stopped");
    }

    /**
     * Run a single health-check round across all bots
     * Uses p-limit for async batching
     */
    async runHealthCheckRound(): Promise<HealthCheckResult[]> {
        const activeBots = Array.from(this.bots.values()).filter(
            (bot) => bot.status !== BotStatus.INACTIVE && bot.status !== BotStatus.COOLDOWN
        );

        if (activeBots.length === 0) {
            return [];
        }

        if (!pLimit) {
            await loadPLimit();
        }
        const limit = pLimit(this.config.concurrency);

        const results = await Promise.allSettled(
            activeBots.map((bot) =>
                limit(() => this.checkBot(bot))
            )
        );

        const healthResults: HealthCheckResult[] = results.map((result, i) => {
            if (result.status === "fulfilled") {
                return result.value;
            }
            return {
                botId: activeBots[i].botId,
                healthy: false,
                responseTimeMs: null,
                error: result.reason?.message || "Unknown error",
                timestamp: Date.now(),
            };
        });

        // Process results
        for (const result of healthResults) {
            await this.processResult(result);
        }

        return healthResults;
    }

    /**
     * Perform a single health-check on a bot
     */
    async checkBot(bot: MonitoredBot): Promise<HealthCheckResult> {
        const url = `${bot.url}${this.config.endpoint}`;
        const startTime = Date.now();

        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);

            const response = await fetch(url, {
                method: "GET",
                signal: controller.signal,
            });

            clearTimeout(timeout);

            const responseTime = Date.now() - startTime;

            return {
                botId: bot.botId,
                healthy: response.ok,
                responseTimeMs: responseTime,
                error: response.ok ? null : `HTTP ${response.status}`,
                timestamp: Date.now(),
            };
        } catch (error: any) {
            return {
                botId: bot.botId,
                healthy: false,
                responseTimeMs: null,
                error: error.name === "AbortError" ? "Timeout" : error.message,
                timestamp: Date.now(),
            };
        }
    }

    /**
     * Process a health-check result: update bot status and trigger restart if needed
     */
    private async processResult(result: HealthCheckResult): Promise<void> {
        const bot = this.bots.get(result.botId);
        if (!bot) return;

        if (result.healthy) {
            // Reset failure count on success
            bot.failureCount = 0;
            bot.status = BotStatus.HEALTHY;
            bot.lastHealthy = result.timestamp;
            console.log(`[Heartbeat] ✅ ${bot.botId} healthy (${result.responseTimeMs}ms)`);
        } else {
            // Increment failure count
            bot.failureCount++;
            console.log(
                `[Heartbeat] ❌ ${bot.botId} failed (${bot.failureCount}/${this.config.maxFailures}): ${result.error}`
            );

            if (bot.failureCount >= this.config.maxFailures) {
                // TRIGGER RESTART
                bot.status = BotStatus.DOWN;
                console.log(`[Heartbeat] 🚨 ${bot.botId} DOWN – triggering restart!`);

                const restartEvent: RestartEvent = {
                    botId: bot.botId,
                    url: bot.url,
                    imageURI: bot.imageURI,
                    tier: bot.tier,
                    timestamp: Date.now(),
                    reason: `${this.config.maxFailures} consecutive health-check failures`,
                };

                try {
                    await this.onRestart(restartEvent);
                    bot.status = BotStatus.COOLDOWN;
                    bot.lastRestart = Date.now();
                    bot.failureCount = 0;
                    console.log(`[Heartbeat] 🔄 Restart triggered for ${bot.botId}`);
                } catch (err: any) {
                    console.error(`[Heartbeat] ❗ Restart failed for ${bot.botId}: ${err.message}`);
                }
            } else {
                bot.status = BotStatus.DEGRADED;
            }
        }
    }
}
