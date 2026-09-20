import "server-only";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { schema, withTenant, type Tx } from "@/db";
import type { JobBidInvitation, JobBidPackage } from "@/db/schema";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { hashToken, mintToken } from "@/lib/public-token";
import { violatedUniqueIndex } from "@/lib/db-errors";
import {
  bidStanding,
  invitationExpiryFor,
  summarizePackage,
  type BidStanding,
  type PackageSummary,
} from "./bid-math";
import { JobsError, requireWrite, type JobsCtx } from "./ops";

/**
 * ASKING SUBCONTRACTORS FOR A NUMBER (X3, ADR 0098) — the builder's half.
 *
 * The subcontractor's half is `resolveBidInvitation` in `bid-share.ts`, which
 * is the only thing here that runs under `withSystem`, and it does one lookup
 * and nothing else.
 *
 * MEMBER WORK. Asking for a number is estimating, the same as writing the
 * line it will fill. Awarding one is also member work — it decides which
 * figure an estimate uses, not who gets bought, which is still a commitment.
 */

export interface InvitationRow {
  invitation: JobBidInvitation;
  partyName: string;
  standing: BidStanding;
}

export interface BidPackageRow {
  pkg: JobBidPackage;
  invitations: InvitationRow[];
  summary: PackageSummary;
}

function facts(i: JobBidInvitation) {
  return {
    amountCents: i.amountCents,
    declined: i.declined,
    revokedAt: i.revokedAt,
    expiresAt: i.expiresAt,
    viewCount: i.viewCount,
    isAwarded: i.isAwarded,
  };
}

export async function listBidPackages(
  tx: Tx,
  tenantId: string,
  projectId: string,
  now: Date = new Date(),
): Promise<BidPackageRow[]> {
  const packages = await tx
    .select()
    .from(schema.jobBidPackages)
    .where(
      and(
        eq(schema.jobBidPackages.tenantId, tenantId),
        eq(schema.jobBidPackages.projectId, projectId),
      ),
    )
    .orderBy(desc(schema.jobBidPackages.createdAt));
  if (packages.length === 0) return [];

  /** One read for every invitation on the job, not one per package. */
  const rows = await tx
    .select({
      invitation: schema.jobBidInvitations,
      partyName: schema.parties.displayName,
    })
    .from(schema.jobBidInvitations)
    .innerJoin(
      schema.parties,
      and(
        eq(schema.parties.tenantId, schema.jobBidInvitations.tenantId),
        eq(schema.parties.id, schema.jobBidInvitations.partyId),
      ),
    )
    .where(eq(schema.jobBidInvitations.tenantId, tenantId))
    .orderBy(asc(schema.jobBidInvitations.createdAt));

  const byPackage = new Map<string, InvitationRow[]>();
  for (const r of rows) {
    const list = byPackage.get(r.invitation.packageId) ?? [];
    list.push({
      invitation: r.invitation,
      partyName: r.partyName,
      standing: bidStanding(facts(r.invitation), now),
    });
    byPackage.set(r.invitation.packageId, list);
  }

  return packages.map((pkg) => {
    const invitations = byPackage.get(pkg.id) ?? [];
    return {
      pkg,
      invitations,
      summary: summarizePackage(
        invitations.map((i) => facts(i.invitation)),
        now,
      ),
    };
  });
}

export async function getBidPackage(
  tx: Tx,
  tenantId: string,
  id: string,
): Promise<JobBidPackage | null> {
  const rows = await tx
    .select()
    .from(schema.jobBidPackages)
    .where(and(eq(schema.jobBidPackages.tenantId, tenantId), eq(schema.jobBidPackages.id, id)))
    .limit(1);
  return rows[0] ?? null;
}

export interface BidPackageInput {
  projectId: string;
  title: string;
  costCode?: string;
  scope?: string;
  dueOn?: string | null;
  notes?: string;
}

export async function createBidPackage(
  tx: Tx,
  ctx: JobsCtx,
  input: BidPackageInput,
): Promise<JobBidPackage> {
  requireWrite(ctx, "member");
  const title = input.title.trim();
  if (title === "") throw new JobsError("INVALID_VALUE", "say what is being priced");
  const rows = await tx
    .insert(schema.jobBidPackages)
    .values({
      tenantId: ctx.tenantId,
      projectId: input.projectId,
      title,
      costCode: (input.costCode ?? "").trim(),
      scope: (input.scope ?? "").trim(),
      dueOn: input.dueOn ?? null,
      notes: (input.notes ?? "").trim(),
      createdByClerkUserId: ctx.userId,
    })
    .returning();
  return rows[0];
}

export async function updateBidPackage(
  tx: Tx,
  ctx: JobsCtx,
  id: string,
  patch: Partial<Omit<BidPackageInput, "projectId">> & { status?: string },
): Promise<JobBidPackage> {
  requireWrite(ctx, "member");
  const existing = await getBidPackage(tx, ctx.tenantId, id);
  if (!existing) throw new JobsError("NOT_FOUND", "that bid request is no longer here");
  const values: Partial<typeof schema.jobBidPackages.$inferInsert> = {};
  if (patch.title !== undefined) {
    const title = patch.title.trim();
    if (title === "") throw new JobsError("INVALID_VALUE", "say what is being priced");
    values.title = title;
  }
  if (patch.costCode !== undefined) values.costCode = patch.costCode.trim();
  if (patch.scope !== undefined) values.scope = patch.scope.trim();
  if (patch.dueOn !== undefined) values.dueOn = patch.dueOn;
  if (patch.notes !== undefined) values.notes = patch.notes.trim();
  if (patch.status !== undefined) {
    if (patch.status !== "open" && patch.status !== "closed") {
      throw new JobsError("INVALID_STATUS", "a bid request is open or closed");
    }
    values.status = patch.status;
  }
  const rows = await tx
    .update(schema.jobBidPackages)
    .set({ ...values, version: existing.version + 1, updatedAt: new Date() })
    .where(and(eq(schema.jobBidPackages.tenantId, ctx.tenantId), eq(schema.jobBidPackages.id, id)))
    .returning();
  return rows[0];
}

/**
 * Ask one subcontractor, and mint their own door.
 *
 * **A TOKEN EACH.** One link for the whole package would make "who has seen
 * this" unanswerable and "stop that one" impossible, and a forwarded link
 * would be indistinguishable from the sub you sent it to.
 */
export async function inviteToBid(
  tx: Tx,
  ctx: JobsCtx,
  input: { packageId: string; partyId: string; now?: Date },
): Promise<{ invitation: JobBidInvitation; token: string }> {
  requireWrite(ctx, "member");
  const pkg = await getBidPackage(tx, ctx.tenantId, input.packageId);
  if (!pkg) throw new JobsError("NOT_FOUND", "that bid request is no longer here");

  const now = input.now ?? new Date();
  const token = mintToken();
  try {
    const rows = await tx
      .insert(schema.jobBidInvitations)
      .values({
        tenantId: ctx.tenantId,
        packageId: input.packageId,
        partyId: input.partyId,
        tokenHash: hashToken(token),
        tokenCiphertext: encryptSecret(token),
        expiresAt: invitationExpiryFor(pkg.dueOn, now),
        createdByClerkUserId: ctx.userId,
      })
      .returning();
    return { invitation: rows[0], token };
  } catch (err) {
    if (violatedUniqueIndex(err) === "job_bid_invitations_one_per_party_idx") {
      throw new JobsError("ALREADY_ASKED", "they have already been asked for this one");
    }
    throw err;
  }
}

/** The link again, so the builder can re-send it without minting a second. */
export function revealInvitationToken(invitation: JobBidInvitation): string {
  return decryptSecret(invitation.tokenCiphertext);
}

export async function revokeInvitation(
  tx: Tx,
  ctx: JobsCtx,
  invitationId: string,
): Promise<JobBidInvitation> {
  requireWrite(ctx, "member");
  const rows = await tx
    .update(schema.jobBidInvitations)
    .set({ revokedAt: new Date(), revokedByClerkUserId: ctx.userId, updatedAt: new Date() })
    .where(
      and(
        eq(schema.jobBidInvitations.tenantId, ctx.tenantId),
        eq(schema.jobBidInvitations.id, invitationId),
      ),
    )
    .returning();
  if (!rows[0]) throw new JobsError("NOT_FOUND", "that invitation is no longer here");
  return rows[0];
}

/**
 * Go with this one.
 *
 * **CLEARING THE OTHER AWARD IS PART OF MAKING THIS ONE**, the partial unique
 * index's rule: the database refuses a second, and this is the mechanism that
 * stops an ordinary change of mind hitting it. You cannot award a silence —
 * the table refuses that too.
 */
export async function awardInvitation(
  tx: Tx,
  ctx: JobsCtx,
  invitationId: string,
): Promise<JobBidInvitation> {
  requireWrite(ctx, "member");
  const rows = await tx
    .select()
    .from(schema.jobBidInvitations)
    .where(
      and(
        eq(schema.jobBidInvitations.tenantId, ctx.tenantId),
        eq(schema.jobBidInvitations.id, invitationId),
      ),
    )
    .limit(1);
  const invitation = rows[0];
  if (!invitation) throw new JobsError("NOT_FOUND", "that invitation is no longer here");
  if (invitation.amountCents === null) {
    throw new JobsError("INVALID_VALUE", "they have not given a number to go with");
  }

  await tx
    .update(schema.jobBidInvitations)
    .set({ isAwarded: false, updatedAt: new Date() })
    .where(
      and(
        eq(schema.jobBidInvitations.tenantId, ctx.tenantId),
        eq(schema.jobBidInvitations.packageId, invitation.packageId),
        eq(schema.jobBidInvitations.isAwarded, true),
      ),
    );
  const awarded = await tx
    .update(schema.jobBidInvitations)
    .set({ isAwarded: true, version: invitation.version + 1, updatedAt: new Date() })
    .where(
      and(
        eq(schema.jobBidInvitations.tenantId, ctx.tenantId),
        eq(schema.jobBidInvitations.id, invitationId),
      ),
    )
    .returning();
  return awarded[0];
}

/**
 * THE NUMBER A WALK SHOULD USE FOR A PHASE, when one has been won.
 *
 * Matched on the cost code's digits, the same way everything else in this
 * program resolves a code (ADR 0086). No award means no number, never a
 * guess at the lowest bid — the business decides which one it is going with,
 * and until they have, the line says it needs a price.
 */
export async function awardedForCode(
  tx: Tx,
  tenantId: string,
  projectId: string,
  costCode: string,
): Promise<{ amountCents: number; partyName: string; title: string } | null> {
  const want = costCode.replace(/\s+/g, "").toLowerCase();
  if (want === "") return null;
  const rows = await tx
    .select({
      amountCents: schema.jobBidInvitations.amountCents,
      partyName: schema.parties.displayName,
      title: schema.jobBidPackages.title,
      costCode: schema.jobBidPackages.costCode,
    })
    .from(schema.jobBidInvitations)
    .innerJoin(
      schema.jobBidPackages,
      and(
        eq(schema.jobBidPackages.tenantId, schema.jobBidInvitations.tenantId),
        eq(schema.jobBidPackages.id, schema.jobBidInvitations.packageId),
      ),
    )
    .innerJoin(
      schema.parties,
      and(
        eq(schema.parties.tenantId, schema.jobBidInvitations.tenantId),
        eq(schema.parties.id, schema.jobBidInvitations.partyId),
      ),
    )
    .where(
      and(
        eq(schema.jobBidInvitations.tenantId, tenantId),
        eq(schema.jobBidPackages.projectId, projectId),
        eq(schema.jobBidInvitations.isAwarded, true),
      ),
    );
  const hit = rows.find((r) => r.costCode.replace(/\s+/g, "").toLowerCase() === want);
  return hit && hit.amountCents !== null
    ? { amountCents: hit.amountCents, partyName: hit.partyName, title: hit.title }
    : null;
}

/** The reply a subcontractor typed. Written only by the public door. */
export interface BidReply {
  name: string;
  amountCents: number | null;
  declined: boolean;
  note: string;
  ipHash: string;
}

export async function recordBidReply(
  tenantId: string,
  invitationId: string,
  reply: BidReply,
): Promise<boolean> {
  /**
   * `withTenant` at role STAFF, like every other write a stranger makes: the
   * tenant came from the token's own lookup and never from the request.
   */
  return withTenant(
    tenantId,
    async (tx) => {
      const rows = await tx
        .update(schema.jobBidInvitations)
        .set({
          repliedAt: new Date(),
          repliedName: reply.name.trim().slice(0, 120),
          amountCents: reply.declined ? null : reply.amountCents,
          declined: reply.declined,
          replyNote: reply.note.trim().slice(0, 2000),
          repliedIpHash: reply.ipHash,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.jobBidInvitations.tenantId, tenantId),
            eq(schema.jobBidInvitations.id, invitationId),
            /** Only once: a reply already given is never overwritten. */
            isNull(schema.jobBidInvitations.repliedAt),
          ),
        )
        .returning({ id: schema.jobBidInvitations.id });
      return rows.length > 0;
    },
    { role: "staff" },
  );
}

/** One view, counted. Never fails the page. */
export async function countInvitationView(
  tenantId: string,
  invitationId: string,
): Promise<void> {
  try {
    await withTenant(
      tenantId,
      (tx) =>
        tx
          .update(schema.jobBidInvitations)
          .set({
            viewCount: sql`${schema.jobBidInvitations.viewCount} + 1`,
            lastViewedAt: new Date(),
          })
          .where(
            and(
              eq(schema.jobBidInvitations.tenantId, tenantId),
              eq(schema.jobBidInvitations.id, invitationId),
            ),
          ),
      { role: "staff" },
    );
  } catch {
    // A counter is not worth a blank page.
  }
}
