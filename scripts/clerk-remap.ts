import "dotenv/config";
import { readFileSync } from "node:fs";
import path from "node:path";
import { neonConfig, Pool } from "@neondatabase/serverless";
import ws from "ws";
import { configureNeonForLocalProxy } from "./lib/neon-local";
import {
  CLERK_ID_COLUMNS_SQL,
  classifyColumn,
  planColumn,
  quoteIdent,
  reverseMapping,
  summarizePlan,
  validateMapping,
  type ClerkIdColumn,
  type ColumnPlan,
} from "./lib/clerk-migration";

/**
 * `npm run clerk:remap` — rewrite every Clerk id the database mirrors, old →
 * new, from the mapping `clerk-import` wrote. Step 5 of
 * docs/runbooks/clerk-production-cutover.md, and the one step that touches
 * production data.
 *
 *   npm run clerk:remap -- --dry-run          plan only, nothing written
 *   npm run clerk:remap                       apply, in one transaction
 *   npm run clerk:remap -- --reverse          roll back (new → old)
 *   npm run clerk:remap -- --dev              the Neon dev branch instead
 *   npm run clerk:remap -- --allow-unmapped   proceed past ids the mapping lacks
 *
 * The columns are discovered from the catalogue (`%clerk_user_id%`,
 * `%clerk_org_id%`, text) rather than listed here, so a column added since
 * this was written is rewritten too. Runs as the database owner, like
 * migrate.ts: this is a platform-wide write RLS must not see.
 *
 * It refuses to run when the database holds none of the mapping's old ids
 * (wrong database, or already applied) and, without --allow-unmapped, when a
 * column holds an id the mapping does not know — someone deleted from Clerk
 * before the export, whose rows would keep an id no instance resolves.
 */

function flag(name: string): boolean {
  return process.argv.includes(name);
}

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

/** Same target selection and the same refusal as scripts/migrate.ts. */
function resolveTarget(): { url: string; label: string } | null {
  if (flag("--dev")) {
    const url =
      process.env.TEST_DATABASE_URL_OWNER || process.env.TEST_DATABASE_URL;
    if (!url) {
      console.error("--dev needs TEST_DATABASE_URL_OWNER (or TEST_DATABASE_URL) set.");
      return null;
    }
    if (url === process.env.DATABASE_URL || url === process.env.DATABASE_URL_OWNER) {
      console.error(
        "REFUSING: TEST_DATABASE_URL_OWNER points at the same database as DATABASE_URL.",
      );
      return null;
    }
    return { url, label: "dev branch" };
  }
  const url = process.env.DATABASE_URL_OWNER || process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL_OWNER is not set.");
    return null;
  }
  return { url, label: "app database" };
}

async function main() {
  const target = resolveTarget();
  if (!target) process.exit(1);

  const mappingPath =
    arg("--mapping") ?? path.join("clerk-migration", "mapping.json");
  let mapping = validateMapping(JSON.parse(readFileSync(mappingPath, "utf8")));
  if (flag("--reverse")) mapping = reverseMapping(mapping);
  const dryRun = flag("--dry-run");
  const direction = flag("--reverse") ? "REVERSE (new → old)" : "old → new";

  if (!globalThis.WebSocket) neonConfig.webSocketConstructor = ws;
  if (configureNeonForLocalProxy()) console.log("Using the local WebSocket proxy.");
  const pool = new Pool({ connectionString: target.url });
  // Host only — the connection string carries the password.
  console.log(
    `${dryRun ? "Planning" : "Rewriting"} Clerk ids ${direction} in the ${target.label} (${new URL(target.url).host})…`,
  );
  console.log(
    `Mapping: ${Object.keys(mapping.users).length} users, ${Object.keys(mapping.organizations).length} organizations (${mapping.source} → ${mapping.target}, written ${mapping.createdAt}).\n`,
  );

  const client = await pool.connect();
  try {
    const discovered = await client.query<{ table_name: string; column_name: string }>(
      CLERK_ID_COLUMNS_SQL,
    );
    const columns = discovered.rows
      .map((row) => classifyColumn(row.table_name, row.column_name))
      .filter((column): column is ClerkIdColumn => column !== null);

    const plans: ColumnPlan[] = [];
    for (const column of columns) {
      const t = quoteIdent(column.table);
      const c = quoteIdent(column.column);
      const distinct = await client.query<{ v: string }>(
        `select distinct ${c} as v from ${t} where ${c} is not null`,
      );
      plans.push(planColumn(column, distinct.rows.map((row) => row.v), mapping));
    }

    for (const plan of plans) {
      if (plan.changes.length + plan.unmapped.length + plan.alreadyNew.length === 0) continue;
      const parts = [`${plan.changes.length} to rewrite`];
      if (plan.alreadyNew.length > 0) parts.push(`${plan.alreadyNew.length} already new`);
      if (plan.unmapped.length > 0) parts.push(`UNMAPPED: ${plan.unmapped.join(", ")}`);
      console.log(`  ${plan.column.table}.${plan.column.column}: ${parts.join(", ")}`);
    }
    const summary = summarizePlan(plans);
    console.log(
      `\n${summary.columns} columns hold Clerk ids; ${summary.columnsTouched} need rewriting (${summary.changes} distinct values across them), ${summary.unmapped} unmapped, ${summary.alreadyNew} already new.`,
    );
    console.log(
      "audit_log.meta (JSON) is left as written: it records what happened at the time.",
    );

    if (summary.changes === 0) {
      console.log(
        dryRun
          ? "Nothing to rewrite."
          : "REFUSING: this database holds none of the mapping's old ids — wrong database, or already applied.",
      );
      process.exitCode = dryRun ? 0 : 1;
      return;
    }
    if (summary.unmapped > 0 && !flag("--allow-unmapped")) {
      console.log(
        `\n${dryRun ? "Would refuse" : "REFUSING"}: ${summary.unmapped} id(s) above are not in the mapping. They belong to people or organizations that were not on the source instance at export time. Their rows keep an id no instance resolves; pass --allow-unmapped to leave them as they are.`,
      );
      if (!dryRun) {
        process.exitCode = 1;
        return;
      }
    }
    if (dryRun) {
      console.log("\nDry run: nothing written.");
      return;
    }

    await client.query("BEGIN");
    try {
      for (const plan of plans) {
        if (plan.changes.length === 0) continue;
        const t = quoteIdent(plan.column.table);
        const c = quoteIdent(plan.column.column);
        const values = plan.changes
          .map((_, i) => `($${i * 2 + 1}::text, $${i * 2 + 2}::text)`)
          .join(", ");
        const params = plan.changes.flatMap((change) => [change.from, change.to]);
        const result = await client.query(
          `update ${t} set ${c} = v.new_id from (values ${values}) as v(old_id, new_id) where ${t}.${c} = v.old_id`,
          params,
        );
        console.log(`  ${plan.column.table}.${plan.column.column}: ${result.rowCount} rows`);
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    }

    let remaining = 0;
    for (const plan of plans) {
      if (plan.changes.length === 0) continue;
      const t = quoteIdent(plan.column.table);
      const c = quoteIdent(plan.column.column);
      const check = await client.query<{ n: number }>(
        `select count(*)::int as n from ${t} where ${c} = any($1::text[])`,
        [plan.changes.map((change) => change.from)],
      );
      remaining += check.rows[0]?.n ?? 0;
    }
    console.log(
      remaining === 0
        ? "\nDone. Verified: no old ids remain in the rewritten columns."
        : `\nWARNING: ${remaining} rows still hold old ids after the rewrite.`,
    );
    if (remaining > 0) process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
