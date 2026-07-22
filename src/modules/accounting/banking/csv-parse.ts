import { isValidIsoDate } from "../lib/money";

/**
 * CSV statement parsing — pure, client-safe, fully unit-testable.
 * Bank exports are messy; every helper here is defensive and total
 * (returns null / collects errors instead of throwing), except parseCsv
 * which throws on a structurally broken file.
 */

/** RFC 4180 state machine: quotes, "" escapes, embedded newlines, CRLF/LF, BOM. */
export function parseCsv(text: string): string[][] {
  const s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  const pushField = () => {
    row.push(field);
    field = "";
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };
  while (i < s.length) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i += 2;
        } else {
          inQuotes = false;
          i += 1;
        }
      } else {
        field += c;
        i += 1;
      }
    } else if (c === '"' && field === "") {
      inQuotes = true;
      i += 1;
    } else if (c === ",") {
      pushField();
      i += 1;
    } else if (c === "\r") {
      if (s[i + 1] === "\n") i += 1;
      pushRow();
      i += 1;
    } else if (c === "\n") {
      pushRow();
      i += 1;
    } else {
      field += c;
      i += 1;
    }
  }
  if (inQuotes) throw new Error("unterminated quoted field");
  if (field !== "" || row.length > 0) pushRow();
  return rows;
}

export type DateFormat = "YYYY-MM-DD" | "MM/DD/YYYY" | "DD/MM/YYYY";

export interface ColumnMapping {
  dateCol: number;
  descCol: number;
  dateFormat: DateFormat;
  /** Flip the sign for banks that export money-out as positive. */
  negate: boolean;
  amountCol?: number;
  debitCol?: number;
  creditCol?: number;
}

const DATE_HEADERS = ["date", "transaction date", "posted date", "post date", "posting date"];
const DESC_HEADERS = ["description", "memo", "payee", "name", "details", "transaction details"];
const AMOUNT_HEADERS = ["amount", "transaction amount"];
const DEBIT_HEADERS = ["debit", "withdrawal", "withdrawals", "money out"];
const CREDIT_HEADERS = ["credit", "deposit", "deposits", "money in"];

export function detectColumns(
  header: string[],
): Partial<ColumnMapping> & { hasHeader: boolean } {
  const norm = header.map((h) => h.trim().toLowerCase());
  const find = (names: string[]) => {
    const idx = norm.findIndex((h) => names.includes(h));
    return idx === -1 ? undefined : idx;
  };
  const dateCol = find(DATE_HEADERS);
  const descCol = find(DESC_HEADERS);
  const amountCol = find(AMOUNT_HEADERS);
  const debitCol = find(DEBIT_HEADERS);
  const creditCol = find(CREDIT_HEADERS);
  const hasHeader =
    dateCol !== undefined ||
    descCol !== undefined ||
    amountCol !== undefined ||
    debitCol !== undefined ||
    creditCol !== undefined;
  return {
    hasHeader,
    ...(dateCol !== undefined ? { dateCol } : {}),
    ...(descCol !== undefined ? { descCol } : {}),
    ...(amountCol !== undefined ? { amountCol } : {}),
    ...(debitCol !== undefined && creditCol !== undefined
      ? { debitCol, creditCol }
      : {}),
  };
}

/** Sample-based format detection. Ambiguous slash dates default MM/DD (P14). */
export function detectDateFormat(
  samples: string[],
): { format: DateFormat; ambiguous: boolean } | null {
  const vals = samples.map((s) => s.trim()).filter(Boolean);
  if (vals.length === 0) return null;
  if (vals.every((v) => /^\d{4}-\d{2}-\d{2}$/.test(v))) {
    return { format: "YYYY-MM-DD", ambiguous: false };
  }
  const slash = vals.filter((v) => /^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(v));
  if (slash.length !== vals.length) return null;
  let mmdd = false;
  let ddmm = false;
  for (const v of slash) {
    const [a, b] = v.split("/").map(Number);
    if (a > 12) ddmm = true;
    if (b > 12) mmdd = true;
  }
  if (mmdd && !ddmm) return { format: "MM/DD/YYYY", ambiguous: false };
  if (ddmm && !mmdd) return { format: "DD/MM/YYYY", ambiguous: false };
  if (mmdd && ddmm) return null; // internally contradictory
  return { format: "MM/DD/YYYY", ambiguous: true };
}

export function parseCsvDate(s: string, format: DateFormat): string | null {
  const v = s.trim();
  let iso: string | null = null;
  if (format === "YYYY-MM-DD") {
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) iso = v;
  } else {
    const m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
    if (m) {
      const [first, second, yearRaw] = [m[1], m[2], m[3]];
      const year = yearRaw.length === 2 ? `20${yearRaw}` : yearRaw;
      const [month, day] =
        format === "MM/DD/YYYY" ? [first, second] : [second, first];
      iso = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
    }
  }
  return iso && isValidIsoDate(iso) ? iso : null;
}

/**
 * Signed money string → cents. Handles "$", commas, spaces, leading "-",
 * and accounting parentheses "(1,234.56)". Integer construction, no floats.
 */
export function parseSignedAmount(input: string): number | null {
  let s = input.trim();
  if (s === "") return null;
  let negative = false;
  const paren = s.match(/^\((.*)\)$/);
  if (paren) {
    negative = true;
    s = paren[1];
  }
  s = s.replaceAll(",", "").replaceAll("$", "").replaceAll(" ", "");
  if (s.startsWith("-")) {
    negative = !negative ? true : negative;
    s = s.slice(1);
  }
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const [whole, frac = ""] = s.split(".");
  const cents = Number(whole) * 100 + Number((frac + "00").slice(0, 2));
  if (!Number.isSafeInteger(cents)) return null;
  return negative ? -cents : cents;
}

export function normalizeDescription(s: string): string {
  return s.trim().replace(/\s+/g, " ");
}

export interface NormalizedTxn {
  txnDate: string;
  description: string;
  amountCents: number;
  raw: string[];
  /** 0-based occurrence index of identical (date, amount, desc) in this file. */
  dupIndex: number;
}

export function normalizeRows(
  rows: string[][],
  mapping: ColumnMapping,
): { txns: NormalizedTxn[]; errors: Array<{ rowIndex: number; problem: string }> } {
  const txns: NormalizedTxn[] = [];
  const errors: Array<{ rowIndex: number; problem: string }> = [];
  const seen = new Map<string, number>();
  rows.forEach((row, rowIndex) => {
    if (row.every((cell) => cell.trim() === "")) return;
    const txnDate = parseCsvDate(row[mapping.dateCol] ?? "", mapping.dateFormat);
    if (!txnDate) {
      errors.push({ rowIndex, problem: "bad date" });
      return;
    }
    let amountCents: number | null = null;
    if (mapping.amountCol !== undefined) {
      amountCents = parseSignedAmount(row[mapping.amountCol] ?? "");
    } else if (mapping.debitCol !== undefined && mapping.creditCol !== undefined) {
      const debitRaw = (row[mapping.debitCol] ?? "").trim();
      const creditRaw = (row[mapping.creditCol] ?? "").trim();
      const debit = debitRaw === "" ? 0 : parseSignedAmount(debitRaw);
      const credit = creditRaw === "" ? 0 : parseSignedAmount(creditRaw);
      if (debit === null || credit === null) amountCents = null;
      else amountCents = credit - debit;
    }
    if (amountCents === null) {
      errors.push({ rowIndex, problem: "bad amount" });
      return;
    }
    if (amountCents === 0) return; // zero rows carry no information
    if (mapping.negate) amountCents = -amountCents;
    const description = normalizeDescription(row[mapping.descCol] ?? "");
    const key = `${txnDate}|${amountCents}|${description}`;
    const dupIndex = seen.get(key) ?? 0;
    seen.set(key, dupIndex + 1);
    txns.push({ txnDate, description, amountCents, raw: row, dupIndex });
  });
  return { txns, errors };
}
