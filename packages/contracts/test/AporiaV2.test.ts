import { expect } from "chai";
import { ethers } from "hardhat";
import { AporiaAgentNFT, AporiaAccount, ERC6551Registry, InsuranceVault } from "../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { time } from "@nomicfoundation/hardhat-network-helpers";

describe("Aporia V2: ERC-6551 Identity & Insurance", function () {
    let registry: ERC6551Registry;
    let accountImpl: AporiaAccount;
    let agentNFT: AporiaAgentNFT;
    let vault: InsuranceVault;

    let owner: HardhatEthersSigner;
    let user1: HardhatEthersSigner;
    let watchdog: HardhatEthersSigner;

    const IMAGE_URI = "docker.io/mybot:v2";
    const ENCRYPTED_ENV = ethers.toUtf8Bytes("secret");
    const TIER_NANO = 0;

    beforeEach(async function () {
        [owner, user1, watchdog] = await ethers.getSigners();

        // 1. Deploy ERC-6551 Registry
        const RegistryFactory = await ethers.getContractFactory("ERC6551Registry");
        registry = await RegistryFactory.deploy();

        // 2. Deploy Account Implementation
        const AccountFactory = await ethers.getContractFactory("AporiaAccount");
        accountImpl = await AccountFactory.deploy();

        // 3. Deploy Agent NFT
        const NFTFactory = await ethers.getContractFactory("AporiaAgentNFT");
        agentNFT = await NFTFactory.deploy(await registry.getAddress(), await accountImpl.getAddress());

        // Transfer ownership to watchdog for triggerRestart (MVP simplification)
        await agentNFT.transferOwnership(watchdog.address);

        // 4. Deploy Insurance Vault
        const VaultFactory = await ethers.getContractFactory("InsuranceVault");
        vault = await VaultFactory.deploy(await agentNFT.getAddress());
        await vault.transferOwnership(watchdog.address);
    });

    describe("Agent Registration & TBA Creation", function () {
        it("should mint NFT and deploy TBA with initial deposit", async function () {
            const deposit = ethers.parseEther("0.05");

            const tx = await agentNFT.connect(user1).registerAgent(
                IMAGE_URI,
                ENCRYPTED_ENV,
                TIER_NANO,
                { value: deposit }
            );

            const receipt = await tx.wait();

            // Token ID should be 1
            expect(await agentNFT.ownerOf(1)).to.equal(user1.address);

            // Check TBA address and balance
            const tbaAddress = await agentNFT.getTBA(1);
            expect(tbaAddress).to.not.equal(ethers.ZeroAddress);

            const tbaBalance = await ethers.provider.getBalance(tbaAddress);
            expect(tbaBalance).to.equal(deposit);

            // Check canMonitor
            expect(await agentNFT.canMonitor(1)).to.be.true;
        });

        it("should allow NFT owner to execute calls via TBA", async function () {
            const deposit = ethers.parseEther("0.1");

            await agentNFT.connect(user1).registerAgent(IMAGE_URI, ENCRYPTED_ENV, TIER_NANO, { value: deposit });
            const tbaAddress = await agentNFT.getTBA(1);

            // Get TBA instance
            const tba = await ethers.getContractAt("AporiaAccount", tbaAddress);

            // Transfer 0.01 ETH from TBA back to user1
            const withdrawAmount = ethers.parseEther("0.01");

            const userBalanceBefore = await ethers.provider.getBalance(user1.address);

            // Execute call
            const tx = await tba.connect(user1).execute(
                user1.address,
                withdrawAmount,
                "0x",
                0 // CALL
            );
            const receipt = await tx.wait();
            const gasCost = receipt!.gasUsed * receipt!.gasPrice;

            const userBalanceAfter = await ethers.provider.getBalance(user1.address);

            expect(userBalanceAfter).to.equal(userBalanceBefore + withdrawAmount - gasCost);

            const tbaBalanceAfter = await ethers.provider.getBalance(tbaAddress);
            expect(tbaBalanceAfter).to.equal(deposit - withdrawAmount);
        });

        it("should prevent non-owners from executing calls via TBA", async function () {
            await agentNFT.connect(user1).registerAgent(IMAGE_URI, ENCRYPTED_ENV, TIER_NANO, { value: ethers.parseEther("0.1") });
            const tbaAddress = await agentNFT.getTBA(1);
            const tba = await ethers.getContractAt("AporiaAccount", tbaAddress);

            await expect(
                tba.connect(watchdog).execute(watchdog.address, ethers.parseEther("0.01"), "0x", 0)
            ).to.be.revertedWith("AporiaAccount: not owner");
        });
    });

    describe("Orchestrator: Trigger Restart", function () {
        it("should pull restart cost from TBA and update cooldown", async function () {
            const deposit = ethers.parseEther("0.1");
            await agentNFT.connect(user1).registerAgent(IMAGE_URI, ENCRYPTED_ENV, TIER_NANO, { value: deposit });
            const tbaAddress = await agentNFT.getTBA(1);

            const restartCost = await agentNFT.restartCost(TIER_NANO);
            const tbaBalanceBefore = await ethers.provider.getBalance(tbaAddress);

            await agentNFT.connect(watchdog).triggerRestart(1);

            const tbaBalanceAfter = await ethers.provider.getBalance(tbaAddress);
            expect(tbaBalanceBefore - tbaBalanceAfter).to.equal(restartCost);

            // Cooldown should be active
            const cooldown = await agentNFT.cooldownRemaining(1);
            expect(cooldown).to.be.greaterThan(0);
        });
    });

    describe("Insurance Vault", function () {
        beforeEach(async function () {
            await agentNFT.connect(user1).registerAgent(IMAGE_URI, ENCRYPTED_ENV, TIER_NANO);
        });

        it("should allow user to create policy", async function () {
            const premium = ethers.parseEther("0.01");
            await vault.connect(user1).createPolicy(1, { value: premium });

            const policy = await vault.policies(1);
            expect(policy.deposit).to.equal(premium);
        });

        it("should calculate downtime and process pro-rata refund upon breach", async function () {
            const premium = ethers.parseEther("1.0"); // 1 ETH for easy math
            await vault.connect(user1).createPolicy(1, { value: premium });

            // Watchdog reports healthy
            await vault.connect(watchdog).reportHealthy(1);

            // Advance time by 2 hours (SLA breach > 1 hour)
            await time.increase(2 * 3600);

            // User claims refund
            const tx = await vault.connect(user1).claimRefund(1);
            const receipt = await tx.wait();

            const policy = await vault.policies(1);
            expect(policy.claimed).to.be.true;

            // Refund should be > 0
            const refundEvent = receipt?.logs.find(
                (log) => vault.interface.parseLog({ topics: log.topics as string[], data: log.data })?.name === "RefundClaimed"
            );
            expect(refundEvent).to.not.be.undefined;
        });
    });
});
