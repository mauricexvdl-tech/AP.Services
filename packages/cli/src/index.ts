#!/usr/bin/env node

/**
 * APORIA CLI – Interact with the Decentralized Resurrection Protocol
 *
 * Commands:
 *   aporia init         - Initialize wallet & config
 *   aporia register     - Register a bot with encryption
 *   aporia status       - Query on-chain bot status
 *   aporia deposit      - Top up escrow balance
 *   aporia webhooks     - 🎣 Manage Alchemy Notify webhooks
 *   aporia orchestrate   - 🛡️  Start autonomous resurrection watchdog
 *   aporia test-local    - 🧪 Alpha: Full resurrection demo (local)
 *   aporia test-testnet  - 🔥 Live: Resurrection on Base Sepolia
 */

import { Command } from "commander";
import chalk from "chalk";
import { initCommand } from "./commands/init";
import { registerCommand } from "./commands/register";
import { statusCommand } from "./commands/status";
import { depositCommand } from "./commands/deposit";
import { testLocalCommand } from "./commands/test-local";
import { webhooksCommand } from "./commands/webhooks";
import { orchestrateCommand } from "./commands/orchestrate";
import { testTestnetCommand } from "./commands/test-testnet";

const program = new Command();

program
    .name("aporia")
    .description(chalk.cyan("🛡️  APORIA – Decentralized Resurrection Protocol CLI"))
    .version("1.0.0");

// ─── aporia init ─────────────────────────────────────────────

program
    .command("init")
    .description("Initialize your wallet and create a local config file")
    .action(async () => {
        try {
            await initCommand();
        } catch (error: any) {
            console.error(chalk.red(`\nError: ${error.message}`));
            process.exit(1);
        }
    });

// ─── aporia register ────────────────────────────────────────

program
    .command("register")
    .description("Register a new bot with the APORIA protocol")
    .action(async () => {
        try {
            await registerCommand();
        } catch (error: any) {
            console.error(chalk.red(`\nError: ${error.message}`));
            process.exit(1);
        }
    });

// ─── aporia status ──────────────────────────────────────────

program
    .command("status [botId]")
    .description("Check the on-chain status of your bot(s)")
    .action(async (botId?: string) => {
        try {
            await statusCommand(botId);
        } catch (error: any) {
            console.error(chalk.red(`\nError: ${error.message}`));
            process.exit(1);
        }
    });

// ─── aporia deposit ─────────────────────────────────────────

program
    .command("deposit")
    .description("Deposit ETH into the escrow pool for a bot")
    .option("--bot <botId>", "Bot ID (bytes32 hex)")
    .option("--amount <eth>", "Deposit amount in ETH")
    .action(async (opts) => {
        try {
            await depositCommand(opts.bot, opts.amount);
        } catch (error: any) {
            console.error(chalk.red(`\nError: ${error.message}`));
            process.exit(1);
        }
    });

// ─── aporia webhooks ────────────────────────────────────────

program
    .command("webhooks [subcommand]")
    .description("🎣 Manage Alchemy Notify webhooks (setup|start|status)")
    .action(async (subcommand?: string) => {
        try {
            await webhooksCommand(subcommand);
        } catch (error: any) {
            console.error(chalk.red(`\nError: ${error.message}`));
            process.exit(1);
        }
    });

// ─── aporia orchestrate ─────────────────────────────────────

program
    .command("orchestrate")
    .description("🛡️  Start the autonomous ResurrectionOrchestrator")
    .action(async () => {
        try {
            await orchestrateCommand();
        } catch (error: any) {
            console.error(chalk.red(`\nError: ${error.message}`));
            process.exit(1);
        }
    });

// ─── aporia test-local (God Mode) ───────────────────────────

program
    .command("test-local")
    .description("🧪 Alpha: Run full resurrection demo with local Docker")
    .action(async () => {
        try {
            await testLocalCommand();
        } catch (error: any) {
            console.error(chalk.red(`\nError: ${error.message}`));
            process.exit(1);
        }
    });

// ─── aporia test-testnet (🔥 LIVE) ──────────────────────────

program
    .command("test-testnet")
    .description("🔥 Live: Full resurrection demo on Base Sepolia (real txs!)")
    .action(async () => {
        try {
            // Load .env from contracts package for API keys
            const dotenv = await import("dotenv");
            const path = await import("path");
            dotenv.config({ path: path.resolve(__dirname, "..", "..", "..", "contracts", ".env") });
            await testTestnetCommand();
        } catch (error: any) {
            console.error(chalk.red(`\nError: ${error.message}`));
            process.exit(1);
        }
    });

// ─── Parse ───────────────────────────────────────────────────

program.parse();

