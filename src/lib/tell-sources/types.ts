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
  /** `choice` only. Labels are names, nothing more (see the header). */
  choices?: TellChoice[];
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
