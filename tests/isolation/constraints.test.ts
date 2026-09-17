import "dotenv/config";
import { expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { withSystem } from "../../src/db";
import { d } from "./_shared";

/**
 * Constraint shapes that have to hold across the WHOLE schema, asked of the
 * database itself rather than of the migrations that built it.
 *
 * **A BARE `ON DELETE SET NULL` CAN NEVER RUN ON A COMPOSITE KEY.** Every
 * tenant-scoped foreign key here is `(tenant_id, x)`, and Postgres's bare form
 * of that action nulls EVERY referencing column — `tenant_id` included, which
 * is NOT NULL on every one of these tables. So the delete the schema promises
 * fails at run time, against real rows, long after the migration applied
 * cleanly. PG 15's column-list form, `ON DELETE SET NULL ("x")`, nulls only the
 * column it names; `drizzle/0046` set the precedent and `0192`, `0200` and
 * `0375` are the repairs.
 *
 * WHY `pg_constraint` AND NOT THE MIGRATION FILES. A text scan over `drizzle/`
 * cannot see a REPAIR: the file that first installed a constraint keeps its
 * original wording forever, so `0096`, `0104` and `0197` still read as bare
 * long after `0192` and `0200` dropped and re-added those same three in the
 * column-list form. Scanning the files therefore reports offenders that were
 * fixed years of migrations ago and can never go quiet by doing the correct
 * thing, since the correct thing is a NEW migration rather than an edit to the
 * applied one. The catalogue holds the constraint that is actually installed,
 * which is the only version that can break a delete. This test was written
 * after a file scan reported those three as live bugs and a repair migration
 * was nearly written for constraints that were already correct on both
 * databases.
 *
 * WHY IT IS WORTH A STANDING TEST AT ALL. The bare form comes BACK on its own.
 * `.onDelete()` in Drizzle takes an action, not a column list, so the TS
 * declaration and the drizzle-kit snapshot both record a plain `set null` and
 * are a lossy description of what is installed — any later migration that
 * happens to touch one of these tables can emit a DROP and re-ADD in the bare
 * form and nothing will fail until a real delete meets a real child. That is
 * not hypothetical: it happened to `job_estimate_lines_group_fk` three hours
 * after `0373` installed it correctly, and was caught by hand.
 */
d("schema-wide constraint shapes", () => {
  interface Offender {
    table: string;
    constraint: string;
    def: string;
  }

  /** Every composite FK in `public` whose ON DELETE action is SET NULL. */
  const COMPOSITE_SET_NULL = sql`
    select rel.relname                  as "table",
           c.conname                    as "constraint",
           pg_get_constraintdef(c.oid)  as "def",
           c.confdelsetcols is null     as "bare"
      from pg_constraint c
      join pg_class     rel on rel.oid = c.conrelid
      join pg_namespace n   on n.oid   = rel.relnamespace
     where c.contype      = 'f'
       and n.nspname      = 'public'
       and c.confdeltype  = 'n'
       and cardinality(c.conkey) > 1
     order by rel.relname, c.conname`;

  it("never leaves a BARE ON DELETE SET NULL on a composite foreign key", async () => {
    const rows = (await withSystem((tx) => tx.execute(COMPOSITE_SET_NULL)))
      .rows as unknown as (Offender & { bare: boolean })[];

    // Non-vacuous: if the predicate ever stops matching, the assertion below
    // passes on an empty set and certifies nothing.
    expect(
      rows.length,
      "no composite ON DELETE SET NULL foreign keys found at all — the query above has stopped matching, so the check below is vacuous",
    ).toBeGreaterThan(0);

    const bare = rows
      .filter((r) => r.bare)
      .map((r) => `${r.table}.${r.constraint}: ${r.def}`);

    expect(
      bare,
      'use PG 15\'s column-list form — ON DELETE SET NULL ("the_column") — so the action nulls the reference and leaves tenant_id alone. ' +
        "An applied migration is never edited: the repair is a NEW migration that drops and re-adds the constraint, against dev and prod, before the merge.",
    ).toEqual([]);
  });
});
