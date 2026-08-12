import { describe, expect, it } from "vitest";
import {
  describeTerm,
  dueDateFromTerms,
  resolveTerm,
  MAX_DUE_IN_DAYS,
  type TermLike,
} from "../src/modules/accounting/invoicing/terms";
import { codeFromName } from "../src/modules/accounting/invoicing/payment-method-code";
import {
  DEFAULT_PAYMENT_METHODS,
  DEFAULT_PAYMENT_TERMS,
} from "../src/modules/accounting/templates/catalogue";

/**
 * The catalogue's pure half: what a payment term means, and how a method's
 * code is derived. Both are small; both are shared between the browser and the
 * server, which is exactly why they are tested rather than inlined twice.
 */

const TERMS: TermLike[] = [
  { id: "t0", name: "Due on receipt", dueInDays: 0 },
  { id: "t30", name: "Net 30", dueInDays: 30 },
  { id: "t60", name: "Net 60", dueInDays: 60 },
];

describe("payment terms", () => {
  it("computes a due date from the issue date", () => {
    expect(dueDateFromTerms("2026-08-12", 30)).toBe("2026-09-11");
    expect(dueDateFromTerms("2026-08-12", 0)).toBe("2026-08-12");
    // Month and year boundaries come from addDaysIso, which is already pinned.
    expect(dueDateFromTerms("2026-12-20", 30)).toBe("2027-01-19");
    expect(dueDateFromTerms("2024-02-01", 29)).toBe("2024-03-01");
  });

  it("prefers the customer's own terms over the tenant default", () => {
    expect(resolveTerm(TERMS, "t60", "t30")?.id).toBe("t60");
  });

  it("falls back to the default when the customer has none", () => {
    // Null on a customer means "whatever the default is", not "no terms" — so
    // changing the default moves everyone who never had an arrangement.
    expect(resolveTerm(TERMS, null, "t30")?.id).toBe("t30");
  });

  it("returns null rather than guessing when neither resolves", () => {
    expect(resolveTerm(TERMS, null, null)).toBeNull();
    // A term that has since been deleted must not resurrect as something else.
    expect(resolveTerm(TERMS, "gone", null)).toBeNull();
    expect(resolveTerm(TERMS, "gone", "t30")?.id).toBe("t30");
  });

  it("describes itself for the line under the date field", () => {
    expect(describeTerm(TERMS[1], "2026-08-12")).toBe(
      "Net 30 — due 2026-09-11 (30 days)",
    );
    expect(describeTerm(TERMS[0], "2026-08-12")).toBe(
      "Due on receipt — due 2026-08-12",
    );
    expect(describeTerm(null, "2026-08-12")).toMatch(/No terms/);
  });
});

describe("payment method codes", () => {
  it("slugs a name", () => {
    expect(codeFromName("Bank transfer")).toBe("bank_transfer");
    expect(codeFromName("  Zelle  ")).toBe("zelle");
    expect(codeFromName("Cash on delivery!")).toBe("cash_on_delivery");
  });

  it("never produces leading or trailing separators", () => {
    expect(codeFromName("!!Wise!!")).toBe("wise");
    expect(codeFromName("— dash —")).toBe("dash");
  });

  it("returns empty for a name with nothing usable, so the caller can refuse", () => {
    expect(codeFromName("!!!")).toBe("");
    expect(codeFromName("   ")).toBe("");
  });
});

describe("seeded defaults", () => {
  it("seeds exactly the five codes invoice_payments already holds", () => {
    // These were a zod enum written straight into a text column, so every
    // payment ever recorded holds one of them. Seeding the same codes is what
    // keeps historic payments rendering as names instead of bare slugs.
    expect(DEFAULT_PAYMENT_METHODS.map((m) => m.code).sort()).toEqual([
      "bank_transfer",
      "card",
      "cash",
      "check",
      "other",
    ]);
  });

  it("offers exactly one default term, and it is within the schema's range", () => {
    const defaults = DEFAULT_PAYMENT_TERMS.filter((t) => t.isDefault);
    expect(defaults).toHaveLength(1);
    expect(defaults[0].name).toBe("Net 30");
    for (const t of DEFAULT_PAYMENT_TERMS) {
      expect(t.dueInDays).toBeGreaterThanOrEqual(0);
      expect(t.dueInDays).toBeLessThanOrEqual(MAX_DUE_IN_DAYS);
    }
  });
});
