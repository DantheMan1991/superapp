import { z } from "zod";
import type { PasteField, PasteRow, PasteValue } from "./types";

/**
 * The SHAPE of a paste: limits, the model's tool built from a target's
 * fields, and the pure functions that turn what comes back into rows a
 * person can review and a module can be asked to save.
 *
 * DELIBERATELY NOT `server-only`. The dialog is a client component and reads
 * the limits and `checkRow` from here — the same split `crm/ai/note-shape.ts`
 * keeps, for the same reason: the network and the database live in
 * `model.ts` and `resolve.ts`, and importing either toward the browser bundle
 * is what `server-only` exists to stop.
 *
 * Everything here is pure. Nothing here writes.
 */

/** Longer than this is a spreadsheet, and belongs in pieces. */
export const PASTE_MAX_CHARS = 20_000;
/** Per reading and per save. A herd book bigger than this is pasted in two. */
export const PASTE_MAX_ROWS = 200;
/** Headroom under the vision API's 5 MB. */
export const PASTE_IMAGE_MAX_BYTES = 4 * 1024 * 1024;
export const PASTE_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/pdf",
] as const;
/** For <input accept=…> — advisory; the action's allowlist decides. */
export const PASTE_ACCEPT_ATTR =
  ".jpg,.jpeg,.png,.webp,.gif,.pdf,image/jpeg,image/png,image/webp,image/gif,application/pdf";

/** The longest a text cell may be. An address is a line; a biography is not a cell. */
const TEXT_MAX = 2_000;

/** A proposed row, resolved: values by field, plus what could not be placed. */
export interface ReviewRow {
  values: PasteRow;
  /**
   * Field key → what the list said, for a cell that is empty because the words
   * matched no choice, no date or no number. Shown beside the cell, never
   * silently dropped; the CRM's assignee hint, generalised.
   */
  hints: Record<string, string>;
  /** The existing thing this row looks like, by label, or null. */
  duplicateOf: string | null;
}

/* -- The tool ------------------------------------------------------------- */

const quote = (s: string) => `“${s}”`;

/**
 * One JSON-schema property per field. Every property is nullable and every
 * key is required, so the model must say "none" rather than leave a column
 * out, and `validateProposal` never has to guess what an absent key meant.
 *
 * A `choice` is NOT an enum. An enum would turn "Back forty", which is not a
 * parcel here, into null and lose the words; the description asks for an exact
 * copy when one fits and the list's own words when none does, so the reviewer
 * sees what was meant.
 */
function propertyFor(field: PasteField): Record<string, unknown> {
  switch (field.kind) {
    case "text":
      return {
        type: ["string", "null"],
        description: `${field.hint} Null when the list does not say.`,
      };
    case "number":
      return {
        type: ["number", "null"],
        description: `${field.hint} A number, or null when the list does not say.`,
      };
    case "date":
      return {
        type: ["string", "null"],
        description:
          `${field.hint} As YYYY-MM-DD when the list gives a full date; a partial date exactly as ` +
          `written; null when it gives none. Never invent a day the list does not give.`,
      };
    case "choice": {
      const labels = (field.choices ?? []).map((c) => quote(c.label)).join(", ");
      return {
        type: ["string", "null"],
        description:
          `${field.hint} One of: ${labels || "(none yet)"} — copied exactly when the list clearly ` +
          `means it. When nothing fits, the words the list uses, so a person can decide. Null ` +
          `when the list says nothing.`,
      };
    }
  }
}

export interface ProposeTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export const PROPOSE_TOOL_NAME = "propose_rows";

export function proposeToolFor(fields: PasteField[]): ProposeTool {
  const properties: Record<string, unknown> = {};
  for (const f of fields) properties[f.key] = propertyFor(f);
  return {
    name: PROPOSE_TOOL_NAME,
    description:
      "The rows the list holds, one per thing, in the order they appear. Every field on every row, null where the list does not say.",
    input_schema: {
      type: "object",
      properties: {
        rows: {
          type: "array",
          maxItems: PASTE_MAX_ROWS,
          items: {
            type: "object",
            properties,
            required: fields.map((f) => f.key),
          },
        },
      },
      required: ["rows"],
    },
  };
}

/* -- What comes back ------------------------------------------------------ */

/**
 * Zod at the boundary, loosely on purpose: the model is held to "rows of
 * cells that are strings, numbers or null" and nothing tighter, because a
 * date written as "spring 2024" is information for the reviewer, not a reason
 * to throw away forty rows. `resolveRows` is where each cell is judged.
 *
 * A tool call that is not even that — no `rows`, a row that is not an object —
 * is a refusal, never a half-parsed proposal shown as if it were the answer.
 */
const cellSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const proposalSchema = z.object({
  rows: z.array(z.record(z.string(), cellSchema.optional())).max(PASTE_MAX_ROWS),
});

export type RawRow = Record<string, string | number | boolean | null | undefined>;

export function validateProposal(raw: unknown): RawRow[] | null {
  const parsed = proposalSchema.safeParse(raw);
  return parsed.success ? parsed.data.rows : null;
}

/* -- Resolve each cell ---------------------------------------------------- */

/** For duplicate checks: case, surrounding space, runs of space, trailing punctuation. */
export function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.,;:'’"”]+$/, "")
    .trim();
}

export function isCalendarDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** "1,250.50", "$12", " 40 " → a number; anything else → null. */
export function parseNumber(s: string): number | null {
  const cleaned = s.replace(/[,$\s]/g, "");
  if (cleaned === "" || !/^-?\d*\.?\d+$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function asText(v: string | number | boolean): string {
  return (typeof v === "string" ? v : String(v)).trim();
}

/** A label matched against the choices — case and surrounding space aside. Exact, never nearest. */
export function matchChoice(
  field: PasteField,
  text: string,
): string | null {
  const wanted = normalizeName(text);
  if (!wanted) return null;
  for (const c of field.choices ?? []) {
    if (normalizeName(c.label) === wanted || normalizeName(c.value) === wanted) {
      return c.value;
    }
  }
  return null;
}

/**
 * Each cell judged by its field. An empty row — every cell null — is dropped:
 * it is a heading, a total or a blank line the model dutifully returned.
 */
export function resolveRows(rawRows: RawRow[], fields: PasteField[]): ReviewRow[] {
  const out: ReviewRow[] = [];
  for (const raw of rawRows) {
    const values: PasteRow = {};
    const hints: Record<string, string> = {};
    let any = false;
    for (const f of fields) {
      const v = raw[f.key];
      if (v === null || v === undefined || v === "") {
        values[f.key] = null;
        continue;
      }
      const text = asText(v);
      if (text === "") {
        values[f.key] = null;
        continue;
      }
      let resolved: PasteValue = null;
      switch (f.kind) {
        case "text":
          resolved = text.slice(0, TEXT_MAX);
          break;
        case "number": {
          const n = typeof v === "number" ? v : parseNumber(text);
          if (n !== null && Number.isFinite(n)) resolved = n;
          else hints[f.key] = text.slice(0, 120);
          break;
        }
        case "date":
          if (isCalendarDate(text)) resolved = text;
          else hints[f.key] = text.slice(0, 120);
          break;
        case "choice": {
          const value = matchChoice(f, text);
          if (value !== null) resolved = value;
          else hints[f.key] = text.slice(0, 120);
          break;
        }
      }
      values[f.key] = resolved;
      if (resolved !== null || hints[f.key]) any = true;
    }
    if (any) out.push({ values, hints, duplicateOf: null });
    if (out.length >= PASTE_MAX_ROWS) break;
  }
  return out;
}

/* -- A reviewed row, before it is saved ----------------------------------- */

/**
 * The first thing wrong with a row, in words for the person, or null. Run by
 * the dialog to hold the button back and by the server before any row is
 * written, so the two never disagree about what "ready" means.
 */
export function checkRow(row: PasteRow, fields: PasteField[]): string | null {
  for (const f of fields) {
    const v = row[f.key];
    if (v === null || v === undefined || v === "") {
      if (f.required) return `${f.label} is missing.`;
      continue;
    }
    switch (f.kind) {
      case "text":
        if (typeof v !== "string") return `${f.label} should be words.`;
        if (v.length > TEXT_MAX) return `${f.label} is too long.`;
        break;
      case "number":
        if (typeof v !== "number" || !Number.isFinite(v)) return `${f.label} should be a number.`;
        break;
      case "date":
        if (typeof v !== "string" || !isCalendarDate(v)) return `${f.label} is not a real date.`;
        break;
      case "choice":
        if (typeof v !== "string" || !(f.choices ?? []).some((c) => c.value === v)) {
          return `${f.label} is not one of the choices.`;
        }
        break;
    }
  }
  return null;
}

/**
 * What to call the row in a message: its first text field, which every target
 * makes the name. Empty, the row goes unnamed — "Row 2: Name is missing." —
 * rather than being called by its email.
 */
export function rowLabel(row: PasteRow, fields: PasteField[]): string | null {
  const first = fields.find((f) => f.kind === "text");
  const v = first ? row[first.key] : null;
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/** The save boundary: rows of cells, nothing tighter. Field rules are `checkRow`'s. */
export const savedRowsSchema = z
  .array(z.record(z.string().max(64), z.union([z.string().max(TEXT_MAX), z.number(), z.null()])))
  .max(PASTE_MAX_ROWS);
