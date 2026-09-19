import "dotenv/config";
import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { withSystem } from "../src/db";

/**
 * **EVERY ENTITY-SCOPE POLICY NAMES A PARENT THE CHILD REALLY POINTS AT.**
 *
 * `drizzle/0387` created 49 restrictive policies by walking the schema: tables
 * carrying `entity_id` directly, and tables carrying a column NAMED like a
 * parent's key. A column name is not a foreign key, and two of them were wrong
 * (`drizzle/0388`):
 *
 * - `time_entry_dimensions.entry_id` points at `time_entries`, not
 *   `journal_entries`. The EXISTS never matched, so the WITH CHECK refused
 *   **every insert**. CI caught it in minutes.
 * - `operator_postings.invoice_id` has no foreign key at all. **Nothing caught
 *   that one**, and a policy hiding every row of the operator's own billing
 *   history would have sat there until somebody noticed it was empty.
 *
 * So the assumption the generator made is asserted here instead of trusted. It
 * is a cheap test with an expensive failure mode behind it, and it reads the
 * DATABASE rather than the schema file — the policies live in Postgres, and a
 * check against the TypeScript that was used to write them would agree with the
 * mistake.
 */

const RUN = !!process.env.DATABASE_URL;
const d = RUN ? describe : describe.skip;

interface PolicyRow {
  table: string;
  policy: string;
  expr: string;
  has_entity_id: boolean;
}

d("entity-scope policies", () => {
  async function policies(): Promise<PolicyRow[]> {
    const res = await withSystem((tx) =>
      tx.execute(sql`
        select p.polrelid::regclass::text as table,
               p.polname                  as policy,
               coalesce(pg_get_expr(p.polqual, p.polrelid), '') as expr,
               exists (
                 select 1 from information_schema.columns c
                  where c.table_name = p.polrelid::regclass::text
                    and c.column_name = 'entity_id'
               ) as has_entity_id
          from pg_policy p
         where p.polpermissive = false
           and p.polname like '%\\_entity\\_scope'
         order by 1`),
    );
    return res.rows as unknown as PolicyRow[];
  }

  /** The parent tables an EXISTS clause reads, straight out of the expression. */
  function parentsIn(expr: string): string[] {
    return [...expr.matchAll(/FROM\s+([a-z_][a-z0-9_]*)\s+p\b/gi)].map((m) => m[1]);
  }

  it("exist at all, so a dropped migration fails loudly", async () => {
    const rows = await policies();
    expect(rows.length).toBeGreaterThan(40);
  });

  it("are all on a table that carries a company, or reads one through a parent", async () => {
    const rows = await policies();
    for (const row of rows) {
      const parents = parentsIn(row.expr);
      expect(
        row.has_entity_id || parents.length > 0 || row.table === "entities",
        `${row.table}: policy ${row.policy} neither carries entity_id nor reads a parent`,
      ).toBe(true);
    }
  });

  /**
   * THE ASSERTION THE TWO BUGS WOULD HAVE FAILED. A child may only inherit a
   * company through a parent it has a declared foreign key to — otherwise the
   * EXISTS is comparing one table's id space against another's, which returns
   * nothing and hides everything.
   */
  it("only read a parent the child has a real foreign key to", async () => {
    const rows = await policies();
    const offenders: string[] = [];
    for (const row of rows) {
      for (const parent of parentsIn(row.expr)) {
        const res = await withSystem((tx) =>
          tx.execute(sql`
            select 1 from pg_constraint
             where contype = 'f'
               and conrelid = ${row.table}::regclass
               and confrelid = ${parent}::regclass
             limit 1`),
        );
        if (res.rows.length === 0) offenders.push(`${row.table} -> ${parent}`);
      }
    }
    expect(offenders, `no foreign key backs these: ${offenders.join(", ")}`).toEqual([]);
  });

  /**
   * And the predicate lets the god view through. A RESTRICTIVE policy is AND'd
   * with everything else, including the superadmin's own permissive policy — so
   * a predicate that forgot this would stop every webhook, cron, seed and
   * migration on the platform from seeing rows.
   */
  it("let withSystem through, on every one of them", async () => {
    const res = await withSystem((tx) =>
      tx.execute(sql`select prosrc from pg_proc where proname = 'app_entity_allows'`),
    );
    expect(res.rows).toHaveLength(1);
    expect(String((res.rows[0] as { prosrc: string }).prosrc)).toContain("app_is_superadmin()");
  });
});
