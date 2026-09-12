import { checkEntry, type TellCard } from "@/lib/tell-sources/shape";
import type { TellField } from "@/lib/tell-sources/types";

/**
 * WHAT THE PHONE SAYS BACK. Pure, and tested as such.
 *
 * ── WHY THERE IS A READBACK AT ALL ───────────────────────────────────────────
 *
 * ADR 0039's strongest rule is that a choice resolves BY LABEL AND NEVER BY
 * NEAREST: a word matching no paddock is kept as a hint beside an empty field
 * rather than guessed at. On a screen somebody taps the hint and picks. **On a
 * phone in a pocket there is no field to tap**, which is the one genuinely new
 * problem voice introduces, and this file is the answer to it: say what was
 * understood, name what was not, and record nothing until a person agrees.
 *
 * A wrong write nobody witnessed is the worst thing this feature can produce,
 * so an unresolved field parks the whole sentence rather than being dropped.
 */

/** The light shape `proposeTold` returns — no `record`, because none is called. */
export interface ReadbackAction {
  slug: string;
  title: string;
  label: string;
  fields: TellField[];
}

export interface CardReadback {
  actionSlug: string;
  /** "Moved somewhere — Cows onto Paddock 5, 2026-09-12" */
  line: string;
  /** Why this card cannot be recorded yet, or null. */
  blocked: string | null;
  /** What the sentence said for a field that matched nothing at all. */
  hints: string[];
}

export interface Readback {
  cards: CardReadback[];
  /** One utterance for a phone to speak. */
  text: string;
  /** Every card filled and valid — only then is there anything to confirm. */
  ready: boolean;
}

function displayValue(field: TellField, raw: unknown): string | null {
  if (raw === null || raw === undefined || raw === "") return null;
  if (field.kind === "choice") {
    const hit = (field.choices ?? []).find((c) => c.value === raw);
    // A choice whose value resolved to no label is a bug upstream, not
    // something to render as a uuid at somebody in a barn.
    return hit ? hit.label : null;
  }
  return String(raw);
}

export function buildReadback(
  cards: TellCard[],
  actions: ReadbackAction[],
): Readback {
  const bySlug = new Map(actions.map((a) => [a.slug, a]));
  const out: CardReadback[] = [];

  for (const card of cards) {
    const action = bySlug.get(card.actionSlug);
    if (!action) continue;

    const parts: string[] = [];
    for (const field of action.fields) {
      const shown = displayValue(field, card.values[field.key]);
      if (shown !== null) parts.push(shown);
    }

    const hints = Object.entries(card.hints).map(([key, said]) => {
      const field = action.fields.find((f) => f.key === key);
      return `${field?.label ?? key}: you said “${said}”, which matches nothing here`;
    });

    out.push({
      actionSlug: card.actionSlug,
      line: parts.length > 0 ? `${action.title} — ${parts.join(", ")}` : action.title,
      blocked: checkEntry(card.values, action),
      hints,
    });
  }

  const ready = out.length > 0 && out.every((c) => c.blocked === null);
  return { cards: out, text: speak(out, ready), ready };
}

/**
 * ONE UTTERANCE, and short. A phone reading five lines back at somebody
 * holding a bucket is worse than no readback: they stop listening after the
 * first, and the "yes" that follows means nothing. So the cards are one
 * sentence each, and a blocked card says what is wrong instead of what is
 * right — there is no point confirming the half that worked.
 */
function speak(cards: CardReadback[], ready: boolean): string {
  if (cards.length === 0) return "I did not catch anything I can record.";

  if (!ready) {
    const stuck = cards.find((c) => c.blocked !== null);
    const hint = cards.flatMap((c) => c.hints)[0];
    return hint
      ? `I could not finish that. ${hint}. Say it again with the name as it is in Yosher.`
      : `I could not finish that. ${stuck?.blocked ?? "Something is missing."}`;
  }

  const body = cards.map((c) => c.line).join("; ");
  return `${body}. Say yes to record${cards.length > 1 ? " all of it" : ""}.`;
}
