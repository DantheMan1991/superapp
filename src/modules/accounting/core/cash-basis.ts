import "server-only";
import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import type { BalanceRow } from "./balances";
import { asFilterScope } from "./consolidation";
import { entityScopeCondition, type EntityScope } from "./entities";
import {
  allocateDocument,
  type DocumentPayment,
  type RecognitionLine,
} from "./cash-basis-allocate";

/**
 * Cash-basis recognition: reading the accrual ledger and working out what the
 * same period looks like on the basis the business files on. See
 * docs/decisions/0007-cash-basis-reporting.md.
 *
 * Nothing here writes. Cash basis is a lens over the ledger, never a second set
 * of books — the alternative, storing a parallel cash-basis ledger, is the
 * drift bug class `balances.ts` exists to avoid.
 *
 * The shape of the adjustment, for one invoice payment of A against an invoice
 * whose income lines total T:
 *
 *   base (cash mode)  Dr deposit A     Cr AR A        <- the payment entry;
 *                                                        issuance is excluded
 *   adjustment        Dr AR min(A,T)   Cr income ...  <- this module
 *   -------------------------------------------------
 *   result            Dr deposit A     Cr income ...  <- and AR nets to zero
 *
 * The control-account leg is what keeps it balanced: it is exactly the negation
 * of what was recognised, so on an overpayment the unallocated remainder stays
 * on AR, where unapplied cash belongs.
 */

/** Subtypes that make an account the AR/AP control for this purpose. */
const CONTROL_SUBTYPES = ["accounts_receivable", "accounts_payable"] as const;

export interface CashBasisWindow {
  /**
   * REQUIRED, and it is applied in FOUR places below, not one: the payments
   * that land in the window, every prior payment of those documents (allocation
   * is cumulative — a payment made from another entity's books must not consume
   * this entity's recognition), the documents' accrual lines, and the control
   * leg. Scoping only the first would produce a report that still balances.
   */
  scope: EntityScope;
  asOf?: string;
  from?: string;
  to?: string;
}

interface PaymentRow {
  entryId: string;
  documentId: string;
  amountCents: number;
  paymentDate: string;
  kind: "invoice" | "bill";
}

function toBalanceRows(
  deltas: Array<{ accountId: string; memberId: string | null; amountCents: number }>,
): BalanceRow[] {
  const byKey = new Map<string, BalanceRow>();
  for (const d of deltas) {
    if (d.amountCents === 0) continue;
    const key = `${d.accountId}|${d.memberId ?? ""}`;
    const row = byKey.get(key) ?? {
      accountId: d.accountId,
      memberId: d.memberId,
      debitCents: 0,
      creditCents: 0,
      netCents: 0,
    };
    if (d.amountCents > 0) row.debitCents += d.amountCents;
    else row.creditCents += -d.amountCents;
    row.netCents += d.amountCents;
    byKey.set(key, row);
  }
  return [...byKey.values()];
}

/**
 * The delta to add to a cash-mode base aggregate. Returns [] when the tenant
 * settled no AR/AP documents in the window, which is the common case for a
 * business that only ever spends straight from its bank account.
 */
export async function cashBasisAdjustment(
  tx: Tx,
  tenantId: string,
  opts: CashBasisWindow & {
    accountIds?: string[];
    groupByDimensionType?: string;
    /**
     * `journalLineId` → the account this line should be recognised under
     * instead, from `@/lib/basis-lens`. Empty for nearly every tenant.
     *
     * **APPLIED TO THE RECOGNITION, NOT TO THE CONTROL LEG.** The offset is
     * sized by what was recognised and cancels the AR/AP the payment entry
     * moved, so re-pointing a recognition line moves it sideways in the chart
     * and leaves the entry balanced. Re-pointing the control leg would not.
     */
    substitutedLineAccounts?: Map<string, string>;
  },
): Promise<BalanceRow[]> {
  // CONSOLIDATED BEHAVES AS COMBINED HERE, and there is nothing to eliminate:
  // this adjustment only ever moves recognition between the AR/AP controls and
  // the P&L, so no line it produces or reads can be an affiliate leg. The
  // accrual half it is merged into was eliminated by `getBalances`, which is
  // where the group's intercompany actually lives.
  const inScope = entityScopeCondition(asFilterScope(opts.scope));
  const controls = await tx.query.accounts.findMany({
    where: and(
      eq(schema.accounts.tenantId, tenantId),
      inArray(schema.accounts.subtype, [...CONTROL_SUBTYPES]),
    ),
    columns: { id: true },
  });
  const controlIds = new Set(controls.map((c) => c.id));
  if (controlIds.size === 0) return [];

  const je = schema.journalEntries;
  const jl = schema.journalLines;
  const ld = schema.lineDimensions;

  const dateWindow = [
    opts.asOf ? lte(je.entryDate, opts.asOf) : undefined,
    opts.from ? gte(je.entryDate, opts.from) : undefined,
    opts.to ? lte(je.entryDate, opts.to) : undefined,
  ].filter(Boolean);

  const invoicePaymentsIn = (extra: ReturnType<typeof eq>[]) =>
    tx
      .select({
        entryId: je.id,
        documentId: schema.invoicePayments.invoiceId,
        amountCents: schema.invoicePayments.amountCents,
        paymentDate: schema.invoicePayments.paymentDate,
      })
      .from(schema.invoicePayments)
      .innerJoin(
        je,
        and(
          eq(je.tenantId, schema.invoicePayments.tenantId),
          eq(je.id, schema.invoicePayments.journalEntryId),
        ),
      )
      .where(
        and(
          eq(schema.invoicePayments.tenantId, tenantId),
          eq(je.status, "posted"),
          inScope,
          ...extra,
        ),
      );

  const billPaymentsIn = (extra: ReturnType<typeof eq>[]) =>
    tx
      .select({
        entryId: je.id,
        documentId: schema.billPayments.billId,
        amountCents: schema.billPayments.amountCents,
        paymentDate: schema.billPayments.paymentDate,
      })
      .from(schema.billPayments)
      .innerJoin(
        je,
        and(
          eq(je.tenantId, schema.billPayments.tenantId),
          eq(je.id, schema.billPayments.journalEntryId),
        ),
      )
      .where(
        and(
          eq(schema.billPayments.tenantId, tenantId),
          eq(je.status, "posted"),
          inScope,
          ...extra,
        ),
      );

  // 1. Payment entries that land IN the window. Only their recognition belongs
  //    in this report.
  const [invoicePays, billPays] = await Promise.all([
    invoicePaymentsIn(dateWindow as ReturnType<typeof eq>[]),
    billPaymentsIn(dateWindow as ReturnType<typeof eq>[]),
  ]);

  const inWindow: PaymentRow[] = [
    ...invoicePays.map((p) => ({ ...p, kind: "invoice" as const })),
    ...billPays.map((p) => ({ ...p, kind: "bill" as const })),
  ];
  if (inWindow.length === 0) return [];

  const invoiceIds = [
    ...new Set(inWindow.filter((p) => p.kind === "invoice").map((p) => p.documentId)),
  ];
  const billIds = [
    ...new Set(inWindow.filter((p) => p.kind === "bill").map((p) => p.documentId)),
  ];

  // 2. EVERY payment of those documents, whether or not it is in the window.
  //    Allocation is cumulative: an earlier payment has already consumed its
  //    share, and a report of March must not re-recognise what February took.
  const [allInvoicePays, allBillPays] = await Promise.all([
    invoiceIds.length === 0
      ? Promise.resolve([])
      : invoicePaymentsIn([inArray(schema.invoicePayments.invoiceId, invoiceIds)]),
    billIds.length === 0
      ? Promise.resolve([])
      : billPaymentsIn([inArray(schema.billPayments.billId, billIds)]),
  ]);

  // 3. The documents' accrual lines, minus the control leg — that leg is
  //    precisely what cash basis replaces.
  const documentIds = [...invoiceIds, ...billIds];
  const recognitionBase = tx
    .select({
      documentId: je.sourceId,
      lineId: jl.id,
      accountId: jl.accountId,
      amountCents: jl.amountCents,
      memberId: opts.groupByDimensionType
        ? ld.memberId
        : sql<string | null>`null`.as("member_id"),
    })
    .from(jl)
    .innerJoin(je, and(eq(jl.tenantId, je.tenantId), eq(jl.entryId, je.id)));

  // Same conditional-join shape as getBalances, for the same reason: the
  // dimension join exists only when a report asked to be split by one.
  const recognitionRows = await (
    opts.groupByDimensionType
      ? recognitionBase.leftJoin(
          ld,
          and(
            eq(ld.tenantId, jl.tenantId),
            eq(ld.journalLineId, jl.id),
            eq(ld.dimensionType, opts.groupByDimensionType),
          ),
        )
      : recognitionBase
  )
    .where(
      and(
        eq(jl.tenantId, tenantId),
        eq(je.status, "posted"),
        inScope,
        inArray(je.source, ["invoice", "bill"]),
        inArray(je.sourceId, documentIds),
      ),
    )
    .orderBy(jl.lineNo);

  const substituted = opts.substitutedLineAccounts;
  const recognitionByDoc = new Map<string, RecognitionLine[]>();
  for (const row of recognitionRows) {
    if (!row.documentId) continue;
    if (controlIds.has(row.accountId)) continue; // the AR/AP leg
    const list = recognitionByDoc.get(row.documentId) ?? [];
    list.push({
      // The lens moves a line sideways in the chart. The AMOUNT is never
      // touched, which is what keeps the offset below exact.
      accountId: substituted?.get(row.lineId) ?? row.accountId,
      memberId: row.memberId ?? null,
      amountCents: row.amountCents,
    });
    recognitionByDoc.set(row.documentId, list);
  }

  // 4. The control account each payment entry actually used. Read from the
  //    entry rather than resolved by subtype a second time, so the offset can
  //    never land on a different account than the one it is cancelling.
  const inWindowEntryIds = inWindow.map((p) => p.entryId);
  const paymentLines = await tx
    .select({ entryId: jl.entryId, accountId: jl.accountId })
    .from(jl)
    .where(and(eq(jl.tenantId, tenantId), inArray(jl.entryId, inWindowEntryIds)));
  const controlOfEntry = new Map<string, string>();
  for (const line of paymentLines) {
    if (controlIds.has(line.accountId)) controlOfEntry.set(line.entryId, line.accountId);
  }

  // 5. Allocate over every payment, then keep only those the window asked for.
  const paymentsByDoc = new Map<string, DocumentPayment[]>();
  const ordered = [...allInvoicePays, ...allBillPays].sort(
    (a, b) =>
      a.paymentDate.localeCompare(b.paymentDate) || a.entryId.localeCompare(b.entryId),
  );
  for (const p of ordered) {
    const list = paymentsByDoc.get(p.documentId) ?? [];
    list.push({ paymentEntryId: p.entryId, amountCents: p.amountCents });
    paymentsByDoc.set(p.documentId, list);
  }

  const wanted = new Set(inWindowEntryIds);
  const deltas: Array<{
    accountId: string;
    memberId: string | null;
    amountCents: number;
  }> = [];

  for (const [documentId, payments] of paymentsByDoc) {
    const recognition = recognitionByDoc.get(documentId);
    if (!recognition || recognition.length === 0) continue;
    for (const allocation of allocateDocument(recognition, payments)) {
      if (!wanted.has(allocation.paymentEntryId)) continue;
      if (allocation.lines.length === 0) continue;
      const control = controlOfEntry.get(allocation.paymentEntryId);
      if (!control) continue;
      let recognised = 0;
      for (const line of allocation.lines) {
        deltas.push(line);
        recognised += line.amountCents;
      }
      // The leg that keeps the report balanced.
      deltas.push({ accountId: control, memberId: null, amountCents: -recognised });
    }
  }

  const rows = toBalanceRows(deltas);
  if (!opts.accountIds?.length) return rows;
  const wantedAccounts = new Set(opts.accountIds);
  return rows.filter((r) => wantedAccounts.has(r.accountId));
}
