import { promises as fs } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DB_BACKED_TESTS } from "./db-backed-files";

/**
 * The list in db-backed-files.ts decides which suites run sequentially, and an
 * enumeration in a config file is exactly the kind of thing that silently rots:
 * somebody adds a `d(...)` block to a file that used to be pure, it lands in the
 * parallel project, and it races against the other database suites. The symptom
 * is a test that fails once a fortnight on a machine nobody is watching.
 *
 * So the list is recomputed here from what the files actually contain, and this
 * test fails if the two disagree. Enumeration is fine as long as something
 * checks it.
 *
 * A file counts as database-backed if it reads DATABASE_URL directly, or pulls
 * the `d` / `RUN` gate out of a sibling `_shared` module (which is what the
 * isolation and documents-dms suites do since they were split up).
 *
 * NOTE the marker is assembled from fragments rather than written out. Spelled
 * literally, this file would match its own rule and be reported as a database
 * suite — a small joke at the expense of anyone who writes the obvious version.
 */
const ENV_MARKER = ["process", "env", "DATABASE_URL"].join(".");
const SHARED_GATE = /import\s*\{[^}]*\b(?:d|RUN)\b[^}]*\}\s*from\s*"\.\/_shared"/;

const TESTS_DIR = path.resolve(__dirname);

async function walk(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const out = await Promise.all(
    entries.map((e) => {
      const full = path.join(dir, e.name);
      return e.isDirectory() ? walk(full) : Promise.resolve([full]);
    }),
  );
  return out.flat();
}

/** Repo-relative, forward slashes — the form the config and the list use. */
function relative(file: string) {
  return path.relative(path.resolve(TESTS_DIR, ".."), file).split(path.sep).join("/");
}

describe("database-backed test classification", () => {
  it("db-backed-files.ts lists exactly the suites that touch the database", async () => {
    const files = (await walk(TESTS_DIR)).filter((f) => f.endsWith(".test.ts"));

    const actual: string[] = [];
    for (const file of files) {
      const source = await fs.readFile(file, "utf8");
      if (source.includes(ENV_MARKER) || SHARED_GATE.test(source)) {
        actual.push(relative(file));
      }
    }
    actual.sort();

    const listed = [...DB_BACKED_TESTS].sort();
    const missing = actual.filter((f) => !listed.includes(f));
    const stale = listed.filter((f) => !actual.includes(f));

    const explain = [
      missing.length &&
        `These talk to the database but are NOT listed, so they are running in\n` +
          `the PARALLEL project and can race the other database suites:\n` +
          missing.map((f) => `  + ${f}`).join("\n"),
      stale.length &&
        `These are listed but no longer touch the database, so they are being\n` +
          `serialised for nothing:\n` +
          stale.map((f) => `  - ${f}`).join("\n"),
      `\nFix by editing the array in tests/db-backed-files.ts to match.`,
    ]
      .filter(Boolean)
      .join("\n\n");

    expect(missing, explain).toEqual([]);
    expect(stale, explain).toEqual([]);
  });

  it("every listed file exists", async () => {
    const missing: string[] = [];
    for (const rel of DB_BACKED_TESTS) {
      try {
        await fs.access(path.resolve(TESTS_DIR, "..", rel));
      } catch {
        missing.push(rel);
      }
    }
    // A renamed or deleted file left in the list means its `include` entry
    // matches nothing — the suite quietly stops running rather than failing.
    expect(missing, `Listed in db-backed-files.ts but not on disk:\n${missing.join("\n")}`).toEqual(
      [],
    );
  });
});
