import { describe, expect, it } from "vitest";
import { renderInvoicePdf } from "../src/modules/accounting/invoicing/invoice-pdf";
import type { InvoicePdfInput } from "../src/modules/accounting/invoicing/invoice-pdf-model";

/**
 * Actually render one. No database — this is the check that the font files are
 * where the loader thinks they are and that react-pdf can resolve every face.
 *
 * It exists because that failure mode is invisible until request time: the
 * fonts moved to `src/lib/pdf/fonts` when Accounting started generating PDFs,
 * and a missing face makes react-pdf throw "Could not resolve font for
 * NotoSans" rather than quietly substituting one.
 */

const base: InvoicePdfInput = {
  businessName: "Upward Real Estate LLC",
  invoiceNumber: "INV-1080",
  status: "issued",
  issueDate: "2026-08-01",
  dueDate: "2026-08-31",
  memo: "Thanks for your business.",
  totalCents: 175_000,
  paidCents: 40_000,
  customerName: "JB's Flappers LLC",
  customerAddress: "17 Main St\nMount Vernon, OH 43050",
  customerEmail: "ap@example.com",
  lines: [
    { description: "Monthly Rent", quantity: "1.00", unitPriceCents: 175_000, amountCents: 175_000 },
  ],
};

describe("renderInvoicePdf", () => {
  it("produces a real PDF", async () => {
    const bytes = await renderInvoicePdf(base);
    expect(bytes.length).toBeGreaterThan(1000);
    // Every PDF starts with this signature; anything else is not a document.
    expect(Buffer.from(bytes.slice(0, 5)).toString("latin1")).toBe("%PDF-");
  });

  it("renders non-Latin names, which is why NotoSans is registered at all", async () => {
    const bytes = await renderInvoicePdf({
      ...base,
      customerName: "Nguyễn Đặng Ltd",
      lines: [
        { description: "Łukasz — Öztürk", quantity: "2.50", unitPriceCents: 1000, amountCents: 2500 },
      ],
    });
    expect(Buffer.from(bytes.slice(0, 5)).toString("latin1")).toBe("%PDF-");
  });

  it("renders a void invoice, which reaches the bold face via the watermark", async () => {
    const bytes = await renderInvoicePdf({ ...base, status: "void" });
    expect(Buffer.from(bytes.slice(0, 5)).toString("latin1")).toBe("%PDF-");
  });

  it("renders an invoice with no lines and no due date without throwing", async () => {
    const bytes = await renderInvoicePdf({
      ...base,
      dueDate: null,
      memo: "",
      paidCents: 0,
      totalCents: 0,
      lines: [],
    });
    expect(Buffer.from(bytes.slice(0, 5)).toString("latin1")).toBe("%PDF-");
  });
});
