/**
 * READING A PASTED COST CODE LIST — pure, no database, no model.
 *
 * ── WHY NO MODEL ────────────────────────────────────────────────────────────
 *
 * The platform already has an AI paste extractor (`src/lib/paste-targets/`)
 * for the messy case — a photographed herd book, a supplier's emailed list.
 * **A chart of cost is the wrong place for it.** The source is a spreadsheet
 * with columns, the shape is regular, and a model that misreads `03.100` as
 * `03.10` produces a chart that looks right and posts money to the wrong
 * phase for a year. Deterministic parsing can fail loudly; a model fails
 * plausibly, which is the failure this pack refuses everywhere else.
 *
 * ── THE ORDER OF THE PASTE IS THE ORDER OF THE CHART ────────────────────────
 *
 * **AND THAT IS LOAD-BEARING, NOT TIDINESS.** The pilot's own 291-code list
 * runs `03.90, 03.95, 03.100, 03.105` — numbering that sorts CORRECTLY by
 * hand and wrongly as text, because `03.100` is less than `03.20` to a
 * computer. Sorted as text, **251 of its 291 codes land in the wrong place**.
 * `listCostCodes` orders by `sortOrder` before it falls back to the code, so
 * the row order carried across here is the only thing keeping that list in
 * the shape its owner wrote. `tests/jobs-cost-code-import.test.ts` holds the
 * case.
 *
 * ── A COLUMN THAT SAYS THE SAME THING ON EVERY ROW SAYS NOTHING ─────────────
 *
 * The pilot's export carries an `Item Type` column reading `Service` on all
 * 291 rows — a bookkeeping artefact of wherever it came from. A uniform
 * column is dropped rather than imported as a category nobody chose.
 */

/** What a paste turns into: one row of the chart, in the order it was given. */
export interface ParsedCostCode {
  code: string;
  name: string;
  /**
   * The list's own grouping — the pilot's *"03. Infrastructure"*, a CSI
   * division, whatever the business calls it. **A category is a label, not a
   * row**, so nothing can post to it; see `category` in the schema.
   */
  category: string;
  /** Where it was in the paste, 1-based. */
  line: number;
}

export interface ImportIssue {
  line: number;
  text: string;
  /** What is wrong, in words somebody can act on. */
  reason: string;
}

export interface ParsedImport {
  codes: ParsedCostCode[];
  /** Lines that carried no code, and duplicates. Never silently dropped. */
  issues: ImportIssue[];
  /** A header row that was recognised and skipped, for the preview to echo. */
  skippedHeader: string;
}

export const MAX_IMPORT_ROWS = 2_000;
export const CODE_MAX = 40;
export const NAME_MAX = 200;
export const CATEGORY_MAX = 120;

/**
 * A code is a leading run of digits, which may carry dots or inner spaces:
 * `1000`, `03.20`, `03 30 00`. It may be followed by a dash, a colon or just
 * a space before the name.
 *
 * **IT MUST START WITH A DIGIT.** A looser rule turned `Excavation Labor`
 * into the code `Excavation`, and a chart whose first column is sometimes a
 * word is worse than one that refuses the line and says so.
 */
const CODE_AND_NAME = /^\s*([0-9][0-9.]*(?:\s+[0-9]+)*)\s*(?:[-–—:]+\s*|\s+)(.+?)\s*$/;

/** A cell that is only a code, with the name in the next cell along. */
const CODE_ONLY = /^\s*([0-9][0-9.]*(?:\s+[0-9]+)*)\s*$/;

function tidyCode(raw: string): string {
  return raw.trim().replace(/[.\s]+$/, "").replace(/\s+/g, " ");
}

function looksLikeHeader(cells: readonly string[]): boolean {
  if (cells.length === 0) return false;
  if (cells.some((c) => CODE_AND_NAME.test(c) || CODE_ONLY.test(c))) return false;
  const words = cells.join(" ").toLowerCase();
  return /\b(code|item|name|parent|child|type|description|category|division)\b/.test(words);
}

/** Tabs when there are any — that is what a spreadsheet pastes — else commas. */
function splitCells(line: string): string[] {
  const cells = line.includes("\t") ? line.split("\t") : line.split(",");
  return cells.map((c) => c.trim().replace(/^"(.*)"$/, "$1").trim());
}

/**
 * Columns whose value never changes across the whole paste. They carry no
 * information and are not offered as a category.
 */
function uniformColumns(rows: readonly string[][]): Set<number> {
  const width = Math.max(0, ...rows.map((r) => r.length));
  const out = new Set<number>();
  for (let i = 0; i < width; i += 1) {
    const values = new Set(rows.map((r) => (r[i] ?? "").trim()).filter((v) => v !== ""));
    if (values.size === 1 && rows.length > 1) out.add(i);
  }
  return out;
}

export function parseCostCodes(input: string): ParsedImport {
  const rawLines = input
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.trimEnd());

  const kept: { cells: string[]; line: number; text: string }[] = [];
  let skippedHeader = "";
  for (let i = 0; i < rawLines.length; i += 1) {
    const text = rawLines[i];
    if (text.trim() === "") continue;
    const cells = splitCells(text);
    if (kept.length === 0 && skippedHeader === "" && looksLikeHeader(cells)) {
      skippedHeader = text.trim();
      continue;
    }
    kept.push({ cells, line: i + 1, text: text.trim() });
  }

  const uniform = uniformColumns(kept.map((k) => k.cells));

  const codes: ParsedCostCode[] = [];
  const issues: ImportIssue[] = [];
  const seen = new Map<string, number>();

  for (const row of kept) {
    if (codes.length >= MAX_IMPORT_ROWS) {
      issues.push({
        line: row.line,
        text: row.text,
        reason: `over ${MAX_IMPORT_ROWS.toLocaleString()} rows — bring the rest in a second paste`,
      });
      continue;
    }

    /**
     * Find the cell carrying the code — **and the first match is the wrong
     * answer.** The pilot's parent column reads `03. Infrastructure`, which
     * is itself code-shaped, so a left-to-right scan took `03` off every
     * single row and then called all 291 of them duplicates of each other.
     *
     * **THE LEAF WINS, AND A LEAF'S CODE IS LONGER THAN ITS PARENT'S.**
     * `03.20` beats `03`; `03 30 00` beats `03`. That is true of the pilot's
     * numbering and of CSI, because a child's code extends its parent's.
     * Ties go to the rightmost cell, which is where an export of this shape
     * puts the leaf.
     */
    let code = "";
    let name = "";
    let at = -1;
    for (let i = 0; i < row.cells.length; i += 1) {
      const cell = row.cells[i];
      let here = "";
      let label = "";
      const both = CODE_AND_NAME.exec(cell);
      if (both) {
        here = tidyCode(both[1]);
        label = both[2].trim();
      } else if (CODE_ONLY.test(cell)) {
        const next = row.cells.slice(i + 1).find((c) => c !== "");
        if (next !== undefined) {
          here = tidyCode(cell);
          label = next.trim();
        }
      }
      if (here === "" || label === "") continue;
      if (here.length >= code.length) {
        code = here;
        name = label;
        at = i;
      }
    }

    if (code === "" || name === "") {
      issues.push({ line: row.line, text: row.text, reason: "no code and name on this line" });
      continue;
    }
    if (code.length > CODE_MAX) {
      issues.push({ line: row.line, text: row.text, reason: "that code is too long" });
      continue;
    }

    const already = seen.get(code.toLowerCase());
    if (already !== undefined) {
      issues.push({
        line: row.line,
        text: row.text,
        reason: `the same code as line ${already}`,
      });
      continue;
    }
    seen.set(code.toLowerCase(), row.line);

    /**
     * The category is the last meaningful cell BEFORE the code — the column
     * layout of every export of this shape, the pilot's included:
     * `Item Type | Parent Item | Child Item`.
     */
    let category = "";
    for (let i = at - 1; i >= 0; i -= 1) {
      if (uniform.has(i)) continue;
      const value = row.cells[i].trim();
      if (value !== "") {
        category = value.slice(0, CATEGORY_MAX);
        break;
      }
    }

    codes.push({ code, name: name.slice(0, NAME_MAX), category, line: row.line });
  }

  return { codes, issues, skippedHeader };
}

/** What the preview says before anybody writes anything. */
export interface ImportPlan {
  adding: number;
  updating: number;
  unchanged: number;
  /** Codes already in the set that the paste did not mention. Left alone. */
  untouched: number;
  categories: string[];
}

/**
 * **NOTHING IS DELETED AND NOTHING IS SWITCHED OFF.** A code already in the
 * set that the paste does not mention is left exactly as it is: it may have a
 * year of costs posted against it, and a list somebody pasted to add three
 * rows must never be read as an instruction to retire forty.
 */
export function planImport(
  parsed: readonly ParsedCostCode[],
  existing: readonly { code: string; name: string; category: string }[],
): ImportPlan {
  const byCode = new Map(existing.map((e) => [e.code.trim().toLowerCase(), e]));
  let adding = 0;
  let updating = 0;
  let unchanged = 0;
  for (const row of parsed) {
    const was = byCode.get(row.code.toLowerCase());
    if (!was) {
      adding += 1;
    } else if (was.name === row.name && was.category === row.category) {
      unchanged += 1;
    } else {
      updating += 1;
    }
  }
  const mentioned = new Set(parsed.map((p) => p.code.toLowerCase()));
  const untouched = existing.filter((e) => !mentioned.has(e.code.trim().toLowerCase())).length;

  const categories: string[] = [];
  for (const row of parsed) {
    if (row.category !== "" && !categories.includes(row.category)) categories.push(row.category);
  }

  return { adding, updating, unchanged, untouched, categories };
}
