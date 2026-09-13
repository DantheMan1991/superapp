import "server-only";
import type { Tx } from "@/db";
import type { TellCard } from "./shape";
import type { TellAction, TellCandidate, TellCtx } from "./types";

/**
 * GOING AND LOOKING — the pass that turns the words somebody said into the
 * thing they meant.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 *
 * Until now a `choice` field was a MENU with an exact-match rule: every lot,
 * paddock and job name was written into the model's prompt, and the model had
 * to pick one word-for-word. One design, two failures, and the founder found
 * both:
 *
 *   the menu does not scale     two thousand customers will not fit in a
 *                               prompt, so CRM and accounting could never be
 *                               told anything at all
 *   the match does not think    "checked the cows" matched nothing, because
 *                               no lot is called "the cows"
 *
 * *"I didn't want to have to say the exactly right things. It should be
 * intelligent and conversational."*
 *
 * So the model now reports what was SAID, and this asks each pack to look.
 * Nothing is enumerated; the pack searches however suits its own records.
 *
 * ── AND THE LINE THAT DID NOT MOVE ──────────────────────────────────────────
 *
 * ADR 0039 refused to guess the nearest match, deliberately, so a misheard
 * sentence could not reach the herd. That protection is kept and MOVED rather
 * than dropped: understanding is generous, confirming stays strict. One
 * candidate resolves; several become a question; none stays a hint. And
 * everything that moves animals, stock or money is still read back before it
 * happens (ADR 0050's three tests are untouched).
 *
 * **Nothing here writes.** It reads, and it fills in cards a person has yet to
 * agree to.
 */

/** How many things a shortlist may hold before it stops being a question. */
export const MAX_OPTIONS = 6;

/**
 * Resolve every `find` field on every card, in one pass, inside the caller's
 * transaction.
 *
 * Takes the caller's `tx` and opens none of its own — the rule every file in
 * this folder follows (`types.ts`, invariant S12). It sees what that person
 * may see, which is also why a search can never turn up a row they could not
 * have opened themselves.
 */
export async function resolveFound(
  tx: Tx,
  ctx: TellCtx,
  cards: TellCard[],
  actions: TellAction[],
): Promise<TellCard[]> {
  const bySlug = new Map(actions.map((a) => [a.slug, a]));
  const out: TellCard[] = [];

  for (const card of cards) {
    const action = bySlug.get(card.actionSlug);
    if (!action) {
      out.push(card);
      continue;
    }

    const values = { ...card.values };
    const hints = { ...card.hints };
    const options: Record<string, TellCandidate[]> = { ...(card.options ?? {}) };

    for (const field of action.fields) {
      if (!field.find) continue;
      const said = hints[field.key];
      if (typeof said !== "string" || said.trim() === "") continue;

      let candidates: TellCandidate[];
      try {
        candidates = await field.find(tx, ctx, said);
      } catch {
        // A pack whose search fails leaves the words where they were. The card
        // is still readable and still fixable by hand, which is the state this
        // whole pass is an improvement ON — never a worse one.
        continue;
      }

      const shortlist = candidates.slice(0, MAX_OPTIONS);
      if (shortlist.length === 0) continue;

      /*
       * THE SHORTLIST IS KEPT EITHER WAY, and that is not tidiness.
       *
       * A resolved field used to carry an id and nothing else, which the box
       * could not draw: a `choice` input with no matching entry renders
       * EMPTY, so a field that had been worked out correctly looked exactly
       * like one that had failed. Keeping the candidates means the box can
       * show what was decided AND let somebody change it to one of the others
       * without starting the sentence again.
       */
      options[field.key] = shortlist;

      const decided = decide(shortlist, said);
      if (decided) {
        values[field.key] = decided.value;
        delete hints[field.key];
        continue;
      }

      // MORE THAN ONE, AND NOTHING TO CHOOSE BETWEEN THEM. That is a question,
      // not a failure: the words stay visible and the candidates come with it.
    }

    out.push({
      ...card,
      values,
      hints,
      ...(Object.keys(options).length > 0 ? { options } : {}),
    });
  }

  return out;
}

/**
 * One obvious answer, or none.
 *
 * DELIBERATELY NOT CLEVER. A pack returns its candidates best first, and the
 * only things settled here are the ones nobody could argue with: a single
 * candidate, or one whose name is exactly what was said. Anything closer to a
 * judgement belongs to whoever knows the domain — the pack that ordered them,
 * or the person the shortlist is shown to.
 *
 * Ranking by string similarity was the obvious alternative and is how "never
 * nearest" gets reintroduced by accident: "Pen 3" is one character from
 * "Pen 2", and the wrong one would win silently.
 */
export function decide(
  shortlist: TellCandidate[],
  said: string,
): TellCandidate | null {
  if (shortlist.length === 0) return null;
  if (shortlist.length === 1) return shortlist[0];

  const wanted = normalise(said);
  const exact = shortlist.filter((c) => normalise(c.label) === wanted);
  return exact.length === 1 ? exact[0] : null;
}

/** Case, punctuation and runs of space aside. */
function normalise(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}
