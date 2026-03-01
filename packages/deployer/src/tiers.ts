/**
 * @module @aporia/deployer
 * Hardware tier definitions shared between contract and backend
 */

/** Hardware tier enum matching the smart contract */
export enum Tier {
    NANO = 0,
    LOGIC = 1,
    EXPERT = 2,
}

/** Resource specification for a tier */
export interface TierSpec {
    name: string;
    tier: Tier;
    cpu: number;       // vCPUs
    memory: string;    // e.g., "1Gi"
    memoryMB: number;  // in MB for Docker
    description: string;
    allowedPorts: number[];
}

/** Tier blueprints as per specification */
export const TIER_SPECS: Record<Tier, TierSpec> = {
    [Tier.NANO]: {
        name: "NANO",
        tier: Tier.NANO,
        cpu: 1,
        memory: "1Gi",
        memoryMB: 1024,
        description: "Trading-Bots (1 vCPU / 1 GB RAM)",
        allowedPorts: [80, 443, 3000],
    },
    [Tier.LOGIC]: {
        name: "LOGIC",
        tier: Tier.LOGIC,
        cpu: 2,
        memory: "4Gi",
        memoryMB: 4096,
        description: "API-Agents (2 vCPU / 4 GB RAM)",
        allowedPorts: [80, 443, 3000],
    },
    [Tier.EXPERT]: {
        name: "EXPERT",
        tier: Tier.EXPERT,
        cpu: 4,
        memory: "8Gi",
        memoryMB: 8192,
        description: "Data-Automation (4 vCPU / 8 GB RAM)",
        allowedPorts: [80, 443, 3000],
    },
};

/** Allowed ports per specification */
export const ALLOWED_PORTS = [80, 443, 3000];

/** Max image size in bytes (2 GB) */
export const MAX_IMAGE_SIZE_BYTES = 2 * 1024 * 1024 * 1024;

/**
 * Validate that requested ports are within the allowed set
 */
export function validatePorts(ports: number[]): { valid: boolean; invalidPorts: number[] } {
    const invalidPorts = ports.filter((p) => !ALLOWED_PORTS.includes(p));
    return {
        valid: invalidPorts.length === 0,
        invalidPorts,
    };
}
