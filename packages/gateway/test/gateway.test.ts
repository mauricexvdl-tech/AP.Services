/**
 * @module @aporia/gateway
 * Tests for AlchemyGateway
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { AlchemyGateway } from "../src/alchemy-gateway";

// ─── Mock fetch for testing ──────────────────────────────────────

const mockFetchResponse = (data: any, status = 200) => {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    json: async () => data,
    headers: new Headers(),
  } as Response;
};

describe("AlchemyGateway", () => {
  describe("API Key Mode", () => {
    let gateway: AlchemyGateway;

    beforeEach(() => {
      gateway = new AlchemyGateway({
        privateKey: "0x" + "a".repeat(64),
        network: "base-sepolia",
        alchemyApiKey: "test-api-key-123",
      });
    });

    it("should initialize in API key mode", async () => {
      await gateway.initialize();
      expect(gateway.isApiKeyMode()).toBe(true);
      expect(gateway.isInitialized()).toBe(true);
    });

    it("should generate correct API key endpoint URL", () => {
      const url = gateway.getEndpointUrl();
      expect(url).toBe("https://base-sepolia.g.alchemy.com/v2/test-api-key-123");
    });

    it("should generate correct mainnet URL", () => {
      const mainnetGateway = new AlchemyGateway({
        privateKey: "0x" + "a".repeat(64),
        network: "base-mainnet",
        alchemyApiKey: "test-key",
      });
      const url = mainnetGateway.getEndpointUrl();
      expect(url).toBe("https://base-mainnet.g.alchemy.com/v2/test-key");
    });

    it("should make RPC call with API key", async () => {
      await gateway.initialize();

      const mockResult = "0x134e82c";
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(mockFetchResponse({ id: 1, jsonrpc: "2.0", result: mockResult })),
      );

      const result = await gateway.rpcCall("eth_blockNumber");
      expect(result).toBe(mockResult);

      const fetchMock = vi.mocked(fetch);
      expect(fetchMock).toHaveBeenCalledOnce();

      const [url, opts] = fetchMock.mock.calls[0];
      expect(url).toBe("https://base-sepolia.g.alchemy.com/v2/test-api-key-123");

      const body = JSON.parse(opts?.body as string);
      expect(body.method).toBe("eth_blockNumber");
      expect(body.jsonrpc).toBe("2.0");

      vi.unstubAllGlobals();
    });

    it("should handle RPC errors", async () => {
      await gateway.initialize();

      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          mockFetchResponse({
            id: 1,
            jsonrpc: "2.0",
            error: { code: -32600, message: "Invalid request" },
          }),
        ),
      );

      await expect(gateway.rpcCall("invalid_method")).rejects.toThrow("RPC error: Invalid request");

      vi.unstubAllGlobals();
    });

    it("should handle HTTP errors", async () => {
      await gateway.initialize();

      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockFetchResponse({}, 500)));

      await expect(gateway.rpcCall("eth_blockNumber")).rejects.toThrow(
        "RPC request failed: HTTP 500",
      );

      vi.unstubAllGlobals();
    });
  });

  describe("Agentic Gateway Mode", () => {
    it("should default to agentic mode without API key", () => {
      const gateway = new AlchemyGateway({
        privateKey: "0x" + "a".repeat(64),
      });
      expect(gateway.isApiKeyMode()).toBe(false);
    });

    it("should generate correct gateway URL", () => {
      const gateway = new AlchemyGateway({
        privateKey: "0x" + "a".repeat(64),
        network: "base-mainnet",
      });
      const url = gateway.getEndpointUrl();
      expect(url).toBe("https://x402.alchemy.com/base-mainnet/v2");
    });

    it("should generate correct sepolia gateway URL", () => {
      const gateway = new AlchemyGateway({
        privateKey: "0x" + "a".repeat(64),
        network: "base-sepolia",
      });
      const url = gateway.getEndpointUrl();
      expect(url).toBe("https://x402.alchemy.com/base-sepolia/v2");
    });

    it("should default to base-mainnet network", () => {
      const gateway = new AlchemyGateway({
        privateKey: "0x" + "a".repeat(64),
      });
      expect(gateway.getNetwork()).toBe("base-mainnet");
    });
  });

  describe("Convenience Methods", () => {
    let gateway: AlchemyGateway;

    beforeEach(async () => {
      gateway = new AlchemyGateway({
        privateKey: "0x" + "a".repeat(64),
        alchemyApiKey: "test-key",
      });
      await gateway.initialize();
    });

    it("should call getBlockNumber", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(mockFetchResponse({ id: 1, jsonrpc: "2.0", result: "0xabc" })),
      );

      const result = await gateway.getBlockNumber();
      expect(result).toBe("0xabc");

      const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string);
      expect(body.method).toBe("eth_blockNumber");

      vi.unstubAllGlobals();
    });

    it("should call getBalance with address", async () => {
      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockResolvedValue(
            mockFetchResponse({ id: 1, jsonrpc: "2.0", result: "0xde0b6b3a7640000" }),
          ),
      );

      const result = await gateway.getBalance("0x1234567890abcdef1234567890abcdef12345678");
      expect(result).toBe("0xde0b6b3a7640000");

      const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string);
      expect(body.method).toBe("eth_getBalance");
      expect(body.params[0]).toBe("0x1234567890abcdef1234567890abcdef12345678");

      vi.unstubAllGlobals();
    });

    it("should call getTokenBalances", async () => {
      const mockBalances = { address: "0x123", tokenBalances: [] };
      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockResolvedValue(mockFetchResponse({ id: 1, jsonrpc: "2.0", result: mockBalances })),
      );

      const result = await gateway.getTokenBalances("0x123");
      expect(result).toEqual(mockBalances);

      const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string);
      expect(body.method).toBe("alchemy_getTokenBalances");

      vi.unstubAllGlobals();
    });

    it("should call getAssetTransfers", async () => {
      const mockTransfers = { transfers: [] };
      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockResolvedValue(mockFetchResponse({ id: 1, jsonrpc: "2.0", result: mockTransfers })),
      );

      const result = await gateway.getAssetTransfers({
        fromBlock: "0x0",
        toBlock: "latest",
        toAddress: "0x123",
        category: ["erc20"],
      });
      expect(result).toEqual(mockTransfers);

      const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string);
      expect(body.method).toBe("alchemy_getAssetTransfers");
      expect(body.params[0].category).toEqual(["erc20"]);

      vi.unstubAllGlobals();
    });
  });
});
