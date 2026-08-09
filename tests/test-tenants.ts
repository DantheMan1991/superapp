import { sql } from "drizzle-orm";
import { withSystem } from "../src/db";

/**
 * What a *test* tenant looks like, and how to sweep them up.
 *
 * Every DB-backed suite stamps the rows it creates with
 * `<prefix>-${process.pid}` so that two concurrent runs can never collide,
 * and deletes them in `afterAll`. A run that is killed — Ctrl-C, an editor
 * restart, a timeout partway through the ~9-minute Neon suite — never reaches
 * `afterAll`, and its tenants then sit in the admin CRM list and the client
 * matrix forever.
 *
 * Used by `npm run db:clean-test-tenants` (manual) and by the stale sweep in
 * tests/global-setup.ts (automatic, before every run).
 *
 * Adding a suite that creates tenants? Add its prefix here — tests/
 * test-stamps.test.ts fails if a `${process.pid}` stamp in tests/ is missing.
 */
export const TEST_TENANT_SLUG_PREFIXES = [
  // tests/tenant-isolation.test.ts — one pair per certified module
  "iso-test",
  "iso-acc",
  "iso-doc",
  "iso-pay",
  "iso-close",
  "iso-retainer",
  "iso-interview",
  // per-module suites
  "banking-test",
  "close-test",
  "doc-test",
  "export-test",
  "interview-test",
  "invoicing-test",
  "ledger-test",
  "payables-test",
  "reports-test",
  "retainer-billing",
  // in-flight DMS work (harmless until those suites land)
  "iso-dms",
  "dms-ops",
  "dms-test",
] as const;

/**
 * Postgres regex matching a stamped identifier and nothing else. The
 * `-<digits>` pid segment is the load-bearing part: a real client slug would
 * have to be literally "Ledger Test 4127" to collide.
 */
export const TEST_STAMP_PATTERN = `^(?:${TEST_TENANT_SLUG_PREFIXES.join("|")})-[0-9]+(?:-[a-z0-9-]*)?$`;

/** Same, allowing the `hash-` prefix the interview suites put on ip_hash. */
const TEST_HASH_PATTERN = `^(?:hash-)?(?:${TEST_TENANT_SLUG_PREFIXES.join("|")})-[0-9]+(?:-[a-z0-9-]*)?$`;

/** `in (…)` list of uuids — the driver doesn't bind a JS array to `= any()`. */
const idList = (ids: string[]) =>
  sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`, `,
  );

export type TestTenantRow = {
  id: string;
  slug: string;
  name: string;
  created_at: string;
  /** Rows in tenant-scoped tables that a delete would cascade away. */
  child_rows: number;
};

export type CleanupReport = {
  tenants: TestTenantRow[];
  /** audit_log is ON DELETE SET NULL, so it is cleared explicitly. */
  auditRows: number;
  profiles: number;
  interviewSessions: number;
};

/**
 * Find stamped tenants, with a count of the rows that would cascade. Read
 * only — this is what the script reports when run without `--yes`.
 *
 * @param olderThanMinutes skip anything younger, so a concurrent run in
 *   progress is never touched. 0 = no age filter.
 */
export async function findTestTenants(olderThanMinutes = 0): Promise<CleanupReport> {
  return withSystem(async (tx) => {
    const cutoff = sql`now() - make_interval(mins => ${olderThanMinutes})`;

    const tenants = await tx.execute(sql`
      select id::text, slug, name, created_at::text
      from tenants
      where slug ~ ${TEST_STAMP_PATTERN} and created_at < ${cutoff}
      order by created_at asc
    `);
    const rows = tenants.rows as Omit<TestTenantRow, "child_rows">[];

    // Count what each tenant is carrying, across every table that has a
    // tenant_id — no hardcoded table list to fall out of date.
    const tables = await tx.execute(sql`
      select table_name from information_schema.columns
      where table_schema = 'public' and column_name = 'tenant_id'
        and table_name <> 'audit_log'
      order by table_name
    `);
    const tableNames = (tables.rows as { table_name: string }[]).map((t) => t.table_name);

    const withCounts: TestTenantRow[] = [];
    for (const row of rows) {
      let total = 0;
      for (const table of tableNames) {
        const c = await tx.execute(
          sql`select count(*)::int as n from ${sql.identifier(table)} where tenant_id = ${row.id}::uuid`,
        );
        total += (c.rows[0] as { n: number }).n;
      }
      withCounts.push({ ...row, child_rows: total });
    }

    const ids = withCounts.map((t) => t.id);
    const auditRows = ids.length
      ? ((
          await tx.execute(
            sql`select count(*)::int as n from audit_log where tenant_id in (${idList(ids)})`,
          )
        ).rows[0] as { n: number }).n
      : 0;

    const profiles = (
      (
        await tx.execute(sql`
          select count(*)::int as n from profiles
          where clerk_user_id ~ ${TEST_STAMP_PATTERN} and created_at < ${cutoff}
        `)
      ).rows[0] as { n: number }
    ).n;

    const interviewSessions = (
      (
        await tx.execute(sql`
          select count(*)::int as n from interview_sessions
          where ip_hash ~ ${TEST_HASH_PATTERN} and created_at < ${cutoff}
        `)
      ).rows[0] as { n: number }
    ).n;

    return { tenants: withCounts, auditRows, profiles, interviewSessions };
  });
}

/**
 * Delete stamped tenants and the platform-level rows the suites leave beside
 * them. Returns what was removed.
 *
 * Order matters: audit_log's FK is ON DELETE SET NULL, so its rows are
 * cleared first — otherwise they survive as tenant-less entries in the
 * platform audit view. Everything else is ON DELETE CASCADE.
 */
export async function deleteTestTenants(olderThanMinutes = 0): Promise<CleanupReport> {
  const found = await findTestTenants(olderThanMinutes);
  if (
    !found.tenants.length &&
    !found.profiles &&
    !found.interviewSessions &&
    !found.auditRows
  ) {
    return found;
  }

  await withSystem(async (tx) => {
    const cutoff = sql`now() - make_interval(mins => ${olderThanMinutes})`;
    const ids = found.tenants.map((t) => t.id);
    if (ids.length) {
      await tx.execute(sql`delete from audit_log where tenant_id in (${idList(ids)})`);
      await tx.execute(sql`delete from tenants where id in (${idList(ids)})`);
    }
    // Platform-level (no tenant_id, so no cascade reaches them).
    await tx.execute(sql`
      delete from profiles
      where clerk_user_id ~ ${TEST_STAMP_PATTERN} and created_at < ${cutoff}
    `);
    await tx.execute(sql`
      delete from interview_sessions
      where ip_hash ~ ${TEST_HASH_PATTERN} and created_at < ${cutoff}
    `);
  });

  return found;
}

/** One-line-per-tenant summary shared by the script and the pre-run sweep. */
export function formatReport(report: CleanupReport): string {
  const lines = report.tenants.map(
    (t) =>
      `  ${t.created_at}  ${t.slug.padEnd(26)} ${JSON.stringify(t.name).padEnd(22)} ${t.child_rows} child row(s)`,
  );
  lines.push(
    `  audit_log rows: ${report.auditRows} · stamped profiles: ${report.profiles} · interview sessions: ${report.interviewSessions}`,
  );
  return lines.join("\n");
}
