import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import { SchedulingError, type SchedulingCtx } from "./calendar-ops";

/**
 * Subscribe-feed tokens: minting, listing, revoking.
 *
 * The serving side is deliberately in a different file (`feed-serve.ts`),
 * because that one runs `withSystem` and this one never may. Keeping them apart
 * is what makes the `withSystem` call easy to find and hard to copy by accident.
 */

/** SHA-256, hex. The only form of a token that is ever stored. */
export function hashFeedToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export interface FeedTokenRow {
  id: string;
  label: string;
  createdAt: Date;
  lastUsedAt: Date | null;
}

/**
 * Takes no ctx, deliberately. The policy scopes these rows to the caller's own,
 * so there is nothing for a caller to pass and nothing here to filter on —
 * adding a predicate would imply the filter is what protects it.
 */
export async function listFeedTokens(tx: Tx): Promise<FeedTokenRow[]> {
  return tx
    .select({
      id: schema.scheduleFeedTokens.id,
      label: schema.scheduleFeedTokens.label,
      createdAt: schema.scheduleFeedTokens.createdAt,
      lastUsedAt: schema.scheduleFeedTokens.lastUsedAt,
    })
    .from(schema.scheduleFeedTokens)
    .where(isNull(schema.scheduleFeedTokens.revokedAt));
}

/** How many live feeds one person may have. */
const MAX_TOKENS = 5;

/**
 * Mint a token and return it IN PLAINTEXT, exactly once.
 *
 * The caller must show it immediately and must not store it: only the hash
 * reaches the database, so there is no second chance to display it. That is the
 * whole security property — a dump of the table hands nobody a working feed.
 *
 * 32 random bytes, base64url. Long enough that guessing is not a threat model,
 * and URL-safe so it survives being pasted into a phone.
 */
export async function mintFeedToken(
  tx: Tx,
  ctx: SchedulingCtx,
  label: string,
): Promise<string> {
  const existing = await listFeedTokens(tx);
  if (existing.length >= MAX_TOKENS) {
    throw new SchedulingError(
      "INVALID",
      `you already have ${MAX_TOKENS} subscribe links — revoke one first`,
    );
  }

  const token = randomBytes(32).toString("base64url");
  await tx.insert(schema.scheduleFeedTokens).values({
    tenantId: ctx.tenantId,
    clerkUserId: ctx.userId,
    tokenHash: hashFeedToken(token),
    label: label.trim().slice(0, 60),
  });
  return token;
}

/**
 * Revoke. The row stays, marked, rather than being deleted — so "when did I
 * turn that off?" has an answer, and so a revoked hash can never be re-minted.
 */
export async function revokeFeedToken(
  tx: Tx,
  tokenId: string,
): Promise<void> {
  await tx
    .update(schema.scheduleFeedTokens)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(schema.scheduleFeedTokens.id, tokenId),
        isNull(schema.scheduleFeedTokens.revokedAt),
      ),
    );
}
