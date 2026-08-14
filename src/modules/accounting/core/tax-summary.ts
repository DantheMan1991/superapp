/**
 * The sales tax summary — pure, no database, no `server-only`.
 *
 * The eighth report, and the only one built from DOCUMENTS rather than from
 * `getBalances`. That is the design decision worth understanding before
 * changing anything here:
 *
 *   - The LEDGER knows what you owe. `2200 Sales Tax Payable` ties to the
 *     balance sheet and catches every adjustment, including a manual journal.
 *     It cannot tell you what you SOLD, because a credit to a liability has no
 *     taxable base attached to it.
 *   - The INVOICES know the base. Taxable sales, exempt sales and tax by rate
 *     are the boxes a return form actually asks for. They know nothing about a
 *     journal somebody posted straight to 2200.
 *
 * Neither is the honest answer alone, so this report carries BOTH and states
 * the difference when they disagree. A tax report that quietly diverges from
 * the balance sheet is the bad kind — it looks authoritative while the number
 * beside it says something else. Same rule the General Ledger follows when it
 * truncates.
 *
 * ACCRUAL ONLY, and it says so on its face. A cash-basis version means
 * pro-rating each invoice's tax across its payments — `cash-basis.ts` already
 * does that for the balances but not per rate — which is a real feature rather
 * than a toggle, and half of it would be a wrong return.
 *
 * NO DIVISION (P5). The taxable base is SUMMED from the invoice's own taxable
 * lines, which are frozen at issue and are exactly what produced the tax. An
 * earlier cut recovered the base by dividing the tax by the rate; it was
 * approximate wherever the tax had been rounded, which is the wrong trade when
 * the exact figure is one sum away.
 */

export interface TaxSummaryInvoice {
  /** Null on an invoice with no rate — grouped as "No tax". */
  taxRateId: string | null;
  /** Frozen at write; a rate renamed since is still THIS invoice's rate. */
  taxRatePpm: number;
  /** Σ line amounts where `is_taxable`. */
  taxableCents: number;
  /** Σ line amounts where not. taxable + exempt = the invoice subtotal. */
  exemptCents: number;
  taxCents: number;
  /** Excludes draft and void: neither charges a customer anything. */
  status: string;
}

export interface TaxSummaryRateRow {
  rateId: string | null;
  name: string;
  ratePpm: number;
  invoiceCount: number;
  taxableCents: number;
  exemptCents: number;
  taxCents: number;
}

export interface TaxSummaryReport {
  from: string;
  to: string;
  rows: TaxSummaryRateRow[];
  totals: {
    taxableCents: number;
    exemptCents: number;
    taxCents: number;
  };
  /**
   * The `sales_tax` account's balance as of `to`, on the natural liability
   * side (positive = owed). Null when the tenant has no such account.
   */
  liabilityCents: number | null;
  /**
   * liability − Σ tax charged in this period. NON-ZERO IS NORMAL and does not
   * mean anything is wrong: tax charged before this period and not yet remitted
   * sits in the balance, and a remittance inside the period reduces the balance
   * without touching any invoice. It is surfaced so a reader reconciles
   * deliberately rather than assuming the two figures should match. Null when
   * there is no account to compare against.
   */
  differenceCents: number | null;
}

/** Statuses that represent a real charge to a customer. */
const CHARGING_STATUSES = new Set(["issued", "partial", "paid"]);

export interface TaxRateName {
  id: string;
  name: string;
}

/**
 * One row per rate as CHARGED, keyed on the invoice's frozen rate id.
 *
 * Invoices carrying no rate collapse into a single "No tax" row rather than
 * being dropped: sales that were not taxed is exactly the figure a return asks
 * for as exempt, and an invoice missing from a tax report is indistinguishable
 * from one nobody recorded.
 */
export function buildTaxSummary(
  invoices: readonly TaxSummaryInvoice[],
  rateNames: readonly TaxRateName[],
  opts: {
    from: string;
    to: string;
    liabilityCents: number | null;
  },
): TaxSummaryReport {
  const nameOf = new Map(rateNames.map((r) => [r.id, r.name]));
  const byRate = new Map<string, TaxSummaryRateRow>();

  for (const invoice of invoices) {
    if (!CHARGING_STATUSES.has(invoice.status)) continue;
    const key = invoice.taxRateId ?? "";
    const row = byRate.get(key) ?? {
      rateId: invoice.taxRateId,
      name: invoice.taxRateId
        ? // A rate cannot be deleted out from under an invoice (the FK is NO
          // ACTION), so this fallback only covers a caller that did not fetch
          // the row — never a real orphan.
          (nameOf.get(invoice.taxRateId) ?? "Unknown rate")
        : "No tax",
      ratePpm: invoice.taxRatePpm,
      invoiceCount: 0,
      taxableCents: 0,
      exemptCents: 0,
      taxCents: 0,
    };
    row.invoiceCount += 1;
    row.taxCents += invoice.taxCents;
    if (invoice.taxRateId === null) {
      // No rate at all: the whole invoice is exempt, whatever its lines are
      // flagged as. A line ticked taxable on an invoice with no rate charged
      // nothing, and reporting it as a taxable sale would overstate the base.
      row.exemptCents += invoice.taxableCents + invoice.exemptCents;
    } else {
      row.taxableCents += invoice.taxableCents;
      row.exemptCents += invoice.exemptCents;
    }
    byRate.set(key, row);
  }

  const rows = [...byRate.values()].sort((a, b) => {
    // "No tax" last; the rest by name, so the report reads the same every run.
    if (a.rateId === null) return 1;
    if (b.rateId === null) return -1;
    return a.name.localeCompare(b.name);
  });

  const totals = rows.reduce(
    (acc, r) => ({
      taxableCents: acc.taxableCents + r.taxableCents,
      exemptCents: acc.exemptCents + r.exemptCents,
      taxCents: acc.taxCents + r.taxCents,
    }),
    { taxableCents: 0, exemptCents: 0, taxCents: 0 },
  );

  return {
    from: opts.from,
    to: opts.to,
    rows,
    totals,
    liabilityCents: opts.liabilityCents,
    differenceCents:
      opts.liabilityCents === null ? null : opts.liabilityCents - totals.taxCents,
  };
}
