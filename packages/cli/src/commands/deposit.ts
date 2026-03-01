/**
 * @module @aporia/cli
 * Command: aporia deposit
 * Deposit ETH into the escrow pool for a bot
 */

import inquirer from "inquirer";
import chalk from "chalk";
import ora from "ora";
import { ethers } from "ethers";
import { loadConfig } from "../config";
import { REGISTRY_ABI, TIER_NAMES } from "../abi";

export async function depositCommand(botId?: string, amount?: string): Promise<void> {
    console.log(chalk.bold.cyan("\n🛡️  APORIA – Escrow Deposit\n"));

    const config = loadConfig();
    const provider = new ethers.JsonRpcProvider(config.rpcUrl);
    const wallet = new ethers.Wallet(config.privateKey, provider);
    const registry = new ethers.Contract(config.contractAddress, REGISTRY_ABI, wallet);

    console.log(chalk.gray(`Wallet: ${wallet.address}`));

    // ─── Get bot ID if not provided ────────────────────────────

    if (!botId) {
        const { inputBotId } = await inquirer.prompt([
            {
                type: "input",
                name: "inputBotId",
                message: "Bot ID (bytes32 hex):",
                validate: (input: string) => {
                    return input.startsWith("0x") && input.length === 66
                        ? true
                        : "Must be a valid bytes32 hex string (0x + 64 chars)";
                },
            },
        ]);
        botId = inputBotId;
    }

    // ─── Show current bot info ─────────────────────────────────

    const infoSpinner = ora("Fetching bot details...").start();

    try {
        const details = await registry.getBotDetails(botId);
        const restartCost = await registry.restartCost(details.tier);

        infoSpinner.stop();

        console.log(chalk.white(`\n  Bot:      ${(botId as string).substring(0, 18)}...`));
        console.log(chalk.white(`  Tier:     ${TIER_NAMES[Number(details.tier)]}`));
        console.log(chalk.white(`  Balance:  ${ethers.formatEther(details.balance)} ETH`));
        console.log(chalk.white(`  Active:   ${details.isActive ? chalk.green("Yes") : chalk.red("No")}`));

        const minBalance = restartCost * 2n;
        if (details.balance < minBalance) {
            const deficit = minBalance - details.balance;
            console.log(chalk.yellow(`\n  ⚠️  Need ${ethers.formatEther(deficit)} ETH more to activate monitoring.`));
        }

        // ─── Get deposit amount ──────────────────────────────────

        if (!amount) {
            const { inputAmount } = await inquirer.prompt([
                {
                    type: "input",
                    name: "inputAmount",
                    message: "Deposit amount (ETH):",
                    validate: (input: string) => {
                        try {
                            const val = ethers.parseEther(input);
                            if (val <= 0n) return "Must be greater than 0";
                            return true;
                        } catch {
                            return "Invalid ETH amount";
                        }
                    },
                },
            ]);
            amount = inputAmount;
        }

        const depositWei = ethers.parseEther(amount as string);

        // ─── Show wallet balance ─────────────────────────────────

        const walletBalance = await provider.getBalance(wallet.address);
        console.log(chalk.gray(`\n  Wallet balance: ${ethers.formatEther(walletBalance)} ETH`));

        if (walletBalance < depositWei) {
            console.log(chalk.red("  ❌ Insufficient wallet balance for this deposit."));
            return;
        }

        const newBalance = details.balance + depositWei;
        console.log(chalk.cyan(`  New bot balance: ${ethers.formatEther(newBalance)} ETH`));

        // ─── Confirm ─────────────────────────────────────────────

        const { confirm } = await inquirer.prompt([
            {
                type: "confirm",
                name: "confirm",
                message: `Deposit ${chalk.bold(amount)} ETH?`,
                default: true,
            },
        ]);

        if (!confirm) {
            console.log(chalk.gray("\nAborted."));
            return;
        }

        // ─── Execute ─────────────────────────────────────────────

        const txSpinner = ora("Sending deposit transaction...").start();

        const tx = await registry.deposit(botId, { value: depositWei });
        txSpinner.text = `Transaction sent: ${tx.hash}. Waiting...`;

        const receipt = await tx.wait();
        txSpinner.succeed("Deposit successful!");

        console.log(chalk.bold.green("\n✅ Deposit Complete!"));
        console.log(chalk.white(`  Amount:   ${amount} ETH`));
        console.log(chalk.white(`  Tx Hash:  ${receipt.hash}`));
        console.log(chalk.white(`  Block:    ${receipt.blockNumber}\n`));
    } catch (error: any) {
        infoSpinner.stop();
        if (error.message.includes("BotNotFound")) {
            console.log(chalk.red(`\n❌ Bot not found: ${botId}`));
        } else {
            console.error(chalk.red(`\n❌ Error: ${error.message}`));
        }
    }
}
