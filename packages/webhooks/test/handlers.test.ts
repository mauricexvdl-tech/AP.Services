/**
 * @module @aporia/webhooks
 * Tests for event parsing and handler routing
 */

import { describe, it, expect, vi } from "vitest";
import { ethers } from "ethers";
import {
  parseWebhookPayload,
  createEventRouter,
  type EventHandlerMap,
  type AporiaEvent,
} from "../src/handlers";

// ─── Helper: Generate mock webhook payload ─────────────────────

function createMockPayload(eventName: string, args: any[]): any {
  const abiFragments: Record<string, string> = {
    BotRegistered:
      "event BotRegistered(bytes32 indexed botId, address indexed owner, string imageURI, uint8 tier)",
    Deposited: "event Deposited(bytes32 indexed botId, address indexed depositor, uint256 amount)",
    Withdrawn: "event Withdrawn(bytes32 indexed botId, address indexed owner, uint256 amount)",
    RestartTriggered: "event RestartTriggered(bytes32 indexed botId, uint256 timestamp)",
  };

  const iface = new ethers.Interface([abiFragments[eventName]]);
  const eventFragment = iface.getEvent(eventName)!;
  const encoded = iface.encodeEventLog(eventFragment, args);

  return {
    event: {
      network: "BASE_SEPOLIA",
      activity: [
        {
          hash: "0x" + "ab".repeat(32),
          blockNum: "0x100",
          log: {
            topics: encoded.topics,
            data: encoded.data,
            transactionHash: "0x" + "ab".repeat(32),
            blockNumber: "0x100",
          },
        },
      ],
    },
  };
}

// ─── Tests ───────────────────────────────────────────────────────

describe("parseWebhookPayload", () => {
  it("should parse BotRegistered event", () => {
    const botId = "0x" + "01".repeat(32);
    const owner = "0x" + "aa".repeat(20);
    const payload = createMockPayload("BotRegistered", [botId, owner, "docker.io/mybot:latest", 0]);

    const events = parseWebhookPayload(payload);

    expect(events).toHaveLength(1);
    expect(events[0].name).toBe("BotRegistered");
    expect(events[0].args.botId).toBe(botId);
    expect(events[0].args.owner).toBe(ethers.getAddress(owner));
    expect(events[0].args.imageURI).toBe("docker.io/mybot:latest");
    expect(events[0].args.tier).toBe(0n);
  });

  it("should parse Deposited event", () => {
    const botId = "0x" + "02".repeat(32);
    const depositor = "0x" + "bb".repeat(20);
    const amount = ethers.parseEther("0.01");
    const payload = createMockPayload("Deposited", [botId, depositor, amount]);

    const events = parseWebhookPayload(payload);

    expect(events).toHaveLength(1);
    expect(events[0].name).toBe("Deposited");
    expect(events[0].args.botId).toBe(botId);
    expect(events[0].args.amount).toBe(amount);
  });

  it("should parse Withdrawn event", () => {
    const botId = "0x" + "03".repeat(32);
    const owner = "0x" + "cc".repeat(20);
    const amount = ethers.parseEther("0.005");
    const payload = createMockPayload("Withdrawn", [botId, owner, amount]);

    const events = parseWebhookPayload(payload);

    expect(events).toHaveLength(1);
    expect(events[0].name).toBe("Withdrawn");
    expect(events[0].args.amount).toBe(amount);
  });

  it("should parse RestartTriggered event", () => {
    const botId = "0x" + "04".repeat(32);
    const timestamp = BigInt(Math.floor(Date.now() / 1000));
    const payload = createMockPayload("RestartTriggered", [botId, timestamp]);

    const events = parseWebhookPayload(payload);

    expect(events).toHaveLength(1);
    expect(events[0].name).toBe("RestartTriggered");
    expect(events[0].args.botId).toBe(botId);
  });

  it("should return empty array for unrelated payloads", () => {
    const payload = {
      event: {
        network: "BASE_SEPOLIA",
        activity: [
          {
            hash: "0x123",
            blockNum: "0x100",
            log: {
              topics: ["0x" + "ff".repeat(32)],
              data: "0x",
            },
          },
        ],
      },
    };

    const events = parseWebhookPayload(payload);
    expect(events).toHaveLength(0);
  });

  it("should handle empty payload", () => {
    expect(parseWebhookPayload({})).toHaveLength(0);
    expect(parseWebhookPayload({ event: {} })).toHaveLength(0);
    expect(parseWebhookPayload(null)).toHaveLength(0);
  });
});

describe("createEventRouter", () => {
  it("should route events to correct handlers", async () => {
    const onBotRegistered = vi.fn();
    const onDeposited = vi.fn();

    const router = createEventRouter({
      onBotRegistered,
      onDeposited,
    });

    const event: AporiaEvent = {
      name: "BotRegistered",
      txHash: "0x123",
      blockNumber: 100,
      log: {},
      args: { botId: "0x01", owner: "0x02" },
    };

    await router(event);
    expect(onBotRegistered).toHaveBeenCalledWith(event);
    expect(onDeposited).not.toHaveBeenCalled();
  });

  it("should use onUnknown for unrecognized events", async () => {
    const onUnknown = vi.fn();

    const router = createEventRouter({ onUnknown });

    const event: AporiaEvent = {
      name: "SomeOtherEvent",
      txHash: "0x123",
      blockNumber: 100,
      log: {},
      args: {},
    };

    await router(event);
    expect(onUnknown).toHaveBeenCalledWith(event);
  });

  it("should silently skip events with no matching handler", async () => {
    const router = createEventRouter({});

    const event: AporiaEvent = {
      name: "BotRegistered",
      txHash: "0x123",
      blockNumber: 100,
      log: {},
      args: {},
    };

    // Should not throw
    await router(event);
  });

  it("should handle async handlers", async () => {
    const results: string[] = [];

    const router = createEventRouter({
      onDeposited: async (event) => {
        await new Promise((r) => setTimeout(r, 10));
        results.push(`deposited:${event.args.amount}`);
      },
    });

    await router({
      name: "Deposited",
      txHash: "0x1",
      blockNumber: 1,
      log: {},
      args: { amount: "100" },
    });

    expect(results).toEqual(["deposited:100"]);
  });
});
