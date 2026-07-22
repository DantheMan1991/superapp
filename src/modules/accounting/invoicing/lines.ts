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
  dimensionMemberIds: z.array(z.string().uuid()).max(10).optional(),
});

export type InvoiceLineInput = z.infer<typeof invoiceLineSchema>;

export function computeLineAmounts(
  lines: InvoiceLineInput[],
): Array<InvoiceLineInput & { amountCents: number }> {
  return lines.map((l) => ({
    ...l,
    amountCents: lineAmountCents(
      parseQuantityHundredths(l.quantity)!,
      l.unitPriceCents,
    ),
  }));
}

export function invoiceTotalCents(lines: Array<{ amountCents: number }>): number {
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
