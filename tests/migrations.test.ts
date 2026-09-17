import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Rules that hold across EVERY migration, scanned from the files themselves.
 *
 * These exist because CI cannot check them: it builds its own database from
 * zero, so every migration always applies there, and a constraint that is
 * merely WRONG rather than unapplyable passes silently and fails later against
 * real rows.
 */

const DIR = "drizzle";
const FILES = readdirSync(DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort();

/**
 * Every FOREIGN KEY with its column list and its ON DELETE clause. The `ON
 * DELETE SET NULL` may carry a column list of its own — PG 15's form — and
 * this captures it when it does.
 */
const FOREIGN_KEY =
  /FOREIGN KEY\s*\(([^)]*)\)\s*REFERENCES[^;]*?ON DELETE SET NULL\s*(\(\s*"[^"]+"(?:\s*,\s*"[^"]+")*\s*\))?/gi;

/**
 * ALREADY APPLIED AND ALREADY WRONG — found by this test's first run, 2026-09-16.
 *
 * Each of these three installed a bare `ON DELETE SET NULL` on a composite key,
 * so **the delete they describe fails at run time**: a parent work item with
 * children, a parent schedule item with children, and a processor price item an
 * order line points at. They are listed rather than fixed because an applied
 * migration is never edited — the database already holds the constraint, and the
 * repair is a NEW migration that drops and re-adds each one in the column-list
 * form, against dev and prod, in the usual before-the-merge ritual.
 *
 * Nothing may be added to this list. A new offender is a bug to fix before it
 * is applied, which is the whole point of the test.
 */
const APPLIED_AND_WRONG = [
  '0096_sudden_star_brand.sql: FOREIGN KEY ("tenant_id","parent_id") ... ON DELETE SET NULL',
  '0104_slow_zemo.sql: FOREIGN KEY ("tenant_id","parent_id") ... ON DELETE SET NULL',
  '0197_amazing_mentallo.sql: FOREIGN KEY ("tenant_id","price_item_id") ... ON DELETE SET NULL',
];

describe("every migration", () => {
  it("has at least one file, so a broken glob cannot make this suite vacuous", () => {
    expect(FILES.length).toBeGreaterThan(300);
  });

  /**
   * **A BARE `ON DELETE SET NULL` CAN NEVER RUN ON A COMPOSITE KEY.** Every
   * tenant-scoped foreign key in this repo is `(tenant_id, x)`, and a bare SET
   * NULL would try to null `tenant_id` too, which is NOT NULL — so the delete
   * fails at run time, against real rows, long after the migration applied
   * cleanly. PG 15's column-list form (`ON DELETE SET NULL ("x")`) is the fix
   * and the 0046 precedent.
   *
   * This is a scan test rather than a review habit because **drizzle-kit
   * regenerates the bare form on its own**: the snapshot cannot express the
   * column list, so any later migration that happens to touch the same table
   * may emit a DROP and re-ADD that quietly reverts it. That is exactly what
   * 0375 did to `job_estimate_lines_group_fk`, three hours after 0373
   * installed it correctly.
   */
  it("never writes a BARE ON DELETE SET NULL on a composite foreign key", () => {
    const offenders: string[] = [];
    for (const file of FILES) {
      const sql = readFileSync(`${DIR}/${file}`, "utf8");
      for (const m of sql.matchAll(FOREIGN_KEY)) {
        const columns = m[1].split(",").filter((c) => c.trim() !== "");
        if (columns.length > 1 && m[2] === undefined) {
          offenders.push(`${file}: FOREIGN KEY (${m[1].trim()}) ... ON DELETE SET NULL`);
        }
      }
    }
    expect(
      offenders,
      "use PG 15's column-list form — ON DELETE SET NULL (\"the_column\") — on a composite key",
    ).toEqual(APPLIED_AND_WRONG);
  });

  it("keeps the known-wrong list closed: three, and the newest of them predates this test", () => {
    expect(APPLIED_AND_WRONG).toHaveLength(3);
    // A fourth would mean somebody added to the list instead of fixing the migration.
    for (const known of APPLIED_AND_WRONG) expect(Number(known.slice(0, 4))).toBeLessThan(375);
  });

  it("finds the column-list form where the repo installed it, so the pattern above is really being read", () => {
    const withList = FILES.filter((f) =>
      /ON DELETE SET NULL\s*\(\s*"/i.test(readFileSync(`${DIR}/${f}`, "utf8")),
    );
    expect(withList.length).toBeGreaterThan(0);
  });
});
