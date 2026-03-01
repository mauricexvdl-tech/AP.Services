/**
 * @module @aporia/heartbeat
 * Shared types for the Heartbeat Watchdog module
 */

/** Hardware-Tier matching the smart contract enum */
export enum Tier {
    NANO = 0,
    LOGIC = 1,
    EXPERT = 2,
}

/** Status of a monitored bot */
export enum BotStatus {
    HEALTHY = "HEALTHY",
    DEGRADED = "DEGRADED",     // 1-2 failed checks
    DOWN = "DOWN",              // 3 failed checks → trigger restart
    COOLDOWN = "COOLDOWN",     // Restart triggered, in cooldown
    INACTIVE = "INACTIVE",     // Monitoring deactivated (no balance)
}

/** Configuration for the health-check endpoint */
export interface HealthCheckConfig {
    /** Health-check endpoint path (default: /aporia-health) */
    endpoint: string;
    /** Timeout per health-check request in ms (default: 30000) */
    timeoutMs: number;
    /** Number of consecutive failures before triggering restart (default: 3) */
    maxFailures: number;
    /** Interval between health-check rounds in ms (default: 30000) */
    intervalMs: number;
    /** Max concurrent health-checks (default: 50) */
    concurrency: number;
}

/** A monitored bot entry */
export interface MonitoredBot {
    /** Unique bot ID (from smart contract) */
    botId: string;
    /** URL where the bot is running (e.g., http://1.2.3.4:3000) */
    url: string;
    /** Docker image URI */
    imageURI: string;
    /** Hardware tier */
    tier: Tier;
    /** Current status */
    status: BotStatus;
    /** Consecutive failure count */
    failureCount: number;
    /** Last successful health-check timestamp */
    lastHealthy: number | null;
    /** Last restart timestamp */
    lastRestart: number | null;
}

/** Result of a health-check */
export interface HealthCheckResult {
    botId: string;
    healthy: boolean;
    responseTimeMs: number | null;
    error: string | null;
    timestamp: number;
}

/** Event emitted when a restart is triggered */
export interface RestartEvent {
    botId: string;
    url: string;
    imageURI: string;
    tier: Tier;
    timestamp: number;
    reason: string;
}

/** Default health-check configuration */
export const DEFAULT_CONFIG: HealthCheckConfig = {
    endpoint: "/aporia-health",
    timeoutMs: 30_000,
    maxFailures: 3,
    intervalMs: 30_000,
    concurrency: 50,
};
