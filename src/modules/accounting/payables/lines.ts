import { z } from "zod";
import { MAX_AMOUNT_CENTS } from "../lib/money";

/**
 * Bill line math + status derivation — pure, fully unit-testable.
 * Bill lines are amount-only (P10): AP is entered by amount; extraction
 * quantities survive in the description text.
 */

export const billLineSchema = z.object({
  description: z.string().trim().max(500).default(""),
  /** Signed; 0 posts nothing; negative = credit/discount line. */
  amountCents: z
    .number()
    .int()
    .refine((n) => Math.abs(n) <= MAX_AMOUNT_CENTS, "Amount too large"),
  /** Nullable by design (P9) — uncoded until AI + human code it. */
  accountId: z.string().uuid().nullable().default(null),
  dimensionMemberIds: z.array(z.string().uuid()).max(10).optional(),
});

export type BillLineInput = z.infer<typeof billLineSchema>;

export function billTotalCents(
  lines: ReadonlyArray<{ amountCents: number }>,
): number {
  return lines.reduce((sum, l) => sum + l.amountCents, 0);
}

/** Post-approval statuses derive from payments — never client-set. */
export function deriveBillStatus(
  totalCents: number,
  paidCents: number,
): "approved" | "partial" | "paid" {
  if (paidCents <= 0) return "approved";
  if (paidCents < totalCents) return "partial";
  return "paid";
}

export type BillStatusValue =
  | "draft"
  | "awaiting_approval"
  | "approved"
  | "partial"
  | "paid"
  | "void";

/**
 * The explicit transition table (P1/P5). Derived transitions
 * (approved ↔ partial ↔ paid) happen only inside payment transactions
 * and are not listed — no action may request them.
 */
const TRANSITIONS: Record<string, BillStatusValue[]> = {
  submit: ["draft"],
  return: ["awaiting_approval"],
  approve: ["draft", "awaiting_approval"],
  void: ["approved", "partial", "paid"],
  edit: ["draft"],
  delete: ["draft"],
  pay: ["approved", "partial"],
};

export function canTransition(
  action: keyof typeof TRANSITIONS,
  from: BillStatusValue,
): boolean {
  return TRANSITIONS[action]?.includes(from) ?? false;
}

/** Normalized vendor-invoice-number key for the strong duplicate signal. */
export function normalizeBillNumber(billNumber: string): string {
  return billNumber.trim().toLowerCase();
}
