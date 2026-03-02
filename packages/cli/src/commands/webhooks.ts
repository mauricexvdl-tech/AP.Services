/**
 * @module @aporia/cli
 * Command: aporia webhooks
 * Manage Alchemy Notify webhooks for AporiaRegistry events
 */

import inquirer from "inquirer";
import chalk from "chalk";
import ora from "ora";
import { loadConfig, saveConfig } from "../config";

// Dynamic imports to avoid requiring @aporia/webhooks when not using this command
async function getWebhookModules() {
  const { registerWebhook, listWebhooks, deleteWebhook } = await import("@aporia/webhooks");
  const { WebhookServer, defaultHandlers } = await import("@aporia/webhooks");
  return { registerWebhook, listWebhooks, deleteWebhook, WebhookServer, defaultHandlers };
}

/**
 * aporia webhooks – Setup and manage Alchemy Notify webhooks
 */
export async function webhooksCommand(subcommand?: string): Promise<void> {
  switch (subcommand) {
    case "setup":
      return webhooksSetup();
    case "start":
      return webhooksStart();
    case "status":
      return webhooksStatus();
    default:
      console.log(chalk.bold.cyan("\n🎣 APORIA – Webhook Management\n"));
      console.log(chalk.white("  Available subcommands:\n"));
      console.log(chalk.gray("    aporia webhooks setup   – Register webhook with Alchemy"));
      console.log(chalk.gray("    aporia webhooks start   – Start local webhook server"));
      console.log(chalk.gray("    aporia webhooks status  – Show webhook configuration\n"));
  }
}

/**
 * Setup: Register a new webhook with Alchemy Notify
 */
async function webhooksSetup(): Promise<void> {
  console.log(chalk.bold.cyan("\n🎣 APORIA – Webhook Setup\n"));

  const config = loadConfig();

  const answers = await inquirer.prompt([
    {
      type: "input",
      name: "authToken",
      message: "Alchemy Notify Auth Token:",
      validate: (input: string) =>
        input.length > 0 || "Required. Generate at: https://dashboard.alchemy.com",
    },
    {
      type: "input",
      name: "webhookUrl",
      message: "Webhook endpoint URL (public):",
      default: "https://your-server.com/webhook/alchemy",
      validate: (input: string) =>
        input.startsWith("https://") || input.startsWith("http://localhost")
          ? true
          : "Must be HTTPS (or localhost for dev)",
    },
    {
      type: "list",
      name: "network",
      message: "Network:",
      choices: [
        { name: "Base Sepolia (testnet)", value: "base-sepolia" },
        { name: "Base Mainnet", value: "base-mainnet" },
      ],
      default: "base-sepolia",
    },
  ]);

  const spinner = ora("Registering webhook with Alchemy...").start();

  try {
    const { registerWebhook } = await getWebhookModules();

    const webhook = await registerWebhook({
      authToken: answers.authToken,
      webhookUrl: answers.webhookUrl,
      contractAddress: config.contractAddress,
      network: answers.network,
    });

    spinner.succeed("Webhook registered!");

    console.log(chalk.bold.green("\n✅ Webhook Active!"));
    console.log(chalk.white(`  ID:          ${webhook.id}`));
    console.log(chalk.white(`  URL:         ${webhook.url}`));
    console.log(chalk.white(`  Network:     ${webhook.network}`));
    console.log(chalk.white(`  Contract:    ${config.contractAddress}`));

    if (webhook.signingKey) {
      console.log(chalk.white(`  Signing Key: ${webhook.signingKey.substring(0, 12)}...`));

      // Save to config
      config.webhookUrl = answers.webhookUrl;
      config.webhookSigningKey = webhook.signingKey;
      saveConfig(config);
      console.log(chalk.gray("\n  Signing key saved to config."));
    }

    console.log(
      chalk.cyan("\n  Next: Run"),
      chalk.bold("aporia webhooks start"),
      chalk.cyan("to receive events.\n"),
    );
  } catch (error: any) {
    spinner.fail("Failed to register webhook");
    console.error(chalk.red(`\n❌ ${error.message}`));
  }
}

/**
 * Start: Run the local webhook server
 */
async function webhooksStart(): Promise<void> {
  console.log(chalk.bold.cyan("\n🎣 APORIA – Webhook Server\n"));

  const config = loadConfig();

  if (!config.webhookSigningKey) {
    console.log(chalk.yellow("⚠️  No signing key configured."));
    console.log(chalk.gray("   Run 'aporia webhooks setup' first, or provide a signing key:\n"));

    const { signingKey } = await inquirer.prompt([
      {
        type: "input",
        name: "signingKey",
        message: "Webhook signing key:",
        validate: (input: string) => input.length > 0 || "Required for signature verification",
      },
    ]);

    config.webhookSigningKey = signingKey;
    saveConfig(config);
  }

  const { port } = await inquirer.prompt([
    {
      type: "number",
      name: "port",
      message: "Server port:",
      default: 8089,
    },
  ]);

  try {
    const { WebhookServer } = await getWebhookModules();

    const server = new WebhookServer({
      port,
      signingKey: config.webhookSigningKey!,
    });

    await server.start();

    console.log(chalk.bold.green(`\n✅ Webhook server running on port ${port}`));
    console.log(chalk.gray("   Listening for AporiaRegistry events...\n"));
    console.log(chalk.gray("   Events monitored:"));
    console.log(chalk.gray("     • BotRegistered"));
    console.log(chalk.gray("     • Deposited"));
    console.log(chalk.gray("     • Withdrawn"));
    console.log(chalk.gray("     • RestartTriggered\n"));
    console.log(chalk.yellow("   Press Ctrl+C to stop.\n"));

    // Keep running
    await new Promise(() => {}); // infinite wait
  } catch (error: any) {
    console.error(chalk.red(`\n❌ Server error: ${error.message}`));
  }
}

/**
 * Status: Show current webhook configuration
 */
async function webhooksStatus(): Promise<void> {
  console.log(chalk.bold.cyan("\n🎣 APORIA – Webhook Status\n"));

  const config = loadConfig();

  console.log(chalk.white("  Configuration:"));
  console.log(
    chalk.gray(`    Webhook URL:    ${config.webhookUrl || chalk.yellow("Not configured")}`),
  );
  console.log(
    chalk.gray(
      `    Signing Key:    ${config.webhookSigningKey ? config.webhookSigningKey.substring(0, 12) + "..." : chalk.yellow("Not configured")}`,
    ),
  );
  console.log(chalk.gray(`    Contract:       ${config.contractAddress}`));

  if (config.alchemyApiKey) {
    console.log(chalk.gray(`    Alchemy API:    ${config.alchemyApiKey.substring(0, 8)}...`));
  }

  console.log("");
}
