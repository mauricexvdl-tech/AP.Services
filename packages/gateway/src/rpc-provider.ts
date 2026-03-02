/**
 * @module @aporia/gateway
 * Custom ethers.js provider that routes through the Alchemy Gateway
 *
 * This enables existing code using ethers.js to transparently use
 * the Alchemy agentic gateway with x402 payments.
 */

import { ethers } from "ethers";
import { AlchemyGateway, GatewayConfig } from "./alchemy-gateway";

/**
 * AlchemyX402Provider – ethers.js JsonRpcProvider backed by AlchemyGateway
 *
 * Usage:
 *   const provider = new AlchemyX402Provider({
 *     privateKey: "0x...",
 *     network: "base-sepolia",
 *   });
 *   const blockNumber = await provider.getBlockNumber();
 */
export class AlchemyX402Provider extends ethers.JsonRpcApiProvider {
  private gateway: AlchemyGateway;
  private gatewayReady: Promise<void>;

  constructor(config: GatewayConfig) {
    const networkInfo =
      config.network === "base-sepolia"
        ? { chainId: 84532, name: "base-sepolia" }
        : { chainId: 8453, name: "base-mainnet" };

    super(networkInfo);
    this.gateway = new AlchemyGateway(config);
    this.gatewayReady = this.gateway.initialize();
  }

  /**
   * Override: Send JSON-RPC requests through the gateway
   */
  async _send(
    payload: ethers.JsonRpcPayload | Array<ethers.JsonRpcPayload>,
  ): Promise<Array<ethers.JsonRpcResult | ethers.JsonRpcError>> {
    await this.gatewayReady;

    const payloads = Array.isArray(payload) ? payload : [payload];
    const results: Array<ethers.JsonRpcResult | ethers.JsonRpcError> = [];

    for (const p of payloads) {
      try {
        const result = await this.gateway.rpcCall(p.method, (p.params as any[]) || []);
        results.push({
          id: p.id,
          result,
        });
      } catch (error: any) {
        results.push({
          id: p.id,
          error: {
            code: -32603,
            message: error.message,
          },
        });
      }
    }

    return results;
  }

  /** Get the underlying AlchemyGateway instance */
  getGateway(): AlchemyGateway {
    return this.gateway;
  }
}
