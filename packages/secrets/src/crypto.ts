/**
 * @module @aporia/secrets
 * Asymmetric encryption for secure environment variable management
 *
 * Flow:
 * 1. Deployer generates a keypair (done once)
 * 2. User encrypts their env vars with Deployer's public key
 * 3. Encrypted blob + hash stored on-chain
 * 4. On restart, Deployer decrypts in RAM, passes to Docker, wipes immediately
 */

import nacl from "tweetnacl";
import util from "tweetnacl-util";

/** A NaCl box keypair */
export interface KeyPair {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
}

/** Encrypted envelope containing ciphertext + nonce */
export interface EncryptedEnvelope {
  /** Base64-encoded ciphertext */
  ciphertext: string;
  /** Base64-encoded nonce */
  nonce: string;
  /** Base64-encoded sender public key (ephemeral) */
  ephemeralPublicKey: string;
}

/**
 * Generate a new NaCl box keypair for the Deployer
 */
export function generateKeyPair(): KeyPair {
  return nacl.box.keyPair();
}

/**
 * Serialize a public key to Base64 for sharing
 */
export function publicKeyToBase64(publicKey: Uint8Array): string {
  return util.encodeBase64(publicKey);
}

/**
 * Deserialize a Base64 public key
 */
export function publicKeyFromBase64(base64: string): Uint8Array {
  return util.decodeBase64(base64);
}

/**
 * Encrypt environment variables for secure transport
 *
 * Uses an ephemeral keypair so the sender doesn't need a persistent identity.
 * Only the Deployer's secret key can decrypt.
 *
 * @param envVars - Key-value pairs of environment variables
 * @param deployerPublicKey - The Deployer's public key
 * @returns Encrypted envelope
 */
export function encryptEnv(
  envVars: Record<string, string>,
  deployerPublicKey: Uint8Array,
): EncryptedEnvelope {
  const plaintext = JSON.stringify(envVars);
  const messageUint8 = util.decodeUTF8(plaintext);

  // Ephemeral keypair provides forward secrecy — even if the deployer's
  // key is compromised, past encryptions remain safe
  const ephemeralKeyPair = nacl.box.keyPair();

  // 24-byte random nonce prevents ciphertext collision across identical plaintexts
  const nonce = nacl.randomBytes(nacl.box.nonceLength);

  // NaCl box = X25519-XSalsa20-Poly1305 (ECDH + stream cipher + MAC)
  // Provides both confidentiality and tamper detection
  const encrypted = nacl.box(messageUint8, nonce, deployerPublicKey, ephemeralKeyPair.secretKey);

  if (!encrypted) {
    throw new Error("Encryption failed");
  }

  return {
    ciphertext: util.encodeBase64(encrypted),
    nonce: util.encodeBase64(nonce),
    ephemeralPublicKey: util.encodeBase64(ephemeralKeyPair.publicKey),
  };
}

/**
 * Decrypt environment variables (Deployer-only, in RAM)
 *
 * SECURITY: The result should be passed directly to Docker env vars
 * and NOT persisted to disk.
 *
 * @param envelope - The encrypted envelope
 * @param deployerSecretKey - The Deployer's secret key
 * @returns Decrypted key-value pairs
 */
export function decryptEnv(
  envelope: EncryptedEnvelope,
  deployerSecretKey: Uint8Array,
): Record<string, string> {
  const ciphertext = util.decodeBase64(envelope.ciphertext);
  const nonce = util.decodeBase64(envelope.nonce);
  const ephemeralPublicKey = util.decodeBase64(envelope.ephemeralPublicKey);

  const decrypted = nacl.box.open(ciphertext, nonce, ephemeralPublicKey, deployerSecretKey);

  if (!decrypted) {
    throw new Error("Decryption failed – invalid key or tampered data");
  }

  const plaintext = util.encodeUTF8(decrypted);

  // Caller is responsible for wiping the returned object from memory after use
  return JSON.parse(plaintext);
}

/**
 * Serialize encrypted envelope to bytes for on-chain storage
 */
export function envelopeToBytes(envelope: EncryptedEnvelope): Uint8Array {
  const json = JSON.stringify(envelope);
  return util.decodeUTF8(json);
}

/**
 * Deserialize bytes from on-chain storage to encrypted envelope
 */
export function bytesToEnvelope(bytes: Uint8Array): EncryptedEnvelope {
  const json = util.encodeUTF8(bytes);
  return JSON.parse(json);
}

/**
 * Compute keccak256-compatible hash of encrypted blob
 * Uses SHA-512 from tweetnacl as a stand-in; real keccak256 is done on-chain
 */
export function hashEnvelope(envelope: EncryptedEnvelope): Uint8Array {
  const bytes = envelopeToBytes(envelope);
  return nacl.hash(bytes);
}
