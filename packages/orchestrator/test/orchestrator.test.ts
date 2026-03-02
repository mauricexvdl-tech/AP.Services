/**
 * @module @aporia/orchestrator
 * Tests for the ResurrectionOrchestrator 7-phase pipeline
 *
 * Uses fully mocked contract, secrets, and deployment backend
 * to test the pipeline logic without external dependencies.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { ethers } from "ethers";
import { ResurrectionOrchestrator, type OrchestratorConfig } from "../src/orchestrator";
import { type DeploymentBackend, type DeployRequest, type DeployResponse } from "../src/backends";
import { Tier } from "@aporia/heartbeat";
import type { RestartEvent } from "@aporia/heartbeat";

// ─── Mock Deployment Backend ─────────────────────────────────────

class MockBackend implements DeploymentBackend {
  name = "Mock Backend";
  deployCalls: DeployRequest[] = [];
  shouldFail = false;
  deployDelay = 0;

  async deploy(request: DeployRequest): Promise<DeployResponse> {
    // Deep copy envVars since orchestrator wipes them from RAM after deploy
    this.deployCalls.push({ ...request, envVars: { ...request.envVars } });

    if (this.deployDelay > 0) {
      await new Promise((r) => setTimeout(r, this.deployDelay));
    }

    if (this.shouldFail) {
      return {
        success: false,
        deploymentId: "",
        url: "",
        error: "Mock deployment failure",
      };
    }

    return {
      success: true,
      deploymentId: `container-${request.botId.substring(0, 8)}`,
      url: `http://localhost:3000`,
    };
  }
}

// ─── Mock Contract ───────────────────────────────────────────────

function createMockContract(
  overrides: Partial<{
    canMonitor: boolean;
    cooldownRemaining: bigint;
    balance: bigint;
    restartCost: bigint;
    imageURI: string;
    encryptedEnv: string;
    tier: number;
    isActive: boolean;
    triggerRestartFails: boolean;
  }> = {},
) {
  const opts = {
    canMonitor: true,
    cooldownRemaining: 0n,
    balance: ethers.parseEther("0.01"),
    restartCost: ethers.parseEther("0.001"),
    imageURI: "docker.io/testbot:latest",
    encryptedEnv: "0x", // empty for mock
    tier: 0,
    isActive: true,
    triggerRestartFails: false,
    ...overrides,
  };

  return {
    canMonitor: vi.fn().mockResolvedValue(opts.canMonitor),
    cooldownRemaining: vi.fn().mockResolvedValue(opts.cooldownRemaining),
    getBotDetails: vi.fn().mockResolvedValue({
      imageURI: opts.imageURI,
      envHash: ethers.ZeroHash,
      tier: opts.tier,
      balance: opts.balance,
      lastRestart: 0n,
      isActive: opts.isActive,
      owner: "0x" + "aa".repeat(20),
    }),
    bots: vi.fn().mockResolvedValue({
      imageURI: opts.imageURI,
      encryptedEnv: opts.encryptedEnv,
      envHash: ethers.ZeroHash,
      tier: opts.tier,
      balance: opts.balance,
      lastRestart: 0n,
      isActive: opts.isActive,
      owner: "0x" + "aa".repeat(20),
    }),
    restartCost: vi.fn().mockResolvedValue(opts.restartCost),
    triggerRestart: vi.fn().mockImplementation(async () => {
      if (opts.triggerRestartFails) {
        throw new Error("Transaction reverted");
      }
      return {
        hash: "0x" + "ff".repeat(32),
        wait: async () => ({
          hash: "0x" + "ff".repeat(32),
          blockNumber: 12345,
        }),
      };
    }),
  };
}

// ─── Mock decryptSecrets ─────────────────────────────────────────
// We mock the private method to avoid needing real NaCl keys

function createTestOrchestrator(
  mockContract: any,
  backend: MockBackend,
  decryptResult: Record<string, string> = { API_KEY: "test-123", DB_URL: "postgres://test" },
): ResurrectionOrchestrator {
  const config: OrchestratorConfig = {
    provider: {} as any,
    signer: {} as any,
    contractAddress: "0x" + "cc".repeat(20),
    deployerSecretKey: new Uint8Array(32),
    backend,
    defaultPorts: [3000],
  };

  const orchestrator = new ResurrectionOrchestrator(config);

  // Replace the internal contract and decrypt method with mocks
  (orchestrator as any).registry = mockContract;
  (orchestrator as any).decryptSecrets = vi.fn().mockReturnValue(decryptResult);

  return orchestrator;
}

function createRestartEvent(botId: string = "0x" + "01".repeat(32)): RestartEvent {
  return {
    botId,
    url: "http://localhost:3000",
    imageURI: "docker.io/testbot:latest",
    tier: Tier.NANO,
    timestamp: Date.now(),
    reason: "3 consecutive health-check failures",
  };
}

// ─── Tests ───────────────────────────────────────────────────────

describe("ResurrectionOrchestrator", () => {
  let backend: MockBackend;

  beforeEach(() => {
    backend = new MockBackend();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  describe("Full Pipeline – Success Path", () => {
    it("should complete all 7 phases successfully", async () => {
      const mockContract = createMockContract();
      const orchestrator = createTestOrchestrator(mockContract, backend);
      const event = createRestartEvent();

      const result = await orchestrator.handleRestart(event);

      expect(result.success).toBe(true);
      expect(result.phase).toBe("settle");
      expect(result.deploymentId).toBeTruthy();
      expect(result.txHash).toBeTruthy();
      expect(result.durationMs).toBeGreaterThan(0);

      // Verify all phases were called
      expect(mockContract.canMonitor).toHaveBeenCalledWith(event.botId);
      expect(mockContract.cooldownRemaining).toHaveBeenCalledWith(event.botId);
      expect(mockContract.bots).toHaveBeenCalledWith(event.botId);
      expect(backend.deployCalls).toHaveLength(1);
      expect(mockContract.triggerRestart).toHaveBeenCalledWith(event.botId);
    });

    it("should pass correct deploy config to backend", async () => {
      const mockContract = createMockContract({
        imageURI: "custom-image:v2",
        tier: 1,
      });
      const orchestrator = createTestOrchestrator(mockContract, backend);
      const event = createRestartEvent();

      await orchestrator.handleRestart(event);

      const deployCall = backend.deployCalls[0];
      expect(deployCall.imageURI).toBe("custom-image:v2");
      expect(deployCall.tier).toBe(1);
      expect(deployCall.envVars).toEqual({ API_KEY: "test-123", DB_URL: "postgres://test" });
      expect(deployCall.ports).toEqual([3000]);
    });

    it("should track statistics", async () => {
      const mockContract = createMockContract();
      const orchestrator = createTestOrchestrator(mockContract, backend);

      await orchestrator.handleRestart(createRestartEvent());
      await orchestrator.handleRestart(createRestartEvent("0x" + "02".repeat(32)));

      const stats = orchestrator.getStats();
      expect(stats.total).toBe(2);
      expect(stats.success).toBe(2);
      expect(stats.failed).toBe(0);
    });
  });

  describe("Phase 2: VERIFY – On-chain checks", () => {
    it("should abort when canMonitor returns false", async () => {
      const mockContract = createMockContract({ canMonitor: false });
      const orchestrator = createTestOrchestrator(mockContract, backend);

      const result = await orchestrator.handleRestart(createRestartEvent());

      expect(result.success).toBe(false);
      expect(result.phase).toBe("verify");
      expect(result.error).toContain("cannot be monitored");
      expect(backend.deployCalls).toHaveLength(0);
    });

    it("should abort when cooldown is active", async () => {
      const mockContract = createMockContract({
        cooldownRemaining: 3600n, // 1 hour remaining
      });
      const orchestrator = createTestOrchestrator(mockContract, backend);

      const result = await orchestrator.handleRestart(createRestartEvent());

      expect(result.success).toBe(false);
      expect(result.phase).toBe("verify");
      expect(result.error).toContain("Cooldown active");
      expect(result.error).toContain("60 minutes");
    });

    it("should abort when balance < restart cost", async () => {
      const mockContract = createMockContract({
        balance: ethers.parseEther("0.0005"),
        restartCost: ethers.parseEther("0.001"),
      });
      const orchestrator = createTestOrchestrator(mockContract, backend);

      const result = await orchestrator.handleRestart(createRestartEvent());

      expect(result.success).toBe(false);
      expect(result.phase).toBe("verify");
      expect(result.error).toContain("Insufficient balance");
    });
  });

  describe("Phase 3: FETCH – Chain data retrieval", () => {
    it("should abort when bot data fetch fails", async () => {
      const mockContract = createMockContract();
      mockContract.bots.mockRejectedValue(new Error("Network error"));
      const orchestrator = createTestOrchestrator(mockContract, backend);

      const result = await orchestrator.handleRestart(createRestartEvent());

      expect(result.success).toBe(false);
      expect(result.phase).toBe("fetch");
    });
  });

  describe("Phase 4: DECRYPT – Secret decryption", () => {
    it("should abort when decryption fails", async () => {
      const mockContract = createMockContract();
      const orchestrator = createTestOrchestrator(mockContract, backend);
      (orchestrator as any).decryptSecrets = vi.fn().mockImplementation(() => {
        throw new Error("Invalid key or tampered data");
      });

      const result = await orchestrator.handleRestart(createRestartEvent());

      expect(result.success).toBe(false);
      expect(result.phase).toBe("decrypt");
      expect(result.error).toContain("Decryption failed");
    });
  });

  describe("Phase 6: DEPLOY – Container deployment", () => {
    it("should abort when deployment fails", async () => {
      backend.shouldFail = true;
      const mockContract = createMockContract();
      const orchestrator = createTestOrchestrator(mockContract, backend);

      const result = await orchestrator.handleRestart(createRestartEvent());

      expect(result.success).toBe(false);
      expect(result.phase).toBe("deploy");
      expect(result.error).toContain("Deployment failed");
      // Should NOT have called triggerRestart
      expect(mockContract.triggerRestart).not.toHaveBeenCalled();
    });
  });

  describe("Phase 7: SETTLE – On-chain settlement", () => {
    it("should report failure when triggerRestart tx fails", async () => {
      const mockContract = createMockContract({ triggerRestartFails: true });
      const orchestrator = createTestOrchestrator(mockContract, backend);

      const result = await orchestrator.handleRestart(createRestartEvent());

      expect(result.success).toBe(false);
      expect(result.phase).toBe("settle");
      expect(result.error).toContain("Settlement failed");
      // Container was deployed but settlement failed
      expect(result.deploymentId).toBeTruthy();
    });
  });

  describe("Concurrent Resurrection Guard", () => {
    it("should prevent concurrent resurrections for same bot", async () => {
      const mockContract = createMockContract();
      backend.deployDelay = 100; // slow deployment
      const orchestrator = createTestOrchestrator(mockContract, backend);
      const event = createRestartEvent();

      // Start two concurrent resurrections
      const [result1, result2] = await Promise.all([
        orchestrator.handleRestart(event),
        orchestrator.handleRestart(event),
      ]);

      // One should succeed, one should be rejected
      const succeeded = [result1, result2].filter((r) => r.success);
      const rejected = [result1, result2].filter(
        (r) => !r.success && r.error?.includes("already in progress"),
      );

      expect(succeeded).toHaveLength(1);
      expect(rejected).toHaveLength(1);
    });

    it("should allow concurrent resurrections for different bots", async () => {
      const mockContract = createMockContract();
      const orchestrator = createTestOrchestrator(mockContract, backend);

      const [result1, result2] = await Promise.all([
        orchestrator.handleRestart(createRestartEvent("0x" + "01".repeat(32))),
        orchestrator.handleRestart(createRestartEvent("0x" + "02".repeat(32))),
      ]);

      expect(result1.success).toBe(true);
      expect(result2.success).toBe(true);
      expect(backend.deployCalls).toHaveLength(2);
    });
  });
});
