import "server-only";
import { and, asc, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import type { Engagement, EngagementAllotment, PsTimeEntry } from "@/db/schema";
import { allowsWrite, type WriteLevel } from "@/lib/packs/authorize";
import { isValidIsoDate } from "@/lib/money";
import { loadParty, PartyError } from "@/lib/parties";
import { createPartyForRole } from "@/lib/parties/role-sync";
import {
  archiveDimensionMember,
  upsertDimensionMember,
} from "@/modules/accounting/core";
import {
  canTransition,
  isEngagementStatus,
  isValidEngagementKind,
  type EngagementStatus,
} from "./vocabulary";
import { meter, monthHistory, monthOf, monthRange, type EngagementMonth } from "./core/meter";

/**
 * Engagement operations. Every function takes a `Tx` so the caller owns the
 * transaction — the rule `src/packs/assets/ops.ts` set for every pack since:
 *
 * **A write and its dimension sync happen in ONE transaction.** An
 * engagement is a COST OBJECT — the thing a bill, an expense or a journal
 * line is tagged with so the P&L can answer "what did this client cost us" —
 * and `dimension_members` is the seam core opened for exactly that. If the
 * engagement and its member could land separately, one would exist that no
 * report can group by.
 *
 * Owner and member levels follow the decision-or-chore rule
 * (src/lib/packs/authorize.ts): making, changing or ending an engagement is
 * a decision with a money consequence, and `upsertDimensionMember` requires
 * an owner anyway; logging an hour is a chore done by whoever did the work.
 */

export const PACK = "professional-services";
export const ENGAGEMENT_DIMENSION = "engagement";

export class EngagementError extends Error {
  constructor(
    readonly code:
      | "FORBIDDEN"
      | "NOT_FOUND"
      | "INVALID_KIND"
      | "INVALID_DATE"
      | "CLIENT_REQUIRED"
      | "CLIENT_INVALID"
      | "INVALID_STATUS"
      | "ENDED"
      | "INVALID_MINUTES"
      | "VERSION_CONFLICT",
    message: string,
  ) {
    super(message);
    this.name = "EngagementError";
  }
}

export interface EngagementCtx {
  tenantId: string;
  userId: string;
  role: "owner" | "staff" | "expert";
}

function requireWrite(ctx: EngagementCtx, level: WriteLevel): void {
  if (!allowsWrite(ctx.role, level)) {
    throw new EngagementError("FORBIDDEN", "not allowed to change this");
  }
}

function ledgerCtx(ctx: EngagementCtx) {
  return { tenantId: ctx.tenantId, userId: ctx.userId, role: ctx.role };
}

/** What the cost object is called in a report: the client, then the engagement. */
function dimensionName(clientName: string, engagementName: string): string {
  return `${clientName} · ${engagementName}`;
}

function assertDates(startsOn: string, endsOn: string | null | undefined): void {
  if (!isValidIsoDate(startsOn)) {
    throw new EngagementError("INVALID_DATE", "starts_on is not a date");
  }
  if (endsOn != null) {
    if (!isValidIsoDate(endsOn)) {
      throw new EngagementError("INVALID_DATE", "ends_on is not a date");
    }
    if (endsOn < startsOn) {
      throw new EngagementError("INVALID_DATE", "an engagement cannot end before it starts");
    }
  }
}

// ---- reads ---------------------------------------------------------------

export interface EngagementRow {
  engagement: Engagement;
  clientName: string;
  /** The month the list reports on. */
  month: EngagementMonth;
}

const STATUS_ORDER: Record<string, number> = { active: 0, paused: 1, proposed: 2, ended: 3 };

/**
 * The list, with each engagement's month. One query for the rows, one for
 * the allotments in force, one for the month's minutes — never a query per
 * row.
 */
export async function listEngagements(
  tx: Tx,
  tenantId: string,
  opts: { month: string; includeEnded?: boolean },
): Promise<EngagementRow[]> {
  const rows = await tx
    .select({ engagement: schema.psEngagements, clientName: schema.parties.displayName })
    .from(schema.psEngagements)
    .innerJoin(
      schema.parties,
      and(
        eq(schema.parties.tenantId, schema.psEngagements.tenantId),
        eq(schema.parties.id, schema.psEngagements.partyId),
      ),
    )
    .where(eq(schema.psEngagements.tenantId, tenantId));
  const kept = rows.filter((r) => opts.includeEnded || r.engagement.status !== "ended");
  if (kept.length === 0) return [];
  const ids = kept.map((r) => r.engagement.id);

  const range = monthRange(opts.month);
  const [allotments, sums] = await Promise.all([
    tx.query.psEngagementAllotments.findMany({
      where: and(
        eq(schema.psEngagementAllotments.tenantId, tenantId),
        inArray(schema.psEngagementAllotments.engagementId, ids),
      ),
    }),
    tx
      .select({
        engagementId: schema.psTimeEntries.engagementId,
        minutes: sql<number>`coalesce(sum(${schema.psTimeEntries.minutes}), 0)::int`,
      })
      .from(schema.psTimeEntries)
      .where(
        and(
          eq(schema.psTimeEntries.tenantId, tenantId),
          inArray(schema.psTimeEntries.engagementId, ids),
          gte(schema.psTimeEntries.workDate, range.from),
          lt(schema.psTimeEntries.workDate, range.to),
        ),
      )
      .groupBy(schema.psTimeEntries.engagementId),
  ]);
  const usedBy = new Map(sums.map((s) => [s.engagementId, s.minutes]));
  const allotmentsBy = new Map<string, EngagementAllotment[]>();
  for (const a of allotments) {
    const list = allotmentsBy.get(a.engagementId) ?? [];
    list.push(a);
    allotmentsBy.set(a.engagementId, list);
  }

  return kept
    .map((r) => ({
      engagement: r.engagement,
      clientName: r.clientName,
      month: monthFor(r.engagement, opts.month, usedBy.get(r.engagement.id) ?? 0, allotmentsBy.get(r.engagement.id) ?? []),
    }))
    .sort(
      (a, b) =>
        (STATUS_ORDER[a.engagement.status] ?? 9) - (STATUS_ORDER[b.engagement.status] ?? 9) ||
        a.clientName.localeCompare(b.clientName) ||
        a.engagement.name.localeCompare(b.engagement.name),
    );
}

function monthFor(
  engagement: Engagement,
  month: string,
  usedMinutes: number,
  allotments: EngagementAllotment[],
): EngagementMonth {
  return meter({
    month,
    usedMinutes,
    includedMinutes: allotmentFor(allotments, month),
    rateCents: engagement.rateCents,
  });
}

function allotmentFor(allotments: EngagementAllotment[], month: string): number {
  let best: EngagementAllotment | undefined;
  for (const a of allotments) {
    if (a.effectiveMonth > month) continue;
    if (!best || a.effectiveMonth > best.effectiveMonth) best = a;
  }
  return best?.includedMinutes ?? 0;
}

export async function getEngagement(
  tx: Tx,
  tenantId: string,
  id: string,
): Promise<Engagement | null> {
  const row = await tx.query.psEngagements.findFirst({
    where: and(eq(schema.psEngagements.tenantId, tenantId), eq(schema.psEngagements.id, id)),
  });
  return row ?? null;
}

export interface EngagementDetail {
  engagement: Engagement;
  clientName: string;
  allotments: EngagementAllotment[];
  /** Newest first. */
  entries: PsTimeEntry[];
  thisMonth: EngagementMonth;
  /** Newest first, through this month. */
  months: EngagementMonth[];
}

export async function getEngagementDetail(
  tx: Tx,
  tenantId: string,
  id: string,
  month: string,
): Promise<EngagementDetail | null> {
  const engagement = await getEngagement(tx, tenantId, id);
  if (!engagement) return null;
  const [party, allotments, entries] = await Promise.all([
    loadParty(tx, tenantId, engagement.partyId),
    tx.query.psEngagementAllotments.findMany({
      where: and(
        eq(schema.psEngagementAllotments.tenantId, tenantId),
        eq(schema.psEngagementAllotments.engagementId, id),
      ),
      orderBy: [asc(schema.psEngagementAllotments.effectiveMonth)],
    }),
    tx.query.psTimeEntries.findMany({
      where: and(
        eq(schema.psTimeEntries.tenantId, tenantId),
        eq(schema.psTimeEntries.engagementId, id),
      ),
      orderBy: [desc(schema.psTimeEntries.workDate), desc(schema.psTimeEntries.createdAt)],
    }),
  ]);
  const history = monthHistory({
    entries,
    allotments,
    rateCents: engagement.rateCents,
    through: month,
  });
  const thisMonth =
    history.find((m) => m.month === month) ??
    meter({ month, usedMinutes: 0, includedMinutes: allotmentFor(allotments, month), rateCents: engagement.rateCents });
  return { engagement, clientName: party.displayName, allotments, entries, thisMonth, months: history };
}

/** Organizations the business could engage with — the picker's list. */
export async function listClientCandidates(
  tx: Tx,
  tenantId: string,
): Promise<{ id: string; name: string }[]> {
  const rows = await tx.query.parties.findMany({
    where: and(
      eq(schema.parties.tenantId, tenantId),
      eq(schema.parties.kind, "organization"),
      eq(schema.parties.isActive, true),
    ),
    columns: { id: true, displayName: true },
    orderBy: [asc(schema.parties.displayName)],
  });
  return rows.map((r) => ({ id: r.id, name: r.displayName }));
}

/** Who logged what: a name per Clerk user id, for the time log. */
export async function whoLogged(
  tx: Tx,
  clerkUserIds: string[],
): Promise<Map<string, string>> {
  const ids = [...new Set(clerkUserIds)];
  if (ids.length === 0) return new Map();
  const rows = await tx
    .select({
      clerkUserId: schema.profiles.clerkUserId,
      name: schema.profiles.name,
      email: schema.profiles.email,
    })
    .from(schema.profiles)
    .where(inArray(schema.profiles.clerkUserId, ids));
  return new Map(rows.map((r) => [r.clerkUserId, r.name?.trim() || r.email]));
}

// ---- writes: the engagement (owner) --------------------------------------

export interface EngagementInput {
  /** An organization already known, or … */
  partyId?: string | null;
  /** … a new one, minted through the party door. One of the two is required. */
  clientName?: string | null;
  name: string;
  kind: string;
  scope?: string;
  startsOn: string;
  endsOn?: string | null;
  feeCents?: number | null;
  rateCents?: number | null;
  /** 0 = no retainer. */
  retainerMinutesMonthly?: number;
  notes?: string;
}

export async function createEngagement(
  tx: Tx,
  ctx: EngagementCtx,
  input: EngagementInput,
): Promise<Engagement> {
  requireWrite(ctx, "owner");
  if (!isValidEngagementKind(input.kind)) {
    throw new EngagementError("INVALID_KIND", `kind ${input.kind}`);
  }
  assertDates(input.startsOn, input.endsOn);
  const included = input.retainerMinutesMonthly ?? 0;

  let party;
  if (input.partyId) {
    try {
      party = await loadParty(tx, ctx.tenantId, input.partyId);
    } catch (err) {
      if (err instanceof PartyError) {
        throw new EngagementError("CLIENT_INVALID", "that client does not exist");
      }
      throw err;
    }
  } else {
    const name = (input.clientName ?? "").trim();
    if (!name) throw new EngagementError("CLIENT_REQUIRED", "an engagement needs a client");
    party = await createPartyForRole(tx, ctx.tenantId, name);
  }

  const [row] = await tx
    .insert(schema.psEngagements)
    .values({
      tenantId: ctx.tenantId,
      partyId: party.id,
      name: input.name.trim(),
      kind: input.kind,
      scope: input.scope ?? "",
      startsOn: input.startsOn,
      endsOn: input.endsOn ?? null,
      feeCents: input.feeCents ?? null,
      rateCents: input.rateCents ?? null,
      retainerMinutesMonthly: included,
      notes: input.notes ?? "",
      createdByClerkUserId: ctx.userId,
    })
    .returning();

  if (included > 0) {
    await tx.insert(schema.psEngagementAllotments).values({
      tenantId: ctx.tenantId,
      engagementId: row.id,
      effectiveMonth: monthOf(input.startsOn),
      includedMinutes: included,
    });
  }

  await upsertDimensionMember(tx, ledgerCtx(ctx), {
    dimensionType: ENGAGEMENT_DIMENSION,
    packEntityId: row.id,
    displayName: dimensionName(party.displayName, row.name),
  });
  return row;
}

export type EngagementPatch = Partial<Omit<EngagementInput, "partyId" | "clientName">>;

/**
 * Change the terms. The client is fixed — an engagement for somebody else is
 * a different engagement. A changed retainer lands as a new allotment for
 * `allotmentMonth` (the tenant's current month, from the action), leaving
 * every earlier month at what was agreed then.
 */
export async function updateEngagement(
  tx: Tx,
  ctx: EngagementCtx,
  args: {
    engagementId: string;
    expectedVersion: number;
    patch: EngagementPatch;
    allotmentMonth: string;
  },
): Promise<Engagement> {
  requireWrite(ctx, "owner");
  const before = await getEngagement(tx, ctx.tenantId, args.engagementId);
  if (!before) throw new EngagementError("NOT_FOUND", "engagement not found");
  const { patch } = args;
  if (patch.kind !== undefined && !isValidEngagementKind(patch.kind)) {
    throw new EngagementError("INVALID_KIND", `kind ${patch.kind}`);
  }
  const startsOn = patch.startsOn ?? before.startsOn;
  const endsOn = patch.endsOn === undefined ? before.endsOn : patch.endsOn;
  assertDates(startsOn, endsOn);

  const [after] = await tx
    .update(schema.psEngagements)
    .set({
      name: patch.name?.trim() ?? before.name,
      kind: patch.kind ?? before.kind,
      scope: patch.scope ?? before.scope,
      startsOn,
      endsOn: endsOn ?? null,
      feeCents: patch.feeCents === undefined ? before.feeCents : patch.feeCents,
      rateCents: patch.rateCents === undefined ? before.rateCents : patch.rateCents,
      retainerMinutesMonthly: patch.retainerMinutesMonthly ?? before.retainerMinutesMonthly,
      notes: patch.notes ?? before.notes,
      version: sql`${schema.psEngagements.version} + 1`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.psEngagements.tenantId, ctx.tenantId),
        eq(schema.psEngagements.id, args.engagementId),
        eq(schema.psEngagements.version, args.expectedVersion),
      ),
    )
    .returning();
  if (!after) {
    throw new EngagementError("VERSION_CONFLICT", "the engagement changed underneath you");
  }

  if (
    patch.retainerMinutesMonthly !== undefined &&
    patch.retainerMinutesMonthly !== before.retainerMinutesMonthly
  ) {
    await tx
      .insert(schema.psEngagementAllotments)
      .values({
        tenantId: ctx.tenantId,
        engagementId: after.id,
        effectiveMonth: args.allotmentMonth,
        includedMinutes: patch.retainerMinutesMonthly,
      })
      .onConflictDoUpdate({
        target: [
          schema.psEngagementAllotments.tenantId,
          schema.psEngagementAllotments.engagementId,
          schema.psEngagementAllotments.effectiveMonth,
        ],
        set: { includedMinutes: patch.retainerMinutesMonthly },
      });
  }

  if (after.name !== before.name) {
    const party = await loadParty(tx, ctx.tenantId, after.partyId);
    await upsertDimensionMember(tx, ledgerCtx(ctx), {
      dimensionType: ENGAGEMENT_DIMENSION,
      packEntityId: after.id,
      displayName: dimensionName(party.displayName, after.name),
    });
  }
  return after;
}

/**
 * Move an engagement along. Ending archives its cost object — nothing new
 * should be tagged to a finished engagement, and what already was keeps
 * reporting; reopening brings it back.
 */
export async function setEngagementStatus(
  tx: Tx,
  ctx: EngagementCtx,
  args: { engagementId: string; status: string; today: string },
): Promise<Engagement> {
  requireWrite(ctx, "owner");
  const before = await getEngagement(tx, ctx.tenantId, args.engagementId);
  if (!before) throw new EngagementError("NOT_FOUND", "engagement not found");
  if (!isEngagementStatus(args.status) || !isEngagementStatus(before.status)) {
    throw new EngagementError("INVALID_STATUS", `status ${args.status}`);
  }
  const to: EngagementStatus = args.status;
  if (!canTransition(before.status, to)) {
    throw new EngagementError("INVALID_STATUS", `${before.status} → ${to}`);
  }

  const [after] = await tx
    .update(schema.psEngagements)
    .set({
      status: to,
      // Ending stamps the day if nobody set one; reopening clears it, since
      // an engagement that is live again has not ended.
      endsOn: to === "ended" ? (before.endsOn ?? args.today) : to === "active" ? null : before.endsOn,
      version: sql`${schema.psEngagements.version} + 1`,
      updatedAt: new Date(),
    })
    .where(
      and(eq(schema.psEngagements.tenantId, ctx.tenantId), eq(schema.psEngagements.id, before.id)),
    )
    .returning();

  if (to === "ended") {
    const member = await tx.query.dimensionMembers.findFirst({
      where: and(
        eq(schema.dimensionMembers.tenantId, ctx.tenantId),
        eq(schema.dimensionMembers.dimensionType, ENGAGEMENT_DIMENSION),
        eq(schema.dimensionMembers.packEntityId, before.id),
      ),
      columns: { id: true },
    });
    if (member) await archiveDimensionMember(tx, ledgerCtx(ctx), { memberId: member.id });
  } else if (before.status === "ended") {
    const party = await loadParty(tx, ctx.tenantId, before.partyId);
    await upsertDimensionMember(tx, ledgerCtx(ctx), {
      dimensionType: ENGAGEMENT_DIMENSION,
      packEntityId: before.id,
      displayName: dimensionName(party.displayName, before.name),
    });
  }
  return after;
}

// ---- writes: time (member) ----------------------------------------------

function assertMinutes(minutes: number): void {
  if (!Number.isInteger(minutes) || minutes <= 0 || minutes > 24 * 60) {
    throw new EngagementError("INVALID_MINUTES", `minutes ${minutes}`);
  }
}

async function loadOpenEngagement(
  tx: Tx,
  tenantId: string,
  engagementId: string,
): Promise<Engagement> {
  const engagement = await getEngagement(tx, tenantId, engagementId);
  if (!engagement) throw new EngagementError("NOT_FOUND", "engagement not found");
  // Time against a proposal is real — discovery hours — so only an ended
  // engagement refuses. Reopen it to log against it again.
  if (engagement.status === "ended") {
    throw new EngagementError("ENDED", "that engagement has ended");
  }
  return engagement;
}

export async function logTime(
  tx: Tx,
  ctx: EngagementCtx,
  input: { engagementId: string; minutes: number; workDate: string; note?: string },
): Promise<PsTimeEntry> {
  requireWrite(ctx, "member");
  assertMinutes(input.minutes);
  if (!isValidIsoDate(input.workDate)) {
    throw new EngagementError("INVALID_DATE", "work_date is not a date");
  }
  await loadOpenEngagement(tx, ctx.tenantId, input.engagementId);
  const [row] = await tx
    .insert(schema.psTimeEntries)
    .values({
      tenantId: ctx.tenantId,
      engagementId: input.engagementId,
      minutes: input.minutes,
      workDate: input.workDate,
      note: (input.note ?? "").trim(),
      actorClerkUserId: ctx.userId,
    })
    .returning();
  return row;
}

export async function getTimeEntry(
  tx: Tx,
  tenantId: string,
  id: string,
): Promise<PsTimeEntry | null> {
  const row = await tx.query.psTimeEntries.findFirst({
    where: and(eq(schema.psTimeEntries.tenantId, tenantId), eq(schema.psTimeEntries.id, id)),
  });
  return row ?? null;
}

export async function updateTimeEntry(
  tx: Tx,
  ctx: EngagementCtx,
  args: {
    entryId: string;
    expectedVersion: number;
    minutes: number;
    workDate: string;
    note: string;
  },
): Promise<PsTimeEntry> {
  requireWrite(ctx, "member");
  assertMinutes(args.minutes);
  if (!isValidIsoDate(args.workDate)) {
    throw new EngagementError("INVALID_DATE", "work_date is not a date");
  }
  const before = await getTimeEntry(tx, ctx.tenantId, args.entryId);
  if (!before) throw new EngagementError("NOT_FOUND", "entry not found");
  await loadOpenEngagement(tx, ctx.tenantId, before.engagementId);
  const [after] = await tx
    .update(schema.psTimeEntries)
    .set({
      minutes: args.minutes,
      workDate: args.workDate,
      note: args.note.trim(),
      version: sql`${schema.psTimeEntries.version} + 1`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.psTimeEntries.tenantId, ctx.tenantId),
        eq(schema.psTimeEntries.id, args.entryId),
        eq(schema.psTimeEntries.version, args.expectedVersion),
      ),
    )
    .returning();
  if (!after) throw new EngagementError("VERSION_CONFLICT", "the entry changed underneath you");
  return after;
}

export async function deleteTimeEntry(
  tx: Tx,
  ctx: EngagementCtx,
  args: { entryId: string },
): Promise<PsTimeEntry> {
  requireWrite(ctx, "member");
  const before = await getTimeEntry(tx, ctx.tenantId, args.entryId);
  if (!before) throw new EngagementError("NOT_FOUND", "entry not found");
  await loadOpenEngagement(tx, ctx.tenantId, before.engagementId);
  const [gone] = await tx
    .delete(schema.psTimeEntries)
    .where(
      and(eq(schema.psTimeEntries.tenantId, ctx.tenantId), eq(schema.psTimeEntries.id, args.entryId)),
    )
    .returning();
  if (!gone) throw new EngagementError("NOT_FOUND", "entry not found");
  return gone;
}
