import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Rules that hold across EVERY migration, scanned from the files themselves.
 *
 * These exist because CI cannot check them: it builds its own database from
 * zero, so every migration always applies there, and a constraint that is
 * merely WRONG rather than unapplyable passes silently and fails later against
 * real rows.
 *
 * WHAT A TEXT SCAN CAN AND CANNOT SEE. It reads the migrations as WRITTEN,
 * which is the only version that exists BEFORE one is applied — so this is the
 * right place to stop a bad constraint from ever reaching a database, while the
 * file can still be edited. It is the wrong place to ask what a database
 * currently HOLDS: an applied migration is never edited and a repair is a NEW
 * file, so the migration that first installed a constraint keeps its original
 * wording forever. `tests/isolation/constraints.test.ts` asks `pg_constraint`
 * for that, and is the authoritative guard because a repair cannot fool it.
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
 * BARE AS WRITTEN, REPAIRED BY A LATER MIGRATION — superseded, not broken.
 *
 * Each of these three installed a bare `ON DELETE SET NULL` on a composite key,
 * and each was repaired later by the migration named beside it. **The
 * constraint the database holds today carries PG 15's column-list form on all
 * three, so there is nothing here to fix and no delete that fails at run time.**
 * Checked against `pg_constraint` on dev and production on 2026-09-16, and
 * re-checked on dev when this list was renamed — **17 composite SET NULL
 * foreign keys, 0 of them bare**, both times. Checked behaviourally too, on the
 * dev branch inside a rolled-back transaction: deleting a parent work item that
 * still has a child unparents the child and leaves `tenant_id` intact.
 *
 * THEY CANNOT LEAVE THIS LIST BY BEING FIXED, because they already were. An
 * applied migration is never edited, so `0096` still READS as bare and always
 * will. That is the structural limit of scanning text, and the only reason this
 * list exists. An earlier version of this comment called the three "already
 * applied and already wrong" and claimed the delete they describe fails at run
 * time; on the strength of that, a repair migration was nearly written for
 * three constraints that were already correct on both databases. The list is a
 * record of what the scan cannot see, not a defect log.
 *
 * ADDING AN ENTRY IS NOT A WAY PAST THE SCAN. A new offender is a bug to fix
 * BEFORE it is applied, while the file is still editable — which is how
 * `job_estimate_lines_group_fk` was caught in `0375`, three hours after `0373`
 * installed it correctly, and fixed by deleting the two statements rather than
 * by listing them here. An entry earns its place only once a later migration
 * has really repaired it, which the test below proves instead of trusting.
 */
const APPLIED_THEN_REPAIRED = [
  {
    offender:
      '0096_sudden_star_brand.sql: FOREIGN KEY ("tenant_id","parent_id") ... ON DELETE SET NULL',
    constraint: "schedule_items_parent_fk",
    repairedBy: "0192_parent_fk_set_null_parent_id.sql",
  },
  {
    offender:
      '0104_slow_zemo.sql: FOREIGN KEY ("tenant_id","parent_id") ... ON DELETE SET NULL',
    constraint: "work_items_parent_fk",
    repairedBy: "0192_parent_fk_set_null_parent_id.sql",
  },
  {
    offender:
      '0197_amazing_mentallo.sql: FOREIGN KEY ("tenant_id","price_item_id") ... ON DELETE SET NULL',
    constraint: "production_order_lines_price_item_fk",
    repairedBy: "0200_order_line_price_item_set_null.sql",
  },
];

/** The migration a grandfathered entry was written in, e.g. `0096`. */
const serial = (file: string) => Number(file.slice(0, 4));

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
   * installed it correctly — and catching it HERE, before it was applied, is
   * what this test is for: the statements were deleted from the file and no
   * constraint was ever installed wrong.
   *
   * The three expected offenders are the ones a scan can never stop reporting;
   * `APPLIED_THEN_REPAIRED` explains why, and the database-side guard is
   * `tests/isolation/constraints.test.ts`.
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
      "use PG 15's column-list form — ON DELETE SET NULL (\"the_column\") — on a composite key. " +
        "Fix the migration now, while it is still unapplied; do not add it to APPLIED_THEN_REPAIRED, " +
        "which is only for files a LATER migration has already repaired.",
    ).toEqual(APPLIED_THEN_REPAIRED.map((e) => e.offender));
  });

  /**
   * The grandfathered entries claim to be superseded. This checks the claim, so
   * the list cannot be used to launder a genuinely broken migration: the named
   * repair has to exist, come afterwards, re-add that very constraint, and do it
   * in the column-list form.
   */
  it("grandfathers only migrations a later file really repaired", () => {
    for (const { offender, constraint, repairedBy } of APPLIED_THEN_REPAIRED) {
      const original = offender.slice(0, offender.indexOf(":"));

      expect(
        FILES,
        `${repairedBy} is named as the repair for ${constraint} but is not in ${DIR}/`,
      ).toContain(repairedBy);
      expect(
        serial(repairedBy),
        `${repairedBy} must come AFTER ${original} to be its repair`,
      ).toBeGreaterThan(serial(original));

      const repair = readFileSync(`${DIR}/${repairedBy}`, "utf8");
      expect(repair, `${repairedBy} must re-add ${constraint}`).toContain(constraint);
      expect(
        /ON DELETE SET NULL\s*\(\s*"/i.test(repair),
        `${repairedBy} must install the column-list form`,
      ).toBe(true);
    }
  });

  it("keeps the grandfathered list closed: three, and every one of them predates this test", () => {
    expect(APPLIED_THEN_REPAIRED).toHaveLength(3);
    // A fourth means a bare composite SET NULL reached a database — fixable
    // only by a repair migration, and worth noticing rather than absorbing.
    for (const { offender } of APPLIED_THEN_REPAIRED)
      expect(serial(offender)).toBeLessThan(375);
  });

  it("finds the column-list form where the repo installed it, so the pattern above is really being read", () => {
    const withList = FILES.filter((f) =>
      /ON DELETE SET NULL\s*\(\s*"/i.test(readFileSync(`${DIR}/${f}`, "utf8")),
    );
    expect(withList.length).toBeGreaterThan(0);
  });
});
