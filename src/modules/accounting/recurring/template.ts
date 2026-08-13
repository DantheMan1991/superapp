import { z } from "zod";
import { MAX_AMOUNT_CENTS } from "../lib/money";
import { billLineSchema } from "../payables/lines";
import { invoiceLineSchema } from "../invoicing/lines";

/**
 * What a recurring journal or bill template holds — pure, no `server-only`.
 *
 * Validated at WRITE and re-validated at GENERATION, the same contract
 * `recurring_invoices.template` keeps: accounts and vendors may deactivate
 * between the day a template is saved and the morning it next runs, so a
 * template is never trusted just because it was once valid.
 */

/**
 * A journal line: signed cents against an account, positive = debit.
 *
 * The ledger's own convention (`journal_lines.amount_cents`), so a template
 * line is the thing the posting engine already takes rather than a shape that
 * has to be translated — translation is where a sign gets flipped.
 */
export const recurringJournalLineSchema = z.object({
  accountId: z.string().uuid(),
  amountCents: z
    .number()
    .int()
    .refine((n) => n !== 0, "A line cannot be zero")
    .refine((n) => Math.abs(n) <= MAX_AMOUNT_CENTS, "Amount too large"),
  memo: z.string().trim().max(500).optional(),
  dimensionMemberIds: z.array(z.string().uuid()).max(10).optional(),
});

export const recurringJournalTemplateSchema = z.object({
  kind: z.literal("journal"),
  // Two lines minimum, because one line cannot balance — the same floor the
  // posting engine enforces (TOO_FEW_LINES).
  lines: z.array(recurringJournalLineSchema).min(2).max(100),
  memo: z.string().trim().max(2000).optional(),
});

export const recurringBillTemplateSchema = z.object({
  kind: z.literal("bill"),
  lines: z.array(billLineSchema).min(1).max(100),
  memo: z.string().trim().max(2000).optional(),
  dueInDays: z.number().int().min(0).max(365),
});

/**
 * What `recurring_invoices.template` held, with a discriminator added.
 *
 * The old shape was `{lines, memo, dueInDays}` and carried no `kind` — the
 * table it lived in was the discriminator. Folding the two tables together
 * means the tag moves into the payload, which is what migration `0122` adds on
 * the way across.
 */
export const recurringInvoiceTemplateSchema = z.object({
  kind: z.literal("invoice"),
  lines: z.array(invoiceLineSchema).min(1).max(100),
  memo: z.string().trim().max(2000).optional(),
  dueInDays: z.number().int().min(0).max(365),
});

export const recurringEntryTemplateSchema = z.discriminatedUnion("kind", [
  recurringJournalTemplateSchema,
  recurringBillTemplateSchema,
  recurringInvoiceTemplateSchema,
]);

export type RecurringJournalTemplate = z.infer<typeof recurringJournalTemplateSchema>;
export type RecurringBillTemplate = z.infer<typeof recurringBillTemplateSchema>;
export type RecurringInvoiceTemplate = z.infer<
  typeof recurringInvoiceTemplateSchema
>;
export type RecurringEntryTemplate = z.infer<typeof recurringEntryTemplateSchema>;

/**
 * Σ signed cents. Zero means the entry balances.
 *
 * CHECKED AT WRITE TIME, which is the whole point of it being here. The
 * posting engine would reject an unbalanced entry anyway — but it would do so
 * once a month, at 3am, inside a generation run, where the only evidence is an
 * error row nobody reads. Refusing to save the template is the same rule
 * enforced where somebody is looking at it.
 */
export function journalTemplateImbalanceCents(
  lines: ReadonlyArray<{ amountCents: number }>,
): number {
  return lines.reduce((sum, l) => sum + l.amountCents, 0);
}

export function journalTemplateBalances(
  lines: ReadonlyArray<{ amountCents: number }>,
): boolean {
  return journalTemplateImbalanceCents(lines) === 0;
}

/**
 * Parse stored jsonb, returning null rather than throwing.
 *
 * A template whose shape no longer validates must cost its OWN run and nothing
 * else — the generation loop reports it and carries on to the next template,
 * exactly as `recurring.ts` does. One malformed row must never stop a tenant's
 * whole month from generating.
 */
export function parseRecurringEntryTemplate(
  stored: unknown,
): RecurringEntryTemplate | null {
  const parsed = recurringEntryTemplateSchema.safeParse(stored);
  if (!parsed.success) return null;
  if (parsed.data.kind === "journal" && !journalTemplateBalances(parsed.data.lines)) {
    return null;
  }
  return parsed.data;
}
