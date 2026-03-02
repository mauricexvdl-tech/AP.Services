/**
 * @module @aporia/deployer
 * Akash SDL file generator + Docker deployment orchestration
 */

import * as yaml from "js-yaml";
import { Tier, TIER_SPECS, ALLOWED_PORTS, validatePorts, TierSpec } from "./tiers";

// ─── SDL Generation ──────────────────────────────────────────

/** Configuration for SDL generation */
export interface SDLConfig {
  /** Docker image URI */
  imageURI: string;
  /** Hardware tier */
  tier: Tier;
  /** Ports to expose (must be subset of ALLOWED_PORTS) */
  ports: number[];
  /** Environment variables (will be injected at runtime) */
  envVars?: Record<string, string>;
  /** Deployment name */
  name?: string;
}

/** Generated SDL result */
export interface SDLResult {
  /** The SDL YAML string */
  sdl: string;
  /** Parsed SDL object */
  sdlObject: Record<string, any>;
  /** Tier spec used */
  tierSpec: TierSpec;
}

/**
 * Generate an Akash-compatible SDL (Stack Definition Language) file
 *
 * SDL defines the compute resources, container image, ports, and
 * pricing for deployment on the Akash decentralized cloud.
 */
export function generateSDL(config: SDLConfig): SDLResult {
  const { imageURI, tier, ports, envVars, name } = config;
  const tierSpec = TIER_SPECS[tier];
  const deploymentName = name || "aporia-bot";

  // Validate ports
  const portValidation = validatePorts(ports);
  if (!portValidation.valid) {
    throw new Error(
      `Invalid ports: ${portValidation.invalidPorts.join(", ")}. Allowed: ${ALLOWED_PORTS.join(", ")}`,
    );
  }

  // Build SDL object (Akash SDL v2 format)
  const sdlObject: Record<string, any> = {
    version: "2.0",

    services: {
      [deploymentName]: {
        image: imageURI,
        env: envVars ? Object.entries(envVars).map(([k, v]) => `${k}=${v}`) : [],
        expose: ports.map((port) => ({
          port,
          as: port,
          to: [{ global: true }],
        })),
      },
    },

    profiles: {
      compute: {
        [deploymentName]: {
          resources: {
            cpu: {
              units: tierSpec.cpu,
            },
            memory: {
              size: tierSpec.memory,
            },
            storage: {
              size: "2Gi",
            },
          },
        },
      },
      placement: {
        dcloud: {
          attributes: {
            host: "akash",
          },
          signedBy: {
            anyOf: ["akash1365ez..."], // Placeholder – echte Auditor-Adresse bei Deployment
          },
          pricing: {
            [deploymentName]: {
              denom: "uakt",
              amount: 1000,
            },
          },
        },
      },
    },

    deployment: {
      [deploymentName]: {
        dcloud: {
          profile: deploymentName,
          count: 1,
        },
      },
    },
  };

  const sdl = yaml.dump(sdlObject, {
    indent: 2,
    lineWidth: 120,
    noRefs: true,
  });

  return { sdl, sdlObject, tierSpec };
}

// ─── Docker Deployment ───────────────────────────────────────

/** Docker deployment configuration */
export interface DockerDeployConfig {
  /** Docker image URI */
  imageURI: string;
  /** Hardware tier */
  tier: Tier;
  /** Ports to expose */
  ports: number[];
  /** Environment variables */
  envVars: Record<string, string>;
  /** Container name */
  containerName?: string;
}

/** Result of a Docker deployment */
export interface DeployResult {
  containerId: string;
  containerName: string;
  status: "created" | "started" | "error";
  ports: Record<number, number>; // container port → host port
  error?: string;
}

/**
 * Deploy a container using Docker (for local testing / MVP)
 *
 * In production, this would use the Akash provider API.
 * For MVP, we use Docker directly via dockerode.
 */
export async function deployWithDocker(config: DockerDeployConfig): Promise<DeployResult> {
  // Dynamic import to avoid hard dependency when just generating SDL
  const Docker = (await import("dockerode")).default;
  const docker = new Docker();

  const tierSpec = TIER_SPECS[config.tier];
  const containerName = config.containerName || `aporia-${Date.now()}`;

  // Validate ports
  const portValidation = validatePorts(config.ports);
  if (!portValidation.valid) {
    throw new Error(
      `Invalid ports: ${portValidation.invalidPorts.join(", ")}. Allowed: ${ALLOWED_PORTS.join(", ")}`,
    );
  }

  try {
    // Pull image if not available locally
    console.log(`[Deployer] Pulling image: ${config.imageURI}`);
    await new Promise<void>((resolve, reject) => {
      docker.pull(config.imageURI, (err: any, stream: any) => {
        if (err) return reject(err);
        docker.modem.followProgress(stream, (err: any) => {
          if (err) return reject(err);
          resolve();
        });
      });
    });

    // Build port bindings
    const exposedPorts: Record<string, {}> = {};
    const portBindings: Record<string, { HostPort: string }[]> = {};

    for (const port of config.ports) {
      exposedPorts[`${port}/tcp`] = {};
      portBindings[`${port}/tcp`] = [{ HostPort: `${port}` }];
    }

    // Build env array
    const env = Object.entries(config.envVars).map(([k, v]) => `${k}=${v}`);

    // Create container
    console.log(`[Deployer] Creating container: ${containerName}`);
    const container = await docker.createContainer({
      Image: config.imageURI,
      name: containerName,
      Env: env,
      ExposedPorts: exposedPorts,
      HostConfig: {
        PortBindings: portBindings,
        Memory: tierSpec.memoryMB * 1024 * 1024, // Convert MB to bytes
        NanoCpus: tierSpec.cpu * 1e9, // Convert vCPU to nanocpus
        RestartPolicy: { Name: "unless-stopped" },
      },
    });

    // Start container
    console.log(`[Deployer] Starting container: ${containerName}`);
    await container.start();

    const ports: Record<number, number> = {};
    for (const port of config.ports) {
      ports[port] = port;
    }

    return {
      containerId: container.id,
      containerName,
      status: "started",
      ports,
    };
  } catch (error: any) {
    return {
      containerId: "",
      containerName,
      status: "error",
      ports: {},
      error: error.message,
    };
  }
}

/**
 * Stop and remove a Docker container
 */
export async function stopContainer(containerId: string): Promise<void> {
  const Docker = (await import("dockerode")).default;
  const docker = new Docker();

  const container = docker.getContainer(containerId);
  await container.stop();
  await container.remove();
  console.log(`[Deployer] Container ${containerId} stopped and removed`);
}
