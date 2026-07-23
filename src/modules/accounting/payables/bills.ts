import "server-only";
import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import type { Bill, BillLine } from "@/db/schema";
import {
  LedgerError,
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

async function assertLineAccounts(
  tx: Tx,
  tenantId: string,
  lines: BillLineInput[],
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
  for (const id of ids) {
    const account = accounts.find((a) => a.id === id);
    if (!account) throw new LedgerError("ACCOUNT_NOT_FOUND", `account ${id}`);
    if (!account.isActive) {
      throw new LedgerError("ACCOUNT_INACTIVE", `account ${account.code}`);
    }
  }
}

async function insertBillLines(
  tx: Tx,
  tenantId: string,
  billId: string,
  lines: BillLineInput[],
): Promise<number> {
  const typeOf = await validateLineDimensions(tx, tenantId, lines);
  await assertLineAccounts(tx, tenantId, lines);
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
  const dimRows = lines.flatMap((l, i) => {
    const lineId = inserted.find((r) => r.lineNo === i + 1)!.id;
    return (l.dimensionMemberIds ?? []).map((memberId) => ({
      tenantId,
      billLineId: lineId,
      dimensionType: typeOf.get(memberId)!,
      memberId,
    }));
  });
  if (dimRows.length > 0) {
    await tx.insert(schema.lineDimensions).values(dimRows);
  }
  return billTotalCents(lines);
}

export interface BillDraftInput {
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
 * Whole-replace lines; dims cascade with them. Clears ai_coding —
 * regenerated line ids make stale suggestions dangerous (P14).
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
  await tx
    .delete(schema.billLines)
    .where(
      and(
        eq(schema.billLines.tenantId, ctx.tenantId),
        eq(schema.billLines.billId, bill.id),
      ),
    );
  const totalCents = await insertBillLines(tx, ctx.tenantId, bill.id, args.patch.lines);
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
