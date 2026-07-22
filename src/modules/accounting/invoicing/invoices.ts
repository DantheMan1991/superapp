import "server-only";
import { and, asc, eq, inArray } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import type { Invoice, InvoiceLine } from "@/db/schema";
import {
  LedgerError,
  postEntry,
  requireOwnerRole,
  voidEntry,
  type LedgerCtx,
} from "../core";
import { loadCustomer } from "./customers";
import {
  computeLineAmounts,
  invoiceTotalCents,
  type InvoiceLineInput,
} from "./lines";
import { suggestInvoiceNumber } from "./numbering";

/**
 * Invoice lifecycle. Statuses draft/issued/partial/paid/void with an
 * explicit machine: partial/paid are DERIVED from payments (payments.ts);
 * no code path sets a target status from input. Issuance posts
 * Dr AR / Cr income per line through the core engine.
 */

export async function loadInvoice(
  tx: Tx,
  tenantId: string,
  invoiceId: string,
): Promise<Invoice> {
  const row = await tx.query.invoices.findFirst({
    where: and(
      eq(schema.invoices.tenantId, tenantId),
      eq(schema.invoices.id, invoiceId),
    ),
  });
  if (!row) throw new LedgerError("INVOICE_NOT_FOUND", `invoice ${invoiceId} missing`);
  return row;
}

export async function loadInvoiceLines(
  tx: Tx,
  tenantId: string,
  invoiceId: string,
): Promise<Array<InvoiceLine & { dimensionMemberIds: string[] }>> {
  const lines = await tx.query.invoiceLines.findMany({
    where: and(
      eq(schema.invoiceLines.tenantId, tenantId),
      eq(schema.invoiceLines.invoiceId, invoiceId),
    ),
    orderBy: asc(schema.invoiceLines.lineNo),
  });
  if (lines.length === 0) return [];
  const dims = await tx.query.lineDimensions.findMany({
    where: and(
      eq(schema.lineDimensions.tenantId, tenantId),
      inArray(
        schema.lineDimensions.invoiceLineId,
        lines.map((l) => l.id),
      ),
    ),
  });
  return lines.map((l) => ({
    ...l,
    dimensionMemberIds: dims
      .filter((d) => d.invoiceLineId === l.id)
      .map((d) => d.memberId),
  }));
}

/** Validate member ids (active, one per type per line) and return the type map. */
async function validateLineDimensions(
  tx: Tx,
  tenantId: string,
  lines: InvoiceLineInput[],
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

async function insertInvoiceLines(
  tx: Tx,
  tenantId: string,
  invoiceId: string,
  lines: InvoiceLineInput[],
): Promise<number> {
  const typeOf = await validateLineDimensions(tx, tenantId, lines);
  const computed = computeLineAmounts(lines);
  const inserted = await tx
    .insert(schema.invoiceLines)
    .values(
      computed.map((l, i) => ({
        tenantId,
        invoiceId,
        lineNo: i + 1,
        description: l.description,
        quantity: l.quantity,
        unitPriceCents: l.unitPriceCents,
        amountCents: l.amountCents,
        incomeAccountId: l.incomeAccountId,
      })),
    )
    .returning({ id: schema.invoiceLines.id, lineNo: schema.invoiceLines.lineNo });
  const dimRows = computed.flatMap((l, i) => {
    const lineId = inserted.find((r) => r.lineNo === i + 1)!.id;
    return (l.dimensionMemberIds ?? []).map((memberId) => ({
      tenantId,
      invoiceLineId: lineId,
      dimensionType: typeOf.get(memberId)!,
      memberId,
    }));
  });
  if (dimRows.length > 0) {
    await tx.insert(schema.lineDimensions).values(dimRows);
  }
  return invoiceTotalCents(computed);
}

export interface InvoiceDraftInput {
  customerId: string;
  invoiceNumber?: string;
  issueDate: string;
  dueDate?: string | null;
  memo?: string;
  lines: InvoiceLineInput[];
  recurringInvoiceId?: string | null;
}

/**
 * Create a draft. The (tenant, number) unique is the numbering race
 * arbiter: onConflictDoNothing + one in-tx recompute retry for
 * auto-suggested numbers; user-typed conflicts surface immediately.
 */
export async function createInvoiceDraft(
  tx: Tx,
  ctx: LedgerCtx,
  input: InvoiceDraftInput,
): Promise<Invoice> {
  const customer = await loadCustomer(tx, ctx.tenantId, input.customerId);
  if (!customer.isActive) {
    throw new LedgerError("CUSTOMER_INACTIVE", `customer ${customer.id} inactive`);
  }
  const autoNumber = !input.invoiceNumber;
  let number = input.invoiceNumber ?? (await suggestInvoiceNumber(tx, ctx.tenantId));

  const values = (invoiceNumber: string) => ({
    tenantId: ctx.tenantId,
    customerId: input.customerId,
    invoiceNumber,
    issueDate: input.issueDate,
    dueDate: input.dueDate ?? null,
    memo: input.memo ?? "",
    recurringInvoiceId: input.recurringInvoiceId ?? null,
    createdByClerkUserId: ctx.userId,
  });

  let [invoice] = await tx
    .insert(schema.invoices)
    .values(values(number))
    .onConflictDoNothing()
    .returning();
  if (!invoice && autoNumber) {
    number = await suggestInvoiceNumber(tx, ctx.tenantId);
    [invoice] = await tx
      .insert(schema.invoices)
      .values(values(number))
      .onConflictDoNothing()
      .returning();
  }
  if (!invoice) {
    throw new LedgerError("INVOICE_NUMBER_TAKEN", `number ${number} taken`);
  }

  const totalCents = await insertInvoiceLines(tx, ctx.tenantId, invoice.id, input.lines);
  const [updated] = await tx
    .update(schema.invoices)
    .set({ totalCents, updatedAt: new Date() })
    .where(eq(schema.invoices.id, invoice.id))
    .returning();
  return updated;
}

export async function updateInvoiceDraft(
  tx: Tx,
  ctx: LedgerCtx,
  args: {
    invoiceId: string;
    expectedVersion: number;
    patch: Omit<InvoiceDraftInput, "recurringInvoiceId">;
  },
): Promise<Invoice> {
  const invoice = await loadInvoice(tx, ctx.tenantId, args.invoiceId);
  if (invoice.status !== "draft") {
    throw new LedgerError("INVOICE_NOT_DRAFT", "only drafts are editable");
  }
  const customer = await loadCustomer(tx, ctx.tenantId, args.patch.customerId);
  if (!customer.isActive) {
    throw new LedgerError("CUSTOMER_INACTIVE", `customer ${customer.id} inactive`);
  }
  // Whole-replace lines (dims cascade with them).
  await tx
    .delete(schema.invoiceLines)
    .where(
      and(
        eq(schema.invoiceLines.tenantId, ctx.tenantId),
        eq(schema.invoiceLines.invoiceId, invoice.id),
      ),
    );
  const totalCents = await insertInvoiceLines(tx, ctx.tenantId, invoice.id, args.patch.lines);

  const number = args.patch.invoiceNumber ?? invoice.invoiceNumber;
  const rows = await tx
    .update(schema.invoices)
    .set({
      customerId: args.patch.customerId,
      invoiceNumber: number,
      issueDate: args.patch.issueDate,
      dueDate: args.patch.dueDate ?? null,
      memo: args.patch.memo ?? "",
      totalCents,
      version: args.expectedVersion + 1,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.invoices.tenantId, ctx.tenantId),
        eq(schema.invoices.id, invoice.id),
        eq(schema.invoices.version, args.expectedVersion),
      ),
    )
    .returning();
  if (rows.length === 0) {
    throw new LedgerError("STALE_VERSION", "invoice changed since loaded");
  }
  return rows[0];
}

export async function deleteInvoiceDraft(
  tx: Tx,
  ctx: LedgerCtx,
  args: { invoiceId: string; expectedVersion: number },
): Promise<Invoice> {
  const invoice = await loadInvoice(tx, ctx.tenantId, args.invoiceId);
  if (invoice.status !== "draft") {
    throw new LedgerError("INVOICE_NOT_DRAFT", "only drafts can be deleted");
  }
  if (invoice.version !== args.expectedVersion) {
    throw new LedgerError("STALE_VERSION", "invoice changed since loaded");
  }
  await tx
    .delete(schema.invoices)
    .where(
      and(
        eq(schema.invoices.tenantId, ctx.tenantId),
        eq(schema.invoices.id, invoice.id),
      ),
    );
  return invoice;
}

async function findArAccount(tx: Tx, tenantId: string): Promise<string> {
  const ar = await tx.query.accounts.findFirst({
    where: and(
      eq(schema.accounts.tenantId, tenantId),
      eq(schema.accounts.subtype, "accounts_receivable"),
      eq(schema.accounts.isSystem, true),
    ),
  });
  if (!ar) throw new LedgerError("ACCOUNT_NOT_FOUND", "Accounts Receivable missing");
  return ar.id;
}

/** draft → issued: posts Dr AR / Cr income per non-zero line, dims copied. */
export async function issueInvoice(
  tx: Tx,
  ctx: LedgerCtx,
  args: { invoiceId: string; expectedVersion: number },
): Promise<Invoice> {
  requireOwnerRole(ctx);
  const invoice = await loadInvoice(tx, ctx.tenantId, args.invoiceId);
  if (invoice.status !== "draft") {
    throw new LedgerError("INVOICE_NOT_DRAFT", "only drafts can be issued");
  }
  const lines = await loadInvoiceLines(tx, ctx.tenantId, invoice.id);
  const postable = lines.filter((l) => l.amountCents !== 0);
  const total = invoiceTotalCents(lines);
  if (postable.length === 0 || total <= 0) {
    throw new LedgerError("INVOICE_EMPTY", "invoice needs lines and a positive total");
  }
  const arAccountId = await findArAccount(tx, ctx.tenantId);

  const prior = await tx
    .select({ id: schema.journalEntries.id })
    .from(schema.journalEntries)
    .where(
      and(
        eq(schema.journalEntries.tenantId, ctx.tenantId),
        eq(schema.journalEntries.source, "invoice"),
        eq(schema.journalEntries.sourceId, invoice.id),
      ),
    );

  const { entry } = await postEntry(tx, ctx, {
    status: "posted",
    entryDate: invoice.issueDate,
    memo: `Invoice ${invoice.invoiceNumber}`,
    source: "invoice",
    sourceId: invoice.id,
    idempotencyKey: `invoice:${invoice.id}:${prior.length}`,
    lines: [
      { accountId: arAccountId, amountCents: total },
      ...postable.map((l) => ({
        accountId: l.incomeAccountId,
        amountCents: -l.amountCents,
        memo: l.description,
        dimensionMemberIds:
          l.dimensionMemberIds.length > 0 ? l.dimensionMemberIds : undefined,
      })),
    ],
  });

  const rows = await tx
    .update(schema.invoices)
    .set({
      status: "issued",
      journalEntryId: entry.id,
      version: args.expectedVersion + 1,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.invoices.tenantId, ctx.tenantId),
        eq(schema.invoices.id, invoice.id),
        eq(schema.invoices.version, args.expectedVersion),
      ),
    )
    .returning();
  if (rows.length === 0) {
    throw new LedgerError("STALE_VERSION", "invoice changed since loaded");
  }
  return rows[0];
}

/** Memo/due-date only — zero ledger effect (P7). */
export async function updateIssuedInvoice(
  tx: Tx,
  ctx: LedgerCtx,
  args: {
    invoiceId: string;
    expectedVersion: number;
    patch: { memo?: string; dueDate?: string | null };
  },
): Promise<Invoice> {
  requireOwnerRole(ctx);
  const invoice = await loadInvoice(tx, ctx.tenantId, args.invoiceId);
  if (!["issued", "partial", "paid"].includes(invoice.status)) {
    throw new LedgerError("INVOICE_NOT_OPEN", "invoice is not issued");
  }
  const rows = await tx
    .update(schema.invoices)
    .set({
      ...(args.patch.memo !== undefined ? { memo: args.patch.memo } : {}),
      ...(args.patch.dueDate !== undefined ? { dueDate: args.patch.dueDate } : {}),
      version: args.expectedVersion + 1,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.invoices.tenantId, ctx.tenantId),
        eq(schema.invoices.id, invoice.id),
        eq(schema.invoices.version, args.expectedVersion),
      ),
    )
    .returning();
  if (rows.length === 0) {
    throw new LedgerError("STALE_VERSION", "invoice changed since loaded");
  }
  return rows[0];
}

/** issued → void: zero payments + mutable issuance entry required. */
export async function voidInvoice(
  tx: Tx,
  ctx: LedgerCtx,
  args: { invoiceId: string; expectedVersion: number },
): Promise<Invoice> {
  requireOwnerRole(ctx);
  const invoice = await loadInvoice(tx, ctx.tenantId, args.invoiceId);
  if (!["issued", "partial", "paid"].includes(invoice.status)) {
    throw new LedgerError("INVOICE_NOT_OPEN", "only issued invoices can be voided");
  }
  const payments = await tx
    .select({ id: schema.invoicePayments.id })
    .from(schema.invoicePayments)
    .where(
      and(
        eq(schema.invoicePayments.tenantId, ctx.tenantId),
        eq(schema.invoicePayments.invoiceId, invoice.id),
      ),
    );
  if (payments.length > 0) {
    throw new LedgerError("INVOICE_HAS_PAYMENTS", "unapply payments first");
  }
  if (invoice.journalEntryId) {
    const entry = await tx.query.journalEntries.findFirst({
      where: and(
        eq(schema.journalEntries.tenantId, ctx.tenantId),
        eq(schema.journalEntries.id, invoice.journalEntryId),
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
    .update(schema.invoices)
    .set({ status: "void", version: args.expectedVersion + 1, updatedAt: new Date() })
    .where(
      and(
        eq(schema.invoices.tenantId, ctx.tenantId),
        eq(schema.invoices.id, invoice.id),
        eq(schema.invoices.version, args.expectedVersion),
      ),
    )
    .returning();
  if (rows.length === 0) {
    throw new LedgerError("STALE_VERSION", "invoice changed since loaded");
  }
  return rows[0];
}
