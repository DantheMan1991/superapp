import { significantWords } from "./outline-merge";
import { measureSlug, type DeclaredMeasure } from "./measure-math";
import type { ParsedRoom } from "./room-math";

/**
 * READING A SCHEDULE EXPORTED FROM THE MODEL — pure, no database, no model.
 *
 * The founder's first answer, on the first day of the estimate interview:
 * *they draw in Revit.* Every quantity the walk asks for — the perimeter, the
 * roof area, the rooms and what each one measures — is already in the model,
 * and every modelling tool exports a schedule as delimited text: Revit from
 * *File → Export → Reports → Schedule*, ArchiCAD and Vectorworks from their
 * own list views. That file is what arrives here.
 *
 * ── THE BOUNDARY IS ROWS, NOT FILES ─────────────────────────────────────────
 *
 * Nothing downstream knows what a Revit export looks like. This file turns
 * the text into a table (`parseSchedule`), reads the table's quantity columns
 * (`readColumns`), recognises a room list when it sees one (`readRooms`) and
 * suggests which of the outline's measurements a column answers
 * (`suggestMeasures`). An IFC reader, or one for a spreadsheet somebody typed,
 * produces the same `Schedule` and everything after it is shared.
 *
 * ── DETERMINISTIC, NOT A MODEL ──────────────────────────────────────────────
 *
 * The same rule the cost code import and the measurements themselves keep. A
 * measurement multiplies through every line that reads it, so a number that
 * cannot be traced to a cell is not written. Where this file cannot tell —
 * a column with no unit, two rooms with one name — it says so on the preview
 * rather than choosing.
 *
 * ── WHAT A REVIT EXPORT ACTUALLY LOOKS LIKE ─────────────────────────────────
 *
 * Tab-delimited by default, every cell in double quotes, the schedule's title
 * alone on the first line, the headers on the second, and quantities carrying
 * their unit symbol: `"1,234 SF"`, `"63' - 4 1/2""`, `"2.3 m²"`. Group headers
 * are a line with only its first cell filled, group footers read
 * `"Level 1: 7"`, and the last line may be `"Grand total: 14"`. The file is
 * UTF-16 more often than not, which `decodeScheduleBytes` handles before any
 * of this sees it. A room that exists in the schedule but not on a plan reads
 * `Not Placed` in its area cell.
 */

export const MAX_SCHEDULE_CHARS = 500_000;
export const MAX_SCHEDULE_ROWS = 5_000;

/* ----------------------------------------------------------------- the table */

export interface ScheduleRow {
  /** 1-based line in the file, for the preview to name. */
  line: number;
  cells: string[];
  /** The group heading in force when this row was read — a level, usually. */
  group: string;
}

export interface Schedule {
  /** The schedule's own title, when the export carried one. */
  title: string;
  headers: string[];
  rows: ScheduleRow[];
  /** Total and group-footer rows, left out of every sum. */
  footers: number;
  delimiter: "\t" | "," | ";";
}

/**
 * The bytes of a dropped file, as text.
 *
 * Revit writes UTF-16 with a byte-order mark; Excel writes UTF-8 with or
 * without one; an older export is Windows-1252. Decoding a UTF-16 file as
 * UTF-8 gives a NUL between every character and a parser that finds nothing,
 * which would look exactly like "this tool does not work".
 */
export function decodeScheduleBytes(bytes: Uint8Array): string {
  const strip = (text: string) => text.replace(/^﻿/, "");
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return strip(new TextDecoder("utf-16le").decode(bytes));
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return strip(new TextDecoder("utf-16be").decode(bytes));
  }
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return strip(new TextDecoder("utf-8").decode(bytes));
  }
  /** No mark: a NUL in every other byte is UTF-16 without one. */
  const sample = bytes.subarray(0, Math.min(bytes.length, 2_000));
  let odd = 0;
  let even = 0;
  for (let i = 0; i < sample.length; i += 1) {
    if (sample[i] !== 0) continue;
    if (i % 2 === 1) odd += 1;
    else even += 1;
  }
  const half = Math.floor(sample.length / 2);
  if (half > 0 && odd > half * 0.3) return strip(new TextDecoder("utf-16le").decode(bytes));
  if (half > 0 && even > half * 0.3) return strip(new TextDecoder("utf-16be").decode(bytes));
  try {
    return strip(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return strip(new TextDecoder("windows-1252").decode(bytes));
  }
}

/**
 * Which character separates the cells. A tab anywhere settles it — that is
 * Revit's default and what a spreadsheet pastes. Otherwise a semicolon when
 * the lines agree on one, else a comma.
 */
function detectDelimiter(lines: readonly string[]): Schedule["delimiter"] {
  const sample = lines.filter((l) => l.trim() !== "").slice(0, 25);
  if (sample.some((l) => l.includes("\t"))) return "\t";
  const semis = sample.filter((l) => l.includes(";")).length;
  if (semis >= 2 && semis >= sample.length / 2) return ";";
  return ",";
}

/**
 * One quoted cell, unquoted. Tolerant of the inch mark Revit leaves before
 * the closing quote — `"63' - 4""` — as well as the properly doubled form.
 */
function unquote(cell: string): string {
  let text = cell.trim();
  if (text.startsWith('"')) text = text.slice(1);
  if (text.endsWith('"')) text = text.slice(0, -1);
  return text.replace(/""/g, '"').trim();
}

/** A comma-delimited line, where a quoted cell can hold the delimiter. */
function splitCsv(line: string): string[] {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        const next = line[i + 1];
        const after = line[i + 2];
        if (next === '"' && (after === "," || after === undefined)) {
          /** `6""` then the delimiter: an inch mark, then the closing quote. */
          cell += '"';
          i += 1;
          quoted = false;
        } else if (next === '"') {
          cell += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"' && cell === "") {
      quoted = true;
    } else if (ch === ",") {
      cells.push(cell.trim());
      cell = "";
    } else {
      cell += ch;
    }
  }
  cells.push(cell.trim());
  return cells;
}

function splitLine(line: string, delimiter: Schedule["delimiter"]): string[] {
  if (delimiter === ",") return splitCsv(line);
  return line.split(delimiter).map(unquote);
}

function blank(cells: readonly string[]): boolean {
  return cells.every((c) => c.trim() === "");
}

function filled(cells: readonly string[]): number {
  return cells.filter((c) => c.trim() !== "").length;
}

const TOTAL_ROW = /^(grand\s+)?totals?\b/i;

/**
 * THE FILE AS A TABLE.
 *
 * Title, headers and rows, with group headings carried onto the rows under
 * them and every total row counted and set aside. Nothing here reads a
 * number; that is the next function's job, once the columns are known.
 */
export function parseSchedule(input: string): Schedule {
  const text = input.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const lines = text.split("\n");
  const delimiter = detectDelimiter(lines);

  const raw: { line: number; cells: string[] }[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const cells = splitLine(lines[i], delimiter);
    /** A trailing delimiter is padding, not a column. */
    while (cells.length > 1 && cells[cells.length - 1].trim() === "") cells.pop();
    if (blank(cells)) continue;
    raw.push({ line: i + 1, cells });
  }

  let at = 0;
  let title = "";
  /** The title is a line on its own, above a line with several cells. */
  if (raw.length >= 2 && filled(raw[0].cells) === 1 && raw[1].cells.length >= 2) {
    title = raw[0].cells.find((c) => c.trim() !== "")?.trim() ?? "";
    at = 1;
  }

  /**
   * The headers: the first line with several cells and no quantity in any
   * of them. A grouped-headers line above the real one has blanks where the
   * groups span; it is skipped when a fuller header line follows.
   */
  let headers: string[] = [];
  if (at < raw.length) {
    const first = raw[at].cells;
    const next = raw[at + 1]?.cells;
    const isHeaderLike = (cells: readonly string[]) =>
      cells.length >= 2 && !cells.some((c) => readQuantity(c) !== null);
    if (
      isHeaderLike(first) &&
      next &&
      isHeaderLike(next) &&
      filled(first) < first.length &&
      filled(next) === next.length
    ) {
      at += 1;
    }
    if (isHeaderLike(raw[at].cells)) {
      headers = raw[at].cells.map((c) => c.trim());
      at += 1;
    }
  }

  const width = Math.max(headers.length, ...raw.slice(at).map((r) => r.cells.length), 0);
  if (headers.length < width) {
    for (let i = headers.length; i < width; i += 1) headers.push(`Column ${i + 1}`);
  }

  const rows: ScheduleRow[] = [];
  let footers = 0;
  let group = "";
  for (const r of raw.slice(at)) {
    const cells = [...r.cells];
    while (cells.length < width) cells.push("");
    const first = cells.find((c) => c.trim() !== "")?.trim() ?? "";
    const count = filled(cells);

    if (TOTAL_ROW.test(first)) {
      footers += 1;
      continue;
    }
    /** `Level 1: 7` — the footer of the group above. */
    if (group !== "" && new RegExp(`^${escapeRegExp(group)}\\s*:\\s*\\d+$`, "i").test(first)) {
      footers += 1;
      continue;
    }
    /**
     * A line with only its first cell, and no number in it, opens a group —
     * when there are rows under it. A lone name at the end of the file is a
     * row whose other cells were blank, not a heading over nothing.
     */
    const following = raw[raw.indexOf(r) + 1];
    if (
      width >= 2 &&
      count === 1 &&
      cells[0].trim() !== "" &&
      readQuantity(cells[0]) === null &&
      following !== undefined &&
      filled(following.cells) >= 2
    ) {
      group = cells[0].trim();
      continue;
    }
    if (rows.length >= MAX_SCHEDULE_ROWS) break;
    rows.push({ line: r.line, cells, group });
  }

  return { title, headers, rows, footers, delimiter };
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/* ------------------------------------------------------------- one quantity */

export type Dimension = "length" | "area" | "volume" | "count";

/** The units a schedule states, reduced to the pack's own words for them. */
export type CanonicalUnit = "lf" | "m" | "sf" | "m2" | "cf" | "cy" | "m3" | "ea";

export interface CellQuantity {
  valueThousandths: number;
  /** Blank when the cell was a bare number. */
  unit: CanonicalUnit | "";
}

const DIMENSION_OF: Record<CanonicalUnit, Dimension> = {
  lf: "length",
  m: "length",
  sf: "area",
  m2: "area",
  cf: "volume",
  cy: "volume",
  m3: "volume",
  ea: "count",
};

export function dimensionOf(unit: CanonicalUnit): Dimension {
  return DIMENSION_OF[unit];
}

/**
 * A unit as a schedule or an outline writes it, reduced. `SF`, `sq ft`,
 * `ft²` and `square feet` are one unit; so are `lf`, `ft` and `feet`, because
 * a length in feet is what the pack's `lf` means.
 */
export function canonicalUnit(text: string): CanonicalUnit | null {
  const t = text
    .toLowerCase()
    .replace(/²/g, "2")
    .replace(/³/g, "3")
    .replace(/[.\s]+/g, "")
    .trim();
  switch (t) {
    case "sf":
    case "sqft":
    case "ft2":
    case "sqf":
    case "squarefeet":
    case "squarefoot":
    case "sqfeet":
      return "sf";
    case "m2":
    case "sqm":
    case "sm":
    case "squaremetres":
    case "squaremeters":
      return "m2";
    case "lf":
    case "ft":
    case "feet":
    case "foot":
    case "linft":
    case "linearfeet":
    case "linealfeet":
    case "'":
      return "lf";
    case "m":
    case "lm":
    case "metre":
    case "metres":
    case "meter":
    case "meters":
      return "m";
    case "cf":
    case "ft3":
    case "cuft":
    case "cubicfeet":
      return "cf";
    case "cy":
    case "yd3":
    case "cuyd":
    case "cubicyards":
    case "cubicyard":
      return "cy";
    case "m3":
    case "cum":
    case "cubicmetres":
    case "cubicmeters":
      return "m3";
    case "ea":
    case "each":
    case "no":
    case "nr":
    case "pcs":
    case "count":
    case "qty":
      return "ea";
    default:
      return null;
  }
}

/**
 * Units a cell can carry that the canonical list does not name outright.
 * Inches and millimetres are read into feet and metres here, so a column
 * is one unit throughout.
 */
const SMALL_UNITS: Record<string, { unit: CanonicalUnit; factor: number }> = {
  in: { unit: "lf", factor: 1 / 12 },
  inch: { unit: "lf", factor: 1 / 12 },
  inches: { unit: "lf", factor: 1 / 12 },
  '"': { unit: "lf", factor: 1 / 12 },
  mm: { unit: "m", factor: 1 / 1000 },
  cm: { unit: "m", factor: 1 / 100 },
  cm2: { unit: "m2", factor: 1 / 10_000 },
  mm2: { unit: "m2", factor: 1 / 1_000_000 },
};

const NOT_A_VALUE = new Set([
  "<varies>",
  "varies",
  "not placed",
  "redundant",
  "not enclosed",
  "n/a",
  "na",
  "-",
  "—",
  "–",
]);

/**
 * `1,234.5` → 1234.5; `1.234,50` → 1234.5; `2 743` → 2743. A comma before
 * one or two final digits is a decimal comma; before three it is grouping.
 */
function readNumber(text: string): number | null {
  let t = text.trim().replace(/\u00a0/g, " ");
  if (!/^-?[\d.,\s]+$/.test(t) || !/\d/.test(t)) return null;
  const lastComma = t.lastIndexOf(",");
  const lastDot = t.lastIndexOf(".");
  if (lastComma > lastDot) {
    const after = t.length - lastComma - 1;
    if (after === 3 && /^-?\d{1,3}(,\d{3})+$/.test(t.replace(/\s/g, ""))) {
      t = t.replace(/,/g, "");
    } else if (after >= 1 && after <= 2) {
      t = t.replace(/\./g, "").replace(/,/g, ".");
    } else {
      t = t.replace(/,/g, "");
    }
  } else if (lastDot > lastComma) {
    t = t.replace(/,/g, "");
  }
  t = t.replace(/\s/g, "");
  if (!/^-?\d+(?:\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

const FEET_INCHES =
  /^(-?)(\d+(?:\.\d+)?)\s*'\s*-?\s*(?:(\d+(?:\.\d+)?)\s*(?:(\d+)\s*\/\s*(\d+))?\s*(?:"|''|in)?)?$/;
const INCHES_ONLY = /^(\d+(?:\.\d+)?)\s*(?:(\d+)\s*\/\s*(\d+))?\s*(?:"|'')$/;
const FRACTION_INCHES_ONLY = /^(\d+)\s*\/\s*(\d+)\s*(?:"|'')$/;

function readFeetAndInches(text: string): number | null {
  const fi = FEET_INCHES.exec(text);
  if (fi) {
    const feet = Number(fi[2]);
    const inches = fi[3] ? Number(fi[3]) : 0;
    const fraction = fi[4] && fi[5] && Number(fi[5]) !== 0 ? Number(fi[4]) / Number(fi[5]) : 0;
    const value = feet + (inches + fraction) / 12;
    return fi[1] === "-" ? -value : value;
  }
  const io = INCHES_ONLY.exec(text);
  if (io) {
    const inches = Number(io[1]);
    const fraction = io[2] && io[3] && Number(io[3]) !== 0 ? Number(io[2]) / Number(io[3]) : 0;
    return (inches + fraction) / 12;
  }
  const fo = FRACTION_INCHES_ONLY.exec(text);
  if (fo && Number(fo[2]) !== 0) return Number(fo[1]) / Number(fo[2]) / 12;
  return null;
}

/**
 * ONE CELL AS A QUANTITY, OR NOTHING.
 *
 * Nothing is a real answer: a header, a name, `<varies>`, a price with a
 * currency sign on it. The value is in thousandths, the pack's quantity
 * scale; feet and inches become feet, millimetres become metres.
 */
export function readQuantity(cell: string): CellQuantity | null {
  /** Cells arrive unquoted; stripping a quote here would eat `6"`. */
  const text = cell.replace(/\u00a0/g, " ").trim();
  if (text === "") return null;
  if (NOT_A_VALUE.has(text.toLowerCase())) return null;
  if (/^[$€£¥]/.test(text) || /%$/.test(text)) return null;

  const feet = readFeetAndInches(text);
  if (feet !== null) {
    return { valueThousandths: Math.round(feet * 1000), unit: "lf" };
  }

  const m = /^(-?[\d.,\s]*\d)\s*([^\d\s][^\d]*)?$/.exec(text);
  if (!m) return null;
  const value = readNumber(m[1]);
  if (value === null) return null;
  const unitText = (m[2] ?? "").trim();
  if (unitText === "") return { valueThousandths: Math.round(value * 1000), unit: "" };

  const small = SMALL_UNITS[unitText.toLowerCase().replace(/²/g, "2").replace(/[.\s]+/g, "")];
  if (small) {
    return { valueThousandths: Math.round(value * small.factor * 1000), unit: small.unit };
  }
  const unit = canonicalUnit(unitText);
  if (unit === null) return null;
  return { valueThousandths: Math.round(value * 1000), unit };
}

/* ------------------------------------------------------------- the columns */

export interface ScheduleColumn {
  index: number;
  header: string;
  /** A column the rows put a quantity in, or one they put words in. */
  kind: "quantity" | "text";
  /** The unit its cells carry; blank when they are bare numbers. */
  unit: CanonicalUnit | "";
  dimension: Dimension | null;
  /** How many rows carried a readable quantity. */
  count: number;
  /** Everything added up, in thousandths. */
  totalThousandths: number;
  /** When every row carries the same figure — a wall height, a ceiling. */
  sameOnEveryRow: number | null;
  /** The first few, for the preview. */
  samples: string[];
}

/**
 * Columns that number things rather than measure them: a room number, a
 * door mark. They parse as figures and their total means nothing.
 */
const IDENTIFIER_HEADER =
  /^(number|no\.?|#|mark|type mark|id|keynote|assembly code|omniclass.*|uniformat.*|level|phase.*|sheet.*|detail.*|revision.*|cost|price|comments?|description)$/i;

function normalHeader(header: string): string {
  return header
    .toLowerCase()
    .replace(/[^a-z0-9:]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * WHAT EACH COLUMN HOLDS, ONCE THE FOOTERS ARE OUT.
 *
 * A column is a quantity column when most of its filled cells read as one
 * and they agree on a unit. A footer that carries totals under blank text
 * cells is found HERE — it needs the columns to be known first — and taken
 * out before anything is added up.
 */
export function readColumns(schedule: Schedule): { columns: ScheduleColumn[]; rows: ScheduleRow[]; footers: number } {
  const width = schedule.headers.length;
  const classify = (rows: readonly ScheduleRow[]): ScheduleColumn[] => {
    const out: ScheduleColumn[] = [];
    for (let i = 0; i < width; i += 1) {
      const header = schedule.headers[i] ?? `Column ${i + 1}`;
      const cells = rows.map((r) => r.cells[i] ?? "").filter((c) => c.trim() !== "");
      const read = cells.map(readQuantity);
      const quantities = read.filter((q): q is CellQuantity => q !== null);
      const units = new Set(quantities.map((q) => q.unit));
      const isQuantity =
        quantities.length > 0 &&
        quantities.length >= Math.ceil(cells.length * 0.6) &&
        units.size === 1 &&
        !IDENTIFIER_HEADER.test(normalHeader(header));
      if (!isQuantity) {
        out.push({
          index: i,
          header,
          kind: "text",
          unit: "",
          dimension: null,
          count: 0,
          totalThousandths: 0,
          sameOnEveryRow: null,
          samples: cells.slice(0, 3),
        });
        continue;
      }
      const unit = quantities[0].unit;
      const values = quantities.map((q) => q.valueThousandths);
      const total = values.reduce((n, v) => n + v, 0);
      const same = values.every((v) => v === values[0]) ? values[0] : null;
      out.push({
        index: i,
        header,
        kind: "quantity",
        unit,
        dimension: unit === "" ? null : dimensionOf(unit),
        count: quantities.length,
        totalThousandths: total,
        sameOnEveryRow: same,
        samples: cells.slice(0, 3),
      });
    }
    return out;
  };

  const first = classify(schedule.rows);
  const textColumns = first.filter((c) => c.kind === "text").map((c) => c.index);
  const quantityColumns = first.filter((c) => c.kind === "quantity").map((c) => c.index);
  /**
   * A row with every word column blank and a figure in a quantity column is
   * a footer the export wrote under its group — Revit's *"Export group
   * headers, footers, and blank lines"* — and counting it doubles the group.
   * A row with no word columns at all cannot be told apart, and is kept.
   */
  let footers = schedule.footers;
  const rows =
    textColumns.length === 0
      ? schedule.rows
      : schedule.rows.filter((r) => {
          const words = textColumns.some((i) => (r.cells[i] ?? "").trim() !== "");
          const figures = quantityColumns.some((i) => readQuantity(r.cells[i] ?? "") !== null);
          if (!words && figures) {
            footers += 1;
            return false;
          }
          return true;
        });
  const columns = rows.length === schedule.rows.length ? first : classify(rows);
  return { columns, rows, footers };
}

/* --------------------------------------------------------------- the rooms */

export interface RoomsRead {
  rooms: ParsedRoom[];
  /** The unit the areas came in, canonical. Blank when no area column. */
  areaUnit: CanonicalUnit | "";
  nameHeader: string;
  levelHeader: string;
  areaHeader: string;
  /** Rows that did not become a room, and why. */
  skipped: { line: number; text: string; reason: string }[];
}

const NAME_HEADERS = new Set(["name", "room name", "room: name", "space name", "area name", "room"]);
const LEVEL_HEADERS = new Set([
  "level",
  "floor",
  "storey",
  "story",
  "level name",
  "room: level",
  "base level",
  "reference level",
]);
const NUMBER_HEADERS = new Set(["number", "room number", "room: number", "no", "mark", "space number"]);
const ROOMISH_TITLE = /\b(rooms?|spaces?|areas?|finish)\b/i;

/**
 * A ROOM LIST, WHEN THE SCHEDULE IS ONE.
 *
 * A name column, and either a level column, an area column or a title that
 * says rooms. The level comes from its column or from the group heading the
 * row sat under. Two rooms with one name on one floor are the same room to
 * the pack (ADR 0101), so the second is told apart by its number — the
 * schedule always has one — rather than quietly lost.
 */
export function readRooms(schedule: Schedule, columns: readonly ScheduleColumn[], rows: readonly ScheduleRow[]): RoomsRead | null {
  const byHeader = (wanted: ReadonlySet<string>) =>
    columns.find((c) => wanted.has(normalHeader(c.header))) ?? null;
  const name = byHeader(NAME_HEADERS);
  if (!name) return null;
  const level = byHeader(LEVEL_HEADERS);
  const number = byHeader(NUMBER_HEADERS);
  /**
   * The area column: one headed *Area* whose figures are areas or carry no
   * unit at all — a spreadsheet somebody typed has bare numbers — else any
   * column whose figures are areas.
   */
  const area =
    columns.find(
      (c) =>
        c.kind === "quantity" &&
        (c.dimension === "area" || c.dimension === null) &&
        /\barea\b/.test(normalHeader(c.header)),
    ) ??
    columns.find((c) => c.kind === "quantity" && c.dimension === "area") ??
    null;
  const grouped = rows.some((r) => r.group !== "");
  if (!level && !area && !grouped && !ROOMISH_TITLE.test(schedule.title)) return null;

  const rooms: ParsedRoom[] = [];
  const skipped: RoomsRead["skipped"] = [];
  const seen = new Map<string, number>();
  for (const row of rows) {
    const text = row.cells.filter((c) => c.trim() !== "").join(" · ");
    const roomName = (row.cells[name.index] ?? "").trim();
    if (roomName === "" || measureSlug(roomName) === "") {
      skipped.push({ line: row.line, text, reason: "no name on this row" });
      continue;
    }
    const areaCell = area ? (row.cells[area.index] ?? "").trim() : "";
    const areaLower = areaCell.toLowerCase();
    if (areaLower === "not placed" || areaLower === "redundant") {
      skipped.push({ line: row.line, text, reason: `${roomName} is ${areaLower} in the model` });
      continue;
    }
    const roomLevel = level ? (row.cells[level.index] ?? "").trim() : row.group;
    const quantity = area ? readQuantity(areaCell) : null;
    const areaThousandths = quantity && quantity.valueThousandths > 0 ? quantity.valueThousandths : null;

    let finalName = roomName;
    const key = `${measureSlug(roomLevel)}/${measureSlug(roomName)}`;
    const times = seen.get(key) ?? 0;
    if (times > 0) {
      const tag = number ? (row.cells[number.index] ?? "").trim() : "";
      finalName = tag !== "" ? `${roomName} ${tag}` : `${roomName} (${times + 1})`;
    }
    seen.set(key, times + 1);
    rooms.push({ name: finalName, level: roomLevel, areaThousandths });
  }

  return {
    rooms,
    areaUnit: area ? area.unit : "",
    nameHeader: name.header,
    levelHeader: level ? level.header : grouped ? "the group headings" : "",
    areaHeader: area ? area.header : "",
    skipped,
  };
}

/* ------------------------------------------------ which measurement it is */

/**
 * The dimension a declared measurement is in, from its unit when the unit
 * is one this file knows, else from the takeoff kind it asks for.
 */
export function measureDimension(measure: Pick<DeclaredMeasure, "unit" | "kind">): Dimension {
  const unit = canonicalUnit(measure.unit);
  if (unit) return dimensionOf(unit);
  return measure.kind === "count" ? "count" : measure.kind;
}

/**
 * Whether a column's figures can answer a measurement at all. A bare number
 * can answer anything, because that is what typing one does; a unit the file
 * states has to be in the same dimension as the one the outline wants.
 */
export function canAnswer(column: Pick<ScheduleColumn, "kind" | "dimension">, measure: Pick<DeclaredMeasure, "unit" | "kind">): boolean {
  if (column.kind !== "quantity") return false;
  if (column.dimension === null) return true;
  return column.dimension === measureDimension(measure);
}

const FACTOR: Partial<Record<`${CanonicalUnit}>${CanonicalUnit}`, number>> = {
  "lf>m": 0.3048,
  "m>lf": 1 / 0.3048,
  "sf>m2": 0.09290304,
  "m2>sf": 1 / 0.09290304,
  "cf>cy": 1 / 27,
  "cy>cf": 27,
  "cf>m3": 0.028316846592,
  "m3>cf": 1 / 0.028316846592,
  "cy>m3": 0.764554857984,
  "m3>cy": 1 / 0.764554857984,
};

/**
 * A figure in the column's unit, in the measurement's. Same unit, or no
 * unit stated, and it passes through; feet into metres and back is a
 * factor; anything else is refused with null, because a length handed to
 * an area is a number that means nothing and would multiply through every
 * line that reads it.
 */
export function convertThousandths(
  valueThousandths: number,
  from: CanonicalUnit | "",
  toUnitText: string,
): number | null {
  const to = canonicalUnit(toUnitText);
  if (from === "") return valueThousandths;
  /**
   * An outline unit this file does not know — *squares*, *boxes* — cannot be
   * converted to, so a column that states a unit is refused and a bare
   * number passes, exactly as typing one would.
   */
  if (to === null) return null;
  if (from === to) return valueThousandths;
  if (dimensionOf(from) !== dimensionOf(to)) return null;
  const factor = FACTOR[`${from}>${to}`];
  if (factor === undefined) return null;
  return Math.round(valueThousandths * factor);
}

/**
 * WHICH COLUMN ANSWERS WHICH MEASUREMENT — a suggestion, never a decision.
 *
 * A measurement is suggested for a column when every significant word of
 * its name is in the schedule's title or the column's header: *Roof area*
 * is found in a *Roof Schedule* under *Area*, and *Wall perimeter* is not
 * found under *Length*, because the pack does not know that those are the
 * same thing and will not pretend to. The person picks; this saves the
 * click when the words already agree.
 */
export function suggestMeasures(
  schedule: Schedule,
  columns: readonly ScheduleColumn[],
  declared: readonly DeclaredMeasure[],
): Map<number, string> {
  const titleWords = significantWords(schedule.title);
  const out = new Map<number, string>();
  const used = new Set<string>();
  for (const column of columns) {
    if (column.kind !== "quantity") continue;
    const headerWords = significantWords(column.header);
    let best: { id: string; score: number } | null = null;
    for (const measure of declared) {
      if (used.has(measure.id) || !canAnswer(column, measure)) continue;
      const wanted = [...significantWords(measure.name)];
      if (wanted.length === 0) continue;
      const inHeader = wanted.filter((w) => headerWords.has(w)).length;
      const inTitle = wanted.filter((w) => titleWords.has(w)).length;
      const covered = wanted.filter((w) => headerWords.has(w) || titleWords.has(w)).length;
      if (covered < wanted.length) continue;
      const score = inHeader * 2 + inTitle;
      if (!best || score > best.score) best = { id: measure.id, score };
    }
    if (best) {
      out.set(column.index, best.id);
      used.add(best.id);
    }
  }
  return out;
}

/* --------------------------------------------------------------- the figure */

export type UseOf = "total" | "each" | "rows";

/**
 * WHICH FIGURE A SUGGESTED COLUMN OFFERS BY DEFAULT — or none.
 *
 * Driving it found this: a wall schedule's *Unconnected Height* read 9' on
 * every one of four rows, the words matched *Wall height*, and the default
 * wrote the TOTAL — 36 lf — onto the building. A plausible wrong number is
 * worse than a refusal. When every row carries the same figure the pack
 * cannot know whether the total or the figure is wanted — four equal roof
 * planes ARE a total, four equal wall heights are not — so it suggests the
 * measurement and leaves the figure to the person. A column of counts is
 * the exception: rows of `1` add up to the count.
 */
export function suggestedUse(
  column: Pick<ScheduleColumn, "kind" | "count" | "sameOnEveryRow" | "dimension">,
): UseOf | null {
  if (column.kind !== "quantity") return null;
  if (column.sameOnEveryRow !== null && column.count > 1 && column.dimension !== "count") {
    return null;
  }
  return "total";
}

/**
 * The one number a column offers a measurement, in the measurement's unit,
 * with the words that say where it came from. Null when the column cannot
 * answer it, which the preview has already said.
 */
export function figureFor(
  schedule: Schedule,
  column: ScheduleColumn | null,
  rowCount: number,
  use: UseOf,
  measure: Pick<DeclaredMeasure, "name" | "unit" | "kind">,
  fileName: string,
): { valueThousandths: number; note: string } | null {
  const source = schedule.title.trim() !== "" ? schedule.title.trim() : fileName.trim();
  if (use === "rows") {
    if (measureDimension(measure) !== "count" || rowCount <= 0) return null;
    return { valueThousandths: rowCount * 1000, note: `${source}: ${rowCount} rows` };
  }
  if (!column || column.kind !== "quantity" || !canAnswer(column, measure)) return null;
  const raw = use === "each" ? column.sameOnEveryRow : column.totalThousandths;
  if (raw === null || raw <= 0) return null;
  const value = convertThousandths(raw, column.unit, measure.unit);
  if (value === null || value <= 0) return null;
  const how =
    use === "each"
      ? `the same on every one of ${column.count} rows`
      : column.count === 1
        ? "one row"
        : `total of ${column.count} rows`;
  const unitNote = column.unit === "" ? `, no unit in the file, taken as ${measure.unit.trim() || "given"}` : "";
  return { valueThousandths: value, note: `${source}: ${column.header}, ${how}${unitNote}`.slice(0, 200) };
}
