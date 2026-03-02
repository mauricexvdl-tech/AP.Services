/**
 * @module @aporia/gateway
 * AlchemyGateway – Autonomous agent access to Alchemy APIs
 *
 * Supports two modes:
 * 1. API Key mode: Standard Alchemy RPC with ALCHEMY_API_KEY
 * 2. Agentic Gateway mode: SIWE auth + x402 USDC payments (no API key needed)
 *
 * The agentic gateway enables bots/agents to pay autonomously with USDC on Base.
 */

export interface GatewayConfig {
  /** Private key for signing SIWE tokens and x402 payments (0x-prefixed hex) */
  privateKey: string;
  /** Network to use (default: "base-mainnet") */
  network?: "base-mainnet" | "base-sepolia";
  /** Alchemy API key (optional – uses standard RPC when provided) */
  alchemyApiKey?: string;
}

/** Supported chain network slugs for the gateway */
const GATEWAY_NETWORKS: Record<string, { chainId: number; rpcSlug: string }> = {
  "base-mainnet": { chainId: 8453, rpcSlug: "base-mainnet" },
  "base-sepolia": { chainId: 84532, rpcSlug: "base-sepolia" },
};

const GATEWAY_BASE_URL = "https://x402.alchemy.com";

/**
 * AlchemyGateway – Provides RPC access to Base L2 via Alchemy
 *
 * In agentic mode (no API key), uses SIWE + x402 payment flow:
 *   wallet → SIWE token → request → handle 402 → pay with USDC → retry
 *
 * In API key mode, uses standard Alchemy RPC URLs.
 */
export class AlchemyGateway {
  private config: Required<Pick<GatewayConfig, "privateKey" | "network">> & {
    alchemyApiKey?: string;
  };
  private siweToken: string | null = null;
  private paidFetch: typeof fetch | null = null;
  private initialized = false;

  constructor(config: GatewayConfig) {
    this.config = {
      privateKey: config.privateKey,
      network: config.network || "base-mainnet",
      alchemyApiKey: config.alchemyApiKey,
    };
  }

  /**
   * Initialize the gateway – sets up SIWE auth and x402 payment client
   * Must be called before making any RPC calls in agentic mode
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    if (this.config.alchemyApiKey) {
      // API Key mode – no SIWE/x402 needed
      this.initialized = true;
      console.log("[Gateway] Initialized in API Key mode");
      return;
    }

    // Agentic Gateway mode – SIWE + x402
    try {
      const { buildX402Client, signSiwe } = await import("@alchemy/x402");
      const { wrapFetchWithPayment } = await import("@x402/fetch");

      const privateKey = this.config.privateKey as `0x${string}`;

      // Create x402 payment client (supports Base Mainnet + Base Sepolia)
      const x402Client = buildX402Client(privateKey);

      // Generate SIWE auth token
      this.siweToken = await signSiwe({ privateKey });

      // Create fetch wrapper with SIWE auth + auto x402 payment
      const siweToken = this.siweToken;
      const authedFetch: typeof fetch = async (input, init) => {
        const headers = new Headers(init?.headers);
        headers.set("Authorization", `SIWE ${siweToken}`);
        return fetch(input, { ...init, headers });
      };

      this.paidFetch = wrapFetchWithPayment(authedFetch, x402Client);
      this.initialized = true;

      console.log(`[Gateway] Initialized in Agentic mode (${this.config.network})`);
    } catch (error: any) {
      throw new Error(
        `Failed to initialize Alchemy Gateway: ${error.message}\n` +
          `Make sure @alchemy/x402 and @x402/fetch are installed.`,
      );
    }
  }

  /**
   * Get the RPC endpoint URL based on the current mode
   */
  getEndpointUrl(): string {
    const networkInfo = GATEWAY_NETWORKS[this.config.network];
    if (!networkInfo) {
      throw new Error(`Unsupported network: ${this.config.network}`);
    }

    if (this.config.alchemyApiKey) {
      return `https://${networkInfo.rpcSlug}.g.alchemy.com/v2/${this.config.alchemyApiKey}`;
    }

    return `${GATEWAY_BASE_URL}/${networkInfo.rpcSlug}/v2`;
  }

  /**
   * Make a JSON-RPC call to the Base L2 node
   */
  async rpcCall(method: string, params: any[] = []): Promise<any> {
    if (!this.initialized) {
      await this.initialize();
    }

    const url = this.getEndpointUrl();
    const body = JSON.stringify({
      id: 1,
      jsonrpc: "2.0",
      method,
      params,
    });

    let response: Response;

    if (this.paidFetch) {
      // Agentic mode – use paid fetch with auto 402 handling
      response = await this.paidFetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body,
      });
    } else {
      // API Key mode – standard fetch
      response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });
    }

    if (!response.ok) {
      throw new Error(`RPC request failed: HTTP ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as any;

    if (data.error) {
      throw new Error(`RPC error: ${data.error.message || JSON.stringify(data.error)}`);
    }

    return data.result;
  }

  // ─── Convenience Methods ─────────────────────────────────────

  /** Get the current block number */
  async getBlockNumber(): Promise<string> {
    return this.rpcCall("eth_blockNumber");
  }

  /** Get ETH balance of an address */
  async getBalance(address: string): Promise<string> {
    return this.rpcCall("eth_getBalance", [address, "latest"]);
  }

  /** Get ERC-20 token balances via Alchemy enhanced API */
  async getTokenBalances(address: string): Promise<any> {
    return this.rpcCall("alchemy_getTokenBalances", [address]);
  }

  /** Get asset transfers via Alchemy enhanced API */
  async getAssetTransfers(params: {
    fromBlock?: string;
    toBlock?: string;
    fromAddress?: string;
    toAddress?: string;
    category: string[];
    maxCount?: string;
  }): Promise<any> {
    return this.rpcCall("alchemy_getAssetTransfers", [params]);
  }

  /** Check if the gateway is operating in API Key mode */
  isApiKeyMode(): boolean {
    return !!this.config.alchemyApiKey;
  }

  /** Check if the gateway is initialized */
  isInitialized(): boolean {
    return this.initialized;
  }

  /** Get current network */
  getNetwork(): string {
    return this.config.network;
  }
}
