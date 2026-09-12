import { promises as fs } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { violatedUniqueIndex } from "../src/modules/time/core/errors";

/**
 * Turning a unique-index violation into a sentence somebody can read.
 *
 * ── WHY THIS FILE EXISTS ─────────────────────────────────────────────────────
 *
 * Three places in the time module wrote
 * `String(err).includes("<index name>")` and **not one of them ever fired.**
 * Drizzle wraps the driver's error, so `String(err)` is the SQL — `Failed
 * query: insert into "time_punches" …` — and never the constraint. A second
 * clock-in showed a raw query dump where "a clock is already running" was
 * written and waiting, and nothing failed, because the fallback `throw err`
 * is a perfectly good code path.
 *
 * That is the shape the repo has been bitten by before: a check that returns a
 * real-but-wrong answer, so no test goes red. The unit tests below pin the
 * error shape that was MEASURED against Postgres; the scan below stops the
 * broken idiom coming back in a file nobody is looking at.
 */

/** Exactly what a double clock-in throws — measured, not imagined. */
function drizzleWrapped(code: string, constraint: string): Error {
  const err = new Error(
    'Failed query: insert into "time_punches" ("id", "tenant_id") values (default, $1)',
  );
  (err as { cause?: unknown }).cause = Object.assign(new Error("duplicate key"), {
    severity: "ERROR",
    code,
    constraint,
    table: "time_punches",
    routine: "_bt_check_unique",
  });
  return err;
}

describe("violatedUniqueIndex", () => {
  it("finds the index name one level down, where the driver actually put it", () => {
    const err = drizzleWrapped("23505", "time_punches_one_open_idx");
    expect(violatedUniqueIndex(err)).toBe("time_punches_one_open_idx");
  });

  it("reads an unwrapped driver error too", () => {
    const err = Object.assign(new Error("duplicate key"), {
      code: "23505",
      constraint: "time_workers_tenant_user_idx",
    });
    expect(violatedUniqueIndex(err)).toBe("time_workers_tenant_user_idx");
  });

  it("is null for anything that is not a unique violation", () => {
    expect(violatedUniqueIndex(drizzleWrapped("23503", "some_fk"))).toBeNull();
    expect(violatedUniqueIndex(new Error("boom"))).toBeNull();
    expect(violatedUniqueIndex(null)).toBeNull();
    expect(violatedUniqueIndex(undefined)).toBeNull();
    expect(violatedUniqueIndex("a string")).toBeNull();
  });

  it("is null when it is a unique violation the driver did not name", () => {
    // Better to keep travelling as a failure than to be translated into a
    // sentence about the wrong index.
    const err = new Error("nope");
    (err as { cause?: unknown }).cause = { code: "23505" };
    expect(violatedUniqueIndex(err)).toBeNull();
  });

  it("does NOT match the index name in the SQL text, which is the trap", () => {
    // A query that merely MENTIONS the index — an ON CONFLICT clause, say —
    // is not a violation of it. The old `String(err).includes` idiom could
    // not tell those apart even when it matched.
    const err = new Error(
      'Failed query: insert ... on conflict on constraint time_punches_one_open_idx do nothing',
    );
    expect(violatedUniqueIndex(err)).toBeNull();
  });
});

describe("nothing matches a constraint by searching the error text", () => {
  it("has no String(err).includes(\"…_idx\") left in src/", async () => {
    const offenders: string[] = [];

    async function walk(dir: string): Promise<void> {
      for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(full);
          continue;
        }
        if (!/\.tsx?$/.test(entry.name)) continue;
        const source = await fs.readFile(full, "utf8");
        // `String(err).includes("x_idx")`, `err.message.includes("x_idx")`,
        // and the `${err}` spelling of the same mistake.
        if (
          /(?:String\([^)]*\)|\.message)\s*\.includes\(\s*["'`][^"'`]*_idx/.test(
            source,
          )
        ) {
          offenders.push(path.relative(path.resolve(__dirname, ".."), full));
        }
      }
    }

    await walk(path.resolve(__dirname, "..", "src"));

    expect(
      offenders,
      `These match a constraint by searching the error's TEXT, which drizzle\n` +
        `replaces with the SQL — so the branch never runs and the sentence beside\n` +
        `it is never shown. Use violatedUniqueIndex() from time/core/errors.ts:\n` +
        offenders.map((f) => `  - ${f}`).join("\n"),
    ).toEqual([]);
  });
});
