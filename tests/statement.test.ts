import { describe, expect, it } from "vitest";
import {
  buildCustomerStatement,
  type StatementInvoice,
  type StatementPayment,
} from "../src/modules/accounting/invoicing/statement";

const inv = (
  n: number,
  issueDate: string,
  totalCents: number,
  extra: Partial<StatementInvoice> = {},
): StatementInvoice => ({
  id: `inv-${n}`,
  invoiceNumber: `INV-${String(n).padStart(4, "0")}`,
  issueDate,
  dueDate: null,
  totalCents,
  status: "issued",
  entityId: "co-1",
  ...extra,
});

const pay = (
  invoiceId: string,
  paymentDate: string,
  amountCents: number,
  extra: Partial<StatementPayment> = {},
): StatementPayment => ({
  id: `pay-${invoiceId}-${paymentDate}`,
  invoiceId,
  paymentDate,
  amountCents,
  method: "check",
  memo: "",
  ...extra,
});

describe("buildCustomerStatement", () => {
  const invoices = [
    inv(1, "2026-07-10", 50_000, { dueDate: "2026-08-09", status: "paid" }),
    inv(2, "2026-08-03", 30_000, { dueDate: "2026-09-02", status: "partial" }),
    inv(3, "2026-08-20", 12_000, { dueDate: "2026-09-19" }),
    inv(4, "2026-08-20", 8_000),
    inv(9, "2026-08-25", 99_000, { status: "draft" }),
    inv(8, "2026-08-26", 77_000, { status: "void" }),
  ];
  const payments = [
    pay("inv-1", "2026-07-30", 50_000),
    pay("inv-2", "2026-08-03", 10_000, { method: "bank_transfer", memo: "Deposit" }),
    pay("inv-2", "2026-09-05", 5_000),
  ];

  it("carries the balance forward, runs the period's lines in order, and closes", () => {
    const s = buildCustomerStatement(invoices, payments, "2026-08-01", "2026-08-31");
    // INV-0001 was issued and fully paid before August.
    expect(s.forwardCents).toBe(0);
    expect(s.lines.map((l) => [l.date, l.kind, l.invoiceNumber, l.balanceCents])).toEqual([
      ["2026-08-03", "invoice", "INV-0002", 30_000],
      ["2026-08-03", "payment", "INV-0002", 20_000],
      ["2026-08-20", "invoice", "INV-0003", 32_000],
      ["2026-08-20", "invoice", "INV-0004", 40_000],
    ]);
    expect(s.lines[1].detail).toBe("Payment · bank transfer · Deposit");
    expect(s.lines[2].detail).toBe("Invoice · due 2026-09-19");
    expect(s.chargesCents).toBe(50_000);
    expect(s.paymentsCents).toBe(10_000);
    expect(s.closingCents).toBe(40_000);
    // Drafts and void invoices are not claims.
    expect(s.lines.some((l) => l.invoiceNumber === "INV-0009" || l.invoiceNumber === "INV-0008")).toBe(false);
  });

  it("lists the open invoices that make up the closing balance, as of the end date, oldest due first", () => {
    const s = buildCustomerStatement(invoices, payments, "2026-08-01", "2026-08-31");
    expect(s.openInvoices.map((i) => [i.invoiceNumber, i.balanceCents])).toEqual([
      ["INV-0002", 20_000],
      ["INV-0003", 12_000],
      ["INV-0004", 8_000],
    ]);
    expect(s.openInvoices.reduce((t, i) => t + i.balanceCents, 0)).toBe(s.closingCents);
    // The September payment does not count in an August statement…
    const september = buildCustomerStatement(invoices, payments, "2026-09-01", "2026-09-30");
    // …but it opens September's balance forward at August's close.
    expect(september.forwardCents).toBe(40_000);
    expect(september.lines.map((l) => [l.kind, l.paymentCents])).toEqual([["payment", 5_000]]);
    expect(september.closingCents).toBe(35_000);
    expect(september.openInvoices.find((i) => i.invoiceNumber === "INV-0002")?.balanceCents).toBe(15_000);
  });

  it("is empty and owes nothing for a customer with no history", () => {
    const s = buildCustomerStatement([], [], "2026-08-01", "2026-08-31");
    expect(s).toMatchObject({
      forwardCents: 0,
      lines: [],
      chargesCents: 0,
      paymentsCents: 0,
      closingCents: 0,
      openInvoices: [],
    });
  });
});
