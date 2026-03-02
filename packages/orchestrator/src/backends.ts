/**
 * @module @aporia/orchestrator
 * Deployment Backend Interface + Docker Implementation + Akash Implementation
 *
 * Strategy pattern: swap DockerBackend for AkashBackend
 * without touching the orchestrator logic.
 */

import { Tier, TIER_SPECS } from "@aporia/deployer";

// ─── Types ───────────────────────────────────────────────────────

/** Request to deploy a bot container */
export interface DeployRequest {
  /** Unique bot ID from the contract */
  botId: string;
  /** Docker image URI */
  imageURI: string;
  /** Hardware tier */
  tier: Tier;
  /** Decrypted environment variables (in RAM, never persisted) */
  envVars: Record<string, string>;
  /** Ports to expose */
  ports: number[];
}

/** Response from a deployment */
export interface DeployResponse {
  /** Whether the deployment succeeded */
  success: boolean;
  /** Container/deployment ID */
  deploymentId: string;
  /** URL where the bot is reachable */
  url: string;
  /** Error message if failed */
  error?: string;
}

// ─── Interface ───────────────────────────────────────────────────

/**
 * DeploymentBackend – Pluggable interface for container orchestration
 *
 * Implementations:
 * - DockerBackend: Local Docker (MVP / testing)
 * - AkashBackend:  Decentralized cloud (production, future)
 */
export interface DeploymentBackend {
  /** Human-readable name of the backend */
  readonly name: string;

  /**
   * Deploy a bot container
   * @returns DeployResponse with deployment ID and accessible URL
   */
  deploy(request: DeployRequest): Promise<DeployResponse>;

  /**
   * Stop a running deployment (optional, for cleanup)
   */
  stop?(deploymentId: string): Promise<void>;
}

// ─── Docker Backend ──────────────────────────────────────────────

/**
 * DockerBackend – Deploys bots as local Docker containers
 *
 * Used for MVP and local testing. In production, replace with AkashBackend.
 */
export class DockerBackend implements DeploymentBackend {
  readonly name = "Docker (local)";
  private hostAddress: string;

  constructor(hostAddress: string = "http://localhost") {
    this.hostAddress = hostAddress;
  }

  async deploy(request: DeployRequest): Promise<DeployResponse> {
    try {
      const { deployWithDocker } = await import("@aporia/deployer");

      const containerName = `aporia-${request.botId.substring(0, 10)}-${Date.now()}`;
      const ports = request.ports.length > 0 ? request.ports : [3000];

      console.log(`[Docker] 🐳 Deploying ${request.imageURI} as ${containerName}`);

      const result = await deployWithDocker({
        imageURI: request.imageURI,
        tier: request.tier,
        ports,
        envVars: request.envVars,
        containerName,
      });

      if (result.status === "error") {
        return {
          success: false,
          deploymentId: "",
          url: "",
          error: result.error || "Docker deployment failed",
        };
      }

      const primaryPort = ports[0];
      const url = `${this.hostAddress}:${primaryPort}`;

      console.log(`[Docker] ✅ Container ${containerName} running at ${url}`);

      return {
        success: true,
        deploymentId: result.containerId,
        url,
      };
    } catch (error: any) {
      return {
        success: false,
        deploymentId: "",
        url: "",
        error: error.message,
      };
    }
  }

  async stop(deploymentId: string): Promise<void> {
    const { stopContainer } = await import("@aporia/deployer");
    await stopContainer(deploymentId);
  }
}
