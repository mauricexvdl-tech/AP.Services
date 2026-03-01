/**
 * @module @aporia/webhooks
 * Register and manage Alchemy Notify webhooks for AporiaRegistry
 *
 * Uses the Alchemy Notify API to create ADDRESS_ACTIVITY webhooks
 * watching the deployed contract address.
 */

const NOTIFY_API_BASE = "https://dashboard.alchemy.com/api";

/** Network enum for Alchemy Notify API (uppercase format) */
const NOTIFY_NETWORKS: Record<string, string> = {
    "base-mainnet": "BASE_MAINNET",
    "base-sepolia": "BASE_SEPOLIA",
};

export interface RegisterWebhookOptions {
    /** Alchemy Notify auth token (from dashboard) */
    authToken: string;
    /** URL where Alchemy should POST events */
    webhookUrl: string;
    /** AporiaRegistry contract address to watch */
    contractAddress: string;
    /** Network (default: "base-sepolia") */
    network?: string;
}

export interface WebhookInfo {
    id: string;
    url: string;
    network: string;
    isActive: boolean;
    signingKey?: string;
}

/**
 * Register an ADDRESS_ACTIVITY webhook with Alchemy Notify
 *
 * Watches the AporiaRegistry contract for all activity (BotRegistered,
 * Deposited, Withdrawn, RestartTriggered events).
 */
export async function registerWebhook(options: RegisterWebhookOptions): Promise<WebhookInfo> {
    const network = NOTIFY_NETWORKS[options.network || "base-sepolia"];
    if (!network) {
        throw new Error(
            `Unsupported network: ${options.network}. ` +
            `Supported: ${Object.keys(NOTIFY_NETWORKS).join(", ")}`
        );
    }

    const response = await fetch(`${NOTIFY_API_BASE}/create-webhook`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "X-Alchemy-Token": options.authToken,
        },
        body: JSON.stringify({
            network,
            webhook_type: "ADDRESS_ACTIVITY",
            webhook_url: options.webhookUrl,
            addresses: [options.contractAddress],
        }),
    });

    if (!response.ok) {
        const errorBody = await response.text().catch(() => "Unknown error");
        throw new Error(
            `Failed to create webhook: HTTP ${response.status}\n${errorBody}`
        );
    }

    const data = (await response.json()) as any;

    return {
        id: data.data?.id || data.id,
        url: options.webhookUrl,
        network: options.network || "base-sepolia",
        isActive: true,
        signingKey: data.data?.signing_key || data.signing_key,
    };
}

/**
 * Delete a webhook by ID
 */
export async function deleteWebhook(
    authToken: string,
    webhookId: string
): Promise<void> {
    const response = await fetch(
        `${NOTIFY_API_BASE}/delete-webhook?webhook_id=${webhookId}`,
        {
            method: "DELETE",
            headers: {
                "X-Alchemy-Token": authToken,
            },
        }
    );

    if (!response.ok) {
        throw new Error(`Failed to delete webhook: HTTP ${response.status}`);
    }
}

/**
 * List all webhooks for the team
 */
export async function listWebhooks(authToken: string): Promise<WebhookInfo[]> {
    const response = await fetch(`${NOTIFY_API_BASE}/team-webhooks`, {
        method: "GET",
        headers: {
            "X-Alchemy-Token": authToken,
        },
    });

    if (!response.ok) {
        throw new Error(`Failed to list webhooks: HTTP ${response.status}`);
    }

    const data = (await response.json()) as any;
    const webhooks = data.data || [];

    return webhooks.map((w: any) => ({
        id: w.id,
        url: w.webhook_url,
        network: w.network,
        isActive: w.is_active,
    }));
}
