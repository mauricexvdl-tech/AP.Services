/**
 * @module @aporia/cli
 * Command: aporia init
 * Creates a local config file for the bot owner
 */

import inquirer from "inquirer";
import chalk from "chalk";
import { ethers } from "ethers";
import { generateKeyPair, publicKeyToBase64 } from "@aporia/secrets";
import { saveConfig, getConfigPath, configExists, AporiaConfig } from "../config";

export async function initCommand(): Promise<void> {
  console.log(chalk.bold.cyan("\n🛡️  APORIA – Initialization\n"));

  if (configExists()) {
    const { overwrite } = await inquirer.prompt([
      {
        type: "confirm",
        name: "overwrite",
        message: chalk.yellow("Config already exists. Overwrite?"),
        default: false,
      },
    ]);
    if (!overwrite) {
      console.log(chalk.gray("Aborted. Existing config preserved."));
      return;
    }
  }

  const answers = await inquirer.prompt([
    {
      type: "list",
      name: "walletMode",
      message: "How do you want to connect your wallet?",
      choices: [
        { name: "Enter private key manually", value: "manual" },
        { name: "Generate a new wallet", value: "generate" },
      ],
    },
    {
      type: "password",
      name: "privateKey",
      message: "Enter your private key (hex, with 0x prefix):",
      mask: "*",
      when: (a: any) => a.walletMode === "manual",
      validate: (input: string) => {
        try {
          new ethers.Wallet(input);
          return true;
        } catch {
          return "Invalid private key. Must be a valid hex string with 0x prefix.";
        }
      },
    },
    {
      type: "input",
      name: "alchemyApiKey",
      message: "Alchemy API Key (optional, press Enter to skip):",
      default: "",
    },
    {
      type: "input",
      name: "rpcUrl",
      message: "Base L2 RPC URL:",
      default: (a: any) =>
        a.alchemyApiKey
          ? `https://base-mainnet.g.alchemy.com/v2/${a.alchemyApiKey}`
          : "https://mainnet.base.org",
    },
    {
      type: "input",
      name: "contractAddress",
      message: "AporiaRegistry contract address:",
      default: "0x0000000000000000000000000000000000000000",
      validate: (input: string) => {
        return ethers.isAddress(input) || "Invalid Ethereum address.";
      },
    },
  ]);

  let privateKey: string;
  let walletAddress: string;

  if (answers.walletMode === "generate") {
    const wallet = ethers.Wallet.createRandom();
    privateKey = wallet.privateKey;
    walletAddress = wallet.address;
    console.log(chalk.green("\n✨ New wallet generated!"));
    console.log(chalk.gray(`   Address: ${walletAddress}`));
    console.log(
      chalk.yellow(`   ⚠️  Save your private key securely. It will be stored in the config.`),
    );
  } else {
    privateKey = answers.privateKey;
    const wallet = new ethers.Wallet(privateKey);
    walletAddress = wallet.address;
  }

  // Generate deployer keypair for secret management
  const deployerKeys = generateKeyPair();
  const deployerPubKey = publicKeyToBase64(deployerKeys.publicKey);

  console.log(chalk.cyan("\n🔐 Deployer encryption keypair generated."));
  console.log(chalk.gray(`   Public Key: ${deployerPubKey.substring(0, 20)}...`));

  const config: AporiaConfig = {
    privateKey,
    rpcUrl: answers.rpcUrl,
    contractAddress: answers.contractAddress,
    deployerPublicKey: deployerPubKey,
    ...(answers.alchemyApiKey ? { alchemyApiKey: answers.alchemyApiKey } : {}),
  };

  saveConfig(config);

  console.log(chalk.bold.green("\n✅ Config saved!"));
  console.log(chalk.gray(`   Location: ${getConfigPath()}`));
  console.log(chalk.gray(`   Wallet:   ${walletAddress}`));
  console.log(
    chalk.cyan("\n   Next: Run"),
    chalk.bold("aporia register"),
    chalk.cyan("to register your first bot.\n"),
  );
}
