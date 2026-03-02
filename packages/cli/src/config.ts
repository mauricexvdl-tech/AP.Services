/**
 * @module @aporia/cli
 * Config management – stores wallet and contract settings locally
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";

export interface AporiaConfig {
  /** Private key of the bot owner (hex, with 0x prefix) */
  privateKey: string;
  /** RPC URL for Base L2 */
  rpcUrl: string;
  /** AporiaRegistry contract address */
  contractAddress: string;
  /** Deployer public key (Base64) for encrypting env vars */
  deployerPublicKey: string;
  /** Alchemy API key (optional – enables enhanced APIs + higher rate limits) */
  alchemyApiKey?: string;
  /** Webhook endpoint URL for Alchemy Notify (optional) */
  webhookUrl?: string;
  /** Webhook signing secret for HMAC verification (optional) */
  webhookSigningKey?: string;
}

const CONFIG_DIR = path.join(os.homedir(), ".aporia");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");

/**
 * Check if a config file exists
 */
export function configExists(): boolean {
  return fs.existsSync(CONFIG_FILE);
}

/**
 * Load the config from disk
 */
export function loadConfig(): AporiaConfig {
  if (!configExists()) {
    throw new Error("No config found. Run `aporia init` first to create your configuration.");
  }
  const raw = fs.readFileSync(CONFIG_FILE, "utf-8");
  return JSON.parse(raw) as AporiaConfig;
}

/**
 * Save config to disk
 */
export function saveConfig(config: AporiaConfig): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), "utf-8");
}

/**
 * Get the config file path (for display)
 */
export function getConfigPath(): string {
  return CONFIG_FILE;
}
