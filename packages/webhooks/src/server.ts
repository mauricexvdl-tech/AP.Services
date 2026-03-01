/**
 * @module @aporia/webhooks
 * Express server for receiving Alchemy Notify webhook payloads
 */

import express, { Request, Response, Application } from "express";
import { verifyAlchemySignature } from "./verify";
import { parseWebhookPayload, createEventRouter, defaultHandlers, type EventHandlerMap, type AporiaEvent } from "./handlers";

export interface WebhookServerConfig {
    /** Port to listen on (default: 8089) */
    port?: number;
    /** Webhook signing secret for HMAC verification */
    signingKey: string;
    /** Custom event handlers (falls back to default logging handlers) */
    handlers?: EventHandlerMap;
    /** Path for the webhook endpoint (default: /webhook/alchemy) */
    path?: string;
}

/**
 * WebhookServer – Receives and processes Alchemy Notify webhook payloads
 *
 * Automatically verifies HMAC signatures, parses contract events,
 * and routes them to registered handlers.
 */
export class WebhookServer {
    private app: Application;
    private config: Required<WebhookServerConfig>;
    private router: (event: AporiaEvent) => Promise<void>;
    private server: any = null;

    constructor(config: WebhookServerConfig) {
        this.config = {
            port: config.port || 8089,
            signingKey: config.signingKey,
            handlers: config.handlers || defaultHandlers,
            path: config.path || "/webhook/alchemy",
        };

        this.app = express();
        this.router = createEventRouter(this.config.handlers);
        this.setupRoutes();
    }

    /**
     * Set up Express routes
     */
    private setupRoutes(): void {
        // Raw body parser for signature verification
        this.app.use(this.config.path, express.raw({ type: "application/json" }));

        // Health endpoint
        this.app.get("/health", (_req: Request, res: Response) => {
            res.json({ status: "ok", service: "aporia-webhooks" });
        });

        // Webhook endpoint
        this.app.post(this.config.path, async (req: Request, res: Response) => {
            const rawBody = req.body.toString("utf-8");
            const signature = req.headers["x-alchemy-signature"] as string;

            // ─── Verify signature ─────────────────────────────────
            if (!verifyAlchemySignature(rawBody, signature, this.config.signingKey)) {
                console.warn("[Webhook] ⚠️  Invalid signature – rejecting payload");
                res.status(401).json({ error: "Invalid signature" });
                return;
            }

            // ─── Parse and route events ───────────────────────────
            try {
                const payload = JSON.parse(rawBody);
                const events = parseWebhookPayload(payload);

                console.log(`[Webhook] Received ${events.length} event(s)`);

                for (const event of events) {
                    await this.router(event);
                }

                res.status(200).json({ ok: true, eventsProcessed: events.length });
            } catch (error: any) {
                console.error(`[Webhook] ❌ Error processing payload: ${error.message}`);
                res.status(500).json({ error: "Internal processing error" });
            }
        });
    }

    /**
     * Start the webhook server
     */
    async start(): Promise<void> {
        return new Promise((resolve) => {
            this.server = this.app.listen(this.config.port, () => {
                console.log(`[Webhook] 🎣 Server listening on port ${this.config.port}`);
                console.log(`[Webhook]    Endpoint: POST ${this.config.path}`);
                resolve();
            });
        });
    }

    /**
     * Stop the webhook server
     */
    async stop(): Promise<void> {
        return new Promise((resolve) => {
            if (this.server) {
                this.server.close(() => {
                    console.log("[Webhook] Server stopped");
                    resolve();
                });
            } else {
                resolve();
            }
        });
    }

    /** Get the Express app instance (for testing) */
    getApp(): Application {
        return this.app;
    }
}
