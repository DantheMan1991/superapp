import { z } from "zod";
import type { TellAction, TellField, TellValue, TellValues } from "./types";

/**
 * The SHAPE of a told sentence: the limits, the model's tool built from every
 * action a tenant has, and the pure functions that turn what comes back into
 * cards a person can read and a pack can be asked to record.
 *
 * DELIBERATELY NOT `server-only`. The box is a client component and reads the
 * limits and `checkEntry` from here — the same split `paste-targets/shape.ts`
 * and `crm/ai/note-shape.ts` keep, for the same reason: the network and the
 * database live elsewhere, and dragging either toward the browser bundle is
 * what `server-only` exists to stop.
 *
 * Everything here is pure. Nothing here writes.
 */

/** A sentence longer than this is a note, and belongs in a note. */
export const TELL_MAX_CHARS = 1_000;
/** More than this from one sentence is a misreading, not a busy morning. */
export const TELL_MAX_ENTRIES = 12;

export const PROPOSE_TOOL_NAME = "record_what_happened";

/* -- The tool ------------------------------------------------------------- */

function fieldLine(f: TellField): string {
  const bits = [`${f.key} (${f.kind}${f.required ? ", required" : ""})`, f.hint];
  if (f.kind === "choice") {
    const labels = (f.choices ?? []).map((c) => `“${c.label}”`).join(", ");
    bits.push(`One of: ${labels || "(none yet)"} — copied exactly when the sentence clearly means it, otherwise the sentence's own words.`);
  }
  if (f.kind === "date") bits.push("As YYYY-MM-DD. Omit for today.");
  return `    - ${bits.join(" ")}`;
}

/**
 * One tool for every action the tenant has, with the field list written into
 * the description rather than into a schema branch per action.
 *
 * WHY NOT A SCHEMA PER ACTION: the fields differ by action, and a JSON schema
 * that said so would be a `oneOf` over a dozen shapes — long, expensive to
 * send, and no more accurate. `fields` is a free-form object here and is
 * judged per action by `resolveEntries`, which is where the tenant's own
 * choices live anyway. Same trade the paste tool makes with its nullable
 * columns.
 */
export function tellToolFor(actions: TellAction[]) {
  const catalogue = actions
    .map((a) => `  ${a.slug} — ${a.title}. ${a.about}\n${a.fields.map(fieldLine).join("\n")}`)
    .join("\n\n");
  return {
    name: PROPOSE_TOOL_NAME,
    description:
      "What the sentence says happened, as one entry per thing. The actions available, and the fields each takes:\n\n" +
      catalogue,
    input_schema: {
      type: "object",
      properties: {
        entries: {
          type: "array",
          maxItems: TELL_MAX_ENTRIES,
          items: {
            type: "object",
            properties: {
              action: {
                type: "string",
                enum: actions.map((a) => a.slug),
                description: "Which of the actions above this entry is.",
              },
              fields: {
                type: "object",
                description:
                  "The fields for that action, by key. Leave a key out when the sentence does not say — never guess a number, a date or a name.",
                additionalProperties: {
                  type: ["string", "number", "null"],
                },
              },
            },
            required: ["action", "fields"],
          },
        },
      },
      required: ["entries"],
    },
  };
}

/* -- What comes back ------------------------------------------------------ */

const entrySchema = z.object({
  action: z.string().min(1).max(120),
  fields: z.record(
    z.string().max(64),
    z.union([z.string(), z.number(), z.boolean(), z.null()]).optional(),
  ),
});

const proposalSchema = z.object({
  entries: z.array(entrySchema).max(TELL_MAX_ENTRIES),
});

export type RawEntry = z.infer<typeof entrySchema>;

/**
 * Zod at the boundary. A tool call that is not entries of an action and some
 * fields is a refusal, never a half-parsed proposal shown as if it were the
 * answer.
 */
export function validateProposal(raw: unknown): RawEntry[] | null {
  const parsed = proposalSchema.safeParse(raw);
  return parsed.success ? parsed.data.entries : null;
}

/* -- Resolve each field --------------------------------------------------- */

export interface TellCard {
  /** Which action. Always one the tenant has. */
  actionSlug: string;
  values: TellValues;
  /**
   * Field key → what the sentence said, for a field left empty because the
   * words matched no choice, no number and no date. Shown beside the field,
   * never silently dropped.
   */
  hints: Record<string, string>;
}

export function isCalendarDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** Case, surrounding space and runs of space aside. */
export function normalizeLabel(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * A word matched against a field's choices — exactly, then by a choice whose
 * whole label appears in the words. Never nearest: "pen" alone does not pick
 * "Pen 2" when "Pen 3" is also there.
 */
export function matchChoice(field: TellField, said: string): string | null {
  const wanted = normalizeLabel(said);
  if (!wanted) return null;
  const choices = field.choices ?? [];
  for (const c of choices) {
    if (normalizeLabel(c.label) === wanted || c.value === said) return c.value;
  }
  const contained = choices.filter((c) =>
    ` ${wanted} `.includes(` ${normalizeLabel(c.label)} `),
  );
  return contained.length === 1 ? contained[0].value : null;
}

function asText(v: string | number | boolean): string {
  return (typeof v === "string" ? v : String(v)).trim();
}

/**
 * Each field judged by its kind, against the action it belongs to. An entry
 * naming an action the tenant does not have is dropped: the model was told
 * the list, and something outside it is a misreading rather than a card.
 */
export function resolveEntries(
  raw: RawEntry[],
  actions: TellAction[],
  today: string,
): TellCard[] {
  const bySlug = new Map(actions.map((a) => [a.slug, a]));
  const cards: TellCard[] = [];
  for (const entry of raw) {
    const action = bySlug.get(entry.action);
    if (!action) continue;
    const values: TellValues = {};
    const hints: Record<string, string> = {};
    for (const f of action.fields) {
      const v = entry.fields[f.key];
      if (v === null || v === undefined || v === "") {
        values[f.key] = f.kind === "date" && f.defaultToday ? today : null;
        continue;
      }
      const said = asText(v);
      if (said === "") {
        values[f.key] = f.kind === "date" && f.defaultToday ? today : null;
        continue;
      }
      let resolved: TellValue = null;
      switch (f.kind) {
        case "text":
          resolved = said.slice(0, 2_000);
          break;
        case "number": {
          const n = typeof v === "number" ? v : Number(said.replace(/[,$\s]/g, ""));
          if (Number.isFinite(n)) resolved = n;
          else hints[f.key] = said.slice(0, 120);
          break;
        }
        case "date":
          if (isCalendarDate(said)) resolved = said;
          else {
            hints[f.key] = said.slice(0, 120);
            if (f.defaultToday) resolved = today;
          }
          break;
        case "choice": {
          const value = matchChoice(f, said);
          if (value !== null) resolved = value;
          else hints[f.key] = said.slice(0, 120);
          break;
        }
      }
      values[f.key] = resolved;
    }
    cards.push({ actionSlug: action.slug, values, hints });
    if (cards.length >= TELL_MAX_ENTRIES) break;
  }
  return cards;
}

/* -- A card, before it is recorded ---------------------------------------- */

/**
 * The first thing wrong with a card, in words for the person, or null. Run by
 * the box to hold the button back and by the server before anything is
 * recorded, so the two never disagree about what "ready" means.
 */
/**
 * Takes the FIELDS rather than the whole action, so the device endpoint's
 * readback can check a card against the light `{ slug, title, label, fields }`
 * shape `proposeTold` hands back instead of needing a `record` it will never
 * call. A `TellAction` still satisfies it.
 */
export function checkEntry(
  values: TellValues,
  action: Pick<TellAction, "fields">,
): string | null {
  for (const f of action.fields) {
    const v = values[f.key];
    if (v === null || v === undefined || v === "") {
      if (f.required) return `${f.label} is missing.`;
      continue;
    }
    switch (f.kind) {
      case "text":
        if (typeof v !== "string") return `${f.label} should be words.`;
        break;
      case "number":
        if (typeof v !== "number" || !Number.isFinite(v)) {
          return `${f.label} should be a number.`;
        }
        break;
      case "date":
        if (typeof v !== "string" || !isCalendarDate(v)) {
          return `${f.label} is not a real date.`;
        }
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

/** The save boundary: entries of an action and some fields, nothing tighter. */
export const confirmedEntriesSchema = z
  .array(
    z.object({
      actionSlug: z.string().min(1).max(120),
      values: z.record(
        z.string().max(64),
        z.union([z.string().max(2_000), z.number(), z.null()]),
      ),
    }),
  )
  .min(1)
  .max(TELL_MAX_ENTRIES);
