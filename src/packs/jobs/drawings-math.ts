/**
 * The arithmetic of a drawing set, pure so `tests/jobs-drawings.test.ts` can
 * say what the page and the ops both rely on (ADR 0072): which sheet number
 * a page carries, which issue of a number is current, how the set reads.
 * Nothing here touches the database or the browser; the sheet guess runs in
 * the browser over pdf.js's text and the server stores what was confirmed.
 */

import { DISCIPLINE_LABELS, DISCIPLINE_ORDER, OTHER_DISCIPLINE } from "./vocabulary";

// ------------------------------------------------------------ sheet numbers

/** Trimmed, upper-cased, inner runs of space collapsed: `a-101` is `A-101`. */
export function normaliseSheetNumber(raw: string): string {
  return raw.trim().replace(/\s+/g, " ").toUpperCase();
}

/**
 * The discipline a number groups under: its leading letters' FIRST letter
 * (the convention's level-one designator; `AD-101` is Architectural
 * demolition and groups with Architectural). A number with no leading letter
 * — `1`, `12` — or a letter the list does not know groups under *Other*.
 */
export function disciplineOf(sheetNumber: string): string {
  const m = /^([A-Z])[A-Z]{0,2}(?=[-. ]?\d)/.exec(normaliseSheetNumber(sheetNumber));
  return m && DISCIPLINE_LABELS[m[1]] ? m[1] : OTHER_DISCIPLINE;
}

export function disciplineLabel(key: string): string {
  return DISCIPLINE_LABELS[key] ?? OTHER_DISCIPLINE;
}

/** Disciplines in the order the set is read: the convention's, then Other. */
export function compareDisciplines(a: string, b: string): number {
  const ia = a === OTHER_DISCIPLINE ? DISCIPLINE_ORDER.length : DISCIPLINE_ORDER.indexOf(a);
  const ib = b === OTHER_DISCIPLINE ? DISCIPLINE_ORDER.length : DISCIPLINE_ORDER.indexOf(b);
  return ia - ib;
}

/**
 * Natural order: `A-2` before `A-10`, `A1.1` before `A1.2` before `A2.0`,
 * and the discipline's own order before any of it, so a whole set sorts the
 * way its index page lists it.
 */
export function compareSheetNumbers(a: string, b: string): number {
  const byDiscipline = compareDisciplines(disciplineOf(a), disciplineOf(b));
  if (byDiscipline !== 0) return byDiscipline;
  const pa = normaliseSheetNumber(a).split(/(\d+)/).filter((s) => s !== "");
  const pb = normaliseSheetNumber(b).split(/(\d+)/).filter((s) => s !== "");
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i];
    const y = pb[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const nx = /^\d+$/.test(x);
    const ny = /^\d+$/.test(y);
    if (nx && ny) {
      const d = Number.parseInt(x, 10) - Number.parseInt(y, 10);
      if (d !== 0) return d;
      if (x.length !== y.length) return x.length - y.length;
    } else if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return 0;
}

// ------------------------------------------------------------- the current set

export interface SheetIssue {
  id: string;
  sheetNumber: string;
  /** The set's `issued_on`, YYYY-MM-DD. */
  issuedOn: string;
  /** Breaks a tie between two issues dated the same day: the later-made set is newer. */
  setCreatedAt: string;
}

/**
 * Which issue of each sheet number is current: the one from the newest set
 * — by the date on the drawings, then by which set was made later. Every
 * other issue of that number is superseded BY the current one. Derived every
 * time rather than stored: a flag that had to be moved from A-102 to the new
 * A-102 whenever a bulletin arrived is a flag somebody forgets to move.
 */
export function currentIssues<T extends SheetIssue>(sheets: readonly T[]): Map<string, T> {
  const current = new Map<string, T>();
  for (const s of sheets) {
    const key = normaliseSheetNumber(s.sheetNumber);
    const held = current.get(key);
    if (!held || isNewer(s, held)) current.set(key, s);
  }
  return current;
}

export function isNewer(a: SheetIssue, b: SheetIssue): boolean {
  if (a.issuedOn !== b.issuedOn) return a.issuedOn > b.issuedOn;
  return a.setCreatedAt > b.setCreatedAt;
}

/** Every issue of one number, newest first. */
export function issuesOf<T extends SheetIssue>(sheets: readonly T[], sheetNumber: string): T[] {
  const key = normaliseSheetNumber(sheetNumber);
  return sheets
    .filter((s) => normaliseSheetNumber(s.sheetNumber) === key)
    .sort((a, b) => (isNewer(a, b) ? -1 : isNewer(b, a) ? 1 : 0));
}

export interface DrawingsSummary {
  /** Sheets in the current set. */
  sheets: number;
  sets: number;
  /** Issues no longer current. */
  superseded: number;
  /** The newest set, by the date on the drawings. */
  latestSetName: string | null;
  latestIssuedOn: string | null;
  /** Discipline keys present in the current set, in reading order. */
  disciplines: string[];
}

export function summariseDrawings(
  sheets: readonly SheetIssue[],
  sets: readonly { name: string; issuedOn: string; createdAt: string }[],
): DrawingsSummary {
  const current = currentIssues(sheets);
  const disciplines = [...new Set([...current.keys()].map(disciplineOf))].sort(compareDisciplines);
  const latest = [...sets].sort((a, b) =>
    a.issuedOn !== b.issuedOn ? (a.issuedOn > b.issuedOn ? -1 : 1) : a.createdAt > b.createdAt ? -1 : a.createdAt < b.createdAt ? 1 : 0,
  )[0];
  return {
    sheets: current.size,
    sets: sets.length,
    superseded: sheets.length - current.size,
    latestSetName: latest?.name ?? null,
    latestIssuedOn: latest?.issuedOn ?? null,
    disciplines,
  };
}

// ---------------------------------------------------------- reading a page

/** One run of text on a page, in PDF user space: origin bottom-left, y up. */
export interface PageText {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PageLine {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * pdf.js hands back runs, not lines: "FIRST FLOOR" and "PLAN" arrive as two
 * items when the font changes or the layout engine breaks them. Runs on the
 * same baseline (within a fraction of their height) and close together are
 * one line, read left to right.
 */
export function linesFrom(items: readonly PageText[]): PageLine[] {
  const runs = items
    .filter((i) => i.str.trim() !== "")
    .map((i) => ({ ...i, str: i.str.replace(/\s+/g, " ") }))
    .sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: PageLine[] = [];
  for (const run of runs) {
    const last = lines[lines.length - 1];
    const tolerance = Math.max(run.height, last?.height ?? 0) * 0.5;
    const gap = last ? run.x - (last.x + last.width) : Infinity;
    if (last && Math.abs(last.y - run.y) <= tolerance && gap >= -tolerance && gap <= Math.max(run.height, last.height) * 1.5) {
      const joiner = last.text.endsWith(" ") || run.str.startsWith(" ") || gap < run.height * 0.15 ? "" : " ";
      last.text = `${last.text}${joiner}${run.str}`.replace(/\s+/g, " ");
      last.width = run.x + run.width - last.x;
      last.height = Math.max(last.height, run.height);
    } else {
      lines.push({ text: run.str, x: run.x, y: run.y, width: run.width, height: run.height });
    }
  }
  return lines.map((l) => ({ ...l, text: l.text.trim() }));
}

/** `A-101`, `A1.1`, `S-201A`, `E-001`, `FP-2`, `C1.0`, `M101`, `L-1`. Not a date, not a scale, not `1/4"`. */
export const SHEET_NUMBER_PATTERN = /^[A-Z]{1,3}[-. ]?\d{1,4}(?:\.\d{1,3})?[A-Z]?$/;

/** Words a title block labels its cells with, which are never the title. */
const BLOCK_LABELS = new Set([
  "SHEET",
  "SHEET NO",
  "SHEET NO.",
  "SHEET NUMBER",
  "SHEET TITLE",
  "TITLE",
  "DRAWING",
  "DRAWING NO",
  "DRAWING NO.",
  "DRAWING TITLE",
  "DRAWN",
  "DRAWN BY",
  "CHECKED",
  "CHECKED BY",
  "DESIGNED BY",
  "APPROVED",
  "APPROVED BY",
  "DATE",
  "SCALE",
  "PROJECT",
  "PROJECT NO",
  "PROJECT NO.",
  "PROJECT NUMBER",
  "JOB",
  "JOB NO",
  "JOB NO.",
  "JOB NUMBER",
  "REV",
  "REV.",
  "REVISION",
  "REVISIONS",
  "NO",
  "NO.",
  "DESCRIPTION",
  "ISSUE",
  "ISSUED FOR",
  "SEAL",
  "STAMP",
  "CLIENT",
  "OWNER",
  "ARCHITECT",
  "ENGINEER",
  "OF",
]);

export interface SheetGuess {
  sheetNumber: string;
  title: string;
  /** Why the guess is what it is, for the row's hint. */
  reason: "title block" | "no number found" | "no text on the page";
}

/**
 * Read a page's title block. The sheet number is the number-shaped line
 * nearest the page's bottom-right corner, where every convention puts it —
 * a cover sheet's index lists forty numbers in the middle of the page, and
 * the corner rule ignores all of them. The title is the largest other line
 * in the same corner that is not a label, a date or a scale, ties broken by
 * nearness to the number. A scanned set has no text and says so; the office
 * types the numbers, and the thumbnails are there to read them from.
 */
export function guessSheet(items: readonly PageText[], pageWidth: number, pageHeight: number): SheetGuess {
  const lines = linesFrom(items);
  if (lines.length === 0) return { sheetNumber: "", title: "", reason: "no text on the page" };

  const numbers = lines
    .filter((l) => SHEET_NUMBER_PATTERN.test(l.text) && !/^(?:A[0-4]|B[0-5])$/.test(l.text))
    .map((l) => ({ line: l, corner: cornerScore(l, pageWidth, pageHeight) }))
    .sort((a, b) => b.corner - a.corner || b.line.height - a.line.height);
  const chosen = numbers[0];
  if (!chosen || chosen.corner < 0.9) return { sheetNumber: "", title: "", reason: "no number found" };
  const number = chosen.line;

  const inBlock = lines.filter(
    (l) =>
      l !== number &&
      (l.x + l.width / 2 >= pageWidth * 0.55 || l.y <= pageHeight * 0.25) &&
      l.text.length >= 3 &&
      /[A-Z]{2,}/i.test(l.text) &&
      !BLOCK_LABELS.has(l.text.toUpperCase().replace(/:$/, "")) &&
      !SHEET_NUMBER_PATTERN.test(l.text) &&
      !isDateOrScale(l.text),
  );
  const title = inBlock
    .map((l) => ({ line: l, distance: Math.hypot(l.x - number.x, l.y - number.y) }))
    .sort((a, b) => b.line.height - a.line.height || a.distance - b.distance)[0];
  return {
    sheetNumber: normaliseSheetNumber(number.text),
    title: title ? titleCase(title.line.text) : "",
    reason: "title block",
  };
}

/** 0 at the top-left corner, 2 at the bottom-right; a run is where its centre is. */
function cornerScore(l: PageLine, pageWidth: number, pageHeight: number): number {
  const cx = (l.x + l.width / 2) / pageWidth;
  const cy = (l.y + l.height / 2) / pageHeight;
  return cx + (1 - cy);
}

function isDateOrScale(text: string): boolean {
  return (
    /^\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}$/.test(text) ||
    /^\d{4}-\d{2}-\d{2}$/.test(text) ||
    /^\d+(\/\d+)?"?\s*=\s*\d+'/.test(text) ||
    /^(?:N\.?T\.?S\.?|NTS|AS NOTED|NONE)$/i.test(text) ||
    /^\d+(\.\d+)?$/.test(text) ||
    /^\d+\s*OF\s*\d+$/i.test(text)
  );
}

/**
 * Whether a page's row in the index table starts ticked. A page indexed
 * before: yes. On a file read AGAIN, a page that was left out before — the
 * cover, a legend — stays out, whatever the reading proposes for it, or a
 * careless save would make the cover a sheet (found by driving). On a first
 * read: ticked when a number was found.
 */
export function tickedByDefault(hadPrior: boolean, reReading: boolean, guessedNumber: string): boolean {
  if (hadPrior) return true;
  if (reReading) return false;
  return guessedNumber !== "";
}

/** "FIRST FLOOR PLAN" → "First floor plan": the trade shouts in its title blocks and the list need not. */
export function titleCase(text: string): string {
  const t = text.trim().replace(/\s+/g, " ");
  if (t !== t.toUpperCase()) return t;
  const lower = t.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}
