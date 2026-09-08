/**
 * A customer's statement — pure, no database, no `server-only`.
 *
 * The page a bookkeeper sends at month end: what the customer owed coming
 * into the period, every invoice and payment inside it with a running
 * balance, what they owe going out, and the invoices that make up that
 * figure. Built from the rows the page loads so a test can pin the
 * arithmetic without a database.
 *
 * Drafts and void invoices are not on a statement: a draft is not yet a
 * claim and a void one never was. Payments only ever exist on issued
 * invoices, so nothing else needs excluding.
 */

export interface StatementInvoice {
  id: string;
  invoiceNumber: string;
  issueDate: string;
  dueDate: string | null;
  totalCents: number;
  status: string;
  entityId: string;
}

export interface StatementPayment {
  id: string;
  invoiceId: string;
  paymentDate: string;
  amountCents: number;
  method: string;
  memo: string;
}

export interface StatementLine {
  date: string;
  kind: "invoice" | "payment";
  invoiceId: string;
  /** `INV-0009`, on both the charge and the payment against it. */
  invoiceNumber: string;
  entityId: string;
  /** "Invoice · due 2026-10-01" or "Payment · check · memo". */
  detail: string;
  chargeCents: number;
  paymentCents: number;
  /** After this line. */
  balanceCents: number;
}

export interface OpenInvoice {
  invoiceId: string;
  invoiceNumber: string;
  issueDate: string;
  dueDate: string | null;
  totalCents: number;
  balanceCents: number;
  entityId: string;
}

export interface CustomerStatement {
  from: string;
  to: string;
  /** What was owed the day before `from`. */
  forwardCents: number;
  lines: StatementLine[];
  chargesCents: number;
  paymentsCents: number;
  /** What is owed at the end of `to`: forward + charges − payments. */
  closingCents: number;
  /** The invoices that make up the closing balance, oldest due first. */
  openInvoices: OpenInvoice[];
}

const ON_STATEMENT = new Set(["issued", "partial", "paid"]);

export function buildCustomerStatement(
  invoices: readonly StatementInvoice[],
  payments: readonly StatementPayment[],
  from: string,
  to: string,
): CustomerStatement {
  const counted = invoices.filter((i) => ON_STATEMENT.has(i.status));
  const byId = new Map(counted.map((i) => [i.id, i]));
  const countedPayments = payments.filter((p) => byId.has(p.invoiceId));

  const forwardCents =
    counted.filter((i) => i.issueDate < from).reduce((s, i) => s + i.totalCents, 0) -
    countedPayments.filter((p) => p.paymentDate < from).reduce((s, p) => s + p.amountCents, 0);

  type Raw = Omit<StatementLine, "balanceCents"> & { order: number };
  const raw: Raw[] = [];
  for (const i of counted) {
    if (i.issueDate < from || i.issueDate > to) continue;
    raw.push({
      date: i.issueDate,
      kind: "invoice",
      invoiceId: i.id,
      invoiceNumber: i.invoiceNumber,
      entityId: i.entityId,
      detail: i.dueDate ? `Invoice · due ${i.dueDate}` : "Invoice",
      chargeCents: i.totalCents,
      paymentCents: 0,
      order: 0,
    });
  }
  for (const p of countedPayments) {
    if (p.paymentDate < from || p.paymentDate > to) continue;
    const invoice = byId.get(p.invoiceId)!;
    raw.push({
      date: p.paymentDate,
      kind: "payment",
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      entityId: invoice.entityId,
      // A credit memo settles like a payment (see the credit_memos table) but
      // is not money received, and the statement says which it was. Its
      // payment memo already carries the memo's number and reason.
      detail:
        p.method === "credit_memo"
          ? `Credit memo${p.memo ? ` · ${p.memo}` : ""}`
          : `Payment · ${p.method.replaceAll("_", " ")}${p.memo ? ` · ${p.memo}` : ""}`,
      chargeCents: 0,
      paymentCents: p.amountCents,
      order: 1,
    });
  }
  // By date; on one date the charge before the payment against it, then by
  // number so two invoices issued the same day keep their sequence.
  raw.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      a.order - b.order ||
      a.invoiceNumber.localeCompare(b.invoiceNumber),
  );

  let balance = forwardCents;
  const lines: StatementLine[] = raw.map((r) => {
    balance += r.chargeCents - r.paymentCents;
    const { order: _order, ...rest } = r;
    void _order;
    return { ...rest, balanceCents: balance };
  });
  const chargesCents = lines.reduce((s, l) => s + l.chargeCents, 0);
  const paymentsCents = lines.reduce((s, l) => s + l.paymentCents, 0);

  const paidByInvoice = new Map<string, number>();
  for (const p of countedPayments) {
    if (p.paymentDate > to) continue;
    paidByInvoice.set(p.invoiceId, (paidByInvoice.get(p.invoiceId) ?? 0) + p.amountCents);
  }
  const openInvoices: OpenInvoice[] = counted
    .filter((i) => i.issueDate <= to)
    .map((i) => ({
      invoiceId: i.id,
      invoiceNumber: i.invoiceNumber,
      issueDate: i.issueDate,
      dueDate: i.dueDate,
      totalCents: i.totalCents,
      balanceCents: i.totalCents - (paidByInvoice.get(i.id) ?? 0),
      entityId: i.entityId,
    }))
    .filter((i) => i.balanceCents > 0)
    .sort(
      (a, b) =>
        (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999") ||
        a.issueDate.localeCompare(b.issueDate),
    );

  return {
    from,
    to,
    forwardCents,
    lines,
    chargesCents,
    paymentsCents,
    closingCents: forwardCents + chargesCents - paymentsCents,
    openInvoices,
  };
}
