import { describe, it, expect } from "vitest";
import {
    generateKeyPair,
    publicKeyToBase64,
    publicKeyFromBase64,
    encryptEnv,
    decryptEnv,
    envelopeToBytes,
    bytesToEnvelope,
    hashEnvelope,
} from "../src/crypto";

describe("Secrets Crypto", () => {
    // ─── Key Generation ──────────────────────────────────────────

    describe("Key Generation", () => {
        it("should generate a valid keypair", () => {
            const kp = generateKeyPair();
            expect(kp.publicKey).toHaveLength(32);
            expect(kp.secretKey).toHaveLength(32);
        });

        it("should generate unique keypairs", () => {
            const kp1 = generateKeyPair();
            const kp2 = generateKeyPair();
            expect(publicKeyToBase64(kp1.publicKey)).not.toBe(publicKeyToBase64(kp2.publicKey));
        });
    });

    // ─── Key Serialization ─────────────────────────────────────

    describe("Key Serialization", () => {
        it("should roundtrip public key through Base64", () => {
            const kp = generateKeyPair();
            const b64 = publicKeyToBase64(kp.publicKey);
            const restored = publicKeyFromBase64(b64);
            expect(restored).toEqual(kp.publicKey);
        });
    });

    // ─── Encrypt / Decrypt ─────────────────────────────────────

    describe("Encrypt / Decrypt", () => {
        it("should encrypt and decrypt env vars successfully", () => {
            const deployerKeys = generateKeyPair();
            const envVars = {
                API_KEY: "sk-test-123456",
                DATABASE_URL: "postgres://user:pass@host/db",
                SECRET_TOKEN: "my-super-secret-token",
            };

            const envelope = encryptEnv(envVars, deployerKeys.publicKey);

            // Envelope should have all fields
            expect(envelope.ciphertext).toBeTruthy();
            expect(envelope.nonce).toBeTruthy();
            expect(envelope.ephemeralPublicKey).toBeTruthy();

            // Decrypt
            const decrypted = decryptEnv(envelope, deployerKeys.secretKey);
            expect(decrypted).toEqual(envVars);
        });

        it("should fail decryption with wrong key", () => {
            const deployerKeys = generateKeyPair();
            const wrongKeys = generateKeyPair();
            const envVars = { API_KEY: "secret" };

            const envelope = encryptEnv(envVars, deployerKeys.publicKey);

            expect(() => decryptEnv(envelope, wrongKeys.secretKey)).toThrow("Decryption failed");
        });

        it("should handle empty env vars", () => {
            const deployerKeys = generateKeyPair();
            const envVars = {};

            const envelope = encryptEnv(envVars, deployerKeys.publicKey);
            const decrypted = decryptEnv(envelope, deployerKeys.secretKey);
            expect(decrypted).toEqual({});
        });

        it("should handle special characters in values", () => {
            const deployerKeys = generateKeyPair();
            const envVars = {
                SPECIAL: "value with spaces & symbols! @#$%^&*()",
                UNICODE: "Ünïcödé 🎉",
                MULTILINE: "line1\nline2\nline3",
            };

            const envelope = encryptEnv(envVars, deployerKeys.publicKey);
            const decrypted = decryptEnv(envelope, deployerKeys.secretKey);
            expect(decrypted).toEqual(envVars);
        });

        it("should produce different ciphertext each time (random nonce)", () => {
            const deployerKeys = generateKeyPair();
            const envVars = { KEY: "value" };

            const envelope1 = encryptEnv(envVars, deployerKeys.publicKey);
            const envelope2 = encryptEnv(envVars, deployerKeys.publicKey);

            expect(envelope1.ciphertext).not.toBe(envelope2.ciphertext);
            expect(envelope1.nonce).not.toBe(envelope2.nonce);
        });
    });

    // ─── Serialization ────────────────────────────────────────

    describe("Envelope Serialization", () => {
        it("should roundtrip envelope through bytes", () => {
            const deployerKeys = generateKeyPair();
            const envVars = { API_KEY: "test" };
            const envelope = encryptEnv(envVars, deployerKeys.publicKey);

            const bytes = envelopeToBytes(envelope);
            const restored = bytesToEnvelope(bytes);

            expect(restored).toEqual(envelope);

            // Should still decrypt after roundtrip
            const decrypted = decryptEnv(restored, deployerKeys.secretKey);
            expect(decrypted).toEqual(envVars);
        });
    });

    // ─── Hashing ──────────────────────────────────────────────

    describe("Hashing", () => {
        it("should produce consistent hash for same envelope", () => {
            const deployerKeys = generateKeyPair();
            const envelope = encryptEnv({ KEY: "value" }, deployerKeys.publicKey);

            const hash1 = hashEnvelope(envelope);
            const hash2 = hashEnvelope(envelope);

            expect(hash1).toEqual(hash2);
        });

        it("should produce different hash for different envelopes", () => {
            const deployerKeys = generateKeyPair();
            const envelope1 = encryptEnv({ KEY: "value1" }, deployerKeys.publicKey);
            const envelope2 = encryptEnv({ KEY: "value2" }, deployerKeys.publicKey);

            const hash1 = hashEnvelope(envelope1);
            const hash2 = hashEnvelope(envelope2);

            // Convert to comparable strings
            expect(Array.from(hash1)).not.toEqual(Array.from(hash2));
        });
    });
});
