import "server-only";
import { cookies } from "next/headers";
import { decryptSecret, encryptSecret } from "@/lib/crypto";

/**
 * The half-finished Square authorization, held between the redirect out and
 * the callback back — `src/lib/email/oauth/pending.ts`, for a different
 * provider and with one fewer secret (no PKCE verifier; see oauth.ts).
 *
 * What has to survive the round trip: the state value, WHICH COMPANY the owner
 * was connecting, and where to send them afterwards. The company cannot travel
 * in the URL — an attacker who could edit it would bind another company's books
 * to the Square account being authorised — so it rides in an encrypted,
 * httpOnly, ten-minute cookie instead, and is consumed on first read.
 */

const COOKIE = "square_oauth_pending";
const TTL_SECONDS = 600;

export interface PendingSquareAuthorization {
  state: string;
  tenantId: string;
  /** Null for the tenant that has no books and therefore no company (ADR 0015). */
  entityId: string | null;
  returnTo: string;
  issuedAt: number;
}

export async function storePendingSquare(
  pending: PendingSquareAuthorization,
): Promise<void> {
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
 * Read and immediately consume it. Single-use by construction: the cookie is
 * cleared whether or not its contents turn out to be valid, so a replayed
 * callback finds nothing.
 */
export async function takePendingSquare(): Promise<PendingSquareAuthorization | null> {
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
      typeof p.tenantId !== "string" ||
      !(typeof p.entityId === "string" || p.entityId === null) ||
      typeof p.issuedAt !== "number"
    ) {
      return null;
    }
    // Belt and braces: the cookie's own maxAge should already have expired it,
    // but a clock the browser controls is not one to rely on.
    if (Date.now() - p.issuedAt > TTL_SECONDS * 1000) return null;

    return {
      state: p.state,
      tenantId: p.tenantId,
      entityId: p.entityId,
      returnTo:
        typeof p.returnTo === "string"
          ? p.returnTo
          : "/dashboard/settings/payments",
      issuedAt: p.issuedAt,
    };
  } catch {
    return null;
  }
}
