import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A `"use server"` file may export ONLY async functions.
 *
 * Anything else — a const, a class, an enum, a plain function — makes Next.js
 * throw at module-evaluation time:
 *
 *   A "use server" file can only export async functions, found object.
 *
 * That kills every action in the file AND every page that transitively imports
 * it. On 2026-08-08 an exported `CALENDAR_COLORS` array in
 * `src/modules/scheduling/actions.ts` took down the superadmin tenant page in
 * production: enabling ANY module 500'd, because that page reaches the file
 * through `moduleRegistry` → `SchedulingModule` → `calendar-manager`.
 *
 * THIS TEST EXISTS BECAUSE NOTHING ELSE CATCHES IT. `tsc` is happy, eslint is
 * happy, the rest of the suite is happy, and — unlike the `server-only`
 * violations AGENTS.md says the build catches — **`npm run build` is happy
 * too**. The error surfaces only when a request evaluates the server-action
 * graph, which no CI step does.
 *
 * Exported `type` and `interface` are fine and deliberately allowed: they are
 * erased before runtime, so Next never sees them. Several action files rely on
 * that.
 *
 * KNOWN LIMIT: this reads declaration forms, not a real parse, so a re-export
 * (`export { thing } from "..."`) of a non-async value would slip through.
 * Nothing does that today, and the common mistake is the one above.
 */

const ROOT = join(process.cwd(), "src");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.tsx?$/.test(entry)) out.push(path);
  }
  return out;
}

/** Declaration forms that put a VALUE on the module's exports at runtime. */
const ILLEGAL = [
  /^export\s+(const|let|var)\s/,
  /^export\s+(abstract\s+)?class\s/,
  /^export\s+(const\s+)?enum\s/,
  // A non-async exported function. `export async function` is the legal form,
  // and `export default async function` is fine too.
  /^export\s+(default\s+)?function[\s*]/,
];

describe('"use server" files export only async functions', () => {
  const files = walk(ROOT).filter((path) => {
    const head = readFileSync(path, "utf8").slice(0, 200);
    return /^\s*("use server"|'use server')/.test(head);
  });

  it("finds the action files at all (guards against a broken scan)", () => {
    // If this ever drops to zero the test above is vacuously green, which is
    // the failure mode that makes a checker worse than no checker.
    expect(files.length).toBeGreaterThan(5);
  });

  it("has no non-async value exports", () => {
    const offenders: string[] = [];
    for (const path of files) {
      const lines = readFileSync(path, "utf8").split(/\r?\n/);
      lines.forEach((line, i) => {
        if (ILLEGAL.some((re) => re.test(line))) {
          offenders.push(
            `${path.replace(process.cwd() + "\\", "").replace(process.cwd() + "/", "")}:${i + 1}  ${line.trim().slice(0, 80)}`,
          );
        }
      });
    }
    expect(
      offenders,
      `A "use server" file may export only async functions. Move these to a\n` +
        `plain module beside it (see src/modules/scheduling/core/colors.ts):\n\n` +
        offenders.join("\n"),
    ).toEqual([]);
  });
});
