import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isHidden } from "../src/lib/markdown-meta";

/**
 * The ADR index in `docs/decisions/README.md`, checked against the ADRs.
 *
 * It had been stale since 2026-09-14: 99 ADRs on disk, 58 rows in the table.
 * Nothing noticed, because an index is prose nobody compiles — every ADR was
 * written correctly and rendered correctly at `/admin/docs`, and the one page
 * whose whole job is finding them quietly stopped listing forty. PR #636
 * backfilled the rows by hand; this is what stops the next forty.
 *
 * Nothing here asserts a decision's WORDING. Retitling an ADR is allowed, and
 * a test that fails when prose is improved teaches people not to improve
 * prose. What it holds is the bookkeeping: one row per ADR, the link pointing
 * at the file it numbers, and the date and standing agreeing with the ADR's
 * own header.
 *
 * Filesystem only, no database, so it belongs on the parallel side.
 */

const DECISIONS = join(__dirname, "..", "docs", "decisions");

/** The rule this suite exists to enforce, quoted into every failure. */
const RULE =
  "The index row goes in the SAME COMMIT as the ADR — docs/conventions.md §11,\n" +
  '"A number is not a merge problem".';

interface Adr {
  /** `0042`, taken from the filename, which is the number of record. */
  number: string;
  file: string;
  /** The ISO date on the `- **Date:**` line, or null when there is none. */
  date: string | null;
  /** The bare standing on the `- **Status:**` line, or null when there is none. */
  status: string | null;
  /** The four digits after the `# `, or null when the heading is unreadable. */
  headingNumber: string | null;
}

interface Row {
  /** The link TEXT — what a reader sees in the `#` column. */
  number: string;
  href: string;
  decision: string;
  date: string;
  status: string;
  /** 1-indexed, so a failure names a line somebody can jump to. */
  line: number;
}

/**
 * The first ISO date on the line. 0013 writes
 * `2026-08-21, **revised 2026-08-22**`, and the index carries the date the
 * decision was taken.
 */
const firstDate = (value: string) => /\d{4}-\d{2}-\d{2}/.exec(value)?.[0] ?? null;

/**
 * The first word of the standing. A file is free to qualify it — "Accepted
 * (built 2026-09-05, Marketing slice 10)", "Accepted, amended by [0050](…)" —
 * where the column holds `Accepted`, `Proposed` or `Superseded`.
 */
const firstWord = (value: string) => /^[A-Za-z]+/.exec(value.trim())?.[0] ?? null;

function readAdrs(): Adr[] {
  return readdirSync(DECISIONS)
    .filter((name) => name.endsWith(".md") && name !== "README.md" && !isHidden(name))
    .sort()
    .map((file) => {
      const raw = readFileSync(join(DECISIONS, file), "utf8");
      const date = /^- \*\*Date:\*\*(.*)$/m.exec(raw)?.[1];
      const status = /^- \*\*Status:\*\*(.*)$/m.exec(raw)?.[1];
      return {
        number: file.slice(0, 4),
        file,
        date: date === undefined ? null : firstDate(date),
        status: status === undefined ? null : firstWord(status),
        /**
         * Deliberately NOT the separator. 42 ADRs write `# 0042. Title` and 57
         * write `# 0042 — Title`; both are fine and neither is worth a sweep,
         * so only the number is read.
         */
        headingNumber: /^# (\d{4})(?=[.\s—-])/m.exec(raw)?.[1] ?? null,
      };
    });
}

function readIndex(): Row[] {
  const lines = readFileSync(join(DECISIONS, "README.md"), "utf8").split("\n");
  const start = lines.findIndex((line) => /^##\s+Index\s*$/.test(line));
  expect(start, "docs/decisions/README.md has lost its `## Index` heading").toBeGreaterThan(-1);

  const rows: Row[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    // The Index is the last section today; stop at a sibling heading anyway,
    // so a section appended under it cannot be read as more rows.
    if (/^##\s/.test(lines[i])) break;
    const cells =
      /^\|\s*\[([^\]]*)\]\(([^)]*)\)\s*\|([^|]*)\|([^|]*)\|([^|]*)\|\s*$/.exec(lines[i]);
    if (!cells) continue;
    rows.push({
      number: cells[1].trim(),
      href: cells[2].trim(),
      decision: cells[3].trim(),
      date: cells[4].trim(),
      status: cells[5].trim(),
      line: i + 1,
    });
  }
  return rows;
}

describe("the ADR index", () => {
  const adrs = readAdrs();
  const rows = readIndex();

  it("has ADRs to index in the first place", () => {
    // Guards the guard: a glob that matched nothing would make every
    // assertion below vacuously true, which is the failure mode of a test
    // that reads a directory.
    expect(adrs.length).toBeGreaterThan(50);
    expect(rows.length).toBeGreaterThan(50);
  });

  it("gives every ADR the header the index is built from", () => {
    const broken = adrs.filter(
      (adr) => !adr.date || !adr.status || adr.headingNumber !== adr.number,
    );
    const explain = broken
      .map(
        (adr) =>
          `  ${adr.file}\n` +
          `    heading number: ${adr.headingNumber ?? "MISSING — needs `# NNNN` as its first heading"}\n` +
          `    - **Date:**     ${adr.date ?? "MISSING or not YYYY-MM-DD"}\n` +
          `    - **Status:**   ${adr.status ?? "MISSING"}`,
      )
      .join("\n");
    expect(
      broken.map((adr) => adr.file),
      `These ADRs cannot be indexed, because their own header does not say\n` +
        `what to index them as. Copy the shape from docs/decisions/_TEMPLATE.md:\n\n${explain}`,
    ).toEqual([]);
  });

  it("lists every ADR exactly once", () => {
    const counts = new Map<string, number>();
    for (const row of rows) counts.set(row.number, (counts.get(row.number) ?? 0) + 1);

    const missing = adrs.filter((adr) => !counts.has(adr.number));
    const duplicated = [...counts].filter(([, n]) => n > 1).map(([number]) => number);
    const orphaned = rows.filter((row) => !adrs.some((adr) => adr.number === row.number));

    const explain = [
      missing.length &&
        `These ADRs exist but are NOT in the index, so the page that lists the\n` +
          `decisions does not know about them:\n` +
          missing.map((adr) => `  + ${adr.file}`).join("\n"),
      duplicated.length &&
        `These numbers have more than one row. docs/decisions/README.md is\n` +
          `merge=union, so two sessions adding the same row both get theirs:\n` +
          duplicated.map((number) => `  ! ${number}`).join("\n"),
      orphaned.length &&
        `These rows name a number with no ADR behind it — renamed, or never\n` +
          `committed:\n` +
          orphaned.map((row) => `  - ${row.number} (README.md:${row.line})`).join("\n"),
      `\n${RULE}`,
    ]
      .filter(Boolean)
      .join("\n\n");

    expect(missing.map((adr) => adr.file), explain).toEqual([]);
    expect(duplicated, explain).toEqual([]);
    expect(orphaned.map((row) => row.number), explain).toEqual([]);
  });

  it("points every row at the file it numbers, and says something about it", () => {
    const wrong: string[] = [];
    for (const row of rows) {
      const adr = adrs.find((candidate) => candidate.file === row.href);
      if (!adr) {
        wrong.push(`README.md:${row.line} links to \`${row.href}\`, which is not a file here`);
      } else if (adr.number !== row.number) {
        // `[0041](0042-….md)` reads correctly and goes to the wrong decision.
        wrong.push(
          `README.md:${row.line} reads [${row.number}] but links to ${adr.file} (${adr.number})`,
        );
      }
      if (!row.decision) {
        wrong.push(`README.md:${row.line} has an empty Decision cell`);
      }
    }
    expect(wrong, `${wrong.join("\n")}\n\n${RULE}`).toEqual([]);
  });

  it("carries the date and the standing each ADR gives itself", () => {
    const wrong: string[] = [];
    for (const adr of adrs) {
      const row = rows.find((candidate) => candidate.number === adr.number);
      if (!row) continue; // reported by the "exactly once" test above
      if (row.date !== adr.date) {
        wrong.push(`${adr.number}  Date    index "${row.date}" vs ADR "${adr.date}"`);
      }
      if (row.status !== adr.status) {
        wrong.push(`${adr.number}  Status  index "${row.status}" vs ADR "${adr.status}"`);
      }
    }
    expect(
      wrong,
      `The index disagrees with the ADRs it lists. The ADR is the record and\n` +
        `the index is a listing of it, so the ADR wins — including when a\n` +
        `decision is accepted or superseded later and only the file was\n` +
        `updated (README.md:${rows[0]?.line ?? "?"} onwards):\n\n` +
        `${wrong.map((line) => `  ${line}`).join("\n")}\n\n${RULE}`,
    ).toEqual([]);
  });

  it("keeps the rows in ascending number order", () => {
    const numbers = rows.map((row) => row.number);
    const sorted = [...numbers].sort();
    const firstBreak = numbers.findIndex((number, i) => number !== sorted[i]);
    expect(
      numbers,
      `The index is out of order from ${numbers[firstBreak]} ` +
        `(README.md:${rows[firstBreak]?.line}), where ${sorted[firstBreak]} was expected.\n` +
        `This is what a merge=union of two sessions' rows looks like — both\n` +
        `survived, in whichever order git kept them. Move the row.`,
    ).toEqual(sorted);
  });
});
