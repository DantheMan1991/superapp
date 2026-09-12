import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import { hashToken, mintToken } from "@/lib/public-token";
import { GRANT_DAYS, MAX_GRANTS_PER_PERSON } from "./types";

/**
 * Grants: minting, listing, revoking — everything a SIGNED-IN person does to
 * the phones pointed at their workspace.
 *
 * THE REDEEM SIDE IS A DIFFERENT FILE ON PURPOSE (`redeem.ts`), because that
 * one opens `withSystem` and this one never may. `feed-ops.ts` and
 * `feed-serve.ts` are split for exactly this reason: keeping the `withSystem`
 * call in a file of its own is what makes it easy to find and hard to copy by
 * accident.
 */

export class DeviceGrantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeviceGrantError";
  }
}

export interface GrantCtx {
  tenantId: string;
  userId: string;
}

export interface GrantRow {
  id: string;
  label: string;
  platform: "ios" | "android";
  createdAt: Date;
  lastUsedAt: Date | null;
  expiresAt: Date;
}

/**
 * Takes no ctx, deliberately — the same choice `listFeedTokens` makes. The
 * policy scopes these rows to the caller's own, so there is nothing to filter
 * on here, and adding a predicate would imply the filter is what protects it.
 */
export async function listGrants(tx: Tx): Promise<GrantRow[]> {
  return tx
    .select({
      id: schema.deviceGrants.id,
      label: schema.deviceGrants.label,
      platform: schema.deviceGrants.platform,
      createdAt: schema.deviceGrants.createdAt,
      lastUsedAt: schema.deviceGrants.lastUsedAt,
      expiresAt: schema.deviceGrants.expiresAt,
    })
    .from(schema.deviceGrants)
    .where(isNull(schema.deviceGrants.revokedAt));
}

export function grantExpiryFrom(now: Date): Date {
  return new Date(now.getTime() + GRANT_DAYS * 24 * 60 * 60 * 1_000);
}

/**
 * Mint a grant and return the token IN PLAINTEXT, exactly once.
 *
 * Only the hash reaches the database, so there is no second chance to show
 * it: the caller must hand it straight to the phone's keychain. That is the
 * whole security property — a dump of `device_grants` hands nobody a working
 * credential.
 *
 * ON iOS THE KEYCHAIN ITEM MUST BE `kSecAttrAccessibleAfterFirstUnlock`, not
 * `WhenUnlocked`. A Siri intent firing against a locked phone cannot read a
 * `WhenUnlocked` item, and a locked phone is the entire point of the feature.
 * Recorded here because this function is where somebody will be standing when
 * they write the native side.
 */
export async function mintGrant(
  tx: Tx,
  ctx: GrantCtx,
  input: { label: string; platform: "ios" | "android"; appVersion?: string },
  now = new Date(),
): Promise<string> {
  const existing = await listGrants(tx);
  if (existing.length >= MAX_GRANTS_PER_PERSON) {
    throw new DeviceGrantError(
      `you already have ${MAX_GRANTS_PER_PERSON} phones set up — revoke one first`,
    );
  }

  const label = input.label.trim().slice(0, 60);
  if (label === "") throw new DeviceGrantError("give the phone a name");

  const token = mintToken();
  await tx.insert(schema.deviceGrants).values({
    tenantId: ctx.tenantId,
    clerkUserId: ctx.userId,
    tokenHash: hashToken(token),
    scope: "tell",
    platform: input.platform,
    label,
    appVersion: (input.appVersion ?? "").slice(0, 40),
    expiresAt: grantExpiryFrom(now),
  });
  return token;
}

/**
 * Revoke. The row stays, marked, rather than going: so "when did I turn that
 * off?" has an answer, and so a revoked hash can never be re-minted into a
 * working credential. `device_grants` has no DELETE policy for the same
 * reason.
 *
 * A REVOKED GRANT STOPS WORKING ON ITS NEXT SENTENCE, not the instant this
 * runs — nothing here reaches out to the phone. The screen has to say so
 * rather than implying the phone went quiet immediately.
 */
export async function revokeGrant(
  tx: Tx,
  grantId: string,
  reason = "by hand",
): Promise<void> {
  await tx
    .update(schema.deviceGrants)
    .set({ revokedAt: new Date(), revokedReason: reason })
    .where(
      and(
        eq(schema.deviceGrants.id, grantId),
        isNull(schema.deviceGrants.revokedAt),
      ),
    );
}
