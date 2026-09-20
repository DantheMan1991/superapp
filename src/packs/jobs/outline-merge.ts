/**
 * BRINGING ONE OUTLINE'S QUESTIONS ONTO ANOTHER'S STEPS.
 *
 * ── WHY THIS EXISTS AT ALL ──────────────────────────────────────────────────
 *
 * Reading an outline off a chart of cost gives the right steps, the right
 * codes and the right sections, and **one question on each** — *"Who is doing
 * this one?"*. The questions are the whole value of a walk, and a business
 * that has already written good ones into an older outline should not type
 * them again. The pilot hit exactly this: 33 hand-edited steps carrying 111
 * questions, and a fresh 73-step outline carrying 73.
 *
 * ── IT PROPOSES; IT NEVER DECIDES ───────────────────────────────────────────
 *
 * Matching two people's names for the same phase is guesswork and it is
 * wrong often enough to matter. Measured against the pilot's own pair, 25 of
 * 33 steps matched and **several of those were nearly right rather than
 * right** — `Decks and porches` landed on `Porch` when `Deck` was also there.
 * So everything here returns a PROPOSAL with the reason it was made, and the
 * screen makes somebody confirm or repoint every row. Nothing copies itself.
 *
 * ── WHAT A BAD MATCH USED TO LOOK LIKE ──────────────────────────────────────
 *
 * The first cut scored any shared word and produced confident nonsense:
 * *Utilities and septic* → *Windows and Doors (Including Hardware)*, because
 * `and` counts as a word and a long title shares one with everything. Three
 * fixes, each measured against the real pair: **stop words are dropped**,
 * **a shared-word match must cover most of the shorter title**, and **among
 * containments the closest in length wins** — which is the difference
 * between `Electrical` → `Electric` and `Electrical` → `Electrical Fixtures
 * Material`.
 *
 * Nothing here is construction vocabulary. It is title matching, and the
 * words it ignores are English ones.
 */

/** Words that carry no meaning in a step name and make long titles magnets. */
const STOP = new Set([
  "and",
  "the",
  "for",
  "with",
  "our",
  "per",
  "any",
  "all",
  "its",
  "including",
  "incl",
  "from",
  "into",
  "onto",
  "job",
]);

export function normalizeTitle(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Plain English plural and gerund trimming — enough for `Landscaping` to
 * reach `Landscape` and `Gutters` to reach `Gutter`. Deliberately crude: a
 * real stemmer would over-reach, and every match is confirmed by a person.
 */
export function stemWord(word: string): string {
  return word
    .replace(/(ings|ing|ies|es|s)$/, (m) => (m === "ies" ? "y" : ""))
    .replace(/e$/, "");
}

export function significantWords(title: string): Set<string> {
  return new Set(
    normalizeTitle(title)
      .split(" ")
      .filter((w) => w.length > 2 && !STOP.has(w))
      .map(stemWord),
  );
}

function wordKey(title: string): string {
  return [...significantWords(title)].sort().join(" ");
}

/** Why a pair was proposed, in words the review screen shows. */
export type MatchReason = "same words" | "one contains the other" | "mostly the same words";

export interface StepLike {
  id: string;
  title: string;
  /** How many questions it has, so the screen can say what is worth taking. */
  questions: number;
}

export interface ProposedMerge {
  sourceId: string;
  sourceTitle: string;
  sourceQuestions: number;
  /** Null when nothing looked close enough. The screen asks for a target. */
  targetId: string | null;
  targetTitle: string;
  reason: MatchReason | null;
}

/**
 * One proposal per SOURCE step that has questions worth moving. A target may
 * be proposed twice — the pilot's `Framing labour` and `Framing materials`
 * both point at `Framing` — and that is correct: they are different
 * questions about the same phase and both sets belong there.
 */
export function proposeMerges(
  source: readonly StepLike[],
  target: readonly StepLike[],
): ProposedMerge[] {
  return source
    .filter((s) => s.questions > 0)
    .map((s) => {
      const base: ProposedMerge = {
        sourceId: s.id,
        sourceTitle: s.title,
        sourceQuestions: s.questions,
        targetId: null,
        targetTitle: "",
        reason: null,
      };

      const same = target.find((t) => wordKey(t.title) === wordKey(s.title) && wordKey(s.title) !== "");
      if (same) {
        return { ...base, targetId: same.id, targetTitle: same.title, reason: "same words" as const };
      }

      /**
       * **THE CLOSEST IN LENGTH, NOT THE FIRST.** `Electrical` contains
       * `Electric` and is contained by `Electrical Fixtures Material`; the
       * short one is the phase and the long one is a line item in it.
       */
      const flat = normalizeTitle(s.title);
      const contained = target
        .filter((t) => {
          const other = normalizeTitle(t.title);
          return other !== "" && flat !== "" && (other.includes(flat) || flat.includes(other));
        })
        .sort(
          (a, b) =>
            Math.abs(normalizeTitle(a.title).length - flat.length) -
            Math.abs(normalizeTitle(b.title).length - flat.length),
        );
      if (contained[0]) {
        return {
          ...base,
          targetId: contained[0].id,
          targetTitle: contained[0].title,
          reason: "one contains the other" as const,
        };
      }

      /**
       * **A SHARED WORD ONLY COUNTS IF IT IS MOST OF THE SHORTER TITLE.**
       * Without the threshold a single word makes a match, and a long title
       * becomes a magnet that catches everything.
       */
      const words = significantWords(s.title);
      const best = target
        .map((t) => {
          const theirs = significantWords(t.title);
          const shared = [...theirs].filter((w) => words.has(w)).length;
          return { t, shared, need: Math.min(theirs.size, words.size) };
        })
        .filter((x) => x.need > 0 && x.shared >= Math.ceil(x.need * 0.6))
        .sort((a, b) => b.shared - a.shared)[0];
      if (best) {
        return {
          ...base,
          targetId: best.t.id,
          targetTitle: best.t.title,
          reason: "mostly the same words" as const,
        };
      }

      return base;
    });
}

/**
 * A question is already there when its prompt reads the same. Copying an
 * outline onto itself, or twice, must not double every question — and the
 * prompt is what a person recognises, so it is what identity means here.
 */
export function isAlreadyAsked(prompt: string, existing: readonly string[]): boolean {
  const want = normalizeTitle(prompt);
  return existing.some((p) => normalizeTitle(p) === want);
}
