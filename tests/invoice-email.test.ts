import { describe, expect, it } from "vitest";
import {
  buildInvoiceEmail,
  invoiceSendIdempotencyKey,
  invoiceSendKeyPrefix,
  type InvoiceEmailInput,
} from "../src/modules/accounting/invoicing/invoice-email";

const ID = "11111111-1111-1111-1111-111111111111";

function input(over: Partial<InvoiceEmailInput> = {}): InvoiceEmailInput {
  return {
    businessName: "Upward Real Estate LLC",
    invoiceNumber: "INV-1080",
    customerName: "JB's Flappers LLC",
    totalCents: 175_000,
    balanceCents: 175_000,
    dueDate: "2026-08-31",
    memo: "",
    ...over,
  };
}

describe("invoiceSendIdempotencyKey", () => {
  it("is stable for the same invoice and recipient", () => {
    expect(invoiceSendIdempotencyKey(ID, "ap@example.com")).toBe(
      invoiceSendIdempotencyKey(ID, "ap@example.com"),
    );
  });

  it("ignores case and surrounding space — the same address is the same send", () => {
    expect(invoiceSendIdempotencyKey(ID, "  AP@Example.com ")).toBe(
      invoiceSendIdempotencyKey(ID, "ap@example.com"),
    );
  });

  it("differs by recipient, so a corrected address is a real second send", () => {
    expect(invoiceSendIdempotencyKey(ID, "ap@example.com")).not.toBe(
      invoiceSendIdempotencyKey(ID, "billing@example.com"),
    );
  });

  it("differs by invoice", () => {
    const other = "22222222-2222-2222-2222-222222222222";
    expect(invoiceSendIdempotencyKey(ID, "ap@example.com")).not.toBe(
      invoiceSendIdempotencyKey(other, "ap@example.com"),
    );
  });

  it("starts with the prefix the UI matches on", () => {
    const key = invoiceSendIdempotencyKey(ID, "ap@example.com");
    expect(key.startsWith(invoiceSendKeyPrefix(ID))).toBe(true);
    // A uuid cannot contain a colon, so the prefix cannot straddle two invoices.
    expect(invoiceSendKeyPrefix(ID)).toBe(`invoice:${ID}:`);
  });
});

describe("buildInvoiceEmail", () => {
  it("puts the number and the business in the subject — that is what people search", () => {
    const e = buildInvoiceEmail(input());
    expect(e.subject).toBe("Invoice INV-1080 from Upward Real Estate LLC");
  });

  it("states the amount still owed, not the invoice total", () => {
    const e = buildInvoiceEmail(input({ balanceCents: 75_000 }));
    expect(e.text).toContain("750.00");
    expect(e.text).not.toContain("1,750.00");
  });

  it("includes the due date when there is one and says nothing when there is not", () => {
    expect(buildInvoiceEmail(input()).text).toContain("Due 2026-08-31.");
    expect(buildInvoiceEmail(input({ dueDate: null })).text).not.toContain("Due");
  });

  it("passes the owner's memo through, and omits an empty one", () => {
    expect(buildInvoiceEmail(input({ memo: "  Rent for August  " })).text).toContain(
      "Rent for August",
    );
    const blank = buildInvoiceEmail(input({ memo: "   " }));
    expect(blank.text).not.toContain("  \n  \n");
  });

  it("escapes HTML — a customer name is untrusted text in an HTML email", () => {
    const e = buildInvoiceEmail(
      input({ customerName: 'Bob & Sons <script>alert("x")</script>' }),
    );
    expect(e.html).not.toContain("<script>");
    expect(e.html).toContain("&lt;script&gt;");
    expect(e.html).toContain("Bob &amp; Sons");
    // The plain-text part is not markup and is left alone.
    expect(e.text).toContain("Bob & Sons");
  });

  it("escapes the business name and memo too", () => {
    const e = buildInvoiceEmail(
      input({ businessName: "A & B <Ltd>", memo: "5 > 3 & <b>bold</b>" }),
    );
    expect(e.html).toContain("A &amp; B &lt;Ltd&gt;");
    expect(e.html).not.toContain("<b>bold</b>");
  });

  it("names the attachment after the invoice, with unsafe characters removed", () => {
    expect(buildInvoiceEmail(input()).attachmentFilename).toBe("invoice-INV-1080.pdf");
    expect(
      buildInvoiceEmail(input({ invoiceNumber: "INV/2026 #7" })).attachmentFilename,
    ).toBe("invoice-INV-2026--7.pdf");
  });

  it("greets without a name rather than printing an empty greeting", () => {
    const e = buildInvoiceEmail(input({ customerName: "   " }));
    expect(e.text.startsWith("Hi,")).toBe(true);
    expect(e.html).toContain("<p>Hi,</p>");
  });
});
