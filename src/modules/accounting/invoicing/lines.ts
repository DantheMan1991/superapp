import { z } from "zod";
import { MAX_AMOUNT_CENTS } from "../lib/money";

/**
 * Invoice line math — pure, client-shareable. Quantities are 2dp strings
 * (drizzle numeric arrives as string; NEVER Number() a quantity into
 * float money math). All amounts are integer cents.
 */

/** "2.50" → 250 hundredths; null on anything else. Positive only. */
export function parseQuantityHundredths(quantity: string): number | null {
  const s = quantity.trim();
  if (!/^\d{1,10}(\.\d{1,2})?$/.test(s)) return null;
  const [whole, frac = ""] = s.split(".");
  const hundredths = Number(whole) * 100 + Number((frac + "00").slice(0, 2));
  if (!Number.isSafeInteger(hundredths) || hundredths === 0) return null;
  return hundredths;
}

/**
 * round(quantity × unitPrice) in pure integer math, half away from zero.
 * quantityHundredths × priceCents / 100, e.g. 1.33 × $0.15 = 133×15/100
 * = 19.95 → 20 cents.
 */
export function lineAmountCents(
  quantityHundredths: number,
  unitPriceCents: number,
): number {
  const product = quantityHundredths * unitPriceCents;
  const sign = product < 0 ? -1 : 1;
  const abs = Math.abs(product);
  return sign * Math.floor((abs + 50) / 100);
}

export const invoiceLineSchema = z.object({
  description: z.string().trim().max(500),
  quantity: z
    .string()
    .regex(/^\d{1,10}(\.\d{1,2})?$/)
    .refine((q) => parseQuantityHundredths(q) !== null, "Quantity must be above zero"),
  unitPriceCents: z
    .number()
    .int()
    .refine((n) => Math.abs(n) <= MAX_AMOUNT_CENTS),
  incomeAccountId: z.string().uuid(),
  /**
   * Whether the invoice's rate applies to this line. Optional so every
   * existing caller — and every `recurring_entries.template` written before
   * tax existed — still validates; absent means untaxed, which is what those
   * invoices charged.
   */
  isTaxable: z.boolean().optional(),
  dimensionMemberIds: z.array(z.string().uuid()).max(10).optional(),
});

export type InvoiceLineInput = z.infer<typeof invoiceLineSchema>;

export function computeLineAmounts(
  lines: InvoiceLineInput[],
): Array<InvoiceLineInput & { amountCents: number; isTaxable: boolean }> {
  return lines.map((l) => ({
    ...l,
    amountCents: lineAmountCents(
      parseQuantityHundredths(l.quantity)!,
      l.unitPriceCents,
    ),
    // Normalized here so nothing downstream has to decide what `undefined`
    // means about a line's taxability.
    isTaxable: l.isTaxable === true,
  }));
}

/**
 * Σ line amounts — the invoice SUBTOTAL, before tax.
 *
 * Renamed from `invoiceTotalCents` on 2026-08-13: the name stopped being true
 * the moment an invoice could carry tax, and a helper called "total" returning
 * the pre-tax figure is exactly the kind of thing a later change reads wrong.
 * The gross total is `invoiceTaxTotals(...).totalCents` in `tax.ts`.
 */
export function invoiceSubtotalCents(lines: Array<{ amountCents: number }>): number {
  return lines.reduce((s, l) => s + l.amountCents, 0);
}

/** Derived status from payments — the ONLY way partial/paid come to exist. */
export function deriveStatus(
  totalCents: number,
  paidCents: number,
): "issued" | "partial" | "paid" {
  if (paidCents <= 0) return "issued";
  if (paidCents < totalCents) return "partial";
  return "paid";
}
