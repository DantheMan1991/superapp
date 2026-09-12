import "server-only";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { schema, withSystem, type Tx } from "@/db";
import { hashToken } from "@/lib/public-token";
import { todayInTimezone } from "@/lib/timezone";
import type { TellCtx } from "@/lib/tell-sources/types";
import { grantExpiryFrom } from "./ops";
import {
  looksLikeDeviceToken,
  RATE_WINDOW_MS,
  SPOKEN_AT_TOLERANCE_MS,
} from "./types";

/** The three ends a request can come to. Mirrors the `device_use_outcome` enum. */
export type DeviceUseOutcome = "proposed" | "recorded" | "refused";

/**
 * THE SECOND GATE. `tell-sources/actions.ts` has one that turns a Clerk
 * session into a `TellCtx`; this turns a token a phone presented into the
 * same thing. Everything past this point — `proposeTold`, `recordTold`, each
 * pack's own verb — is identical for both doors, which is the whole design:
 * a phone does not get a second pipeline, it gets a second way in.
 *
 * ── THE ONE `withSystem` ─────────────────────────────────────────────────────
 *
 * There is no session, so nothing can be scoped until the hash resolves. This
 * file opens `withSystem` for EXACTLY ONE TRANSACTION — turning a hash into a
 * person, and stamping the use on the way past — and hands back a context the
 * caller then reopens as that person with `withTenant`. `feed-serve.ts`
 * established this shape and the reasoning has not changed. Nothing else in
 * `src/lib/device-grants/` may call `withSystem`, which is why minting and
 * revoking live in `ops.ts` instead.
 *
 * ── WHY EVERY JOIN IS AN INNER JOIN ──────────────────────────────────────────
 *
 * **This is the revocation story, and it is not the expiry.** The founder's
 * answer to "would anybody go and revoke a departed worker's phone?" was no,
 * so the design had to stop depending on somebody remembering. Sliding expiry
 * does not help: it rewards use, and somebody who left and keeps talking to
 * it renews their own credential every morning.
 *
 * What DOES happen when somebody leaves is that they are taken out of the
 * workspace — because that is how you stop them reading the books — and
 * `organizationMembership.deleted` makes `removeMembership()` hard-DELETE the
 * row (`src/lib/tenant-sync.ts`). `user.deleted` cascades the profile the
 * same way. So an INNER JOIN through `profiles` and `memberships` means their
 * phone dies on its next sentence, with nobody having to think about it.
 * **Revoking a phone is never a separate act.**
 *
 * ── AND WHY A MISSING MEMBERSHIP REFUSES HERE, WHERE THE WEB DEGRADES ────────
 *
 * `lookupTenantAndRole()` in `src/lib/auth.ts` treats a missing membership row
 * as `staff` rather than a refusal, and is right to: a fresh organisation
 * whose webhook has not landed yet must not lock its own owner out of the
 * workspace they just made. Copying that here would be a hole — it is exactly
 * the row whose absence is supposed to kill the credential. **No membership
 * means refuse, not degrade**, and the refusal is the same generic one every
 * other credential failure gets.
 */

export interface RedeemedGrant {
  grantId: string;
  ctx: TellCtx;
}

/**
 * A grant, or null. ONE ANSWER FOR EVERY FAILURE — unknown token, revoked,
 * expired, wrong scope, tenant deleted, membership gone. Distinguishing them
 * would tell somebody holding a dead token which part they got right, the
 * same reasoning behind `serveFeed`'s uniform 404 and the decoy work in
 * `time/pin-ops.ts`.
 */
export async function redeemGrant(
  token: string,
  now = new Date(),
): Promise<RedeemedGrant | null> {
  // Cheap shape check before a round trip, so a scanner costs a regex.
  if (!looksLikeDeviceToken(token)) return null;

  return withSystem(async (tx) => {
    const [found] = await tx
      .select({
        grantId: schema.deviceGrants.id,
        tenantId: schema.deviceGrants.tenantId,
        clerkUserId: schema.deviceGrants.clerkUserId,
        timezone: schema.tenants.timezone,
        membershipRole: schema.memberships.role,
      })
      .from(schema.deviceGrants)
      .innerJoin(
        schema.tenants,
        eq(schema.tenants.id, schema.deviceGrants.tenantId),
      )
      .innerJoin(
        schema.profiles,
        eq(schema.profiles.clerkUserId, schema.deviceGrants.clerkUserId),
      )
      .innerJoin(
        schema.memberships,
        and(
          eq(schema.memberships.tenantId, schema.deviceGrants.tenantId),
          eq(schema.memberships.profileId, schema.profiles.id),
        ),
      )
      .where(
        and(
          eq(schema.deviceGrants.tokenHash, hashToken(token)),
          eq(schema.deviceGrants.scope, "tell"),
          isNull(schema.deviceGrants.revokedAt),
          gt(schema.deviceGrants.expiresAt, now),
        ),
      )
      .limit(1);

    if (!found) return null;

    // The credential was presented and accepted, so this counts as a use
    // whatever the sentence turns out to say. Slid here, in the same
    // transaction, rather than costing a second round trip.
    await tx
      .update(schema.deviceGrants)
      .set({ lastUsedAt: now, expiresAt: grantExpiryFrom(now) })
      .where(eq(schema.deviceGrants.id, found.grantId));

    return {
      grantId: found.grantId,
      ctx: {
        tenantId: found.tenantId,
        userId: found.clerkUserId,
        role: roleForGrant(found.membershipRole),
        today: todayInTimezone(found.timezone),
      },
    };
  });
}

/**
 * A GRANT IS NEVER AN OWNER.
 *
 * Clerk owns owner-vs-member and this path has no Clerk session to ask;
 * `memberships.role` only separates the outside accountant from everybody
 * else. Calling Clerk's API on every sentence would put a network hop on the
 * hot path for the privilege of granting MORE, so the rule is least
 * privilege instead: an owner speaking to their phone gets what a staff
 * member gets, deliberately, and anything needing owner is simply not
 * speakable. Owners-only document folders stay shut because `withTenant`
 * is handed this role and nothing else.
 *
 * `expert` is carried through rather than flattened, because expert is not a
 * lesser staff — it is a DIFFERENT member, read-only in the core modules, and
 * promoting one to staff here would hand the outside accountant writes their
 * own screens refuse them.
 */
export function roleForGrant(
  membershipRole: string | null,
): "staff" | "expert" {
  return membershipRole === "expert" ? "expert" : "staff";
}

/**
 * What time the sentence happened, given what the phone claims.
 *
 * Inside the tolerance the phone wins, and it has to: a sentence spoken in a
 * barn with no signal may not reach us for hours, and its real time is the
 * one it was SPOKEN at, not the one it was uploaded at. Outside the
 * tolerance the server wins, because a device clock is user-settable and for
 * a clock-in the difference is wages.
 *
 * Both values are written to `device_grant_uses`, so a phone whose owner set
 * the date back is a row somebody can find rather than a silent belief.
 */
export function clampSpokenAt(
  claimed: Date | null,
  serverNow: Date,
): { effectiveAt: Date; clamped: boolean } {
  if (!claimed || Number.isNaN(claimed.getTime())) {
    return { effectiveAt: serverNow, clamped: false };
  }
  const drift = Math.abs(claimed.getTime() - serverNow.getTime());
  if (drift > SPOKEN_AT_TOLERANCE_MS) {
    return { effectiveAt: serverNow, clamped: true };
  }
  return { effectiveAt: claimed, clamped: false };
}

/**
 * Has this exact request already been answered? The phone queues sentences
 * while the barn has no signal and retries when it reconnects, so the same
 * request arrives twice and the second one must not act again.
 *
 * Runs as the grant's holder, inside the caller's transaction — the row is
 * theirs and the policy says so.
 */
export async function priorUse(
  tx: Tx,
  grantId: string,
  idempotencyKey: string,
): Promise<{ outcome: DeviceUseOutcome; actionSlugs: string[] } | null> {
  const [row] = await tx
    .select({
      outcome: schema.deviceGrantUses.outcome,
      actionSlugs: schema.deviceGrantUses.actionSlugs,
    })
    .from(schema.deviceGrantUses)
    .where(
      and(
        eq(schema.deviceGrantUses.grantId, grantId),
        eq(schema.deviceGrantUses.idempotencyKey, idempotencyKey),
      ),
    )
    .limit(1);
  if (!row) return null;
  return {
    outcome: row.outcome,
    actionSlugs: Array.isArray(row.actionSlugs)
      ? (row.actionSlugs as string[])
      : [],
  };
}

/**
 * How many sentences this grant has sent inside the window. Counted from the
 * table rather than an in-process map because a limit that only holds on one
 * serverless instance is not a limit — and this is the one path with no
 * disabled button in front of it.
 */
export async function usesInWindow(
  tx: Tx,
  grantId: string,
  now = new Date(),
): Promise<number> {
  const since = new Date(now.getTime() - RATE_WINDOW_MS);
  const [row] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.deviceGrantUses)
    .where(
      and(
        eq(schema.deviceGrantUses.grantId, grantId),
        gt(schema.deviceGrantUses.createdAt, since),
      ),
    );
  return row?.n ?? 0;
}

/**
 * Write the use. One row per REQUEST, not per utterance: a propose and the
 * confirm that follows it are two rows with two keys, so a retried confirm
 * collides with its own first attempt and not with the propose that preceded
 * it.
 *
 * `actionSlugs` IS ALL THAT IS KEPT. The sentence can name a customer, a
 * price or an animal, and this row outlives the proposal, so what the person
 * said never lands here (security.md S9, the rule `audit_log` follows).
 */
export async function recordUse(
  tx: Tx,
  input: {
    tenantId: string;
    grantId: string;
    clerkUserId: string;
    idempotencyKey: string;
    outcome: DeviceUseOutcome;
    actionSlugs: string[];
    claimedAt: Date | null;
    effectiveAt: Date;
  },
): Promise<void> {
  await tx.insert(schema.deviceGrantUses).values({
    tenantId: input.tenantId,
    grantId: input.grantId,
    clerkUserId: input.clerkUserId,
    idempotencyKey: input.idempotencyKey,
    outcome: input.outcome,
    actionSlugs: input.actionSlugs,
    claimedAt: input.claimedAt,
    effectiveAt: input.effectiveAt,
  });
}
