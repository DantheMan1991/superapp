import "server-only";
import { and, asc, eq, inArray } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import type { Invoice, InvoiceLine } from "@/db/schema";
import {
  LedgerError,
  assertCodableAccounts,
  getDefaultEntityId,
  loadDimensionMembers,
  postEntry,
  requireOwnerRole,
  voidEntry,
  type LedgerCtx,
} from "../core";
import { loadCustomer } from "./customers";
import { computeLineAmounts, type InvoiceLineInput } from "./lines";
import { suggestInvoiceNumber } from "./numbering";
import { describeTaxRate, invoiceTaxTotals, type InvoiceTaxTotals } from "./tax";

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

/**
 * The tax fields a rendered invoice needs, as ONE function both the PDF route
 * and the email sender call.
 *
 * Two places building "Sales Tax (7.25%)" by hand is how the attachment and
 * the screen come to disagree — the same rule `reminder-render.ts` exists for.
 *
 * The RATE comes from the invoice (frozen); only the NAME is looked up, and a
 * rate deactivated or renamed since still resolves, because the lookup is by
 * id and does not filter on `is_active`. A rate row that has somehow gone
 * falls back to a generic label rather than failing the render — a customer
 * waiting on an invoice does not care what we called the rate.
 */
export async function invoiceTaxFields(
  tx: Tx,
  tenantId: string,
  invoice: Pick<
    Invoice,
    "taxRateId" | "taxRatePpm" | "taxCents" | "subtotalCents"
  >,
): Promise<{ subtotalCents: number; taxCents: number; taxLabel: string }> {
  let name = "Sales Tax";
  if (invoice.taxRateId) {
    const rate = await tx.query.salesTaxRates.findFirst({
      where: and(
        eq(schema.salesTaxRates.tenantId, tenantId),
        eq(schema.salesTaxRates.id, invoice.taxRateId),
      ),
      columns: { name: true },
    });
    if (rate) name = rate.name;
  }
  return {
    subtotalCents: invoice.subtotalCents,
    taxCents: invoice.taxCents,
    taxLabel: describeTaxRate(name, invoice.taxRatePpm),
  };
}

/** The type map for writing `line_dimensions`. The rule itself is core's. */
async function validateLineDimensions(
  tx: Tx,
  tenantId: string,
  lines: InvoiceLineInput[],
): Promise<Map<string, string>> {
  const members = await loadDimensionMembers(tx, tenantId, lines);
  return new Map([...members].map(([id, m]) => [id, m.dimensionType]));
}

async function insertInvoiceLines(
  tx: Tx,
  tenantId: string,
  invoiceId: string,
  lines: InvoiceLineInput[],
): Promise<Array<{ amountCents: number; isTaxable: boolean }>> {
  /**
   * **NOTHING CHECKED THE INCOME ACCOUNT AT ALL UNTIL 2026-09-01.** Not that it
   * existed — the composite FK caught that as a raw constraint error and a
   * "Something went wrong" toast — not that it was active, and not that it was
   * an account anybody may pick. The invoice picker offers income accounts and
   * that was the entire rule, so any client that sent Checking's id got an
   * invoice whose issue would credit the bank register.
   *
   * The bill path closed the same hole the same day and needed an exception
   * for the one thing that legitimately codes a bill line to an unpickable
   * account: a stock match. **There is no invoice analogue.** No machine path
   * codes an invoice line to GRNI or a register — the recurring generator and
   * the thread drafter both pass codable income accounts — so this is the flat
   * rule with no carve-out, and a draft that somehow holds one must be re-coded
   * before it can be saved again, which is correct.
   */
  await assertCodableAccounts(
    tx,
    tenantId,
    lines.map((l) => l.incomeAccountId),
  );
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
        isTaxable: l.isTaxable,
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
  return computed.map((l) => ({ amountCents: l.amountCents, isTaxable: l.isTaxable }));
}

/**
 * Resolve the rate an invoice is being written with, and FREEZE it.
 *
 * The rate's ppm is copied onto the invoice rather than referenced, so editing
 * the rate later cannot re-price a document that has already been sent — and
 * cannot make the invoice disagree with the entry posted from it.
 *
 * An INACTIVE rate is refused on a write. Deactivating a rate means "stop
 * offering this", and a draft saved against one afterwards would be a rate the
 * owner has already retired.
 */
async function resolveTaxForWrite(
  tx: Tx,
  tenantId: string,
  taxRateId: string | null | undefined,
): Promise<{ taxRateId: string | null; taxRatePpm: number }> {
  if (!taxRateId) return { taxRateId: null, taxRatePpm: 0 };
  const rate = await tx.query.salesTaxRates.findFirst({
    where: and(
      eq(schema.salesTaxRates.tenantId, tenantId),
      eq(schema.salesTaxRates.id, taxRateId),
    ),
  });
  if (!rate || !rate.isActive) {
    throw new LedgerError("TAX_RATE_INVALID", `tax rate ${taxRateId} invalid`);
  }
  return { taxRateId: rate.id, taxRatePpm: rate.ratePpm };
}

export interface InvoiceDraftInput {
  /**
   * Which company's books (ADR 0010). OPTIONAL over the wire and resolved to
   * the tenant's default when absent — a single-company tenant has no picker to
   * send one from. Frozen once the document exists: it is what every entry the
   * document posts will read.
   */
  entityId?: string;
  customerId: string;
  invoiceNumber?: string;
  issueDate: string;
  dueDate?: string | null;
  memo?: string;
  /** Null or absent = no tax on this invoice. */
  taxRateId?: string | null;
  lines: InvoiceLineInput[];
  /** The unified template that generated this invoice. */
  recurringEntryId?: string | null;
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
  const tax = await resolveTaxForWrite(tx, ctx.tenantId, input.taxRateId);

  const entityId =
    input.entityId ?? (await getDefaultEntityId(tx, ctx.tenantId));

  const values = (invoiceNumber: string) => ({
    tenantId: ctx.tenantId,
    entityId,
    customerId: input.customerId,
    invoiceNumber,
    issueDate: input.issueDate,
    dueDate: input.dueDate ?? null,
    memo: input.memo ?? "",
    taxRateId: tax.taxRateId,
    taxRatePpm: tax.taxRatePpm,
    recurringEntryId: input.recurringEntryId ?? null,
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

  const written = await insertInvoiceLines(tx, ctx.tenantId, invoice.id, input.lines);
  const totals = invoiceTaxTotals(written, tax.taxRateId ? tax.taxRatePpm : null);
  const [updated] = await tx
    .update(schema.invoices)
    .set({
      subtotalCents: totals.subtotalCents,
      taxCents: totals.taxCents,
      totalCents: totals.totalCents,
      updatedAt: new Date(),
    })
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
    patch: Omit<InvoiceDraftInput, "recurringEntryId">;
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
  const tax = await resolveTaxForWrite(tx, ctx.tenantId, args.patch.taxRateId);
  // Whole-replace lines (dims cascade with them).
  await tx
    .delete(schema.invoiceLines)
    .where(
      and(
        eq(schema.invoiceLines.tenantId, ctx.tenantId),
        eq(schema.invoiceLines.invoiceId, invoice.id),
      ),
    );
  const written = await insertInvoiceLines(tx, ctx.tenantId, invoice.id, args.patch.lines);
  const totals = invoiceTaxTotals(written, tax.taxRateId ? tax.taxRatePpm : null);

  const number = args.patch.invoiceNumber ?? invoice.invoiceNumber;
  // NOTE `entityId` is deliberately NOT in this SET, even though the patch type
  // carries it. A draft's company is fixed at creation: it is what issuance and
  // every payment will read, so editing it here would be a way to move a
  // document between two balance sheets by typing in a form.
  const rows = await tx
    .update(schema.invoices)
    .set({
      customerId: args.patch.customerId,
      invoiceNumber: number,
      issueDate: args.patch.issueDate,
      dueDate: args.patch.dueDate ?? null,
      memo: args.patch.memo ?? "",
      taxRateId: tax.taxRateId,
      taxRatePpm: tax.taxRatePpm,
      subtotalCents: totals.subtotalCents,
      taxCents: totals.taxCents,
      totalCents: totals.totalCents,
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

/**
 * The account sales tax collected is owed from. Found BY SUBTYPE, never by
 * code — the general template calls it 2200, and a tenant may have renumbered
 * their whole chart.
 *
 * Only ever called when an invoice actually charges tax, so a tenant who
 * renamed or removed the account and never charges any is unaffected.
 */
async function findSalesTaxAccount(tx: Tx, tenantId: string): Promise<string> {
  const account = await tx.query.accounts.findFirst({
    where: and(
      eq(schema.accounts.tenantId, tenantId),
      eq(schema.accounts.subtype, "sales_tax"),
      eq(schema.accounts.isSystem, true),
    ),
  });
  if (!account) {
    throw new LedgerError("ACCOUNT_NOT_FOUND", "Sales Tax Payable missing");
  }
  return account.id;
}

/**
 * draft → issued: posts Dr AR / Cr income per non-zero line, dims copied, plus
 * ONE Cr to Sales Tax Payable when the invoice charges tax.
 *
 * The tax figure is RECOMPUTED here from the frozen lines and the frozen rate
 * rather than read off `invoices.tax_cents`, so the entry and the document
 * cannot disagree even if a write path ever left the column stale. It is then
 * written back, which makes issuance self-healing for any such row.
 */
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
  const totals: InvoiceTaxTotals = invoiceTaxTotals(
    lines,
    invoice.taxRateId ? invoice.taxRatePpm : null,
  );
  const total = totals.totalCents;
  if (postable.length === 0 || total <= 0) {
    throw new LedgerError("INVOICE_EMPTY", "invoice needs lines and a positive total");
  }
  const arAccountId = await findArAccount(tx, ctx.tenantId);
  const taxAccountId =
    totals.taxCents !== 0 ? await findSalesTaxAccount(tx, ctx.tenantId) : null;

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
    // THE INVOICE'S OWN COMPANY. Chosen when the draft was created and frozen
    // from then on — issuance, every payment, and any reversal all read it from
    // the same row, so moving the tenant's default cannot split one document's
    // AR across two balance sheets.
    entityId: invoice.entityId,
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
      // Tax collected is money held for somebody else. It is CARRIED NO
      // DIMENSION on purpose: a dimension answers "which part of the business
      // earned this", and this line is not earnings.
      ...(taxAccountId
        ? [
            {
              accountId: taxAccountId,
              amountCents: -totals.taxCents,
              memo: `Sales tax`,
            },
          ]
        : []),
    ],
  });

  const rows = await tx
    .update(schema.invoices)
    .set({
      status: "issued",
      journalEntryId: entry.id,
      subtotalCents: totals.subtotalCents,
      taxCents: totals.taxCents,
      totalCents: total,
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
