import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import type { DimensionMember, JournalEntry, JournalLine } from "@/db/schema";
import { MAX_AMOUNT_CENTS, isValidIsoDate, todayInTimezone } from "../lib/money";
import { LedgerError } from "./errors";
import { assertPeriodOpen, getSettings, requireOwnerRole } from "./guards";
import type { EntryLineInput, LedgerCtx, NewEntryInput, PostResult } from "./types";

/**
 * The posting engine — the ONLY code that writes journal_entries /
 * journal_lines / line_dimensions. Tools (banking, invoicing, payables)
 * build staging records and call these functions inside the same
 * withTenant transaction; the deferred DB triggers are the backstop for
 * anything this file gets wrong.
 */

interface EntrySnapshot {
  entry: Pick<
    JournalEntry,
    "id" | "entryDate" | "memo" | "status" | "source" | "version"
  >;
  lines: Array<Pick<JournalLine, "accountId" | "amountCents" | "memo" | "lineNo">>;
}

function validateLineAmounts(lines: EntryLineInput[]): void {
  for (const line of lines) {
    if (!Number.isInteger(line.amountCents) || line.amountCents === 0) {
      throw new LedgerError("ZERO_AMOUNT_LINE", "line amount must be a non-zero integer");
    }
    if (Math.abs(line.amountCents) > MAX_AMOUNT_CENTS) {
      throw new LedgerError("AMOUNT_TOO_LARGE", "line amount exceeds ledger maximum");
    }
  }
}

function assertBalanced(lines: EntryLineInput[]): void {
  if (lines.length < 2) {
    throw new LedgerError("TOO_FEW_LINES", "posted entries need at least 2 lines");
  }
  const sum = lines.reduce((acc, l) => acc + l.amountCents, 0);
  if (sum !== 0) {
    throw new LedgerError("UNBALANCED", `entry is unbalanced by ${sum} cents`, { sum });
  }
}

async function loadActiveAccounts(
  tx: Tx,
  tenantId: string,
  accountIds: string[],
): Promise<void> {
  const distinct = [...new Set(accountIds)];
  const rows = await tx
    .select({
      id: schema.accounts.id,
      isActive: schema.accounts.isActive,
    })
    .from(schema.accounts)
    .where(
      and(
        eq(schema.accounts.tenantId, tenantId),
        inArray(schema.accounts.id, distinct),
      ),
    );
  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const id of distinct) {
    const row = byId.get(id);
    if (!row) throw new LedgerError("ACCOUNT_NOT_FOUND", `account ${id} not found`);
    if (!row.isActive) throw new LedgerError("ACCOUNT_INACTIVE", `account ${id} inactive`);
  }
}

/**
 * Validate dimension member ids and return a map id -> member. Also
 * enforces at most one member per dimension type per line (the DB unique
 * is the backstop; this gives a friendly error first).
 */
async function loadDimensionMembers(
  tx: Tx,
  tenantId: string,
  lines: EntryLineInput[],
): Promise<Map<string, DimensionMember>> {
  const allIds = [
    ...new Set(lines.flatMap((l) => l.dimensionMemberIds ?? [])),
  ];
  if (allIds.length === 0) return new Map();
  const rows = await tx
    .select()
    .from(schema.dimensionMembers)
    .where(
      and(
        eq(schema.dimensionMembers.tenantId, tenantId),
        inArray(schema.dimensionMembers.id, allIds),
      ),
    );
  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const id of allIds) {
    const member = byId.get(id);
    if (!member || !member.isActive) {
      throw new LedgerError("DIMENSION_INVALID", `dimension member ${id} invalid`);
    }
  }
  for (const line of lines) {
    const types = new Set<string>();
    for (const id of line.dimensionMemberIds ?? []) {
      const t = byId.get(id)!.dimensionType;
      if (types.has(t)) {
        throw new LedgerError(
          "DIMENSION_INVALID",
          `line tags two members of dimension type ${t}`,
        );
      }
      types.add(t);
    }
  }
  return byId;
}

async function insertLines(
  tx: Tx,
  tenantId: string,
  entryId: string,
  lines: EntryLineInput[],
  members: Map<string, DimensionMember>,
): Promise<void> {
  const lineRows = await tx
    .insert(schema.journalLines)
    .values(
      lines.map((l, i) => ({
        tenantId,
        entryId,
        accountId: l.accountId,
        amountCents: l.amountCents,
        memo: l.memo ?? "",
        lineNo: i + 1,
      })),
    )
    .returning({ id: schema.journalLines.id, lineNo: schema.journalLines.lineNo });
  const dimRows = lines.flatMap((l, i) => {
    const lineId = lineRows.find((r) => r.lineNo === i + 1)!.id;
    return (l.dimensionMemberIds ?? []).map((memberId) => ({
      tenantId,
      journalLineId: lineId,
      dimensionType: members.get(memberId)!.dimensionType,
      memberId,
    }));
  });
  if (dimRows.length > 0) {
    await tx.insert(schema.lineDimensions).values(dimRows);
  }
}

async function findExisting(
  tx: Tx,
  tenantId: string,
  idempotencyKey?: string | null,
  reversesEntryId?: string | null,
): Promise<JournalEntry | undefined> {
  if (idempotencyKey) {
    const byKey = await tx.query.journalEntries.findFirst({
      where: and(
        eq(schema.journalEntries.tenantId, tenantId),
        eq(schema.journalEntries.idempotencyKey, idempotencyKey),
      ),
    });
    if (byKey) return byKey;
  }
  if (reversesEntryId) {
    return tx.query.journalEntries.findFirst({
      where: and(
        eq(schema.journalEntries.tenantId, tenantId),
        eq(schema.journalEntries.reversesEntryId, reversesEntryId),
      ),
    });
  }
  return undefined;
}

/**
 * Create a journal entry (draft or posted). Idempotent when an
 * idempotencyKey is supplied: retries and concurrent duplicates return the
 * existing entry with deduped=true. Uses ON CONFLICT DO NOTHING — never
 * catch-and-reselect, which would poison the transaction.
 */
export async function postEntry(
  tx: Tx,
  ctx: LedgerCtx,
  input: NewEntryInput & {
    status: "draft" | "posted";
    reversesEntryId?: string | null;
  },
): Promise<PostResult> {
  if (input.status === "posted") requireOwnerRole(ctx);
  if (!isValidIsoDate(input.entryDate)) {
    throw new LedgerError("PERIOD_CLOSED", `invalid entry date ${input.entryDate}`);
  }
  if (input.lines.length === 0) {
    throw new LedgerError("TOO_FEW_LINES", "an entry needs at least one line");
  }
  validateLineAmounts(input.lines);
  if (input.status === "posted") assertBalanced(input.lines);

  const existing = await findExisting(
    tx,
    ctx.tenantId,
    input.idempotencyKey,
    input.reversesEntryId,
  );
  if (existing) return { entry: existing, deduped: true };

  await loadActiveAccounts(tx, ctx.tenantId, input.lines.map((l) => l.accountId));
  const members = await loadDimensionMembers(tx, ctx.tenantId, input.lines);
  if (input.status === "posted") {
    await assertPeriodOpen(tx, ctx.tenantId, input.entryDate);
  }

  const inserted = await tx
    .insert(schema.journalEntries)
    .values({
      tenantId: ctx.tenantId,
      entryDate: input.entryDate,
      memo: input.memo ?? "",
      status: input.status,
      source: input.source ?? "manual",
      sourceId: input.sourceId ?? null,
      idempotencyKey: input.idempotencyKey ?? null,
      reversesEntryId: input.reversesEntryId ?? null,
      postedAt: input.status === "posted" ? new Date() : null,
      createdByClerkUserId: ctx.userId,
    })
    // Conflicts here can only be the idempotency or single-reversal
    // uniques — both mean "someone else already posted this".
    .onConflictDoNothing()
    .returning();

  if (inserted.length === 0) {
    const winner = await findExisting(
      tx,
      ctx.tenantId,
      input.idempotencyKey,
      input.reversesEntryId,
    );
    if (!winner) {
      throw new LedgerError("ENTRY_NOT_FOUND", "conflicting entry vanished");
    }
    return { entry: winner, deduped: true };
  }

  await insertLines(tx, ctx.tenantId, inserted[0].id, input.lines, members);
  return { entry: inserted[0], deduped: false };
}

async function loadEntry(
  tx: Tx,
  tenantId: string,
  entryId: string,
): Promise<JournalEntry> {
  const entry = await tx.query.journalEntries.findFirst({
    where: and(
      eq(schema.journalEntries.tenantId, tenantId),
      eq(schema.journalEntries.id, entryId),
    ),
  });
  if (!entry) throw new LedgerError("ENTRY_NOT_FOUND", `entry ${entryId} not found`);
  return entry;
}

async function snapshot(tx: Tx, tenantId: string, entryId: string): Promise<EntrySnapshot> {
  const entry = await loadEntry(tx, tenantId, entryId);
  const lines = await tx
    .select({
      accountId: schema.journalLines.accountId,
      amountCents: schema.journalLines.amountCents,
      memo: schema.journalLines.memo,
      lineNo: schema.journalLines.lineNo,
    })
    .from(schema.journalLines)
    .where(
      and(
        eq(schema.journalLines.tenantId, tenantId),
        eq(schema.journalLines.entryId, entryId),
      ),
    )
    .orderBy(schema.journalLines.lineNo);
  return {
    entry: {
      id: entry.id,
      entryDate: entry.entryDate,
      memo: entry.memo,
      status: entry.status,
      source: entry.source,
      version: entry.version,
    },
    lines,
  };
}

/**
 * Compare-and-increment the entry version. Zero rows updated means someone
 * else changed the entry since the caller loaded it.
 */
async function bumpVersion(
  tx: Tx,
  tenantId: string,
  entryId: string,
  expectedVersion: number,
  patch: Partial<typeof schema.journalEntries.$inferInsert>,
): Promise<JournalEntry> {
  const rows = await tx
    .update(schema.journalEntries)
    .set({ ...patch, version: expectedVersion + 1, updatedAt: new Date() })
    .where(
      and(
        eq(schema.journalEntries.tenantId, tenantId),
        eq(schema.journalEntries.id, entryId),
        eq(schema.journalEntries.version, expectedVersion),
      ),
    )
    .returning();
  if (rows.length === 0) {
    throw new LedgerError("STALE_VERSION", `entry ${entryId} version mismatch`);
  }
  return rows[0];
}

/**
 * True when any line of the entry has been cleared in a reconciliation
 * (including an in-progress one — checking a line locks its entry so the
 * workbench math can't shift under the owner; uncheck to edit).
 */
async function entryHasReconciledLines(
  tx: Tx,
  tenantId: string,
  entryId: string,
): Promise<boolean> {
  const rows = await tx
    .select({ id: schema.reconciliationLines.id })
    .from(schema.reconciliationLines)
    .innerJoin(
      schema.journalLines,
      and(
        eq(schema.journalLines.tenantId, schema.reconciliationLines.tenantId),
        eq(schema.journalLines.id, schema.reconciliationLines.journalLineId),
      ),
    )
    .where(
      and(
        eq(schema.reconciliationLines.tenantId, tenantId),
        eq(schema.journalLines.entryId, entryId),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/**
 * Guard shared by every posted-entry mutation: enforces the three-tier
 * mutability policy (open+standard = editable; strict mode, closed
 * period, or reconciled = reversal-only).
 */
async function assertPostedMutable(
  tx: Tx,
  ctx: LedgerCtx,
  entry: JournalEntry,
): Promise<void> {
  requireOwnerRole(ctx);
  const settings = await getSettings(tx, ctx.tenantId);
  if (settings.entryEditPolicy === "strict_append_only") {
    throw new LedgerError("ENTRY_IMMUTABLE", "tenant is in strict append-only mode");
  }
  if (settings.closedThrough && entry.entryDate <= settings.closedThrough) {
    throw new LedgerError("ENTRY_IMMUTABLE", "entry is in a closed period");
  }
  if (await entryHasReconciledLines(tx, ctx.tenantId, entry.id)) {
    throw new LedgerError("ENTRY_IMMUTABLE", "entry has reconciled lines", {
      reason: "reconciled",
    });
  }
}

export async function editEntry(
  tx: Tx,
  ctx: LedgerCtx,
  args: {
    entryId: string;
    expectedVersion: number;
    patch: { entryDate?: string; memo?: string; lines?: EntryLineInput[] };
  },
): Promise<{ before: EntrySnapshot; after: EntrySnapshot }> {
  const before = await snapshot(tx, ctx.tenantId, args.entryId);
  const entry = await loadEntry(tx, ctx.tenantId, args.entryId);
  if (entry.status === "void") {
    throw new LedgerError("ENTRY_IMMUTABLE", "void entries cannot be edited");
  }
  const newDate = args.patch.entryDate ?? entry.entryDate;
  if (!isValidIsoDate(newDate)) {
    throw new LedgerError("PERIOD_CLOSED", `invalid entry date ${newDate}`);
  }

  if (entry.status === "posted") {
    await assertPostedMutable(tx, ctx, entry);
    // The new date must also land in the open period.
    await assertPeriodOpen(tx, ctx.tenantId, newDate);
  }

  if (args.patch.lines) {
    validateLineAmounts(args.patch.lines);
    if (entry.status === "posted") assertBalanced(args.patch.lines);
    await loadActiveAccounts(
      tx,
      ctx.tenantId,
      args.patch.lines.map((l) => l.accountId),
    );
    const members = await loadDimensionMembers(tx, ctx.tenantId, args.patch.lines);
    await tx
      .delete(schema.journalLines)
      .where(
        and(
          eq(schema.journalLines.tenantId, ctx.tenantId),
          eq(schema.journalLines.entryId, entry.id),
        ),
      );
    await insertLines(tx, ctx.tenantId, entry.id, args.patch.lines, members);
  }

  await bumpVersion(tx, ctx.tenantId, entry.id, args.expectedVersion, {
    entryDate: newDate,
    memo: args.patch.memo ?? entry.memo,
  });

  const after = await snapshot(tx, ctx.tenantId, args.entryId);
  return { before, after };
}

/** Promote a draft to posted, revalidating everything. */
export async function postDraft(
  tx: Tx,
  ctx: LedgerCtx,
  args: { entryId: string; expectedVersion: number },
): Promise<JournalEntry> {
  requireOwnerRole(ctx);
  const entry = await loadEntry(tx, ctx.tenantId, args.entryId);
  if (entry.status !== "draft") {
    throw new LedgerError("ENTRY_NOT_DRAFT", "only drafts can be posted");
  }
  const snap = await snapshot(tx, ctx.tenantId, entry.id);
  const lines: EntryLineInput[] = snap.lines.map((l) => ({
    accountId: l.accountId,
    amountCents: l.amountCents,
  }));
  validateLineAmounts(lines);
  assertBalanced(lines);
  await loadActiveAccounts(tx, ctx.tenantId, lines.map((l) => l.accountId));
  await assertPeriodOpen(tx, ctx.tenantId, entry.entryDate);
  return bumpVersion(tx, ctx.tenantId, entry.id, args.expectedVersion, {
    status: "posted",
    postedAt: new Date(),
  });
}

/** Hard-delete a draft (posted entries are never deleted). */
export async function deleteDraft(
  tx: Tx,
  ctx: LedgerCtx,
  args: { entryId: string; expectedVersion: number },
): Promise<EntrySnapshot> {
  const before = await snapshot(tx, ctx.tenantId, args.entryId);
  const entry = await loadEntry(tx, ctx.tenantId, args.entryId);
  if (entry.status !== "draft") {
    throw new LedgerError("ENTRY_NOT_DRAFT", "only drafts can be deleted");
  }
  if (entry.version !== args.expectedVersion) {
    throw new LedgerError("STALE_VERSION", "draft changed since loaded");
  }
  await tx
    .delete(schema.journalEntries)
    .where(
      and(
        eq(schema.journalEntries.tenantId, ctx.tenantId),
        eq(schema.journalEntries.id, entry.id),
      ),
    );
  return before;
}

/**
 * Void: mark the entry void; reports exclude it. Posts NO offsetting entry
 * (that's reverseEntry — the two are never combined, which would
 * double-count). Only for open-period mistakes.
 */
export async function voidEntry(
  tx: Tx,
  ctx: LedgerCtx,
  args: { entryId: string; expectedVersion: number },
): Promise<JournalEntry> {
  const entry = await loadEntry(tx, ctx.tenantId, args.entryId);
  if (entry.status !== "posted") {
    throw new LedgerError("ENTRY_NOT_POSTED", "only posted entries can be voided");
  }
  await assertPostedMutable(tx, ctx, entry);
  return bumpVersion(tx, ctx.tenantId, entry.id, args.expectedVersion, {
    status: "void",
  });
}

/**
 * Reverse: post an offsetting entry (negated lines, copied dimensions);
 * the original STAYS posted so reports show both, netting to zero. The
 * partial unique on reverses_entry_id makes a second reversal impossible.
 */
export async function reverseEntry(
  tx: Tx,
  ctx: LedgerCtx,
  args: { entryId: string; entryDate?: string; memo?: string },
): Promise<PostResult> {
  requireOwnerRole(ctx);
  const entry = await loadEntry(tx, ctx.tenantId, args.entryId);
  if (entry.status !== "posted") {
    throw new LedgerError("ENTRY_NOT_POSTED", "only posted entries can be reversed");
  }
  const settings = await getSettings(tx, ctx.tenantId);
  const reversalDate =
    args.entryDate ?? todayInTimezone(settings.bookkeepingTimezone);

  const lines = await tx
    .select()
    .from(schema.journalLines)
    .where(
      and(
        eq(schema.journalLines.tenantId, ctx.tenantId),
        eq(schema.journalLines.entryId, entry.id),
      ),
    )
    .orderBy(schema.journalLines.lineNo);
  const dims = await tx
    .select()
    .from(schema.lineDimensions)
    .where(
      and(
        eq(schema.lineDimensions.tenantId, ctx.tenantId),
        inArray(
          schema.lineDimensions.journalLineId,
          lines.map((l) => l.id),
        ),
      ),
    );
  const dimsByLine = new Map<string, string[]>();
  for (const d of dims) {
    const list = dimsByLine.get(d.journalLineId) ?? [];
    list.push(d.memberId);
    dimsByLine.set(d.journalLineId, list);
  }

  return postEntry(tx, ctx, {
    status: "posted",
    entryDate: reversalDate,
    memo: args.memo ?? `Reversal of entry dated ${entry.entryDate}`,
    source: "reversal",
    reversesEntryId: entry.id,
    idempotencyKey: `reversal:${entry.id}`,
    lines: lines.map((l) => ({
      accountId: l.accountId,
      amountCents: -l.amountCents,
      memo: l.memo,
      dimensionMemberIds: dimsByLine.get(l.id),
    })),
  });
}
