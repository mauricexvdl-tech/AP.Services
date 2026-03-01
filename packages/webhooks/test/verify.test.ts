/**
 * @module @aporia/webhooks
 * Tests for HMAC signature verification
 */

import { describe, it, expect } from "vitest";
import crypto from "crypto";
import { verifyAlchemySignature } from "../src/verify";

describe("verifyAlchemySignature", () => {
    const signingKey = "test-signing-secret-key-123";

    function generateSignature(body: string, key: string): string {
        return crypto.createHmac("sha256", key).update(body).digest("hex");
    }

    it("should verify valid signature", () => {
        const body = JSON.stringify({ test: "data" });
        const signature = generateSignature(body, signingKey);

        expect(verifyAlchemySignature(body, signature, signingKey)).toBe(true);
    });

    it("should reject invalid signature", () => {
        const body = JSON.stringify({ test: "data" });
        const badSignature = "0000000000000000000000000000000000000000000000000000000000000000";

        expect(verifyAlchemySignature(body, badSignature, signingKey)).toBe(false);
    });

    it("should reject tampered body", () => {
        const body = JSON.stringify({ test: "data" });
        const signature = generateSignature(body, signingKey);
        const tamperedBody = JSON.stringify({ test: "tampered" });

        expect(verifyAlchemySignature(tamperedBody, signature, signingKey)).toBe(false);
    });

    it("should reject wrong signing key", () => {
        const body = JSON.stringify({ test: "data" });
        const signature = generateSignature(body, signingKey);

        expect(verifyAlchemySignature(body, signature, "wrong-key")).toBe(false);
    });

    it("should reject empty inputs", () => {
        expect(verifyAlchemySignature("", "sig", signingKey)).toBe(false);
        expect(verifyAlchemySignature("body", "", signingKey)).toBe(false);
        expect(verifyAlchemySignature("body", "sig", "")).toBe(false);
    });

    it("should handle complex JSON payloads", () => {
        const complexPayload = JSON.stringify({
            webhookId: "wh_123",
            event: {
                network: "BASE_SEPOLIA",
                activity: [{
                    hash: "0xabc",
                    blockNum: "0x1234",
                    log: {
                        topics: ["0xdead"],
                        data: "0xbeef",
                    },
                }],
            },
        });

        const signature = generateSignature(complexPayload, signingKey);
        expect(verifyAlchemySignature(complexPayload, signature, signingKey)).toBe(true);
    });
});
