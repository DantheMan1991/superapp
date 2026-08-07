import "server-only";
import { eq } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import { DEFAULT_TIMEZONE } from "@/lib/timezone";

/**
 * The tenant's timezone, read inside a caller's transaction.
 *
 * For anything with a request behind it, prefer `ctx.tenant.timezone` —
 * `requireTenant()` has already loaded the row and a second query is waste.
 * This exists for code that only ever receives a tenant id: the ledger core
 * (`LedgerCtx` is deliberately minimal), the books export, and the background
 * jobs that have no `ctx` at all.
 *
 * Takes the caller's `tx` rather than opening its own, so it reads under
 * whatever RLS context the caller established — a tenant transaction can see
 * its own `tenants` row and no other, which is exactly the scope wanted.
 */
export async function getTenantTimezone(
  tx: Tx,
  tenantId: string,
): Promise<string> {
  const row = await tx.query.tenants.findFirst({
    where: eq(schema.tenants.id, tenantId),
    columns: { timezone: true },
  });
  // A missing row means the caller's RLS context cannot see this tenant, which
  // is a bug in the caller rather than a timezone question. Falling back to the
  // default keeps a report rendering in the wrong-by-one-day case instead of
  // throwing; it never widens access, because the read returned nothing.
  return row?.timezone ?? DEFAULT_TIMEZONE;
}
