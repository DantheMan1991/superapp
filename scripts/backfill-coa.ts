import "dotenv/config";
import { neonConfig, Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { eq } from "drizzle-orm";
import ws from "ws";
import * as schema from "../src/db/schema";
import { COA_TEMPLATES } from "../src/modules/accounting/templates/general";

/**
 * Add accounts that the chart-of-accounts template has gained to tenants that
 * were already provisioned.
 *
 * `provisionAccounting` only runs when the accounting module is switched ON, so
 * a tenant provisioned last month never sees an account added to the template
 * this month. That is fine until a feature depends on one — disposal needs
 * `4950 Gain (Loss) on Asset Disposal`, which is how this script came to exist.
 *
 * Deliberately NOT a call into `provisionAccounting`: that module is
 * `server-only` and cannot be imported outside a Next request. The account loop
 * below mirrors it exactly, including `onConflictDoNothing`, so running this is
 * safe and repeatable. If the two ever diverge, this file is the one that is
 * wrong.
 *
 * WHAT IT WILL NOT DO: rename, re-parent, deactivate or otherwise touch an
 * account that already exists. A tenant that renamed `6900` keeps their name.
 * Only genuinely missing codes are inserted.
 *
 *   npm run db:backfill-coa           the app database
 *   npm run db:backfill-coa -- --dev  the Neon dev branch
 *   npm run db:backfill-coa -- --dry  report, change nothing
 */
function resolveTarget(): { url: string; label: string } | null {
  if (process.argv.includes("--dev")) {
    const url =
      process.env.TEST_DATABASE_URL_OWNER || process.env.TEST_DATABASE_URL;
    if (!url) {
      console.error("--dev needs TEST_DATABASE_URL_OWNER (or TEST_DATABASE_URL).");
      return null;
    }
    if (
      url === process.env.DATABASE_URL ||
      url === process.env.DATABASE_URL_OWNER
    ) {
      console.error(
        "REFUSING: TEST_DATABASE_URL_OWNER points at the same database as DATABASE_URL.",
      );
      return null;
    }
    return { url, label: "dev branch" };
  }
  const url = process.env.DATABASE_URL_OWNER || process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set.");
    return null;
  }
  return { url, label: "app database" };
}

async function main() {
  const target = resolveTarget();
  if (!target) process.exit(1);
  const dryRun = process.argv.includes("--dry");

  neonConfig.webSocketConstructor = ws;
  const pool = new Pool({ connectionString: target.url });
  const db = drizzle(pool, { schema });

  // Host only. The connection string carries the password and must never be
  // printed, logged, or pasted into a transcript.
  console.log(
    `${dryRun ? "Checking" : "Backfilling"} the chart of accounts on the ${target.label} (${new URL(target.url).host})…`,
  );

  const template = COA_TEMPLATES.general;
  const tenants = await db.select().from(schema.tenants);
  let touchedTenants = 0;
  let createdTotal = 0;

  for (const tenant of tenants) {
    const existing = await db
      .select({ id: schema.accounts.id, code: schema.accounts.code })
      .from(schema.accounts)
      .where(eq(schema.accounts.tenantId, tenant.id));
    // A tenant with no accounts was never provisioned. Seeding a whole chart
    // into one that never asked for accounting is not this script's job.
    if (existing.length === 0) continue;

    const idByCode = new Map(existing.map((a) => [a.code, a.id]));
    const missing = template.accounts.filter((a) => !idByCode.has(a.code));
    if (missing.length === 0) continue;

    touchedTenants += 1;
    console.log(
      `  ${tenant.name}: ${missing.map((m) => m.code).join(", ")}${dryRun ? " (dry run)" : ""}`,
    );
    if (dryRun) continue;

    for (const acct of missing) {
      const parentId = acct.parentCode
        ? (idByCode.get(acct.parentCode) ?? null)
        : null;
      const rows = await db
        .insert(schema.accounts)
        .values({
          tenantId: tenant.id,
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
        createdTotal += 1;
      }
    }
  }

  console.log(
    createdTotal === 0 && touchedTenants === 0
      ? "Every tenant already has the full template."
      : `${dryRun ? "Would add" : "Added"} ${createdTotal} account(s) across ${touchedTenants} tenant(s).`,
  );
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
