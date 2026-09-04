import { describe, expect, it } from "vitest";
import {
  buildInvoicePdfModel,
  formatQuantity,
  INVOICE_INK,
  INVOICE_LOGO_BOX,
  type InvoicePdfInput,
} from "../src/modules/accounting/invoicing/invoice-pdf-model";

/**
 * What appears on the printed invoice. The renderer is layout only, so every
 * decision worth testing is here — and an invoice is a document somebody pays
 * from, so "DRAFT" and the balance are not cosmetic.
 */

function input(over: Partial<InvoicePdfInput> = {}): InvoicePdfInput {
  return {
    businessName: "Upward Real Estate LLC",
    invoiceNumber: "INV-1080",
    status: "issued",
    issueDate: "2026-08-01",
    dueDate: "2026-08-31",
    memo: "",
    totalCents: 175_000,
    paidCents: 0,
    customerName: "JB's Flappers LLC",
    customerAddress: "",
    customerEmail: "",
    lines: [
      {
        description: "Monthly Rent",
        quantity: "1.00",
        unitPriceCents: 175_000,
        amountCents: 175_000,
      },
    ],
    ...over,
  };
}

describe("formatQuantity", () => {
  it("drops noise from whole numbers and keeps real decimals", () => {
    expect(formatQuantity("1.00")).toBe("1");
    expect(formatQuantity("12.00")).toBe("12");
    expect(formatQuantity("2.50")).toBe("2.5");
    expect(formatQuantity("0.25")).toBe("0.25");
  });

  it("passes through anything it cannot read rather than inventing a number", () => {
    expect(formatQuantity("")).toBe("");
    expect(formatQuantity("n/a")).toBe("n/a");
  });
});

describe("buildInvoicePdfModel", () => {
  it("formats money as cents-derived strings", () => {
    const m = buildInvoicePdfModel(input());
    expect(m.total).toBe("1,750.00");
    expect(m.balance).toBe("1,750.00");
    expect(m.rows[0]).toMatchObject({
      description: "Monthly Rent",
      quantity: "1",
      unitPrice: "1,750.00",
      amount: "1,750.00",
    });
  });

  it("says DRAFT on a draft — a document that does not is one that gets paid twice", () => {
    expect(buildInvoicePdfModel(input({ status: "draft" })).title).toBe(
      "DRAFT INVOICE",
    );
    expect(buildInvoicePdfModel(input({ status: "issued" })).title).toBe("INVOICE");
    expect(buildInvoicePdfModel(input({ status: "paid" })).title).toBe("INVOICE");
  });

  it("watermarks a void invoice and nothing else", () => {
    expect(buildInvoicePdfModel(input({ status: "void" })).watermark).toBe("VOID");
    expect(buildInvoicePdfModel(input({ status: "issued" })).watermark).toBeNull();
  });

  it("shows payments and the remaining balance only once something is paid", () => {
    const unpaid = buildInvoicePdfModel(input());
    expect(unpaid.showPayments).toBe(false);

    const part = buildInvoicePdfModel(input({ paidCents: 75_000 }));
    expect(part.showPayments).toBe(true);
    expect(part.paid).toBe("750.00");
    expect(part.balance).toBe("1,000.00");

    const full = buildInvoicePdfModel(input({ paidCents: 175_000 }));
    expect(full.balance).toBe("0.00");
  });

  it("builds bill-to from the parts that exist, splitting multi-line addresses", () => {
    const m = buildInvoicePdfModel(
      input({
        customerName: "JB's Flappers LLC",
        customerAddress: "17 Main St\nMount Vernon, OH 43050",
        customerEmail: "ap@example.com",
      }),
    );
    expect(m.billTo).toEqual([
      "JB's Flappers LLC",
      "17 Main St",
      "Mount Vernon, OH 43050",
      "ap@example.com",
    ]);
  });

  it("omits blank bill-to parts rather than printing empty lines", () => {
    const m = buildInvoicePdfModel(
      input({ customerAddress: "", customerEmail: "  " }),
    );
    expect(m.billTo).toEqual(["JB's Flappers LLC"]);
  });

  it("keeps a zero-amount line that says something, drops one that says nothing", () => {
    const m = buildInvoicePdfModel(
      input({
        lines: [
          { description: "Rent", quantity: "1", unitPriceCents: 1000, amountCents: 1000 },
          { description: "Included at no charge", quantity: "1", unitPriceCents: 0, amountCents: 0 },
          { description: "   ", quantity: "0", unitPriceCents: 0, amountCents: 0 },
        ],
      }),
    );
    expect(m.rows.map((r) => r.description)).toEqual([
      "Rent",
      "Included at no charge",
    ]);
  });

  it("carries a negative line (a discount) through with its sign readable", () => {
    const m = buildInvoicePdfModel(
      input({
        totalCents: 90_000,
        lines: [
          { description: "Rent", quantity: "1", unitPriceCents: 100_000, amountCents: 100_000 },
          { description: "Discount", quantity: "1", unitPriceCents: -10_000, amountCents: -10_000 },
        ],
      }),
    );
    expect(m.rows).toHaveLength(2);
    expect(m.total).toBe("900.00");
  });

  it("omits an absent due date rather than printing a placeholder", () => {
    expect(buildInvoicePdfModel(input({ dueDate: null })).dueDate).toBeNull();
  });

  it("trims the memo and treats whitespace as absent", () => {
    expect(buildInvoicePdfModel(input({ memo: "  Thanks!  " })).memo).toBe("Thanks!");
    expect(buildInvoicePdfModel(input({ memo: "   " })).memo).toBe("");
  });
});

/**
 * The brand kit on the document. No kit must render exactly the invoice this
 * file rendered before the kit existed — the fallbacks are the contract.
 */
describe("buildInvoicePdfModel — brand", () => {
  const png = new Uint8Array([1, 2, 3]);

  it("with no brand: the ink, no tagline, no logo", () => {
    const m = buildInvoicePdfModel(input());
    expect(m.titleColor).toBe(INVOICE_INK);
    expect(m.ruleColor).toBe(INVOICE_INK);
    expect(m.tagline).toBe("");
    expect(m.logo).toBeNull();
  });

  it("a readable brand colour colours the heading and the rules", () => {
    const m = buildInvoicePdfModel(
      input({ brand: { tagline: " Grass-fed since 1998 ", primaryColor: "#1f6f5f", logo: null } }),
    );
    expect(m.titleColor).toBe("#1f6f5f");
    expect(m.ruleColor).toBe("#1f6f5f");
    expect(m.tagline).toBe("Grass-fed since 1998");
  });

  it("a pale brand colour keeps the rules and hands the heading back to the ink", () => {
    const m = buildInvoicePdfModel(
      input({ brand: { tagline: "", primaryColor: "#ffe066", logo: null } }),
    );
    expect(m.titleColor).toBe(INVOICE_INK);
    expect(m.ruleColor).toBe("#ffe066");
  });

  it("fits the logo into its box without distorting it, and keeps its format", () => {
    const m = buildInvoicePdfModel(
      input({
        brand: {
          tagline: "",
          primaryColor: null,
          logo: { data: png, width: 800, height: 200, format: "jpg" },
        },
      }),
    );
    expect(m.logo).toEqual({
      data: png,
      format: "jpg",
      width: INVOICE_LOGO_BOX.width,
      height: INVOICE_LOGO_BOX.width / 4,
    });
  });
});
