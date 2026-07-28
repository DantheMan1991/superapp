import "server-only";
import { cookies } from "next/headers";
import { decryptSecret, encryptSecret } from "@/lib/crypto";

/**
 * The half-finished authorization, held between the redirect out and the
 * callback back.
 *
 * Three things have to survive that round trip: the PKCE verifier, the state
 * value, and which mailbox the person was connecting. None of them can travel
 * in the URL — the verifier especially, since publishing it would defeat the
 * entire point of PKCE.
 *
 * A cookie rather than a database row, because this is per-browser, short-lived
 * and worthless once used. A `pending_oauth` table would need a purge job and
 * would still be a cookie in disguise.
 *
 * Encrypted with the same app key as everything else, so a cookie read off the
 * wire or out of a browser profile yields nothing. httpOnly keeps it away from
 * scripts, sameSite=lax survives the redirect back from the mail server, and
 * a ten-minute lifetime bounds how long a stolen one is worth anything.
 */

const COOKIE = "mail_oauth_pending";
const TTL_SECONDS = 600;

export interface PendingAuthorization {
  state: string;
  verifier: string;
  /** Which hosted mailbox this connects. */
  mailboxId: string;
  tenantId: string;
  /** Where to send the person once it works. */
  returnTo: string;
  issuedAt: number;
}

export async function storePending(pending: PendingAuthorization): Promise<void> {
  const jar = await cookies();
  jar.set(COOKIE, encryptSecret(JSON.stringify(pending)), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: TTL_SECONDS,
  });
}

/**
 * Read and immediately consume it.
 *
 * Single-use by construction: the cookie is cleared whether or not the contents
 * turn out to be valid, so a replayed callback finds nothing. An authorization
 * code is already single-use at the server; this makes the client side agree.
 */
export async function takePending(): Promise<PendingAuthorization | null> {
  const jar = await cookies();
  const raw = jar.get(COOKIE)?.value;
  jar.delete(COOKIE);
  if (!raw) return null;

  try {
    const parsed: unknown = JSON.parse(decryptSecret(raw));
    if (typeof parsed !== "object" || parsed === null) return null;
    const p = parsed as Record<string, unknown>;
    if (
      typeof p.state !== "string" ||
      typeof p.verifier !== "string" ||
      typeof p.mailboxId !== "string" ||
      typeof p.tenantId !== "string" ||
      typeof p.issuedAt !== "number"
    ) {
      return null;
    }
    // Belt and braces: the cookie's own maxAge should already have expired it,
    // but a clock the browser controls is not one to rely on.
    if (Date.now() - p.issuedAt > TTL_SECONDS * 1000) return null;

    return {
      state: p.state,
      verifier: p.verifier,
      mailboxId: p.mailboxId,
      tenantId: p.tenantId,
      returnTo: typeof p.returnTo === "string" ? p.returnTo : "/dashboard/email",
      issuedAt: p.issuedAt,
    };
  } catch {
    return null;
  }
}
