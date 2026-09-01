import "server-only";
import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import type { Bill, BillLine } from "@/db/schema";
import {
  LedgerError,
  getDefaultEntityId,
  isCodableAccount,
  postEntry,
  requireOwnerRole,
  voidEntry,
  type LedgerCtx,
} from "../core";
import {
  billTotalCents,
  normalizeBillNumber,
  type BillLineInput,
} from "./lines";
import { loadVendor } from "./vendors";

/**
 * Bill lifecycle. Statuses draft/awaiting_approval/approved/partial/paid/
 * void with an explicit machine: partial/paid are DERIVED from payments
 * (payments.ts); no code path sets a target status from input. Approval
 * posts Dr expense-per-line / Cr AP through the core engine.
 */

export async function loadBill(
  tx: Tx,
  tenantId: string,
  billId: string,
): Promise<Bill> {
  const row = await tx.query.bills.findFirst({
    where: and(eq(schema.bills.tenantId, tenantId), eq(schema.bills.id, billId)),
  });
  if (!row) throw new LedgerError("BILL_NOT_FOUND", `bill ${billId} missing`);
  return row;
}

export async function loadBillLines(
  tx: Tx,
  tenantId: string,
  billId: string,
): Promise<Array<BillLine & { dimensionMemberIds: string[] }>> {
  const lines = await tx.query.billLines.findMany({
    where: and(
      eq(schema.billLines.tenantId, tenantId),
      eq(schema.billLines.billId, billId),
    ),
    orderBy: asc(schema.billLines.lineNo),
  });
  if (lines.length === 0) return [];
  const dims = await tx.query.lineDimensions.findMany({
    where: and(
      eq(schema.lineDimensions.tenantId, tenantId),
      inArray(
        schema.lineDimensions.billLineId,
        lines.map((l) => l.id),
      ),
    ),
  });
  return lines.map((l) => ({
    ...l,
    dimensionMemberIds: dims
      .filter((d) => d.billLineId === l.id)
      .map((d) => d.memberId),
  }));
}

/** Validate member ids (active, one per type per line) and return the type map. */
async function validateLineDimensions(
  tx: Tx,
  tenantId: string,
  lines: BillLineInput[],
): Promise<Map<string, string>> {
  const allIds = [...new Set(lines.flatMap((l) => l.dimensionMemberIds ?? []))];
  if (allIds.length === 0) return new Map();
  const members = await tx.query.dimensionMembers.findMany({
    where: and(
      eq(schema.dimensionMembers.tenantId, tenantId),
      inArray(schema.dimensionMembers.id, allIds),
    ),
  });
  const typeOf = new Map(members.map((m) => [m.id, m.dimensionType]));
  for (const id of allIds) {
    const member = members.find((m) => m.id === id);
    if (!member || !member.isActive) {
      throw new LedgerError("DIMENSION_INVALID", `dimension member ${id} invalid`);
    }
  }
  for (const line of lines) {
    const seen = new Set<string>();
    for (const id of line.dimensionMemberIds ?? []) {
      const t = typeOf.get(id)!;
      if (seen.has(t)) {
        throw new LedgerError("DIMENSION_INVALID", `two members of type ${t} on one line`);
      }
      seen.add(t);
    }
  }
  return typeOf;
}

/** What a line already says, for deciding whether a save is changing it. */
type ExistingLine = {
  id: string;
  description: string;
  amountCents: number;
  accountId: string | null;
};

/**
 * **A LINE CODED TO AN ACCOUNT NOBODY MAY PICK IS DERIVED, NOT TYPED.**
 *
 * `isCodableAccount` keeps GRNI, Inventory, the affiliate accounts, AR/AP and
 * the bank registers out of every picker, and its own comment admitted the
 * hole: *"This filters the PICKERS; nothing validates it on save."* The form
 * reads a bill's lines back, adds whatever accounts they already use so the
 * select can render them, and posts the lot again — so the one coding a person
 * could never choose was the one thing that round-tripped freely.
 *
 * The rule that closes it, and it has to be a rule about CHANGE rather than a
 * flat ban, because those lines have to be saveable at all:
 *
 * > A line coded to an unpickable account may be **carried through unchanged**
 * > or **deleted**. It may not be re-coded, re-priced, re-described, or created.
 *
 * Deleting is allowed on purpose: the allocations cascade with the line, so the
 * match and the GRNI debit disappear together, which is consistent. Editing is
 * not, because the account and the amount are what the match computed, and the
 * description is what `allocateBillLineToStock` finds its variance sibling by.
 *
 * Tags are deliberately NOT frozen — an enterprise on a matched line is a
 * person saying what the delivery was for, and it changes nothing the match
 * depends on.
 */
async function assertLineAccounts(
  tx: Tx,
  tenantId: string,
  lines: BillLineInput[],
  existingById: ReadonlyMap<string, ExistingLine>,
): Promise<void> {
  const ids = [
    ...new Set(lines.map((l) => l.accountId).filter((a): a is string => !!a)),
  ];
  if (ids.length === 0) return;
  const accounts = await tx.query.accounts.findMany({
    where: and(
      eq(schema.accounts.tenantId, tenantId),
      inArray(schema.accounts.id, ids),
    ),
  });
  const registers = await tx
    .select({ accountId: schema.bankAccounts.accountId })
    .from(schema.bankAccounts)
    .where(eq(schema.bankAccounts.tenantId, tenantId));
  const registerIds = new Set(registers.map((r) => r.accountId));

  for (const id of ids) {
    const account = accounts.find((a) => a.id === id);
    if (!account) throw new LedgerError("ACCOUNT_NOT_FOUND", `account ${id}`);
    if (!account.isActive) {
      throw new LedgerError("ACCOUNT_INACTIVE", `account ${account.code}`);
    }
  }
  for (const line of lines) {
    if (!line.accountId) continue;
    const account = accounts.find((a) => a.id === line.accountId)!;
    if (isCodableAccount(account, registerIds)) continue;
    const before = line.id ? existingById.get(line.id) : undefined;
    const unchanged =
      before !== undefined &&
      before.accountId === line.accountId &&
      before.amountCents === line.amountCents &&
      before.description === line.description;
    if (!unchanged) {
      throw new LedgerError(
        "ACCOUNT_NOT_CODABLE",
        `account ${account.code} is set by matching, not by hand`,
      );
    }
  }
}

/** Whole-replace the dimension tags on the lines named. */
async function writeLineDimensions(
  tx: Tx,
  tenantId: string,
  rows: ReadonlyArray<{ lineId: string; memberIds: readonly string[] }>,
  typeOf: ReadonlyMap<string, string>,
): Promise<void> {
  const lineIds = rows.map((r) => r.lineId);
  if (lineIds.length > 0) {
    await tx
      .delete(schema.lineDimensions)
      .where(
        and(
          eq(schema.lineDimensions.tenantId, tenantId),
          inArray(schema.lineDimensions.billLineId, lineIds),
        ),
      );
  }
  const dimRows = rows.flatMap((r) =>
    r.memberIds.map((memberId) => ({
      tenantId,
      billLineId: r.lineId,
      dimensionType: typeOf.get(memberId)!,
      memberId,
    })),
  );
  if (dimRows.length > 0) {
    await tx.insert(schema.lineDimensions).values(dimRows);
  }
}

async function insertBillLines(
  tx: Tx,
  tenantId: string,
  billId: string,
  lines: BillLineInput[],
): Promise<number> {
  const typeOf = await validateLineDimensions(tx, tenantId, lines);
  // No existing lines to carry anything through: on a new bill, an unpickable
  // account is always somebody typing one.
  await assertLineAccounts(tx, tenantId, lines, new Map());
  const inserted = await tx
    .insert(schema.billLines)
    .values(
      lines.map((l, i) => ({
        tenantId,
        billId,
        lineNo: i + 1,
        description: l.description,
        amountCents: l.amountCents,
        accountId: l.accountId ?? null,
      })),
    )
    .returning({ id: schema.billLines.id, lineNo: schema.billLines.lineNo });
  await writeLineDimensions(
    tx,
    tenantId,
    lines.map((l, i) => ({
      lineId: inserted.find((r) => r.lineNo === i + 1)!.id,
      memberIds: l.dimensionMemberIds ?? [],
    })),
    typeOf,
  );
  return billTotalCents(lines);
}

export interface BillDraftInput {
  /**
   * Which company's books (ADR 0010). OPTIONAL over the wire and resolved to
   * the tenant's default when absent — a single-company tenant has no picker to
   * send one from. Frozen once the document exists: it is what every entry the
   * document posts will read.
   */
  entityId?: string;
  vendorId: string;
  billNumber?: string;
  billDate: string;
  dueDate?: string | null;
  memo?: string;
  lines: BillLineInput[];
}

export async function createBillDraft(
  tx: Tx,
  ctx: LedgerCtx,
  input: BillDraftInput,
): Promise<Bill> {
  const vendor = await loadVendor(tx, ctx.tenantId, input.vendorId);
  if (!vendor.isActive) {
    throw new LedgerError("VENDOR_INACTIVE", `vendor ${vendor.id} inactive`);
  }
  const [bill] = await tx
    .insert(schema.bills)
    .values({
      tenantId: ctx.tenantId,
      entityId: input.entityId ?? (await getDefaultEntityId(tx, ctx.tenantId)),
      vendorId: input.vendorId,
      billNumber: input.billNumber ?? "",
      billDate: input.billDate,
      dueDate: input.dueDate ?? null,
      memo: input.memo ?? "",
      createdByClerkUserId: ctx.userId,
    })
    .returning();
  const totalCents = await insertBillLines(tx, ctx.tenantId, bill.id, input.lines);
  const [updated] = await tx
    .update(schema.bills)
    .set({ totalCents, updatedAt: new Date() })
    .where(eq(schema.bills.id, bill.id))
    .returning();
  return updated;
}

/**
 * **A LINE KEEPS ITS IDENTITY ACROSS AN EDIT.** Lines the patch still names are
 * UPDATED in place; lines it drops are deleted; lines it adds are inserted.
 *
 * This used to delete every line and re-insert the lot, which was simple and
 * wrong. Two tables hang a settlement off a bill line's id with `ON DELETE
 * CASCADE` — `bill_line_stock_allocations` (a delivery) and
 * `production_run_bill_allocations` (a kill day's fee) — and the form carries
 * the line's GRNI coding and its matched amount faithfully back. So editing the
 * memo of a matched bill destroyed the match while keeping every ledger
 * consequence of it: approving still debited `2050`, and the same deliveries
 * were back on the reconciliation to be matched against a second bill and
 * clear the same credit twice. `grniPosition` then disagreed with its own
 * account by the full amount, with no entry anywhere explaining the gap.
 *
 * Nothing about the accounting needed the delete. It needed the tags replaced,
 * which `writeLineDimensions` does per line, and it needed a stable ordering,
 * which the two-phase renumber below gives it.
 *
 * `ai_coding` is still cleared. Line ids survive now, so the P14 reason no
 * longer holds — but a suggestion made against a description somebody has since
 * rewritten is stale for a plainer reason, and re-asking is cheap.
 */
export async function updateBillDraft(
  tx: Tx,
  ctx: LedgerCtx,
  args: { billId: string; expectedVersion: number; patch: BillDraftInput },
): Promise<Bill> {
  const bill = await loadBill(tx, ctx.tenantId, args.billId);
  if (bill.status !== "draft") {
    throw new LedgerError("BILL_NOT_DRAFT", "only drafts are editable");
  }
  const vendor = await loadVendor(tx, ctx.tenantId, args.patch.vendorId);
  if (!vendor.isActive) {
    throw new LedgerError("VENDOR_INACTIVE", `vendor ${vendor.id} inactive`);
  }

  const existing = await tx
    .select({
      id: schema.billLines.id,
      description: schema.billLines.description,
      amountCents: schema.billLines.amountCents,
      accountId: schema.billLines.accountId,
    })
    .from(schema.billLines)
    .where(
      and(
        eq(schema.billLines.tenantId, ctx.tenantId),
        eq(schema.billLines.billId, bill.id),
      ),
    );
  const existingById = new Map(existing.map((l) => [l.id, l]));

  /**
   * An id is honoured only if this bill actually owns it, and only once. A
   * stale form naming a line that has since gone gets a new line, which is the
   * harmless reading; a duplicated id would otherwise collapse two rows into
   * one and lose an amount.
   */
  const claimed = new Set<string>();
  const lines = args.patch.lines.map((l) => {
    const id = l.id && existingById.has(l.id) && !claimed.has(l.id) ? l.id : undefined;
    if (id) claimed.add(id);
    return { ...l, id };
  });

  await assertLineAccounts(tx, ctx.tenantId, lines, existingById);
  const typeOf = await validateLineDimensions(tx, ctx.tenantId, lines);

  const removed = existing.filter((l) => !claimed.has(l.id));
  if (removed.length > 0) {
    await tx.delete(schema.billLines).where(
      and(
        eq(schema.billLines.tenantId, ctx.tenantId),
        inArray(
          schema.billLines.id,
          removed.map((l) => l.id),
        ),
      ),
    );
  }

  /**
   * **SURVIVORS PARK ON NEGATIVE LINE NUMBERS FIRST.**
   * `bill_lines_bill_line_no_idx` is a plain unique index, so it is enforced
   * row by row rather than at the end of the statement — moving line 2 to line
   * 1 while line 1 is still there fails. Negatives collide with nothing, and
   * once every survivor is parked the whole positive range is free for the
   * inserts and then for the final numbering.
   */
  for (const [i, l] of lines.entries()) {
    if (!l.id) continue;
    await tx
      .update(schema.billLines)
      .set({
        lineNo: -(i + 1),
        description: l.description,
        amountCents: l.amountCents,
        accountId: l.accountId ?? null,
      })
      .where(
        and(
          eq(schema.billLines.tenantId, ctx.tenantId),
          eq(schema.billLines.id, l.id),
        ),
      );
  }

  const fresh = lines
    .map((l, i) => ({ line: l, lineNo: i + 1 }))
    .filter((r) => !r.line.id);
  const inserted =
    fresh.length === 0
      ? []
      : await tx
          .insert(schema.billLines)
          .values(
            fresh.map((r) => ({
              tenantId: ctx.tenantId,
              billId: bill.id,
              lineNo: r.lineNo,
              description: r.line.description,
              amountCents: r.line.amountCents,
              accountId: r.line.accountId ?? null,
            })),
          )
          .returning({
            id: schema.billLines.id,
            lineNo: schema.billLines.lineNo,
          });

  for (const [i, l] of lines.entries()) {
    if (!l.id) continue;
    await tx
      .update(schema.billLines)
      .set({ lineNo: i + 1 })
      .where(
        and(
          eq(schema.billLines.tenantId, ctx.tenantId),
          eq(schema.billLines.id, l.id),
        ),
      );
  }

  await writeLineDimensions(
    tx,
    ctx.tenantId,
    lines.map((l, i) => ({
      lineId: l.id ?? inserted.find((r) => r.lineNo === i + 1)!.id,
      memberIds: l.dimensionMemberIds ?? [],
    })),
    typeOf,
  );

  const totalCents = billTotalCents(lines);
  const rows = await tx
    .update(schema.bills)
    .set({
      vendorId: args.patch.vendorId,
      billNumber: args.patch.billNumber ?? "",
      billDate: args.patch.billDate,
      dueDate: args.patch.dueDate ?? null,
      memo: args.patch.memo ?? "",
      totalCents,
      aiCoding: null,
      version: args.expectedVersion + 1,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.bills.tenantId, ctx.tenantId),
        eq(schema.bills.id, bill.id),
        eq(schema.bills.version, args.expectedVersion),
      ),
    )
    .returning();
  if (rows.length === 0) {
    throw new LedgerError("STALE_VERSION", "bill changed since loaded");
  }
  return rows[0];
}

export async function deleteBillDraft(
  tx: Tx,
  ctx: LedgerCtx,
  args: { billId: string; expectedVersion: number },
): Promise<Bill> {
  const bill = await loadBill(tx, ctx.tenantId, args.billId);
  if (bill.status !== "draft") {
    throw new LedgerError("BILL_NOT_DRAFT", "only drafts can be deleted");
  }
  if (bill.version !== args.expectedVersion) {
    throw new LedgerError("STALE_VERSION", "bill changed since loaded");
  }
  await tx
    .delete(schema.bills)
    .where(
      and(eq(schema.bills.tenantId, ctx.tenantId), eq(schema.bills.id, bill.id)),
    );
  return bill;
}

export async function submitBill(
  tx: Tx,
  ctx: LedgerCtx,
  args: { billId: string; expectedVersion: number },
): Promise<Bill> {
  const bill = await loadBill(tx, ctx.tenantId, args.billId);
  if (bill.status !== "draft") {
    throw new LedgerError("BILL_NOT_DRAFT", "only drafts can be submitted");
  }
  return setBillStatus(tx, ctx.tenantId, bill.id, "awaiting_approval", args.expectedVersion);
}

export async function returnBillToDraft(
  tx: Tx,
  ctx: LedgerCtx,
  args: { billId: string; expectedVersion: number },
): Promise<Bill> {
  const bill = await loadBill(tx, ctx.tenantId, args.billId);
  if (bill.status !== "awaiting_approval") {
    throw new LedgerError("BILL_NOT_AWAITING", "bill is not awaiting approval");
  }
  return setBillStatus(tx, ctx.tenantId, bill.id, "draft", args.expectedVersion);
}

async function setBillStatus(
  tx: Tx,
  tenantId: string,
  billId: string,
  status: "draft" | "awaiting_approval",
  expectedVersion: number,
): Promise<Bill> {
  const rows = await tx
    .update(schema.bills)
    .set({ status, version: expectedVersion + 1, updatedAt: new Date() })
    .where(
      and(
        eq(schema.bills.tenantId, tenantId),
        eq(schema.bills.id, billId),
        eq(schema.bills.version, expectedVersion),
      ),
    )
    .returning();
  if (rows.length === 0) {
    throw new LedgerError("STALE_VERSION", "bill changed since loaded");
  }
  return rows[0];
}

export async function findApAccount(tx: Tx, tenantId: string): Promise<string> {
  const ap = await tx.query.accounts.findFirst({
    where: and(
      eq(schema.accounts.tenantId, tenantId),
      eq(schema.accounts.subtype, "accounts_payable"),
      eq(schema.accounts.isSystem, true),
    ),
  });
  if (!ap) throw new LedgerError("ACCOUNT_NOT_FOUND", "Accounts Payable missing");
  return ap.id;
}

/**
 * draft | awaiting_approval → approved (owner): posts Dr per non-zero
 * line / Cr AP, dims copied. Freeze-on-approve is enforced by the status
 * checks in updateBillDraft.
 */
export async function approveBill(
  tx: Tx,
  ctx: LedgerCtx,
  args: { billId: string; expectedVersion: number },
): Promise<Bill> {
  requireOwnerRole(ctx);
  const bill = await loadBill(tx, ctx.tenantId, args.billId);
  if (!["draft", "awaiting_approval"].includes(bill.status)) {
    throw new LedgerError("BILL_NOT_APPROVABLE", `bill is ${bill.status}`);
  }
  const vendor = await loadVendor(tx, ctx.tenantId, bill.vendorId);
  if (!vendor.isActive) {
    throw new LedgerError("VENDOR_INACTIVE", `vendor ${vendor.id} inactive`);
  }
  const lines = await loadBillLines(tx, ctx.tenantId, bill.id);
  const postable = lines.filter((l) => l.amountCents !== 0);
  const total = billTotalCents(lines);
  if (postable.length === 0 || total <= 0) {
    throw new LedgerError("BILL_EMPTY", "bill needs lines and a positive total");
  }
  const uncoded = postable.filter((l) => !l.accountId);
  if (uncoded.length > 0) {
    throw new LedgerError("BILL_UNCODED_LINES", `${uncoded.length} uncoded`, {
      lineNos: uncoded.map((l) => l.lineNo),
    });
  }
  const apAccountId = await findApAccount(tx, ctx.tenantId);

  const prior = await tx
    .select({ id: schema.journalEntries.id })
    .from(schema.journalEntries)
    .where(
      and(
        eq(schema.journalEntries.tenantId, ctx.tenantId),
        eq(schema.journalEntries.source, "bill"),
        eq(schema.journalEntries.sourceId, bill.id),
      ),
    );

  const { entry } = await postEntry(tx, ctx, {
    // THE BILL'S OWN COMPANY, chosen at draft and frozen — the AP mirror of the
    // invoice rule.
    entityId: bill.entityId,
    status: "posted",
    entryDate: bill.billDate,
    memo: `Bill — ${vendor.name}${bill.billNumber ? ` ${bill.billNumber}` : ""}`,
    source: "bill",
    sourceId: bill.id,
    idempotencyKey: `bill:${bill.id}:${prior.length}`,
    lines: [
      ...postable.map((l) => ({
        accountId: l.accountId!,
        amountCents: l.amountCents,
        memo: l.description,
        dimensionMemberIds:
          l.dimensionMemberIds.length > 0 ? l.dimensionMemberIds : undefined,
      })),
      { accountId: apAccountId, amountCents: -total },
    ],
  });

  const rows = await tx
    .update(schema.bills)
    .set({
      status: "approved",
      journalEntryId: entry.id,
      version: args.expectedVersion + 1,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.bills.tenantId, ctx.tenantId),
        eq(schema.bills.id, bill.id),
        eq(schema.bills.version, args.expectedVersion),
      ),
    )
    .returning();
  if (rows.length === 0) {
    throw new LedgerError("STALE_VERSION", "bill changed since loaded");
  }
  return rows[0];
}

/** Memo/due-date only — zero ledger effect (P7). */
export async function updateApprovedBill(
  tx: Tx,
  ctx: LedgerCtx,
  args: {
    billId: string;
    expectedVersion: number;
    patch: { memo?: string; dueDate?: string | null };
  },
): Promise<Bill> {
  const bill = await loadBill(tx, ctx.tenantId, args.billId);
  if (!["approved", "partial", "paid"].includes(bill.status)) {
    throw new LedgerError("BILL_NOT_OPEN", "bill is not approved");
  }
  const rows = await tx
    .update(schema.bills)
    .set({
      ...(args.patch.memo !== undefined ? { memo: args.patch.memo } : {}),
      ...(args.patch.dueDate !== undefined ? { dueDate: args.patch.dueDate } : {}),
      version: args.expectedVersion + 1,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.bills.tenantId, ctx.tenantId),
        eq(schema.bills.id, bill.id),
        eq(schema.bills.version, args.expectedVersion),
      ),
    )
    .returning();
  if (rows.length === 0) {
    throw new LedgerError("STALE_VERSION", "bill changed since loaded");
  }
  return rows[0];
}

/** approved → void: zero payments + mutable approval entry required. */
export async function voidBill(
  tx: Tx,
  ctx: LedgerCtx,
  args: { billId: string; expectedVersion: number },
): Promise<Bill> {
  requireOwnerRole(ctx);
  const bill = await loadBill(tx, ctx.tenantId, args.billId);
  if (!["approved", "partial", "paid"].includes(bill.status)) {
    throw new LedgerError("BILL_NOT_OPEN", "only approved bills can be voided");
  }
  const payments = await tx
    .select({ id: schema.billPayments.id })
    .from(schema.billPayments)
    .where(
      and(
        eq(schema.billPayments.tenantId, ctx.tenantId),
        eq(schema.billPayments.billId, bill.id),
      ),
    );
  if (payments.length > 0) {
    throw new LedgerError("BILL_HAS_PAYMENTS", "unapply payments first");
  }
  if (bill.journalEntryId) {
    const entry = await tx.query.journalEntries.findFirst({
      where: and(
        eq(schema.journalEntries.tenantId, ctx.tenantId),
        eq(schema.journalEntries.id, bill.journalEntryId),
      ),
    });
    if (entry && entry.status === "posted") {
      await voidEntry(tx, ctx, {
        entryId: entry.id,
        expectedVersion: entry.version,
      });
    }
  }
  const rows = await tx
    .update(schema.bills)
    .set({ status: "void", version: args.expectedVersion + 1, updatedAt: new Date() })
    .where(
      and(
        eq(schema.bills.tenantId, ctx.tenantId),
        eq(schema.bills.id, bill.id),
        eq(schema.bills.version, args.expectedVersion),
      ),
    )
    .returning();
  if (rows.length === 0) {
    throw new LedgerError("STALE_VERSION", "bill changed since loaded");
  }
  return rows[0];
}

export interface DuplicateSignal {
  billId: string;
  billNumber: string;
  billDate: string;
  totalCents: number;
  status: string;
  /** "number" = same vendor + vendor invoice #; "amount_date" = softer. */
  reason: "number" | "amount_date";
}

/** P3: warn, never block. Both signals scoped to the same vendor. */
export async function findPossibleDuplicates(
  tx: Tx,
  tenantId: string,
  args: {
    vendorId: string;
    billNumber: string;
    totalCents: number;
    billDate: string;
    excludeBillId?: string;
  },
): Promise<DuplicateSignal[]> {
  const candidates = await tx.query.bills.findMany({
    where: and(
      eq(schema.bills.tenantId, tenantId),
      eq(schema.bills.vendorId, args.vendorId),
      ne(schema.bills.status, "void"),
      ...(args.excludeBillId ? [ne(schema.bills.id, args.excludeBillId)] : []),
    ),
    orderBy: [sql`${schema.bills.billDate} desc`],
    limit: 200,
  });
  const wantNumber = normalizeBillNumber(args.billNumber);
  const out: DuplicateSignal[] = [];
  for (const bill of candidates) {
    const sameNumber =
      wantNumber !== "" && normalizeBillNumber(bill.billNumber) === wantNumber;
    const dayDelta = Math.abs(
      (Date.parse(bill.billDate) - Date.parse(args.billDate)) / 86_400_000,
    );
    const sameAmountDate =
      bill.totalCents === args.totalCents &&
      args.totalCents > 0 &&
      dayDelta <= 3;
    if (sameNumber || sameAmountDate) {
      out.push({
        billId: bill.id,
        billNumber: bill.billNumber,
        billDate: bill.billDate,
        totalCents: bill.totalCents,
        status: bill.status,
        reason: sameNumber ? "number" : "amount_date",
      });
    }
  }
  return out.slice(0, 5);
}
