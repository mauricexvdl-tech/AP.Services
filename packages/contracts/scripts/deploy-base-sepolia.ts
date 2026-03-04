import { ethers, network } from "hardhat";

// Standard ERC-6551 Registry (deployed on Base Sepolia at the exact same address as Mainnet)
const ERC6551_REGISTRY_ADDRESS = "0x000000006551c19487814612e58FE06813775758";

async function main() {
    console.log(`\n🚀 Starting APORIA V2 Deployment on ${network.name}...\n`);

    const [deployer] = await ethers.getSigners();
    if (!deployer) {
        throw new Error("No deployer account found. Check your DEPLOYER_PRIVATE_KEY.");
    }

    console.log(`Deployer Account: ${deployer.address}`);
    const balance = await ethers.provider.getBalance(deployer.address);
    console.log(`Deployer Balance: ${ethers.formatEther(balance)} ETH`);

    if (balance === 0n) {
        throw new Error("Deployer account has 0 ETH. Please fund the account to deploy contracts.");
    }

    console.log("\n---------------------------------------------------------");

    // 1. Deploy AporiaAccount (TBA Implementation)
    console.log("1️⃣  Deploying AporiaAccount (TBA Implementation)...");
    const AporiaAccount = await ethers.getContractFactory("AporiaAccount");
    const aporiaAccount = await AporiaAccount.deploy();
    await aporiaAccount.waitForDeployment();
    const accountAddress = await aporiaAccount.getAddress();
    console.log(`✅ AporiaAccount deployed to: ${accountAddress}`);

    // 2. Deploy AporiaAgentNFT
    console.log("\n2️⃣  Deploying AporiaAgentNFT...");
    const AporiaAgentNFT = await ethers.getContractFactory("AporiaAgentNFT");
    const aporiaAgentNFT = await AporiaAgentNFT.deploy(
        ERC6551_REGISTRY_ADDRESS,
        accountAddress
    );
    await aporiaAgentNFT.waitForDeployment();
    const nftAddress = await aporiaAgentNFT.getAddress();
    console.log(`✅ AporiaAgentNFT deployed to: ${nftAddress}`);

    // 3. Deploy InsuranceVault
    console.log("\n3️⃣  Deploying InsuranceVault...");
    const InsuranceVault = await ethers.getContractFactory("InsuranceVault");
    const insuranceVault = await InsuranceVault.deploy(nftAddress);
    await insuranceVault.waitForDeployment();
    const vaultAddress = await insuranceVault.getAddress();
    console.log(`✅ InsuranceVault deployed to: ${vaultAddress}`);

    console.log("\n---------------------------------------------------------");
    console.log("🎉  DEPLOYMENT COMPLETE!");
    console.log("---------------------------------------------------------");
    console.log("Save these addresses into your .env and frontend config:\n");
    console.log(`APORIA_ACCOUNT_IMPLEMENTATION=${accountAddress}`);
    console.log(`APORIA_AGENT_NFT_ADDRESS=${nftAddress}`);
    console.log(`APORIA_INSURANCE_VAULT_ADDRESS=${vaultAddress}`);
    console.log(`ERC6551_REGISTRY=${ERC6551_REGISTRY_ADDRESS}`);
    console.log("\nIf you want to verify the contracts on Basescan later:");
    console.log(`npx hardhat verify --network baseSepolia ${accountAddress}`);
    console.log(`npx hardhat verify --network baseSepolia ${nftAddress} ${ERC6551_REGISTRY_ADDRESS} ${accountAddress}`);
    console.log(`npx hardhat verify --network baseSepolia ${vaultAddress} ${nftAddress}`);
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
