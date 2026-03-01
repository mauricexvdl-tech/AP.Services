/**
 * @module @aporia/cli
 * Command: aporia register
 * Registers a bot with the APORIA protocol
 *
 * Flow:
 * 1. Prompts for Docker image, tier, and env vars
 * 2. Encrypts env vars locally via @aporia/secrets
 * 3. Sends registerBot transaction to the AporiaRegistry contract
 */

import inquirer from "inquirer";
import chalk from "chalk";
import ora from "ora";
import { ethers } from "ethers";
import { encryptEnv, publicKeyFromBase64, envelopeToBytes } from "@aporia/secrets";
import { loadConfig } from "../config";
import { REGISTRY_ABI, TIER_NAMES } from "../abi";

export async function registerCommand(): Promise<void> {
    console.log(chalk.bold.cyan("\n🛡️  APORIA – Bot Registration\n"));

    const config = loadConfig();
    const provider = new ethers.JsonRpcProvider(config.rpcUrl);
    const wallet = new ethers.Wallet(config.privateKey, provider);
    const registry = new ethers.Contract(config.contractAddress, REGISTRY_ABI, wallet);

    console.log(chalk.gray(`Wallet: ${wallet.address}`));

    // ─── Step 1: Collect bot details ───────────────────────────

    const answers = await inquirer.prompt([
        {
            type: "input",
            name: "imageURI",
            message: "Docker Image URI (e.g., docker.io/mybot:latest):",
            validate: (input: string) => input.length > 0 || "Image URI cannot be empty.",
        },
        {
            type: "list",
            name: "tier",
            message: "Hardware Tier:",
            choices: [
                { name: `${chalk.green("NANO")}  – 1 vCPU / 1 GB RAM  (Trading-Bots)`, value: 0 },
                { name: `${chalk.yellow("LOGIC")} – 2 vCPU / 4 GB RAM  (API-Agents)`, value: 1 },
                { name: `${chalk.red("EXPERT")} – 4 vCPU / 8 GB RAM (Data-Automation)`, value: 2 },
            ],
        },
        {
            type: "confirm",
            name: "hasEnvVars",
            message: "Do you have environment variables (API keys, secrets) to encrypt?",
            default: true,
        },
    ]);

    // ─── Step 2: Collect env vars ──────────────────────────────

    const envVars: Record<string, string> = {};

    if (answers.hasEnvVars) {
        console.log(chalk.gray("\nEnter your env vars one by one. Type 'done' as key name to finish.\n"));

        let addingVars = true;
        while (addingVars) {
            const { key } = await inquirer.prompt([
                {
                    type: "input",
                    name: "key",
                    message: "ENV key (or 'done'):",
                },
            ]);

            if (key.toLowerCase() === "done") {
                addingVars = false;
                continue;
            }

            const { value } = await inquirer.prompt([
                {
                    type: "password",
                    name: "value",
                    message: `Value for ${chalk.bold(key)}:`,
                    mask: "*",
                },
            ]);

            envVars[key] = value;
            console.log(chalk.green(`  ✓ ${key} added`));
        }
    }

    // ─── Step 3: Encrypt env vars ──────────────────────────────

    const spinner = ora("Encrypting environment variables...").start();

    const deployerPubKey = publicKeyFromBase64(config.deployerPublicKey);
    const envelope = encryptEnv(envVars, deployerPubKey);
    const encryptedBytes = envelopeToBytes(envelope);

    spinner.succeed("Environment variables encrypted locally");
    console.log(chalk.gray(`  Encrypted blob size: ${encryptedBytes.length} bytes`));
    console.log(chalk.gray(`  Keys encrypted: ${Object.keys(envVars).length}`));

    // ─── Step 4: Determine deposit ─────────────────────────────

    let restartCost: bigint;
    try {
        restartCost = await registry.restartCost(answers.tier);
    } catch {
        // Fallback if contract not deployed yet
        restartCost = ethers.parseEther("0.001");
        console.log(chalk.yellow("\n  ⚠️  Could not read restart cost from contract. Using default."));
    }

    const minDeposit = restartCost * 2n;
    const suggestedDeposit = restartCost * 5n; // Enough for 5 restarts

    console.log(chalk.cyan(`\n💰 Escrow Deposit`));
    console.log(chalk.gray(`  Minimum (2x restart cost): ${ethers.formatEther(minDeposit)} ETH`));
    console.log(chalk.gray(`  Suggested (5x):            ${ethers.formatEther(suggestedDeposit)} ETH`));

    const { depositAmount } = await inquirer.prompt([
        {
            type: "input",
            name: "depositAmount",
            message: "Deposit amount (ETH):",
            default: ethers.formatEther(suggestedDeposit),
            validate: (input: string) => {
                try {
                    const val = ethers.parseEther(input);
                    if (val < minDeposit) {
                        return `Must be at least ${ethers.formatEther(minDeposit)} ETH (2x restart cost)`;
                    }
                    return true;
                } catch {
                    return "Invalid ETH amount";
                }
            },
        },
    ]);

    // ─── Step 5: Confirm and send ──────────────────────────────

    console.log(chalk.bold.cyan("\n📋 Registration Summary"));
    console.log(chalk.white(`  Image:     ${answers.imageURI}`));
    console.log(chalk.white(`  Tier:      ${TIER_NAMES[answers.tier]}`));
    console.log(chalk.white(`  Env Vars:  ${Object.keys(envVars).length} encrypted`));
    console.log(chalk.white(`  Deposit:   ${depositAmount} ETH`));
    console.log(chalk.white(`  Contract:  ${config.contractAddress}`));

    const { confirm } = await inquirer.prompt([
        {
            type: "confirm",
            name: "confirm",
            message: chalk.bold("Send registration transaction?"),
            default: true,
        },
    ]);

    if (!confirm) {
        console.log(chalk.gray("\nAborted."));
        return;
    }

    // ─── Step 6: Execute transaction ───────────────────────────

    const txSpinner = ora("Sending transaction to Base L2...").start();

    try {
        const tx = await registry.registerBot(
            answers.imageURI,
            encryptedBytes,
            answers.tier,
            { value: ethers.parseEther(depositAmount) }
        );

        txSpinner.text = `Transaction sent: ${tx.hash}. Waiting for confirmation...`;

        const receipt = await tx.wait();

        // Extract botId from event
        const event = receipt.logs
            .map((log: any) => {
                try {
                    return registry.interface.parseLog({ topics: log.topics, data: log.data });
                } catch {
                    return null;
                }
            })
            .find((parsed: any) => parsed?.name === "BotRegistered");

        const botId = event?.args?.botId || "unknown";

        txSpinner.succeed("Bot registered successfully!");

        console.log(chalk.bold.green("\n🎉 Registration Complete!\n"));
        console.log(chalk.white(`  Bot ID:  ${botId}`));
        console.log(chalk.white(`  Tx Hash: ${receipt.hash}`));
        console.log(chalk.white(`  Block:   ${receipt.blockNumber}`));
        console.log(chalk.cyan("\n  Your bot is now monitored by the APORIA network."));
        console.log(chalk.gray(`  Run ${chalk.bold("aporia status")} to check your bot's status.\n`));
    } catch (error: any) {
        txSpinner.fail("Transaction failed");
        console.error(chalk.red(`\n❌ Error: ${error.message}`));

        if (error.message.includes("insufficient funds")) {
            console.log(chalk.yellow("  → Your wallet doesn't have enough ETH for the deposit + gas."));
        } else if (error.message.includes("ImageIsBanned")) {
            console.log(chalk.yellow("  → This Docker image has been banned by the protocol admin."));
        }
    }
}
