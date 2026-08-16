import "server-only";
import { eq } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import { COA_TEMPLATES } from "./general";
import { provisionEntity } from "../core/entities";
import { provisionCatalogue } from "./catalogue";

/**
 * Provision accounting for a tenant: settings row + template accounts +
 * the reference lists (terms, payment methods).
 * Fully idempotent — re-running creates nothing and never renames or
 * reactivates accounts the tenant has since modified. Runs inside a
 * withTenant transaction (withSystem never writes accounting rows).
 */
export async function provisionAccounting(
  tx: Tx,
  tenantId: string,
  templateSlug = "general",
): Promise<{ accountsCreated: number }> {
  const template = COA_TEMPLATES[templateSlug] ?? COA_TEMPLATES.general;

  await tx
    .insert(schema.accountingSettings)
    .values({ tenantId, coaTemplate: template.slug })
    .onConflictDoNothing();

  // FIRST, because every journal entry needs one and `postEntry` refuses
  // without it. `drizzle/0142` gave every tenant that existed then a default
  // company; this is the same row for every tenant created after it, and the
  // backfill for anything the migration missed. Named after the tenant — the
  // single-company client never sees it (ADR 0010).
  const tenant = await tx.query.tenants.findFirst({
    where: eq(schema.tenants.id, tenantId),
    columns: { name: true },
  });
  await provisionEntity(tx, tenantId, tenant?.name ?? "My company");

  const existing = await tx
    .select({ id: schema.accounts.id, code: schema.accounts.code })
    .from(schema.accounts)
    .where(eq(schema.accounts.tenantId, tenantId));
  const idByCode = new Map(existing.map((a) => [a.code, a.id]));

  let created = 0;
  // Template order guarantees parents precede children, so parentCode
  // always resolves against idByCode (existing + just-created).
  for (const acct of template.accounts) {
    if (idByCode.has(acct.code)) continue;
    const parentId = acct.parentCode ? idByCode.get(acct.parentCode) ?? null : null;
    const rows = await tx
      .insert(schema.accounts)
      .values({
        tenantId,
        code: acct.code,
        name: acct.name,
        accountType: acct.type,
        subtype: acct.subtype,
        parentId,
        description: acct.description ?? "",
        isSystem: acct.isSystem ?? false,
      })
      .onConflictDoNothing()
      .returning({ id: schema.accounts.id });
    if (rows.length > 0) {
      idByCode.set(acct.code, rows[0].id);
      created += 1;
    }
  }

  // The reference lists come with the chart, and are idempotent the same way.
  // Provisioning is re-run on existing tenants (it is how a template gains an
  // account), so this is also the backfill path for tenants that predate them.
  await provisionCatalogue(tx, tenantId);

  return { accountsCreated: created };
}
