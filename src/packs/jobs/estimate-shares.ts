import "server-only";
import { and, desc, eq, sql } from "drizzle-orm";
import { schema, withTenant, type Tx } from "@/db";
import type { JobEstimateShare } from "@/db/schema";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { hashToken, mintToken } from "@/lib/public-token";
import { shareStanding, type ShareStanding } from "./estimate-share-status";
import { JobsError, requireWrite, type JobsCtx } from "./ops";

/**
 * THE CLIENT'S COPY OF A PROPOSAL, AND THE ACCEPTANCE THEY PUT A NAME TO
 * (E5c, ADR 0085).
 *
 * The builder's half: mint a link, copy it again later, take it back, and read
 * what happened to it. The visitor's half is `resolveProposalShare` in
 * `proposal.ts`, which is the only thing in the pack that runs under
 * `withSystem` — and it does one lookup and nothing else.
 *
 * **NOTHING HERE ACCEPTS AN ESTIMATE.** `signEstimateShare` records that
 * somebody holding the link put a name to this proposal at this moment, with
 * the estimate's version and total as they stood. That is evidence, the same
 * way a lien waiver (ADR 0066) and a back-charge (ADR 0077) are records
 * rather than forms. `acceptEstimate` still wants an owner and the contract
 * the estimate priced — neither of which a client has — so the business
 * accepts it, with the signature in front of them as the reason to.
 */

/** No never-expiring anonymous links, and this is the fallback when the estimate names no date. */
export const SHARE_DEFAULT_DAYS = 30;

export interface EstimateShareRow {
  share: JobEstimateShare;
  standing: ShareStanding;
}

/**
 * When a link should die, and the estimate usually already says.
 *
 * A proposal carries `valid_until`: the date the business told the client the
 * price holds to. A link that outlived it would be offering a price the
 * document itself says has expired, so the link ends with the offer. With no
 * date, thirty days — long enough for a client to think, short enough that a
 * forwarded email does not stay live for a year.
 *
 * Pure, so the rule is testable without a row: the date is read in the
 * tenant's zone at the end of that day, because "valid until the 14th"
 * includes the 14th.
 */
export function shareExpiryFor(validUntil: string | null, now: Date): Date {
  if (validUntil !== null) {
    const end = new Date(`${validUntil}T23:59:59.999Z`);
    if (!Number.isNaN(end.getTime()) && end.getTime() > now.getTime()) return end;
  }
  return new Date(now.getTime() + SHARE_DEFAULT_DAYS * 24 * 60 * 60 * 1000);
}

/** Every link on an estimate, newest first, each with its standing read off the facts. */
export async function listEstimateShares(
  tx: Tx,
  tenantId: string,
  estimateId: string,
  estimateVersion: number,
  now: Date = new Date(),
): Promise<EstimateShareRow[]> {
  const rows = await tx
    .select()
    .from(schema.jobEstimateShares)
    .where(
      and(
        eq(schema.jobEstimateShares.tenantId, tenantId),
        eq(schema.jobEstimateShares.estimateId, estimateId),
      ),
    )
    .orderBy(desc(schema.jobEstimateShares.createdAt));
  return rows.map((share) => ({
    share,
    standing: shareStanding(
      {
        revokedAt: share.revokedAt,
        expiresAt: share.expiresAt,
        signedAt: share.signedAt,
        signedEstimateVersion: share.signedEstimateVersion,
        estimateVersion,
      },
      now,
    ),
  }));
}

/**
 * Mint a link. The token is returned ONCE here and never again from this
 * function — it is stored only as a keyed hash and as ciphertext, so getting
 * it back is a deliberate second call (`revealShareToken`).
 */
export async function createEstimateShare(
  tx: Tx,
  ctx: JobsCtx,
  estimateId: string,
  now: Date = new Date(),
): Promise<{ share: JobEstimateShare; token: string }> {
  requireWrite(ctx, "member");
  // The one read this needs, and it is also where the expiry comes from: the
  // builder does not choose a date, the proposal's own validity decides.
  const estimate = await tx
    .select({ validUntil: schema.jobEstimates.validUntil })
    .from(schema.jobEstimates)
    .where(
      and(eq(schema.jobEstimates.tenantId, ctx.tenantId), eq(schema.jobEstimates.id, estimateId)),
    )
    .limit(1);
  if (estimate.length === 0) throw new JobsError("NOT_FOUND", "estimate not found");

  const token = mintToken();
  const rows = await tx
    .insert(schema.jobEstimateShares)
    .values({
      tenantId: ctx.tenantId,
      estimateId,
      tokenHash: hashToken(token),
      tokenCiphertext: encryptSecret(token),
      expiresAt: shareExpiryFor(estimate[0].validUntil, now),
      createdByClerkUserId: ctx.userId,
    })
    .returning();
  return { share: rows[0], token };
}

/**
 * The token again, for a builder who needs to re-send the link. A decrypt, so
 * it is the environment's key that guards it rather than the database's
 * permissions — a backup or a branch copy on its own yields nothing.
 */
export function revealShareToken(share: JobEstimateShare): string {
  return decryptSecret(share.tokenCiphertext);
}

/** Take it back. Idempotent enough to be safe, and refuses a second revoke plainly. */
export async function revokeEstimateShare(
  tx: Tx,
  ctx: JobsCtx,
  shareId: string,
): Promise<JobEstimateShare> {
  requireWrite(ctx, "member");
  const rows = await tx
    .update(schema.jobEstimateShares)
    .set({
      revokedAt: new Date(),
      revokedByClerkUserId: ctx.userId,
      updatedAt: new Date(),
      version: sql`${schema.jobEstimateShares.version} + 1`,
    })
    .where(
      and(
        eq(schema.jobEstimateShares.tenantId, ctx.tenantId),
        eq(schema.jobEstimateShares.id, shareId),
        sql`${schema.jobEstimateShares.revokedAt} is null`,
      ),
    )
    .returning();
  if (rows.length === 0) throw new JobsError("SHARE_CLOSED", "that link is already revoked, or gone");
  return rows[0];
}

/**
 * Count a view and stamp when. One statement, its own transaction, so
 * concurrent opens serialize on the row — and so a failure to count never
 * stops the document being served. A view is a VIEW, not a device: a reload
 * counts, which is honest and is all the builder is told.
 */
export async function countShareView(tenantId: string, shareId: string): Promise<void> {
  await withTenant(tenantId, (tx) =>
    tx
      .update(schema.jobEstimateShares)
      .set({ viewCount: sql`${schema.jobEstimateShares.viewCount} + 1`, lastViewedAt: new Date() })
      .where(
        and(
          eq(schema.jobEstimateShares.tenantId, tenantId),
          eq(schema.jobEstimateShares.id, shareId),
        ),
      ),
  );
}

export interface SignatureInput {
  name: string;
  ipHash: string;
  /** The version the client was SHOWN. A mismatch is refused, not overwritten. */
  estimateVersion: number;
  totalCents: number;
}

/**
 * THE ONE WRITE A VISITOR MAY MAKE, and it is a record, not a state change.
 *
 * **The version the client was shown is checked, not trusted.** If the
 * builder edited the estimate between the page loading and the button being
 * pressed, the signature would name a document the client never read — so it
 * is refused, exactly as `STALE_VERSION` refuses every other guarded verb in
 * this pack. The client reloads and sees what changed.
 *
 * The `signed_at is null` in the WHERE is the second half: two people opening
 * the same link at once cannot both sign, because the first update takes the
 * row and the second matches nothing. A link is signed once.
 *
 * Runs under `withTenant` — the tenant came from the token lookup, never from
 * the caller — so the member policy governs this write like any other.
 */
export async function signEstimateShare(
  tenantId: string,
  shareId: string,
  input: SignatureInput,
): Promise<JobEstimateShare> {
  const name = input.name.trim();
  if (name === "" || name.length > 120) {
    throw new JobsError("INVALID_VALUE", "a name is needed to accept");
  }
  const rows = await withTenant(tenantId, (tx) =>
    tx
      .update(schema.jobEstimateShares)
      .set({
        signedAt: new Date(),
        signedName: name,
        signedIpHash: input.ipHash,
        signedEstimateVersion: input.estimateVersion,
        signedTotalCents: input.totalCents,
        updatedAt: new Date(),
        version: sql`${schema.jobEstimateShares.version} + 1`,
      })
      .where(
        and(
          eq(schema.jobEstimateShares.tenantId, tenantId),
          eq(schema.jobEstimateShares.id, shareId),
          sql`${schema.jobEstimateShares.signedAt} is null`,
          sql`${schema.jobEstimateShares.revokedAt} is null`,
          sql`${schema.jobEstimateShares.expiresAt} > now()`,
        ),
      )
      .returning(),
  );
  if (rows.length === 0) {
    throw new JobsError("SHARE_CLOSED", "that link cannot be accepted");
  }
  return rows[0];
}

/**
 * The signature the business should see on the estimate, if any — the newest
 * one across every link, because a builder who sent two links cares that it
 * was signed, not on which copy.
 */
export async function latestSignature(
  tx: Tx,
  tenantId: string,
  estimateId: string,
): Promise<JobEstimateShare | null> {
  const rows = await tx
    .select()
    .from(schema.jobEstimateShares)
    .where(
      and(
        eq(schema.jobEstimateShares.tenantId, tenantId),
        eq(schema.jobEstimateShares.estimateId, estimateId),
        sql`${schema.jobEstimateShares.signedAt} is not null`,
      ),
    )
    .orderBy(desc(schema.jobEstimateShares.signedAt))
    .limit(1);
  return rows[0] ?? null;
}
