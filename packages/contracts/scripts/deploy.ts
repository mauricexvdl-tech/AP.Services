/**
 * APORIA Registry – Deployment Script
 *
 * Usage:
 *   npx hardhat run scripts/deploy.ts --network baseSepolia
 *
 * Prerequisites:
 *   1. Copy .env.example to .env and fill in your values
 *   2. Fund your deployer wallet with Base Sepolia ETH
 *      → Faucet: https://www.alchemy.com/faucets/base-sepolia
 */

import { ethers, run, network } from "hardhat";

async function main() {
    const [deployer] = await ethers.getSigners();

    console.log("\n═══════════════════════════════════════════════════════");
    console.log("  🛡️  APORIA Registry – Deployment");
    console.log("═══════════════════════════════════════════════════════\n");
    console.log(`  Network:  ${network.name}`);
    console.log(`  Chain ID: ${network.config.chainId}`);
    console.log(`  Deployer: ${deployer.address}`);

    const balance = await ethers.provider.getBalance(deployer.address);
    console.log(`  Balance:  ${ethers.formatEther(balance)} ETH\n`);

    if (balance === 0n) {
        console.error("❌ Deployer wallet has no funds! Get testnet ETH from:");
        console.error("   https://www.alchemy.com/faucets/base-sepolia\n");
        process.exit(1);
    }

    // ─── Deploy ────────────────────────────────────────────────
    console.log("📦 Deploying AporiaRegistry...");

    const Registry = await ethers.getContractFactory("AporiaRegistry");
    const registry = await Registry.deploy();
    await registry.waitForDeployment();

    const contractAddress = await registry.getAddress();

    console.log(`\n✅ AporiaRegistry deployed!`);
    console.log(`   Address: ${contractAddress}`);

    // ─── Verify restart costs ──────────────────────────────────
    const nanoCost = await registry.restartCost(0);
    const logicCost = await registry.restartCost(1);
    const expertCost = await registry.restartCost(2);

    console.log(`\n💰 Restart Costs:`);
    console.log(`   NANO:   ${ethers.formatEther(nanoCost)} ETH`);
    console.log(`   LOGIC:  ${ethers.formatEther(logicCost)} ETH`);
    console.log(`   EXPERT: ${ethers.formatEther(expertCost)} ETH`);

    // ─── Verify on Basescan ────────────────────────────────────
    if (network.name !== "hardhat" && network.name !== "localhost") {
        console.log("\n🔍 Verifying contract on Basescan...");
        console.log("   Waiting 30s for block propagation...");

        // Wait for some block confirmations
        await new Promise((r) => setTimeout(r, 30_000));

        try {
            await run("verify:verify", {
                address: contractAddress,
                constructorArguments: [],
            });
            console.log("✅ Contract verified on Basescan!");
        } catch (error: any) {
            if (error.message.includes("Already Verified")) {
                console.log("✅ Contract already verified on Basescan!");
            } else {
                console.log(`⚠️  Verification failed: ${error.message}`);
                console.log("   You can verify manually later with:");
                console.log(`   npx hardhat verify --network ${network.name} ${contractAddress}`);
            }
        }
    }

    // ─── Output for CLI ────────────────────────────────────────
    console.log("\n═══════════════════════════════════════════════════════");
    console.log("  📋 CLI Configuration");
    console.log("═══════════════════════════════════════════════════════\n");
    console.log("  Run this to configure your CLI:\n");
    console.log(`  npx ts-node src/index.ts init`);
    console.log(`\n  When prompted, enter:`);
    console.log(`    RPC URL:          ${(network.config as any).url || "https://sepolia.base.org"}`);
    console.log(`    Contract Address: ${contractAddress}`);
    console.log("");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
