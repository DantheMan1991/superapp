import type { Tx } from "@/db";

/**
 * The tell-it contract — what a pack can be TOLD in one sentence, and the
 * verb that records it (onboarding slice 6).
 *
 * THIS FILE IMPORTS NOTHING FROM `src/modules/**` OR `src/packs/**`, AND MUST
 * NOT. The seventh declared extension point, arranged like the six before it
 * and enforced the same way in eslint.config.mjs:
 *
 *     src/packs/<slug>/tell/source.ts   ──imports──▶ types.ts (this file)
 *     src/lib/tell-sources/registry.ts  ──imports──▶ every source
 *     the box's actions                 ──imports──▶ resolve.ts ──▶ registry.ts
 *
 * ── WHAT THIS IS FOR ────────────────────────────────────────────────────────
 *
 * The onboarding plan's third problem, and the one the founder named first:
 * *"we need to explore how to super simply enter data in on a day to day
 * basis so it is not overwhelming."* Standing in a barn, "three chicks dead
 * in pen two" is one sentence and four screens. This is the one sentence.
 *
 * ── HOW IT DIFFERS FROM A PASTE TARGET (ADR 0036) ───────────────────────────
 *
 * A paste target is ONE kind of row, many times. A tell action is ONE OF
 * SEVERAL KINDS of thing that happened, usually once: a loss, a move, a
 * feed. So the model picks the action as well as filling it in, and the
 * review is a card per thing rather than a table of rows.
 *
 * Everything else is deliberately the same, because the same things are true:
 *
 *  - **The model never writes.** `propose` returns cards; `record` takes what
 *    a person confirmed and hands each one to the pack's own verb. A sentence
 *    misread cannot reach the herd without somebody tapping it.
 *  - **Choices resolve by label, never nearest.** The paddock, the pen and
 *    the feed are the tenant's own rows; a word that matches none of them is
 *    kept as a HINT beside the empty field for the person to pick.
 *  - **The pack's refusals are the refusals.** `record` calls the verb the
 *    pack's own screens call, so a loss bigger than the pen and a move to a
 *    paddock that does not exist are refused in the pack's words, not in
 *    this slot's.
 *
 * ── TWO RULES THAT ARE SECURITY, NOT STYLE ──────────────────────────────────
 *
 *  1. Every function takes the CALLER'S `tx`, opens no transaction of its own
 *     and never calls `withSystem`. It sees what that person may see
 *     (security.md, invariant S12). The network call happens between
 *     transactions, never inside one.
 *
 *  2. The model is shown the sentence and the LABELS of the choices — the
 *     names of this farm's pens, paddocks and feeds, which it needs in order
 *     to map "pen two" onto one. Nothing else leaves (S9). Labels are names.
 */

/** Who is telling it, and WHEN — see the note on `now`. */
export interface TellCtx {
  tenantId: string;
  userId: string;
  role: "owner" | "staff" | "expert";
  /**
   * WHEN THE SENTENCE HAPPENED, not when it was processed.
   *
   * From the box on a screen these are the same instant and this is simply
   * `new Date()`. From a phone (ADR 0048) they are not: a sentence spoken in
   * a barn with no signal is queued and sent when the phone reconnects, which
   * may be hours later, and the endpoint clamps the phone's claim to the
   * server's clock before setting this.
   *
   * **AN ACTION THAT WRITES A TIMESTAMP MUST USE THIS AND NEVER `new Date()`.**
   * `time.clock_in` is the one that made it necessary: stamping a queued
   * clock-in at processing time is not a rounding error, it is wages.
   */
  now: Date;
  /** The tenant's zone. Needed by anything that turns `now` into a day. */
  timezone: string;
  /**
   * The tenant's industry, so a source can reach its own `packConfig` through
   * `packContext()`.
   *
   * A TENANT FACT, like the timezone, and carried for the same reason: both
   * gates already know it and a source that had to look it up would open a
   * transaction to answer a question the caller could have answered for free.
   * What a source DOES with it is its own business — livestock reads the
   * farm's words for its animals, which is how "the cows" finds the cattle
   * without the pack ever learning it is on a farm.
   */
  industry: string;
  /**
   * The tenant's today, so "this morning" and "yesterday" mean the right day.
   * DERIVED from `now` and `timezone` — `todayInTimezone(timezone, now)` — and
   * carried because almost every action wants the date and not the instant.
   * A sentence queued last night and sent this morning logs against LAST
   * NIGHT, which is the whole point of deriving it rather than reading a clock.
   */
  today: string;
}

export type TellFieldKind = "text" | "number" | "date" | "choice";

export interface TellChoice {
  value: string;
  label: string;
}

/**
 * One thing the words COULD have meant, with enough beside it to tell it from
 * its neighbours.
 *
 * `detail` is what makes this work where a bare list did not. "Meadow" and
 * "Spring broilers 2026" are two names; "Meadow — Cattle · 12 head · North 40"
 * and "Spring broilers 2026 — Poultry · 840 head" are two THINGS, and somebody
 * who said "the cows" meant the first. It is shown to the person and given to
 * the model, and it is the only reason either can choose sensibly.
 *
 * LABELS AND SHAPE ONLY, never money and never who owns it (S9).
 */
export interface TellCandidate {
  value: string;
  label: string;
  /** "Cattle · 12 head · North 40". One line, no more. */
  detail?: string;
}

export interface TellField {
  /** Stable per field within its action. "head". */
  key: string;
  /** The card's label. "How many". */
  label: string;
  kind: TellFieldKind;
  /** A card with this empty cannot be recorded. */
  required?: boolean;
  /** One sentence: the model's instruction, and the field's tooltip. */
  hint: string;
  /**
   * `choice` only, and only when the whole list is SHORT. Labels are names,
   * nothing more (see the header).
   *
   * Every one of these is written into the model's prompt, which is why a
   * field whose list can grow past a few dozen must use `find` instead.
   */
  choices?: TellChoice[];
  /**
   * FIND THE THINGS THESE WORDS COULD MEAN — the alternative to `choices`, and
   * the answer to two problems that turned out to be one.
   *
   * A list in the prompt does not scale: a business with two thousand
   * customers cannot have them all written into every sentence it says. And a
   * list demands an EXACT pick, so "checked the cows" matched nothing at all,
   * because no lot is called "the cows". The founder hit both — the second one
   * first, on his own farm.
   *
   * With this, the model reports what the person SAID, in their words, and the
   * pack goes and looks. Nothing is enumerated, so there is no ceiling; and
   * the pack can look however it likes, so "the cows" can find the cattle.
   *
   * Return the plausible ones, best first, and **do not be shy**: several
   * candidates is a question worth asking, whereas none is a dead end. A pack
   * whose text search finds nothing should return what it has (bounded), so
   * something can still be chosen from context.
   *
   * `said` is the person's own words for this field, never an id.
   */
  find?(tx: Tx, ctx: TellCtx, said: string): Promise<TellCandidate[]>;
  /** `date` only: fill with the tenant's today when the sentence says nothing. */
  defaultToday?: boolean;
}

export type TellValue = string | number | null;
export type TellValues = Record<string, TellValue>;

export interface TellRecorded {
  /** One line, past tense, for the list and the toast. "3 head lost from Pen 2". */
  summary: string;
}

/**
 * A refusal the person can act on. A source throws this — usually wrapping
 * its pack's own error and message — and the batch stops with the card named.
 * Anything else is a failure, not a refusal, and is reported as one.
 */
export class TellRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TellRefusal";
  }
}

/** One thing a pack can be told. */
export interface TellAction {
  /** Stable, and what the model answers with. "livestock.loss". */
  slug: string;
  /** The card's heading. "Animals lost". */
  title: string;
  /**
   * When to choose this action, in the model's terms: what a sentence has to
   * be saying. One or two lines, with an example.
   */
  about: string;
  fields: TellField[];
  /**
   * **May a card of this action be recorded the instant it is proposed, with
   * nobody tapping anything?** Defaults to NO, and the default is the rule
   * (ADR 0039: the model never writes).
   *
   * ADR 0050 is the amendment and the reasoning. The short version: the
   * confirm step exists because a misread sentence must not reach the herd,
   * and it earns that cost for anything that MOVES something. It does not earn
   * it for "clock me in" — four taps to start a clock is worse than the screen
   * it replaces, which is a way of not being used at all.
   *
   * Say yes only when all three hold:
   *
   *  1. **A wrong one is visible.** Not "discoverable in an audit" — visible,
   *     to this person, on a screen they already look at.
   *  2. **A wrong one is undoable in one step**, by them, without a
   *     correcting entry that itself needs explaining.
   *  3. **It moves no quantity.** No head, no stock, no money. A clock is a
   *     timestamp on your own name; a loss is three chicks that no longer
   *     exist.
   *
   * Even then it only fires when the card came back COMPLETE — every required
   * field filled, no unresolved word. A card with a blank in it is read back
   * and waits, always.
   */
  unattended?: boolean;
  /** Do it, through the pack's own verb. Throw `TellRefusal` to refuse. */
  record(tx: Tx, ctx: TellCtx, values: TellValues): Promise<TellRecorded>;
}

/**
 * A pack's contribution.
 *
 * `moduleSlug` gates it: a source whose pack is switched off contributes no
 * actions, and the model is never told they exist.
 */
export interface TellSource {
  slug: string;
  moduleSlug: string;
  /** Shown above its cards. "Livestock". */
  label: string;
  /** The actions, with choices read live from this tenant's rows. */
  actions(tx: Tx, ctx: TellCtx): Promise<TellAction[]>;
  /** Root-relative paths to revalidate after anything of its is recorded. */
  revalidate: string[];
}
