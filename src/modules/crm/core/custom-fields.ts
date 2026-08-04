import type { CrmFieldDef, CrmFieldOption, CrmFieldType } from "@/db/schema";

/**
 * Custom field values: parsing, validation and storage shape. PURE — no
 * database, no `server-only`, no React, so every rule below is testable without
 * a session and the same code runs on both sides of the boundary.
 *
 * THE STORAGE SHAPE, stated once: `crm_party_details.custom` is a flat object
 * keyed by FIELD DEFINITION ID.
 *
 *     { "9f0c…": "ACME-1", "1a2b…": ["north", "south"], "7d4e…": true }
 *
 * Keyed by id rather than by `key` so renaming a field rewrites one definition
 * row instead of every record that ever held it. See the schema comment for why
 * this is the opposite choice from `document_tags`.
 *
 * TWO RULES THAT ARE SECURITY, NOT ERGONOMICS:
 *
 *  1. **This runs on every write, server-side.** The form builds the same shape
 *     the action validates, but the form is not the only caller and never will
 *     be — jsonb accepts anything, so the column's integrity is exactly what
 *     this file enforces and nothing else.
 *
 *  2. **Unknown keys are DROPPED, not rejected.** A value whose definition has
 *     been archived, or that belongs to another tenant's definition id, simply
 *     does not survive `sanitizeCustomValues`. Rejecting instead would let
 *     somebody probe for which ids exist by watching which payloads error, and
 *     would make an archived field break every subsequent save of a record that
 *     still carries its value.
 */

/** What is stored in the jsonb column. */
export type CustomValue = string | number | boolean | string[];
export type CustomValues = Record<string, CustomValue>;

export interface FieldIssue {
  /** The definition this is about, so the form can put the message on it. */
  fieldId: string;
  label: string;
  message: string;
}

export const TEXT_VALUE_MAX = 2000;
export const URL_VALUE_MAX = 2000;
export const OPTION_MAX = 100;

/** A definition's options, defensively — `options` is jsonb and could be anything. */
export function fieldOptions(def: CrmFieldDef): CrmFieldOption[] {
  if (!Array.isArray(def.options)) return [];
  return def.options.flatMap((o) => {
    if (typeof o !== "object" || o === null) return [];
    const { value, label } = o as Record<string, unknown>;
    if (typeof value !== "string" || value.length === 0) return [];
    return [{ value, label: typeof label === "string" && label ? label : value }];
  });
}

/** Field types whose value is chosen from `options` rather than typed. */
export function isChoiceType(type: CrmFieldType): boolean {
  return type === "select" || type === "multi_select";
}

/**
 * True when a value counts as "not answered".
 *
 * An empty string, an empty multi-select and a missing key are all the same
 * absence — one spelling of "blank", so the required check has one thing to
 * test. `false` and `0` are NOT blank: a boolean answered "no" and a number
 * answered "zero" are answers.
 */
export function isBlank(value: CustomValue | undefined | null): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Coerce and validate ONE raw value against its definition.
 *
 * Returns `{ ok: true, value }` with the value in storage form, `{ ok: true }`
 * with no value when the input was blank (the caller drops the key), or
 * `{ ok: false, message }`.
 */
export function parseFieldValue(
  def: CrmFieldDef,
  raw: unknown,
): { ok: true; value?: CustomValue } | { ok: false; message: string } {
  // Normalize the empty cases before anything type-specific looks at them.
  if (raw === undefined || raw === null || raw === "") return { ok: true };

  switch (def.fieldType) {
    case "text": {
      if (typeof raw !== "string") return { ok: false, message: "Must be text." };
      const trimmed = raw.trim();
      if (trimmed.length === 0) return { ok: true };
      if (trimmed.length > TEXT_VALUE_MAX) {
        return { ok: false, message: `Must be ${TEXT_VALUE_MAX} characters or fewer.` };
      }
      return { ok: true, value: trimmed };
    }

    case "number": {
      // Accept the string a form sends as well as a real number; reject
      // anything that is not finite, so NaN and Infinity never reach jsonb
      // where they would serialize to null and read back as "not answered".
      const n = typeof raw === "number" ? raw : Number(String(raw).trim());
      if (!Number.isFinite(n)) return { ok: false, message: "Must be a number." };
      return { ok: true, value: n };
    }

    case "date": {
      if (typeof raw !== "string" || !ISO_DATE.test(raw.trim())) {
        return { ok: false, message: "Must be a date." };
      }
      const trimmed = raw.trim();
      // The format test alone accepts 2026-02-31. Round-tripping through Date
      // is what rejects a day that does not exist in that month.
      const parsed = new Date(`${trimmed}T00:00:00Z`);
      if (Number.isNaN(parsed.getTime()) || !parsed.toISOString().startsWith(trimmed)) {
        return { ok: false, message: "That date does not exist." };
      }
      return { ok: true, value: trimmed };
    }

    case "boolean": {
      if (typeof raw === "boolean") return { ok: true, value: raw };
      if (raw === "true") return { ok: true, value: true };
      if (raw === "false") return { ok: true, value: false };
      return { ok: false, message: "Must be yes or no." };
    }

    case "select": {
      if (typeof raw !== "string") return { ok: false, message: "Must be a choice." };
      const allowed = new Set(fieldOptions(def).map((o) => o.value));
      if (!allowed.has(raw)) return { ok: false, message: "Not one of the choices." };
      return { ok: true, value: raw };
    }

    case "multi_select": {
      if (!Array.isArray(raw)) return { ok: false, message: "Must be a list of choices." };
      const allowed = new Set(fieldOptions(def).map((o) => o.value));
      const chosen: string[] = [];
      for (const item of raw) {
        if (typeof item !== "string" || !allowed.has(item)) {
          return { ok: false, message: "Not one of the choices." };
        }
        // Deduplicated rather than refused: the same choice twice is a client
        // bug, not something to make a person fix.
        if (!chosen.includes(item)) chosen.push(item);
      }
      if (chosen.length === 0) return { ok: true };
      return { ok: true, value: chosen };
    }

    case "url": {
      if (typeof raw !== "string") return { ok: false, message: "Must be a link." };
      const trimmed = raw.trim();
      if (trimmed.length === 0) return { ok: true };
      if (trimmed.length > URL_VALUE_MAX) {
        return { ok: false, message: `Must be ${URL_VALUE_MAX} characters or fewer.` };
      }
      let url: URL;
      try {
        url = new URL(trimmed);
      } catch {
        return { ok: false, message: "Must be a full link, starting http:// or https://." };
      }
      // http/https ONLY. A stored `javascript:` or `data:` value becomes an
      // href somewhere eventually, and the place to refuse it is on the way in.
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        return { ok: false, message: "Only http:// and https:// links are allowed." };
      }
      return { ok: true, value: trimmed };
    }
  }
}

/**
 * Validate a whole payload against the live definitions.
 *
 * `values` is untrusted: keys that match no live definition are dropped, and
 * what comes back in `values` is exactly what should be written.
 *
 * REQUIRED IS ONLY CHECKED WHEN `requireComplete` IS SET, which the caller does
 * for a lifecycle transition and not for an ordinary save. A half-known record
 * is the normal state the moment somebody first types a name; a form that
 * refuses it moves the record into a spreadsheet instead.
 */
export function sanitizeCustomValues(
  defs: CrmFieldDef[],
  values: unknown,
  opts: { requireComplete?: boolean } = {},
): { values: CustomValues; issues: FieldIssue[] } {
  const issues: FieldIssue[] = [];
  const out: CustomValues = {};

  const incoming: Record<string, unknown> =
    typeof values === "object" && values !== null && !Array.isArray(values)
      ? (values as Record<string, unknown>)
      : {};

  // Archived definitions are absent from `defs`, so their stored values are
  // dropped from the write and remain untouched in whatever was already stored
  // — the caller merges rather than replaces. See `mergeCustomValues`.
  for (const def of defs) {
    const raw = incoming[def.id];
    const parsed = parseFieldValue(def, raw);

    if (!parsed.ok) {
      issues.push({ fieldId: def.id, label: def.label, message: parsed.message });
      continue;
    }
    if (parsed.value !== undefined) {
      out[def.id] = parsed.value;
      continue;
    }
    if (opts.requireComplete && def.isRequired) {
      issues.push({
        fieldId: def.id,
        label: def.label,
        message: `${def.label} is required before this record can move stage.`,
      });
    }
  }

  return { values: out, issues };
}

/**
 * Which required fields are unanswered in what is ALREADY STORED.
 *
 * Deliberately not `sanitizeCustomValues(stored, { requireComplete: true })`,
 * and the difference matters. Full validation would also re-check stored values
 * against the CURRENT definitions — so an owner removing a select option would
 * start blocking stage moves on every record that had picked it, with an error
 * about a field nobody touched. Those values were valid when they were written;
 * an administrative edit afterwards is not the record's fault.
 *
 * This asks the only question a stage move actually needs: is anything required
 * still blank?
 */
export function missingRequired(
  defs: CrmFieldDef[],
  stored: unknown,
): FieldIssue[] {
  const values: Record<string, unknown> =
    typeof stored === "object" && stored !== null && !Array.isArray(stored)
      ? (stored as Record<string, unknown>)
      : {};

  return defs
    .filter((def) => def.isRequired && isBlank(values[def.id] as CustomValue))
    .map((def) => ({
      fieldId: def.id,
      label: def.label,
      message: `${def.label} is required before this record can move stage.`,
    }));
}

/**
 * Fold a validated payload onto what is already stored.
 *
 * MERGE RATHER THAN REPLACE, and the reason is archived definitions. Their
 * values are not in `defs`, so they are not in a validated payload either — a
 * straight replace would silently delete them on the next unrelated save, which
 * is exactly the data loss archiving instead of deleting was meant to avoid.
 *
 * A live definition left blank IS removed, because a person clearing a field
 * means it.
 */
export function mergeCustomValues(
  stored: unknown,
  defs: CrmFieldDef[],
  validated: CustomValues,
): CustomValues {
  const base: CustomValues =
    typeof stored === "object" && stored !== null && !Array.isArray(stored)
      ? { ...(stored as CustomValues) }
      : {};

  for (const def of defs) {
    if (def.id in validated) base[def.id] = validated[def.id];
    else delete base[def.id];
  }
  return base;
}

/** Display form for a stored value. Never throws; unknown shapes render blank. */
export function formatFieldValue(def: CrmFieldDef, value: unknown): string {
  if (value === undefined || value === null) return "";
  switch (def.fieldType) {
    case "boolean":
      return value === true ? "Yes" : value === false ? "No" : "";
    case "select": {
      const match = fieldOptions(def).find((o) => o.value === value);
      return match ? match.label : typeof value === "string" ? value : "";
    }
    case "multi_select": {
      if (!Array.isArray(value)) return "";
      const opts = fieldOptions(def);
      return value
        .map((v) => opts.find((o) => o.value === v)?.label ?? String(v))
        .join(", ");
    }
    case "number":
      return typeof value === "number" ? String(value) : "";
    default:
      return typeof value === "string" ? value : "";
  }
}
