/**
 * @module @aporia/cli
 * Command: aporia orchestrate
 * Start the ResurrectionOrchestrator service
 */

import chalk from "chalk";
import ora from "ora";
import { loadConfig } from "../config";

/**
 * aporia orchestrate – Start the autonomous resurrection pipeline
 */
export async function orchestrateCommand(): Promise<void> {
  console.log(chalk.bold.cyan("\n🛡️  APORIA – ResurrectionOrchestrator\n"));

  const config = loadConfig();

  // Validate required config
  if (!config.deployerPublicKey) {
    console.log(chalk.red("❌ Missing deployer key. Run 'aporia init' first."));
    return;
  }

  const spinner = ora("Initializing orchestrator...").start();

  try {
    const { OrchestratorService } = await import("@aporia/orchestrator");
    const { publicKeyFromBase64 } = await import("@aporia/secrets");

    // The deployer secret key must be available to decrypt env vars
    // In production, this should come from a secure source (HSM, env var, etc.)
    const deployerSecretKeyHex = process.env.DEPLOYER_SECRET_KEY;
    if (!deployerSecretKeyHex) {
      spinner.fail("Missing DEPLOYER_SECRET_KEY environment variable");
      console.log(
        chalk.yellow(
          "\n  The deployer secret key is required to decrypt bot environment variables.",
        ),
      );
      console.log(
        chalk.gray("  Set it via: DEPLOYER_SECRET_KEY=<base64-key> aporia orchestrate\n"),
      );
      return;
    }

    // Import tweetnacl-util for base64 decoding
    const util = await import("tweetnacl-util");
    const deployerSecretKey = util.decodeBase64(deployerSecretKeyHex);

    const service = new OrchestratorService({
      rpcUrl: config.rpcUrl,
      operatorPrivateKey: config.privateKey,
      contractAddress: config.contractAddress,
      deployerSecretKey,
      defaultPorts: [3000],
      healthCheckConfig: {
        intervalMs: 30_000,
        maxFailures: 3,
        timeoutMs: 10_000,
      },
    });

    spinner.succeed("Orchestrator initialized");

    await service.start();

    // Graceful shutdown
    process.on("SIGINT", async () => {
      console.log(chalk.yellow("\n\nShutting down..."));
      await service.stop();
      process.exit(0);
    });

    process.on("SIGTERM", async () => {
      await service.stop();
      process.exit(0);
    });

    // Keep the process alive
    await new Promise(() => {});
  } catch (error: any) {
    spinner.fail("Failed to start orchestrator");
    console.error(chalk.red(`\n❌ ${error.message}`));
  }
}
