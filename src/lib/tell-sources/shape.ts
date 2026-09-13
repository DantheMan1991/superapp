import { z } from "zod";
import type {
  TellAction,
  TellCandidate,
  TellField,
  TellValue,
  TellValues,
} from "./types";

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
    if (f.find) {
      // NOTHING ENUMERATED. The model reports what was SAID and the pack goes
      // and looks (`TellField.find`) — which is what removes the ceiling and
      // what lets "the cows" find the cattle.
      bits.push(
        "The words the sentence used for it, exactly as said — “the cows”, “the back field”, “Rosie”. Never invent a name you were not given, and never leave it out because you are unsure which one is meant: saying the words is what lets it be looked up.",
      );
    } else {
      const labels = (f.choices ?? []).map((c) => `“${c.label}”`).join(", ");
      bits.push(`One of: ${labels || "(none yet)"} — copied exactly when the sentence clearly means it, otherwise the sentence's own words.`);
    }
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
  /**
   * Field key → the things those words could have meant, when a `find` came
   * back with more than one and nothing could tell them apart.
   *
   * A SHORTLIST IS A QUESTION, not a failure. The old behaviour for an
   * unmatched word was an empty field and an amber warning; this is two or
   * three real things with a line each saying what they are, which is what a
   * person would have asked.
   */
  options?: Record<string, TellCandidate[]>;
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
          if (f.find) {
            // LEFT FOR `resolveFound`, which runs inside the tenant's
            // transaction because looking things up needs one. The words are
            // parked as a hint so nothing is lost if that pass cannot finish.
            hints[f.key] = said.slice(0, 120);
            break;
          }
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
/** A field whose value comes from a lookup, whichever side is asking. */
function isSearched(field: Pick<TellAction, "fields">["fields"][number]): boolean {
  return (
    field.find !== undefined ||
    (field as { searched?: boolean }).searched === true
  );
}

/**
 * **THE VALUES A PREVIEW WAS COMPUTED FOR** (ADR 0054 §2).
 *
 * A preview is worked out server-side and then a person edits the card. The
 * arithmetic above the button must not survive the edit that invalidated it —
 * **a stale preview is worse than none**, because the whole point is to be the
 * thing somebody trusts INSTEAD of reading the fields.
 *
 * So every preview is stamped with the values it describes, and the box shows
 * it only while that stamp still matches. Keys are sorted, so the same card
 * cannot produce two spellings of the same state and refetch forever.
 */
/**
 * The words of a phrase, for matching — lowercase, punctuation gone.
 *
 * Shared rather than copied. Two sources each carrying their own idea of what
 * a word is, is how "Pen 2" and "pen-2" come to match in one pack and not the
 * other, and neither author ever learns it.
 */
export function saidWords(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w !== "");
}

export function previewKey(values: TellValues): string {
  return JSON.stringify(
    Object.keys(values)
      .sort()
      .map((k) => [k, values[k] ?? null]),
  );
}

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
        if (typeof v !== "string" || v === "") {
          return `${f.label} is missing.`;
        }
        /*
         * A SEARCHED FIELD HAS NO LIST TO BE IN, and checking it against an
         * absent one rejected everything — every card, every action, the whole
         * feature. Found the moment livestock's lots stopped being enumerated.
         *
         * What replaces the check is not nothing. The value came from the
         * pack's own `find`, and `record` hands it to the pack's own verb,
         * which refuses an id it does not recognise in its own words — the
         * same verb the pack's screens call. A second opinion here would be
         * the weaker one, and it is the one that would drift.
         */
        /*
         * EITHER SPELLING OF "THIS ONE IS SEARCHED", because the two sides see
         * different objects. The server has `find`, a function; the box gets
         * `searched`, a boolean, because a function cannot cross into a client
         * component. This same check ran on both and passed on one — so a
         * field that HAD been found correctly was still rejected with "is not
         * one of the choices", which is what the founder saw with Bluebell
         * sitting right there on the card.
         */
        if (!isSearched(f) && !(f.choices ?? []).some((c) => c.value === v)) {
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

/**
 * MAY THIS BATCH BE RECORDED WITHOUT ANYBODY TAPPING ANYTHING? (ADR 0050.)
 *
 * Here rather than in the box because of what it decides: the one condition
 * under which a model's output reaches a tenant's data with no person in
 * between. A rule like that belongs where it can be tested, not inside a
 * component where it is read once by whoever is changing the layout.
 *
 * Four things must all hold, and the last two are why this is not simply
 * `action.unattended`:
 *
 *  1. There is at least one card. An empty batch is not "all clear".
 *  2. Every card's action DECLARED itself unattended. One dissenter stops the
 *     whole batch — two things said in one sentence happened together, and
 *     half of them landing while the other half waits is the worst of both
 *     (ADR 0039's all-or-none, unchanged).
 *  3. No card carries a HINT. A hint is a word that matched nothing, and
 *     "never nearest" means somebody has to look at it.
 *  4. Every card passes `checkEntry`. A required field left empty is not
 *     something to guess at unattended.
 */
export function readyToRecordUnasked(
  cards: TellCard[],
  actions: Array<Pick<TellAction, "fields"> & { slug: string; unattended: boolean }>,
): boolean {
  if (cards.length === 0) return false;
  return cards.every((card) => {
    const action = actions.find((a) => a.slug === card.actionSlug);
    if (!action || !action.unattended) return false;
    if (Object.keys(card.hints).length > 0) return false;
    return checkEntry(card.values, action) === null;
  });
}
