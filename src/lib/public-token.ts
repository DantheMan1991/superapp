import "server-only";
import {
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";

/**
 * Credentials for the platform's anonymous surfaces (first use: document share
 * links). A share token grants a stranger read access to a tenant's files, so
 * it is the highest-value secret this platform mints.
 *
 * One root secret, SHARE_SECRET, with LABELLED derivation for each purpose.
 * Three separate env vars would be three things to set, three to rotate and
 * three to forget; domain separation gives the same isolation — a token hash
 * can never collide with or be confused for a session signature — from one.
 *
 * Fail-closed, like INTERVIEW_IP_SALT: without the secret there is no keying
 * at all, so the feature refuses to work rather than degrading quietly.
 */

const TOKEN_BYTES = 32; // 256 bits, base64url -> 43 chars
const SCRYPT_KEYLEN = 32;
const SALT_BYTES = 16;

type Purpose = "token" | "ip" | "session";

function rootSecret(): string {
  const secret = process.env.SHARE_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      "SHARE_SECRET is not set (needs >= 32 chars). See SETUP.md.",
    );
  }
  return secret;
}

export function isShareSecretConfigured(): boolean {
  const secret = process.env.SHARE_SECRET;
  return typeof secret === "string" && secret.length >= 32;
}

/** Per-purpose key, so one derived value can never stand in for another. */
function key(purpose: Purpose): Buffer {
  return createHmac("sha256", rootSecret())
    .update(`yosher:v1:${purpose}`)
    .digest();
}

/**
 * A fresh share token. NOT lowercased — unlike the inbound-email token, this
 * lives in a URL path, which is case-preserving, and folding it would throw
 * away 40-odd bits for nothing.
 */
export function mintToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

/** Rough shape check before spending a database round trip on a lookup. */
export function looksLikeToken(value: string): boolean {
  return /^[A-Za-z0-9_-]{40,50}$/.test(value);
}

/**
 * Keyed digest for storage and lookup. HMAC rather than a salt-and-sha256
 * concat because this is a digest of a secret, and HMAC is the primitive built
 * for that. The pepper lives in the environment, so a database-only compromise
 * (a backup, a branch copy, a logged query) yields nothing usable.
 */
export function hashToken(token: string): string {
  return createHmac("sha256", key("token")).update(token).digest("hex");
}

/** Hashed client IP for abuse counters. Raw IPs are never stored. */
export function hashIp(ip: string): string {
  return createHmac("sha256", key("ip")).update(ip).digest("hex");
}

/* ---- passcodes -------------------------------------------------------- */

/**
 * scrypt, not sha256: a passcode a human types and reads out over the phone is
 * low-entropy by definition, so it needs a deliberately slow KDF.
 * Format: base64(salt).base64(hash), the dot-joined convention from crypto.ts.
 */
export function hashPasscode(passcode: string): string {
  const salt = randomBytes(SALT_BYTES);
  const derived = scryptSync(passcode, salt, SCRYPT_KEYLEN);
  return `${salt.toString("base64")}.${derived.toString("base64")}`;
}

export function verifyPasscode(passcode: string, stored: string): boolean {
  const [saltB64, hashB64] = stored.split(".");
  if (!saltB64 || !hashB64) return false;
  try {
    const salt = Buffer.from(saltB64, "base64");
    const expected = Buffer.from(hashB64, "base64");
    const actual = scryptSync(passcode, salt, expected.length);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

/**
 * Burn the same work as a real verification on a path that has nothing to
 * verify. Without this, "unknown token" returns measurably faster than "known
 * token, wrong passcode", which is exactly the oracle the generic responses
 * exist to remove.
 */
export function decoyPasscodeWork(): void {
  scryptSync("decoy", Buffer.alloc(SALT_BYTES), SCRYPT_KEYLEN);
}

/* ---- unlock sessions -------------------------------------------------- */

export interface ShareSession {
  shareId: string;
  exp: number;
}

/**
 * A signed cookie value proving this browser passed the passcode. The raw
 * token is deliberately NOT in it: the cookie is scoped to the link's own
 * path, and a cookie that carried the credential would leak it to anything
 * that could read cookies for that path.
 */
export function signSession(session: ShareSession): string {
  const payload = Buffer.from(JSON.stringify(session), "utf8").toString(
    "base64url",
  );
  const mac = createHmac("sha256", key("session"))
    .update(payload)
    .digest("base64url");
  return `${payload}.${mac}`;
}

export function verifySession(
  value: string | undefined,
  shareId: string,
  now = Date.now(),
): boolean {
  if (!value) return false;
  const [payload, mac] = value.split(".");
  if (!payload || !mac) return false;
  const expected = createHmac("sha256", key("session"))
    .update(payload)
    .digest("base64url");
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
  try {
    const parsed = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as ShareSession;
    return parsed.shareId === shareId && parsed.exp > now;
  } catch {
    return false;
  }
}
