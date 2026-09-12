import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { schema, withSystem } from "@/db";
import { overPublicCap } from "@/lib/public-caps";
import { hashToken, isShareSecretConfigured, looksLikeToken } from "@/lib/public-token";

/**
 * Turning a preview token into the site it stands for (ADR 0046).
 *
 * **THE TRUST MODEL IS THE DOCUMENT SHARE'S, VERBATIM**
 * (`src/modules/documents/shares/resolve.ts`): `withSystem` does the token →
 * tenant hop and NOTHING else. It accepts no caller-supplied tenant or site
 * id, it matches on one token-hash equality, and everything the visitor then
 * sees is read under `withTenant` as `staff` by the caller. Widening this one
 * lookup is the single most dangerous change in the feature.
 *
 * Why a whole resolver for what looks like one query: every refusal has to be
 * INDISTINGUISHABLE. A visitor holding a dud token must not be able to tell
 * "never existed" from "revoked yesterday" from "expired an hour ago", because
 * the difference tells them whether a real link exists to go looking for.
 */

/** Every failure answers with this. No status is ever distinguishable. */
export const GENERIC_GONE = "This preview link is no longer available.";

/**
 * Guessing is infeasible — `mintToken` is 32 bytes of entropy in a URL — so
 * this is not the lock, it is the thing that stops somebody trying anyway and
 * turning the lookup into a load generator. Generous per IP: a client opens
 * their preview repeatedly and shows it to people, and only a WRONG token
 * counts against the cap.
 */
const PREVIEW_CAP = { kind: "site_preview", hourlyIpCap: 60, dailyCap: 5000 };

export type PreviewResolution =
  | { ok: false }
  | { ok: true; previewId: string; tenantId: string; siteId: string };

/**
 * Resolve a token. `{ ok: false }` for every failure — unknown, revoked,
 * expired, malformed, secret not configured, tenant gone.
 */
export async function resolvePreview(
  rawToken: string,
  ipHash: string,
): Promise<PreviewResolution> {
  // Fail closed: with no secret there is no keying, so nothing can be trusted.
  if (!isShareSecretConfigured()) {
    console.error("SHARE_SECRET is not set — preview links disabled");
    return { ok: false };
  }
  // Shape first, so a junk path costs no database round trip and no counter.
  if (!looksLikeToken(rawToken)) return { ok: false };
  if (await overPublicCap(PREVIEW_CAP, ipHash)) return { ok: false };

  return withSystem(async (tx) => {
    const row = await tx.query.sitePreviews.findFirst({
      where: eq(schema.sitePreviews.tokenHash, hashToken(rawToken)),
      columns: {
        id: true,
        tenantId: true,
        siteId: true,
        expiresAt: true,
        revokedAt: true,
      },
    });
    if (!row) return { ok: false };
    if (row.revokedAt) return { ok: false };
    if (row.expiresAt.getTime() <= Date.now()) return { ok: false };
    return { ok: true, previewId: row.id, tenantId: row.tenantId, siteId: row.siteId };
  });
}

/**
 * "Have they looked at it yet?" — the question an owner actually asks, and
 * without this the answer is a phone call.
 *
 * Written in the system hop because a visitor has no role to write with, and
 * touching ONLY the row the token already matched. Deliberately not awaited by
 * the page: a counter that fails must never cost somebody the page they came
 * for.
 */
export async function countPreviewView(previewId: string): Promise<void> {
  await withSystem((tx) =>
    tx
      .update(schema.sitePreviews)
      .set({
        viewCount: sql`${schema.sitePreviews.viewCount} + 1`,
        lastViewedAt: new Date(),
      })
      .where(and(eq(schema.sitePreviews.id, previewId))),
  );
}
