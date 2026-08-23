import { describe, expect, it } from "vitest";
import {
  describeTaxRate,
  formatRatePpm,
  invoiceTaxTotals,
  parseRatePercentToPpm,
  resolveTaxRate,
  taxCentsFor,
  MAX_RATE_PPM,
} from "@/modules/accounting/invoicing/tax";
import { computeLineAmounts } from "@/modules/accounting/invoicing/lines";
import {
  buildTaxSummary,
  type TaxSummaryInvoice,
} from "@/modules/accounting/core/tax-summary";
import {
  pnlSectionFor,
  bsGroupFor,
} from "@/modules/accounting/core/report-builders";
import type { Account } from "@/db/schema";

/**
 * Sales tax — the pure half. Everything that decides a number lives in
 * `invoicing/tax.ts` and `core/tax-summary.ts`, which is what makes this file
 * possible without a database.
 *
 * The DB-backed half (posting, freezing, the P&L exclusion end to end) is in
 * tests/sales-tax-db.test.ts.
 */

describe("parseRatePercentToPpm", () => {
  it("reads a plain percentage", () => {
    expect(parseRatePercentToPpm("7.25")).toBe(72_500);
    expect(parseRatePercentToPpm("7")).toBe(70_000);
    expect(parseRatePercentToPpm("0")).toBe(0);
  });

  it("reads the four-decimal rates basis points cannot express", () => {
    // 8.875% is 887.5 basis points — not an integer, which is why the column
    // is ppm. This is the case that decided the unit.
    expect(parseRatePercentToPpm("8.875")).toBe(88_750);
    expect(parseRatePercentToPpm("7.3750")).toBe(73_750);
  });

  it("tolerates a trailing percent sign and whitespace", () => {
    expect(parseRatePercentToPpm(" 6.5% ")).toBe(65_000);
  });

  it("refuses anything else", () => {
    expect(parseRatePercentToPpm("")).toBeNull();
    expect(parseRatePercentToPpm("abc")).toBeNull();
    expect(parseRatePercentToPpm("-5")).toBeNull();
    expect(parseRatePercentToPpm("7.123456")).toBeNull();
    // Over 100% — somebody typing 725 meaning 7.25%.
    expect(parseRatePercentToPpm("725")).toBeNull();
  });

  it("accepts exactly 100%", () => {
    expect(parseRatePercentToPpm("100")).toBe(MAX_RATE_PPM);
  });
});

describe("formatRatePpm", () => {
  it("round-trips and trims trailing zeros", () => {
    expect(formatRatePpm(72_500)).toBe("7.25");
    expect(formatRatePpm(70_000)).toBe("7");
    expect(formatRatePpm(88_750)).toBe("8.875");
    expect(formatRatePpm(0)).toBe("0");
  });

  it("does not claim precision nobody entered", () => {
    // "7.2500%" on an invoice reads as four significant decimals.
    expect(describeTaxRate("State", 72_500)).toBe("State (7.25%)");
  });
});

describe("taxCentsFor", () => {
  it("computes the ordinary case", () => {
    // $100.00 at 7.25% = $7.25
    expect(taxCentsFor(10_000, 72_500)).toBe(725);
  });

  it("rounds half away from zero", () => {
    // $0.10 at 5% = 0.5 cents → 1 cent.
    expect(taxCentsFor(10, 50_000)).toBe(1);
    // $0.10 at 4.9% = 0.49 cents → 0.
    expect(taxCentsFor(10, 49_000)).toBe(0);
  });

  it("is exact at amounts that would lose precision in floats", () => {
    // 0.1 + 0.2 arithmetic has no way in here: this is integer/BigInt only.
    expect(taxCentsFor(1_999_999, 88_750)).toBe(
      Math.round((1_999_999 * 88_750) / 1_000_000),
    );
  });

  it("stays exact past Number.MAX_SAFE_INTEGER in the intermediate", () => {
    // taxable × ppm here is ~1e19, which is why the multiply is BigInt. The
    // naive Number version of this returns a wrong (but plausible) figure.
    const taxable = 10_000_000_000_000; // MAX_AMOUNT_CENTS
    expect(taxable * 72_500).toBeGreaterThan(Number.MAX_SAFE_INTEGER);
    expect(taxCentsFor(taxable, 72_500)).toBe(725_000_000_000);
  });

  it("is sign-safe", () => {
    expect(taxCentsFor(-10_000, 72_500)).toBe(-725);
  });

  it("is zero when either input is", () => {
    expect(taxCentsFor(0, 72_500)).toBe(0);
    expect(taxCentsFor(10_000, 0)).toBe(0);
  });
});

describe("invoiceTaxTotals", () => {
  const line = (amountCents: number, isTaxable: boolean) => ({
    amountCents,
    isTaxable,
  });

  it("taxes only the taxable lines", () => {
    // The case the per-line flag exists for: taxed materials, exempt labour.
    const totals = invoiceTaxTotals(
      [line(50_000, true), line(100_000, false)],
      72_500,
    );
    expect(totals.subtotalCents).toBe(150_000);
    expect(totals.taxableCents).toBe(50_000);
    expect(totals.exemptCents).toBe(100_000);
    expect(totals.taxCents).toBe(3_625);
    expect(totals.totalCents).toBe(153_625);
  });

  it("rounds ONCE on the summed base, not per line", () => {
    // Three lines of $0.10 at 5%: per-line rounding gives 1+1+1 = 3 cents,
    // which does not equal 5% of $0.30. Rounding the sum gives 2.
    const perInvoice = invoiceTaxTotals(
      [line(10, true), line(10, true), line(10, true)],
      50_000,
    );
    expect(perInvoice.taxCents).toBe(2);
    const perLine = 3 * taxCentsFor(10, 50_000);
    expect(perLine).toBe(3);
    expect(perInvoice.taxCents).not.toBe(perLine);
    // And the invoice total equals rate × base, which is the check a customer
    // does with a calculator and the figure a return asks for.
    expect(perInvoice.taxCents).toBe(taxCentsFor(30, 50_000));
  });

  it("treats a null rate as no tax, not a zero rate", () => {
    const totals = invoiceTaxTotals([line(50_000, true)], null);
    expect(totals.taxCents).toBe(0);
    expect(totals.totalCents).toBe(50_000);
    // Everything is exempt, and nothing is reported as a taxable sale — a line
    // ticked taxable on an invoice with no rate charged nothing.
    expect(totals.taxableCents).toBe(0);
    expect(totals.exemptCents).toBe(50_000);
  });

  it("a zero rate still marks the base as taxable", () => {
    // A named 0% rate is a real thing (a zero-rated category), and its sales
    // belong in the taxable column of a return, not the exempt one.
    const totals = invoiceTaxTotals([line(50_000, true)], 0);
    expect(totals.taxCents).toBe(0);
    expect(totals.taxableCents).toBe(50_000);
    expect(totals.exemptCents).toBe(0);
  });

  it("total is always subtotal + tax", () => {
    for (const rate of [0, 50_000, 72_500, 88_750, MAX_RATE_PPM]) {
      const totals = invoiceTaxTotals(
        [line(12_345, true), line(6_789, false), line(-1_000, true)],
        rate,
      );
      expect(totals.totalCents).toBe(totals.subtotalCents + totals.taxCents);
      expect(totals.taxableCents + totals.exemptCents).toBe(totals.subtotalCents);
    }
  });

  it("handles an empty line list", () => {
    const totals = invoiceTaxTotals([], 72_500);
    expect(totals).toEqual({
      subtotalCents: 0,
      taxableCents: 0,
      exemptCents: 0,
      taxCents: 0,
      totalCents: 0,
    });
  });
});

describe("computeLineAmounts carries taxability", () => {
  it("normalizes an absent flag to false", () => {
    const [a, b] = computeLineAmounts([
      {
        description: "Materials",
        quantity: "2",
        unitPriceCents: 5_000,
        incomeAccountId: "00000000-0000-0000-0000-000000000001",
        isTaxable: true,
      },
      {
        description: "Labour",
        quantity: "1",
        unitPriceCents: 20_000,
        incomeAccountId: "00000000-0000-0000-0000-000000000001",
      },
    ]);
    expect(a.amountCents).toBe(10_000);
    expect(a.isTaxable).toBe(true);
    expect(b.isTaxable).toBe(false);
  });
});

describe("resolveTaxRate", () => {
  const rates = [
    { id: "r1", name: "State", ratePpm: 72_500 },
    { id: "r2", name: "City", ratePpm: 15_000 },
  ];

  it("returns the tenant default", () => {
    expect(resolveTaxRate(rates, "r2")?.name).toBe("City");
  });

  it("returns null with no default set", () => {
    expect(resolveTaxRate(rates, null)).toBeNull();
  });

  it("returns null when the default names a rate that is not offered", () => {
    // A deactivated default: the list passed in is the ACTIVE one, so the id
    // resolves to nothing and the invoice gets no rate rather than a retired
    // one.
    expect(resolveTaxRate(rates, "gone")).toBeNull();
  });
});

describe("buildTaxSummary", () => {
  const invoice = (over: Partial<TaxSummaryInvoice>): TaxSummaryInvoice => ({
    taxRateId: "r1",
    taxRatePpm: 72_500,
    taxableCents: 10_000,
    exemptCents: 0,
    taxCents: 725,
    status: "issued",
    ...over,
  });
  const names = [
    { id: "r1", name: "State" },
    { id: "r2", name: "City" },
  ];
  const window = { from: "2026-01-01", to: "2026-01-31", liabilityCents: null };

  it("groups by rate and totals", () => {
    const report = buildTaxSummary(
      [
        invoice({}),
        invoice({}),
        invoice({ taxRateId: "r2", taxRatePpm: 15_000, taxCents: 150 }),
      ],
      names,
      window,
    );
    expect(report.rows).toHaveLength(2);
    const state = report.rows.find((r) => r.rateId === "r1")!;
    expect(state.invoiceCount).toBe(2);
    expect(state.taxCents).toBe(1_450);
    expect(state.taxableCents).toBe(20_000);
    expect(report.totals.taxCents).toBe(1_600);
  });

  it("excludes drafts and voids", () => {
    // Neither charges a customer anything, and a voided invoice's ledger
    // effect has been removed — counting it would overstate a return.
    const report = buildTaxSummary(
      [invoice({ status: "draft" }), invoice({ status: "void" })],
      names,
      window,
    );
    expect(report.rows).toHaveLength(0);
    expect(report.totals.taxCents).toBe(0);
  });

  it("counts partial and paid", () => {
    // Accrual: the liability arose when the invoice was issued, whatever the
    // customer has since paid.
    const report = buildTaxSummary(
      [invoice({ status: "partial" }), invoice({ status: "paid" })],
      names,
      window,
    );
    expect(report.rows[0].invoiceCount).toBe(2);
  });

  it("keeps untaxed invoices as an exempt row rather than dropping them", () => {
    const report = buildTaxSummary(
      [
        invoice({}),
        invoice({
          taxRateId: null,
          taxRatePpm: 0,
          taxableCents: 0,
          exemptCents: 40_000,
          taxCents: 0,
        }),
      ],
      names,
      window,
    );
    const noTax = report.rows.find((r) => r.rateId === null)!;
    expect(noTax.name).toBe("No tax");
    expect(noTax.exemptCents).toBe(40_000);
    // "No tax" sorts last so the rates a return asks about read first.
    expect(report.rows.at(-1)!.rateId).toBeNull();
  });

  it("reports a taxable-flagged line on a rate-less invoice as exempt", () => {
    // It charged nothing, so calling it a taxable sale would overstate the
    // base on a return.
    const report = buildTaxSummary(
      [invoice({ taxRateId: null, taxableCents: 10_000, exemptCents: 0, taxCents: 0 })],
      names,
      window,
    );
    expect(report.rows[0].taxableCents).toBe(0);
    expect(report.rows[0].exemptCents).toBe(10_000);
  });

  it("states the difference against the ledger", () => {
    const report = buildTaxSummary([invoice({})], names, {
      ...window,
      liabilityCents: 2_000,
    });
    expect(report.totals.taxCents).toBe(725);
    expect(report.differenceCents).toBe(1_275);
  });

  it("has no difference to state when there is no tax account", () => {
    const report = buildTaxSummary([invoice({})], names, window);
    expect(report.liabilityCents).toBeNull();
    expect(report.differenceCents).toBeNull();
  });

  it("names a rate it was not given a name for, rather than blanking it", () => {
    const report = buildTaxSummary([invoice({ taxRateId: "r9" })], names, window);
    expect(report.rows[0].name).toBe("Unknown rate");
  });
});

describe("the sales tax account never reaches the P&L", () => {
  const account = (over: Partial<Account>): Account =>
    ({
      id: "a1",
      tenantId: "t1",
      code: "2200",
      name: "Sales Tax Payable",
      accountType: "liability",
      subtype: "sales_tax",
      parentId: null,
      description: "",
      isActive: true,
      isSystem: true,
      ...over,
    }) as Account;

  it("is excluded from every P&L section", () => {
    // Tax collected is money held for a tax authority, not income. Nothing
    // today would notice if somebody added `sales_tax` to
    // PNL_SECTION_BY_SUBTYPE, which is exactly why this is pinned.
    expect(pnlSectionFor(account({}))).toBeNull();
  });

  it("is a current liability on the balance sheet", () => {
    expect(bsGroupFor(account({}))).toBe("current_liabilities");
  });

  it("stays off the P&L even under a renamed or renumbered account", () => {
    // The subtype is what decides, never the code — a tenant may renumber.
    expect(pnlSectionFor(account({ code: "2410", name: "State tax held" }))).toBeNull();
  });
});
