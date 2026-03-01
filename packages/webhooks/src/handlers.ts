/**
 * @module @aporia/webhooks
 * Event handlers for AporiaRegistry contract events received via Alchemy webhooks
 *
 * Handles: BotRegistered, Deposited, Withdrawn, RestartTriggered
 */

import { ethers } from "ethers";

// ─── AporiaRegistry Event Signatures ─────────────────────────────

const EVENT_SIGNATURES: Record<string, string> = {
    BotRegistered: "BotRegistered(bytes32,address,string,uint8)",
    Deposited: "Deposited(bytes32,address,uint256)",
    Withdrawn: "Withdrawn(bytes32,address,uint256)",
    RestartTriggered: "RestartTriggered(bytes32,uint256)",
    ImageBanned: "ImageBanned(string)",
    ImageUnbanned: "ImageUnbanned(string)",
    BotDeactivated: "BotDeactivated(bytes32)",
    RestartCostUpdated: "RestartCostUpdated(uint8,uint256)",
};

/** Topic hashes for event matching */
const EVENT_TOPICS: Record<string, string> = {};
for (const [name, sig] of Object.entries(EVENT_SIGNATURES)) {
    EVENT_TOPICS[ethers.id(sig)] = name;
}

// ─── Types ───────────────────────────────────────────────────────

/** Parsed APORIA event from a webhook payload */
export interface AporiaEvent {
    /** Event name (e.g., "BotRegistered") */
    name: string;
    /** Transaction hash */
    txHash: string;
    /** Block number */
    blockNumber: number;
    /** Raw log data */
    log: any;
    /** Decoded event arguments */
    args: Record<string, any>;
}

/** Handler function for a specific event type */
export type WebhookEventHandler = (event: AporiaEvent) => void | Promise<void>;

/** Map of event name → handler function */
export interface EventHandlerMap {
    onBotRegistered?: WebhookEventHandler;
    onDeposited?: WebhookEventHandler;
    onWithdrawn?: WebhookEventHandler;
    onRestartTriggered?: WebhookEventHandler;
    onImageBanned?: WebhookEventHandler;
    onImageUnbanned?: WebhookEventHandler;
    onBotDeactivated?: WebhookEventHandler;
    onRestartCostUpdated?: WebhookEventHandler;
    /** Catch-all for unrecognized events */
    onUnknown?: WebhookEventHandler;
}

// ─── ABI fragments for decoding ──────────────────────────────────

const ABI_FRAGMENTS = [
    "event BotRegistered(bytes32 indexed botId, address indexed owner, string imageURI, uint8 tier)",
    "event Deposited(bytes32 indexed botId, address indexed depositor, uint256 amount)",
    "event Withdrawn(bytes32 indexed botId, address indexed owner, uint256 amount)",
    "event RestartTriggered(bytes32 indexed botId, uint256 timestamp)",
    "event ImageBanned(string imageURI)",
    "event ImageUnbanned(string imageURI)",
    "event BotDeactivated(bytes32 indexed botId)",
    "event RestartCostUpdated(uint8 tier, uint256 newCost)",
];

const iface = new ethers.Interface(ABI_FRAGMENTS);

// ─── Event Parser ────────────────────────────────────────────────

/**
 * Parse an Alchemy webhook activity payload into AporiaEvents
 *
 * Alchemy Address Activity webhooks deliver payloads with an "event" object
 * containing an "activity" array. Each activity may contain logs with contract events.
 */
export function parseWebhookPayload(payload: any): AporiaEvent[] {
    const events: AporiaEvent[] = [];

    // Alchemy Address Activity format
    const activities = payload?.event?.activity || [];

    for (const activity of activities) {
        const logs = activity?.log ? [activity.log] : (activity?.logs || []);

        for (const log of logs) {
            const topics = log.topics || [];
            if (topics.length === 0) continue;

            const eventName = EVENT_TOPICS[topics[0]];
            if (!eventName) continue;

            try {
                const decoded = iface.parseLog({
                    topics,
                    data: log.data || "0x",
                });

                if (decoded) {
                    const args: Record<string, any> = {};
                    decoded.fragment.inputs.forEach((input, i) => {
                        args[input.name] = decoded.args[i];
                    });

                    events.push({
                        name: eventName,
                        txHash: activity.hash || log.transactionHash || "",
                        blockNumber: parseInt(activity.blockNum || log.blockNumber || "0", 16),
                        log,
                        args,
                    });
                }
            } catch {
                // Skip logs that can't be decoded (not our events)
            }
        }
    }

    return events;
}

// ─── Event Router ────────────────────────────────────────────────

/**
 * Create an event router that dispatches parsed events to their handlers
 */
export function createEventRouter(handlers: EventHandlerMap) {
    const handlerMap: Record<string, WebhookEventHandler | undefined> = {
        BotRegistered: handlers.onBotRegistered,
        Deposited: handlers.onDeposited,
        Withdrawn: handlers.onWithdrawn,
        RestartTriggered: handlers.onRestartTriggered,
        ImageBanned: handlers.onImageBanned,
        ImageUnbanned: handlers.onImageUnbanned,
        BotDeactivated: handlers.onBotDeactivated,
        RestartCostUpdated: handlers.onRestartCostUpdated,
    };

    return async (event: AporiaEvent): Promise<void> => {
        const handler = handlerMap[event.name] || handlers.onUnknown;
        if (handler) {
            await handler(event);
        }
    };
}

// ─── Default Handlers (logging) ──────────────────────────────────

/**
 * Default event handlers that log events to console
 * Use as a starting point or for debugging
 */
export const defaultHandlers: EventHandlerMap = {
    onBotRegistered: (event) => {
        console.log(`[Webhook] 🤖 BotRegistered: botId=${event.args.botId}, owner=${event.args.owner}, tier=${event.args.tier}`);
    },
    onDeposited: (event) => {
        console.log(`[Webhook] 💰 Deposited: botId=${event.args.botId}, amount=${ethers.formatEther(event.args.amount)} ETH`);
    },
    onWithdrawn: (event) => {
        console.log(`[Webhook] 💸 Withdrawn: botId=${event.args.botId}, amount=${ethers.formatEther(event.args.amount)} ETH`);
    },
    onRestartTriggered: (event) => {
        console.log(`[Webhook] 🔄 RestartTriggered: botId=${event.args.botId}, timestamp=${event.args.timestamp}`);
    },
    onUnknown: (event) => {
        console.log(`[Webhook] ❓ Unknown event: ${event.name}`);
    },
};
