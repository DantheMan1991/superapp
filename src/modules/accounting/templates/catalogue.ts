import "server-only";
import { eq } from "drizzle-orm";
import { schema, type Tx } from "@/db";

/**
 * The reference lists every tenant starts with.
 *
 * Provisioned alongside the chart of accounts and idempotent in the same way —
 * `onConflictDoNothing` against the (tenant, name) and (tenant, code) uniques,
 * so re-provisioning an existing tenant adds what is missing and touches
 * nothing else. A tenant that has renamed "Net 30" keeps their name.
 */

/** Named terms, and the arithmetic each one means. */
export const DEFAULT_PAYMENT_TERMS: ReadonlyArray<{
  name: string;
  dueInDays: number;
  isDefault?: boolean;
}> = [
  { name: "Due on receipt", dueInDays: 0 },
  { name: "Net 15", dueInDays: 15 },
  // The one most small businesses actually use, so it is the one offered first.
  { name: "Net 30", dueInDays: 30, isDefault: true },
  { name: "Net 60", dueInDays: 60 },
];

/**
 * The five values `invoice_payments.method` has always held.
 *
 * SEEDED WITH THEIR EXISTING CODES ON PURPOSE. `method` was a zod enum written
 * straight into a text column, so every payment ever recorded holds one of
 * these strings. Seeding the same codes means historic payments still resolve
 * to a name instead of rendering as a bare slug the day this shipped.
 */
export const DEFAULT_PAYMENT_METHODS: ReadonlyArray<{
  code: string;
  name: string;
  sortOrder: number;
}> = [
  { code: "check", name: "Check", sortOrder: 10 },
  { code: "bank_transfer", name: "Bank transfer", sortOrder: 20 },
  { code: "card", name: "Card", sortOrder: 30 },
  { code: "cash", name: "Cash", sortOrder: 40 },
  { code: "other", name: "Other", sortOrder: 50 },
];

export async function provisionCatalogue(
  tx: Tx,
  tenantId: string,
): Promise<{ termsCreated: number; methodsCreated: number }> {
  // Read first so this stays a no-op on a tenant that already has them, rather
  // than relying on conflict handling to swallow four inserts every time.
  const [existingTerms, existingMethods] = await Promise.all([
    tx
      .select({ name: schema.paymentTerms.name })
      .from(schema.paymentTerms)
      .where(eq(schema.paymentTerms.tenantId, tenantId)),
    tx
      .select({ code: schema.paymentMethods.code })
      .from(schema.paymentMethods)
      .where(eq(schema.paymentMethods.tenantId, tenantId)),
  ]);
  const haveTerm = new Set(existingTerms.map((t) => t.name));
  const haveMethod = new Set(existingMethods.map((m) => m.code));

  // If the tenant already has ANY term, do not add a second default — the
  // partial unique index would reject it, and their choice outranks ours.
  const tenantHasTerms = existingTerms.length > 0;

  let termsCreated = 0;
  for (const term of DEFAULT_PAYMENT_TERMS) {
    if (haveTerm.has(term.name)) continue;
    const rows = await tx
      .insert(schema.paymentTerms)
      .values({
        tenantId,
        name: term.name,
        dueInDays: term.dueInDays,
        isDefault: tenantHasTerms ? false : term.isDefault === true,
      })
      .onConflictDoNothing()
      .returning({ id: schema.paymentTerms.id });
    termsCreated += rows.length;
  }

  let methodsCreated = 0;
  for (const method of DEFAULT_PAYMENT_METHODS) {
    if (haveMethod.has(method.code)) continue;
    const rows = await tx
      .insert(schema.paymentMethods)
      .values({
        tenantId,
        code: method.code,
        name: method.name,
        sortOrder: method.sortOrder,
      })
      .onConflictDoNothing()
      .returning({ id: schema.paymentMethods.id });
    methodsCreated += rows.length;
  }

  return { termsCreated, methodsCreated };
}
