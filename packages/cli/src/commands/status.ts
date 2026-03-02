/**
 * @module @aporia/cli
 * Command: aporia status
 * Queries the on-chain status of registered bots
 */

import chalk from "chalk";
import ora from "ora";
import { ethers } from "ethers";
import { loadConfig } from "../config";
import { REGISTRY_ABI, TIER_NAMES } from "../abi";

export async function statusCommand(botId?: string): Promise<void> {
  console.log(chalk.bold.cyan("\n🛡️  APORIA – Bot Status\n"));

  const config = loadConfig();
  const provider = new ethers.JsonRpcProvider(config.rpcUrl);
  const registry = new ethers.Contract(config.contractAddress, REGISTRY_ABI, provider);

  if (botId) {
    // Show status for a specific bot
    await showBotStatus(registry, botId);
  } else {
    // Show all bots for this wallet
    await showAllBots(registry, config.privateKey, provider);
  }
}

async function showBotStatus(registry: ethers.Contract, botId: string): Promise<void> {
  const spinner = ora("Querying on-chain status...").start();

  try {
    const details = await registry.getBotDetails(botId);
    const cooldown = await registry.cooldownRemaining(botId);
    const canMon = await registry.canMonitor(botId);

    spinner.stop();

    // Determine display status
    let status: string;
    if (!details.isActive) {
      status = chalk.gray("INACTIVE");
    } else if (cooldown > 0n) {
      status = chalk.yellow("RECOVERING");
    } else if (canMon) {
      status = chalk.green("ACTIVE");
    } else {
      status = chalk.red("DOWN");
    }

    console.log(chalk.bold("┌─────────────────────────────────────────────┐"));
    console.log(chalk.bold("│  Bot Details                                │"));
    console.log(chalk.bold("├─────────────────────────────────────────────┤"));
    console.log(`│  ID:        ${chalk.white(botId.substring(0, 18))}...   │`);
    console.log(`│  Status:    ${status}                           │`);
    console.log(`│  Image:     ${chalk.white(details.imageURI.substring(0, 25))}        │`);
    console.log(`│  Tier:      ${chalk.cyan(TIER_NAMES[Number(details.tier)])}  │`);
    console.log(
      `│  Balance:   ${chalk.green(ethers.formatEther(details.balance))} ETH             │`,
    );
    console.log(`│  Owner:     ${chalk.gray(details.owner.substring(0, 18))}...  │`);
    console.log(chalk.bold("└─────────────────────────────────────────────┘"));

    if (cooldown > 0n) {
      const mins = Number(cooldown) / 60;
      console.log(chalk.yellow(`\n  ⏳ Cooldown: ${mins.toFixed(0)} minutes remaining`));
    }

    if (!details.isActive) {
      const restartCost = await registry.restartCost(details.tier);
      const needed = restartCost * 2n - details.balance;
      if (needed > 0n) {
        console.log(
          chalk.yellow(
            `\n  ⚠️  Monitoring inactive. Deposit ${ethers.formatEther(needed)} ETH more to activate.`,
          ),
        );
        console.log(chalk.gray(`     Run: aporia deposit --bot ${botId} --amount <ETH>`));
      }
    }
  } catch (error: any) {
    spinner.fail("Failed to query bot status");
    if (error.message.includes("BotNotFound")) {
      console.log(chalk.red(`\n❌ Bot not found: ${botId}`));
    } else {
      console.error(chalk.red(`\n❌ Error: ${error.message}`));
    }
  }
}

async function showAllBots(
  registry: ethers.Contract,
  privateKey: string,
  provider: ethers.JsonRpcProvider,
): Promise<void> {
  const wallet = new ethers.Wallet(privateKey, provider);
  const spinner = ora("Fetching your bots from the chain...").start();

  try {
    const allBotIds: string[] = await registry.getAllBotIds();
    const myBots: Array<{ botId: string; details: any }> = [];

    for (const botId of allBotIds) {
      try {
        const details = await registry.getBotDetails(botId);
        if (details.owner.toLowerCase() === wallet.address.toLowerCase()) {
          myBots.push({ botId, details });
        }
      } catch {
        // Skip bots we can't access
      }
    }

    spinner.stop();

    if (myBots.length === 0) {
      console.log(chalk.gray("  No bots found for this wallet."));
      console.log(
        chalk.cyan(`  Run ${chalk.bold("aporia register")} to register your first bot.\n`),
      );
      return;
    }

    console.log(
      chalk.white(`  Found ${chalk.bold(String(myBots.length))} bot(s) for ${wallet.address}\n`),
    );

    for (const { botId, details } of myBots) {
      let statusIcon: string;
      if (!details.isActive) {
        statusIcon = "⚪";
      } else {
        statusIcon = "🟢";
      }

      console.log(
        `  ${statusIcon}  ${chalk.bold(botId.substring(0, 18))}...  ` +
          `${chalk.cyan(TIER_NAMES[Number(details.tier)])}  ` +
          `${chalk.green(ethers.formatEther(details.balance))} ETH`,
      );
    }

    console.log(chalk.gray(`\n  Use ${chalk.bold("aporia status <bot-id>")} for detailed info.\n`));
  } catch (error: any) {
    spinner.fail("Failed to fetch bots");
    console.error(chalk.red(`\n❌ Error: ${error.message}`));
  }
}
