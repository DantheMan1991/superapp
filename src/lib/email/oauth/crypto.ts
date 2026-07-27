import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Encryption for mailbox OAuth tokens.
 *
 * An access token is a live credential: anyone holding one can read a person's
 * mail until it expires, and a refresh token can mint more indefinitely. They
 * are the most dangerous values this platform stores — worse than a password
 * hash, which cannot be replayed.
 *
 * So `mail_accounts` holds ciphertext, and the key lives in the environment,
 * never in the database. A dump of Postgres — a leaked backup, an over-broad
 * RLS policy, a support engineer with read access — yields nothing usable.
 * That is the property the whole design turns on, and it is the reason the
 * member_read policy on mail_accounts is acceptable rather than alarming.
 *
 * AES-256-GCM: authenticated, so tampering is detected rather than silently
 * decrypting to garbage. A fresh random IV per encryption, because reusing an
 * IV with GCM is catastrophic rather than merely weak.
 *
 * Deliberately free of `server-only` so it can be unit-tested, but it imports
 * node:crypto and will never run in a browser bundle.
 */

const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32;
const IV_BYTES = 12; // 96 bits, the GCM standard
const VERSION = "v1";

/**
 * Reads the key. Throws rather than falling back to a default, because a
 * default key is indistinguishable from no encryption at all and would fail
 * silently and permanently.
 */
function key(): Buffer {
  const raw = process.env.MAIL_TOKEN_KEY;
  if (!raw) {
    throw new Error(
      "MAIL_TOKEN_KEY is not set — mailbox tokens cannot be stored safely. See SETUP.md.",
    );
  }
  const decoded = Buffer.from(raw, "base64");
  if (decoded.length !== KEY_BYTES) {
    throw new Error(
      `MAIL_TOKEN_KEY must be ${KEY_BYTES} bytes of base64 (got ${decoded.length}). ` +
        "Generate one with: openssl rand -base64 32",
    );
  }
  return decoded;
}

export function isTokenEncryptionConfigured(): boolean {
  try {
    key();
    return true;
  } catch {
    return false;
  }
}

/**
 * Encrypt a token. Output is `v1:<iv>:<tag>:<ciphertext>`, all base64.
 *
 * The version prefix exists so the key or algorithm can be rotated later
 * without guessing at what an old row contains — a stored blob with no format
 * marker is a migration nobody can write safely.
 */
export function encryptToken(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [
    VERSION,
    iv.toString("base64"),
    tag.toString("base64"),
    ciphertext.toString("base64"),
  ].join(":");
}

/**
 * Decrypt a token, or return null.
 *
 * Null rather than throwing, because every realistic failure here means the
 * same thing operationally — this connection is unusable and the person must
 * reconnect. A rotated key, a corrupted row and a tampered ciphertext all land
 * in the same place, and callers should not have to tell them apart to render
 * "reconnect your mailbox".
 */
export function decryptToken(stored: string): string | null {
  if (!stored) return null;
  const parts = stored.split(":");
  if (parts.length !== 4 || parts[0] !== VERSION) return null;

  try {
    const iv = Buffer.from(parts[1], "base64");
    const tag = Buffer.from(parts[2], "base64");
    const ciphertext = Buffer.from(parts[3], "base64");
    if (iv.length !== IV_BYTES) return null;

    const decipher = createDecipheriv(ALGORITHM, key(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    // Includes the authentication-tag failure that means tampering.
    return null;
  }
}

/** For SETUP.md and first-run guidance. Never called at runtime. */
export function generateTokenKey(): string {
  return randomBytes(KEY_BYTES).toString("base64");
}
