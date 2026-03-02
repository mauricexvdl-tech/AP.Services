import { expect } from "chai";
import { ethers } from "hardhat";
import { AporiaRegistry } from "../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { time } from "@nomicfoundation/hardhat-network-helpers";

describe("AporiaRegistry", function () {
  let registry: AporiaRegistry;
  let owner: HardhatEthersSigner;
  let user1: HardhatEthersSigner;
  let user2: HardhatEthersSigner;

  const IMAGE_URI = "docker.io/mybot:latest";
  const ENCRYPTED_ENV = ethers.toUtf8Bytes("encrypted-env-data");
  const TIER_NANO = 0;
  const TIER_LOGIC = 1;
  const TIER_EXPERT = 2;

  beforeEach(async function () {
    [owner, user1, user2] = await ethers.getSigners();
    const Registry = await ethers.getContractFactory("AporiaRegistry");
    registry = await Registry.deploy();
  });

  // ─── Registration ────────────────────────────────────────────

  describe("Registration", function () {
    it("should register a bot with initial deposit", async function () {
      const deposit = ethers.parseEther("0.01");
      const tx = await registry
        .connect(user1)
        .registerBot(IMAGE_URI, ENCRYPTED_ENV, TIER_NANO, { value: deposit });
      const receipt = await tx.wait();

      // Extrahiere botId aus Event
      const event = receipt?.logs.find(
        (log) =>
          registry.interface.parseLog({ topics: log.topics as string[], data: log.data })?.name ===
          "BotRegistered",
      );
      expect(event).to.not.be.undefined;
    });

    it("should activate monitoring when deposit >= 2x restart cost", async function () {
      const restartCost = await registry.restartCost(TIER_NANO);
      const deposit = restartCost * 2n;

      const tx = await registry
        .connect(user1)
        .registerBot(IMAGE_URI, ENCRYPTED_ENV, TIER_NANO, { value: deposit });
      const receipt = await tx.wait();

      const parsedLog = receipt?.logs
        .map((log) =>
          registry.interface.parseLog({ topics: log.topics as string[], data: log.data }),
        )
        .find((parsed) => parsed?.name === "BotRegistered");

      const botId = parsedLog?.args?.botId;
      const details = await registry.getBotDetails(botId);
      expect(details.isActive).to.be.true;
    });

    it("should NOT activate monitoring when deposit < 2x restart cost", async function () {
      const deposit = ethers.parseEther("0.0001"); // zu wenig

      const tx = await registry
        .connect(user1)
        .registerBot(IMAGE_URI, ENCRYPTED_ENV, TIER_NANO, { value: deposit });
      const receipt = await tx.wait();

      const parsedLog = receipt?.logs
        .map((log) =>
          registry.interface.parseLog({ topics: log.topics as string[], data: log.data }),
        )
        .find((parsed) => parsed?.name === "BotRegistered");

      const botId = parsedLog?.args?.botId;
      const details = await registry.getBotDetails(botId);
      expect(details.isActive).to.be.false;
    });

    it("should reject registration with banned image", async function () {
      await registry.banImage(IMAGE_URI);
      await expect(
        registry.connect(user1).registerBot(IMAGE_URI, ENCRYPTED_ENV, TIER_NANO),
      ).to.be.revertedWithCustomError(registry, "ImageIsBanned");
    });
  });

  // ─── Escrow ────────────────────────────────────────────────────

  describe("Escrow", function () {
    let botId: string;

    beforeEach(async function () {
      const tx = await registry.connect(user1).registerBot(IMAGE_URI, ENCRYPTED_ENV, TIER_NANO, {
        value: ethers.parseEther("0.01"),
      });
      const receipt = await tx.wait();
      const parsedLog = receipt?.logs
        .map((log) =>
          registry.interface.parseLog({ topics: log.topics as string[], data: log.data }),
        )
        .find((parsed) => parsed?.name === "BotRegistered");
      botId = parsedLog?.args?.botId;
    });

    it("should accept deposits", async function () {
      const depositAmount = ethers.parseEther("0.005");
      await registry.connect(user2).deposit(botId, { value: depositAmount });

      const details = await registry.getBotDetails(botId);
      expect(details.balance).to.equal(ethers.parseEther("0.015"));
    });

    it("should reject zero deposits", async function () {
      await expect(
        registry.connect(user1).deposit(botId, { value: 0 }),
      ).to.be.revertedWithCustomError(registry, "ZeroDeposit");
    });

    it("should allow owner to withdraw", async function () {
      const withdrawAmount = ethers.parseEther("0.005");
      const balanceBefore = await ethers.provider.getBalance(user1.address);

      const tx = await registry.connect(user1).withdraw(botId, withdrawAmount);
      const receipt = await tx.wait();
      const gasUsed = receipt!.gasUsed * receipt!.gasPrice;

      const balanceAfter = await ethers.provider.getBalance(user1.address);
      expect(balanceAfter).to.equal(balanceBefore + withdrawAmount - gasUsed);
    });

    it("should reject withdrawal from non-owner", async function () {
      await expect(
        registry.connect(user2).withdraw(botId, ethers.parseEther("0.001")),
      ).to.be.revertedWithCustomError(registry, "NotBotOwner");
    });

    it("should reject withdrawal exceeding balance", async function () {
      await expect(
        registry.connect(user1).withdraw(botId, ethers.parseEther("100")),
      ).to.be.revertedWithCustomError(registry, "InsufficientBalance");
    });
  });

  // ─── Restart & Cooldown ────────────────────────────────────────

  describe("Restart & Cooldown", function () {
    let botId: string;

    beforeEach(async function () {
      const deposit = ethers.parseEther("0.1"); // genug für mehrere Restarts
      const tx = await registry
        .connect(user1)
        .registerBot(IMAGE_URI, ENCRYPTED_ENV, TIER_NANO, { value: deposit });
      const receipt = await tx.wait();
      const parsedLog = receipt?.logs
        .map((log) =>
          registry.interface.parseLog({ topics: log.topics as string[], data: log.data }),
        )
        .find((parsed) => parsed?.name === "BotRegistered");
      botId = parsedLog?.args?.botId;
    });

    it("should trigger restart and emit event", async function () {
      await expect(registry.triggerRestart(botId)).to.emit(registry, "RestartTriggered");
    });

    it("should deduct restart cost from balance", async function () {
      const detailsBefore = await registry.getBotDetails(botId);
      const cost = await registry.restartCost(TIER_NANO);

      await registry.triggerRestart(botId);

      const detailsAfter = await registry.getBotDetails(botId);
      expect(detailsAfter.balance).to.equal(detailsBefore.balance - cost);
    });

    it("should enforce 6-hour cooldown", async function () {
      await registry.triggerRestart(botId);

      // Sofort nochmal versuchen → sollte fehlschlagen
      await expect(registry.triggerRestart(botId)).to.be.revertedWithCustomError(
        registry,
        "CooldownActive",
      );
    });

    it("should allow restart after cooldown expires", async function () {
      await registry.triggerRestart(botId);

      // 6 Stunden vorspulen
      await time.increase(6 * 60 * 60);

      await expect(registry.triggerRestart(botId)).to.emit(registry, "RestartTriggered");
    });

    it("should only allow owner (watchdog) to trigger restart", async function () {
      await expect(registry.connect(user1).triggerRestart(botId)).to.be.revertedWithCustomError(
        registry,
        "OwnableUnauthorizedAccount",
      );
    });
  });

  // ─── Kill Switch ───────────────────────────────────────────────

  describe("Kill Switch", function () {
    it("should ban and unban images", async function () {
      await registry.banImage(IMAGE_URI);
      expect(await registry.bannedImages(IMAGE_URI)).to.be.true;

      await registry.unbanImage(IMAGE_URI);
      expect(await registry.bannedImages(IMAGE_URI)).to.be.false;
    });

    it("should only allow owner to ban images", async function () {
      await expect(registry.connect(user1).banImage(IMAGE_URI)).to.be.revertedWithCustomError(
        registry,
        "OwnableUnauthorizedAccount",
      );
    });
  });

  // ─── View Functions ────────────────────────────────────────────

  describe("View Functions", function () {
    it("should return bot count", async function () {
      expect(await registry.getBotCount()).to.equal(0);

      await registry.connect(user1).registerBot(IMAGE_URI, ENCRYPTED_ENV, TIER_NANO);
      expect(await registry.getBotCount()).to.equal(1);
    });

    it("should check canMonitor correctly", async function () {
      const restartCost = await registry.restartCost(TIER_NANO);

      // Mit genug Balance
      const tx = await registry.connect(user1).registerBot(IMAGE_URI, ENCRYPTED_ENV, TIER_NANO, {
        value: restartCost * 3n,
      });
      const receipt = await tx.wait();
      const parsedLog = receipt?.logs
        .map((log) =>
          registry.interface.parseLog({ topics: log.topics as string[], data: log.data }),
        )
        .find((parsed) => parsed?.name === "BotRegistered");
      const botId = parsedLog?.args?.botId;

      expect(await registry.canMonitor(botId)).to.be.true;
    });
  });
});
