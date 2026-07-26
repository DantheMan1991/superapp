import {
  extractMergeFields,
  FIELDS_PER_TEMPLATE_MAX,
  isValidFieldName,
} from "./merge";

/**
 * The template vocabulary shared by the server and the browser.
 *
 * Deliberately NOT in `template-ops.ts`: that module is `server-only`, and the
 * editor is a client component. A type or a constant crossing that boundary
 * would drag the whole database layer into the browser bundle — which is
 * exactly the build error this file exists to prevent.
 */

export const TEMPLATE_NAME_MAX = 120;
export const TEMPLATE_BODY_MAX = 100_000;

/** One declared merge field, as stored in the `fields` jsonb column. */
export interface TemplateField {
  name: string;
  label: string;
  required: boolean;
}

export function templateNameKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

/** "client_name" → "Client name", a sane default label. */
export function defaultLabel(name: string): string {
  const words = name.replace(/_/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Derive the field list from the BODY, preserving any labels already set.
 *
 * Derived rather than independently editable on purpose: a stored field list
 * that can drift from the body is a list that will eventually promise a field
 * the document never fills, or hide one it does. The body is the truth; labels
 * and required-ness are the only things a human owns here.
 */
export function reconcileFields(
  body: string,
  existing: readonly TemplateField[],
): TemplateField[] {
  const byName = new Map(existing.map((f) => [f.name, f]));
  return extractMergeFields(body).map((name) => {
    const prior = byName.get(name);
    return {
      name,
      label: prior?.label?.trim() || defaultLabel(name),
      required: prior?.required ?? true,
    };
  });
}

/** Parse the jsonb column defensively — it is stored input like any other. */
export function parseFields(raw: unknown): TemplateField[] {
  if (!Array.isArray(raw)) return [];
  const out: TemplateField[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const record = item as Record<string, unknown>;
    const name = typeof record.name === "string" ? record.name : "";
    if (!isValidFieldName(name)) continue;
    out.push({
      name,
      label:
        typeof record.label === "string" && record.label.trim()
          ? record.label
          : defaultLabel(name),
      required: record.required !== false,
    });
    if (out.length >= FIELDS_PER_TEMPLATE_MAX) break;
  }
  return out;
}
