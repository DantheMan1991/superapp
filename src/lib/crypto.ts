import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * App-layer encryption for genuinely sensitive stored values (first use:
 * Plaid access tokens). AES-256-GCM with a random IV per encryption and
 * the auth tag stored alongside — tampering fails decryption loudly.
 *
 * Key: APP_ENCRYPTION_KEY, 32 bytes base64 (generate with
 * `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`).
 * Lazy like every provider so the app builds without it. v1 is a single
 * key; rotation = decrypt-all/re-encrypt runbook (see plan).
 */

function getKey(): Buffer {
  const raw = process.env.APP_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error("APP_ENCRYPTION_KEY is not set. See SETUP.md.");
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error("APP_ENCRYPTION_KEY must be 32 bytes of base64.");
  }
  return key;
}

/** Format: base64(iv).base64(tag).base64(ciphertext) */
export function encryptSecret(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}.${tag.toString("base64")}.${enc.toString("base64")}`;
}

export function decryptSecret(ciphertext: string): string {
  const key = getKey();
  const [ivB64, tagB64, encB64] = ciphertext.split(".");
  if (!ivB64 || !tagB64 || !encB64) {
    throw new Error("malformed ciphertext");
  }
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(encB64, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
