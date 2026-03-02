/**
 * @module @aporia/webhooks
 * HMAC signature verification for Alchemy Notify webhook payloads
 *
 * Alchemy signs every webhook payload with HMAC-SHA256 using the
 * webhook signing key. The signature is sent in the X-Alchemy-Signature header.
 */

import crypto from "crypto";

/**
 * Verify an Alchemy webhook signature
 *
 * @param rawBody  - The raw request body (pre-JSON-parse)
 * @param signature - The value of the X-Alchemy-Signature header
 * @param signingKey - The webhook signing secret from Alchemy Dashboard
 * @returns true if the signature is valid
 */
export function verifyAlchemySignature(
  rawBody: string,
  signature: string,
  signingKey: string,
): boolean {
  if (!rawBody || !signature || !signingKey) {
    return false;
  }

  try {
    const hmac = crypto.createHmac("sha256", signingKey).update(rawBody).digest("hex");

    return crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(signature));
  } catch {
    return false;
  }
}
