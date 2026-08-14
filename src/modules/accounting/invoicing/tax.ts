/**
 * What sales tax an invoice charges — pure, no database, no `server-only`.
 *
 * It is a module rather than three lines inline for the reason `terms.ts` is:
 * the invoice builder computes the tax in the browser as you type and the
 * server recomputes it on save, and two implementations of one rule is how
 * those two come to disagree. Everything that decides a number lives here and
 * is table-tested without a database.
 *
 * ROUNDING HAPPENS ONCE, ON THE SUMMED TAXABLE BASE. Not per line. Per-line
 * rounding accumulates error and produces a tax figure that does not equal
 * rate × base — which is both the number a customer checks with a calculator
 * and the number a return form asks for. One rounding event, one place, half
 * away from zero (matching `lineAmountCents`).
 */

import { z } from "zod";

/** Rates are parts per million of the taxable amount: 7.25% → 72_500. */
export const PPM_SCALE = 1_000_000;

/** 100%. Mirrored from the schema CHECK for client-side validation. */
export const MAX_RATE_PPM = 1_000_000;

export interface TaxRateLike {
  id: string;
  name: string;
  ratePpm: number;
}

/** "7.25" → 72_500; null on anything else. Up to 4 decimal places. */
export function parseRatePercentToPpm(input: string): number | null {
  const s = input.trim().replace(/%$/, "").trim();
  if (!/^\d{1,3}(\.\d{1,4})?$/.test(s)) return null;
  const [whole, frac = ""] = s.split(".");
  const ppm = Number(whole) * 10_000 + Number((frac + "0000").slice(0, 4));
  if (!Number.isSafeInteger(ppm) || ppm > MAX_RATE_PPM) return null;
  return ppm;
}

/**
 * 72_500 → "7.25". Trailing zeros trimmed, because "7.2500%" on an invoice
 * reads as a precision nobody claimed.
 */
export function formatRatePpm(ppm: number): string {
  const whole = Math.trunc(ppm / 10_000);
  const frac = String(Math.abs(ppm) % 10_000)
    .padStart(4, "0")
    .replace(/0+$/, "");
  return frac === "" ? String(whole) : `${whole}.${frac}`;
}

/**
 * round(taxableCents × ratePpm / 1_000_000), half away from zero.
 *
 * BIGINT INTERMEDIATES, AND THAT IS FORCED. `MAX_AMOUNT_CENTS` is 1e13 and the
 * scale is 1e6, so the product reaches 1e19 — past `Number.MAX_SAFE_INTEGER`,
 * where the answer would be quietly wrong rather than loudly. This is the
 * second place in the module that has to do it; `core/cash-basis-allocate.ts`
 * is the first, for the same reason.
 *
 * Signed, because a discount line can be marked taxable and a taxable base can
 * in principle come out negative.
 */
export function taxCentsFor(taxableCents: number, ratePpm: number): number {
  if (ratePpm === 0 || taxableCents === 0) return 0;
  const negative = taxableCents < 0;
  const abs = BigInt(Math.abs(taxableCents)) * BigInt(ratePpm);
  const scale = BigInt(PPM_SCALE);
  // +half before the truncating divide is half-up on the absolute value, i.e.
  // half away from zero once the sign goes back on. BigInt literals (2n) need
  // an ES2020 target and this tsconfig is lower — same note as
  // core/cash-basis-allocate.ts.
  const rounded = (abs + scale / BigInt(2)) / scale;
  const cents = Number(rounded);
  return negative ? -cents : cents;
}

export interface TaxableLineLike {
  amountCents: number;
  isTaxable: boolean;
}

export interface InvoiceTaxTotals {
  /** Σ every line. */
  subtotalCents: number;
  /** Σ lines the rate applies to. */
  taxableCents: number;
  /** Σ lines it does not. Stated rather than derived — a return asks for it. */
  exemptCents: number;
  taxCents: number;
  /** subtotal + tax: what the customer owes. */
  totalCents: number;
}

/**
 * The whole of an invoice's money, from its lines and its rate.
 *
 * A null rate means no tax at all, NOT a zero rate — the difference matters on
 * the document, where "Tax 0.00" implies a taxed invoice that happened to
 * compute to nothing.
 */
export function invoiceTaxTotals(
  lines: readonly TaxableLineLike[],
  ratePpm: number | null,
): InvoiceTaxTotals {
  let subtotalCents = 0;
  let taxableCents = 0;
  for (const line of lines) {
    subtotalCents += line.amountCents;
    if (line.isTaxable) taxableCents += line.amountCents;
  }
  const taxCents = ratePpm === null ? 0 : taxCentsFor(taxableCents, ratePpm);
  return {
    subtotalCents,
    taxableCents: ratePpm === null ? 0 : taxableCents,
    exemptCents: ratePpm === null ? subtotalCents : subtotalCents - taxableCents,
    taxCents,
    totalCents: subtotalCents + taxCents,
  };
}

/**
 * Which rate a new invoice offers: the tenant default, else none.
 *
 * Deliberately shallower than `resolveTerm` — there is no customer-level rate
 * in v1, so there is nothing to resolve between. The signature is the shape it
 * would take when there is, rather than a function that would need rewriting.
 */
export function resolveTaxRate(
  rates: readonly TaxRateLike[],
  defaultRateId: string | null,
): TaxRateLike | null {
  if (!defaultRateId) return null;
  return rates.find((r) => r.id === defaultRateId) ?? null;
}

/** "Sales Tax (7.25%)", the label on the invoice and the PDF. */
export function describeTaxRate(name: string, ratePpm: number): string {
  return `${name} (${formatRatePpm(ratePpm)}%)`;
}

export const taxRateInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  ratePpm: z.number().int().min(0).max(MAX_RATE_PPM),
});

export type TaxRateInput = z.infer<typeof taxRateInputSchema>;
