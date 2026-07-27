import { decryptSecret, encryptSecret } from "@/lib/crypto";

/**
 * Encryption for mailbox OAuth tokens.
 *
 * A thin wrapper over `@/lib/crypto`, which already does AES-256-GCM with a
 * random IV and the auth tag stored alongside, keyed on `APP_ENCRYPTION_KEY`.
 * Plaid access tokens have used it since the banking module shipped; mailbox
 * tokens are the same class of secret and get the same treatment.
 *
 * A second key was briefly considered and rejected. The usual argument for
 * separating keys is blast radius — but both would live in the same
 * environment, on the same server, reachable by the same compromise. Two keys
 * in one `.env` is two things to rotate and no additional protection.
 *
 * What the mail path needs on top is one behavioural change, below.
 *
 * The property that matters is unchanged: the key lives in the environment and
 * never in the database it protects. An access token reads someone's mail until
 * it expires and a refresh token mints more indefinitely, which makes these the
 * most dangerous values on the platform — worse than a password hash, which
 * cannot be replayed. A Postgres dump yields ciphertext, and that is what makes
 * the member_read policy on `mail_accounts` acceptable rather than alarming.
 */

export function isTokenEncryptionConfigured(): boolean {
  const raw = process.env.APP_ENCRYPTION_KEY;
  if (!raw) return false;
  return Buffer.from(raw, "base64").length === 32;
}

export function encryptToken(plaintext: string): string {
  return encryptSecret(plaintext);
}

/**
 * Decrypt a token, or return null.
 *
 * This is the one place the mail path diverges from `decryptSecret`, which
 * throws. Null, because every realistic failure here means the same thing
 * operationally — this connection is unusable and the person must reconnect. A
 * rotated key, a corrupted row and a tampered ciphertext all land in the same
 * place, and no caller should have to tell them apart to render "reconnect your
 * mailbox". An exception here would turn one dead connection into a broken
 * inbox page.
 */
export function decryptToken(stored: string): string | null {
  if (!stored) return null;
  try {
    return decryptSecret(stored);
  } catch {
    // Includes the authentication-tag failure that means tampering.
    return null;
  }
}
