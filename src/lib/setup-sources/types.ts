import type { Tx } from "@/db";

/**
 * The setup-step contract — what a tool needs before it can do its job,
 * answered live from the tenant's own rows.
 *
 * THIS FILE IMPORTS NOTHING FROM `src/modules/**` OR `src/packs/**`, AND MUST
 * NOT. Same arrangement as `src/lib/attention-sources/types.ts`, enforced the
 * same way in eslint.config.mjs:
 *
 *     src/modules/<slug>/setup/source.ts ──imports──▶ types.ts (this file)
 *     src/packs/<slug>/setup/source.ts   ──imports──▶ types.ts
 *     src/lib/setup-sources/registry.ts  ──imports──▶ every source
 *     the Overview's card                ──imports──▶ resolve.ts ──▶ registry.ts
 *
 * ── WHAT A STEP IS ──────────────────────────────────────────────────────────
 *
 * **A prerequisite, not a nudge** (ADR 0033). A step names a thing the module
 * is built around and this business has none of: a register, a place to keep
 * stock, an animal, a parcel, somewhere to sell. It is never advice — "invite
 * your team", "record your first sale" — because a solo operator would see
 * advice forever, and the only way to make it go away would be a dismiss
 * button, which is the stored state this design exists to avoid.
 *
 * **Derived, never stored.** A source answers "has this ever existed here?"
 * as a query over its module's own tables. Adding the thing makes the step
 * disappear. Nothing is marked done, so the list can never say a business is
 * set up when it is not, and never asks for a thing already there.
 *
 * **EVER, not NOW.** A step asks whether the row has ever existed, not whether
 * one stands today. A broiler farm between batches has no animals on hand and
 * does not need telling to add some; a step that came back every winter would
 * be the nag this list must not become. The cost is accepted and stated: a
 * business that retires its only bank account is not asked again.
 *
 * ── TWO RULES THAT ARE SECURITY, NOT STYLE ──────────────────────────────────
 *
 *  1. `collect` takes the CALLER'S `tx`. It does not open its own transaction,
 *     does not call `withTenant`, and never calls `withSystem`. The Overview
 *     established the RLS context from `requireTenant()`; a source sees what
 *     that person may see and cannot widen it (security.md, invariant S12).
 *
 *  2. The CALLER decides who sees the card — owners, because every step is an
 *     owner's act. A source does not reason about roles at all; there is no
 *     role in its context to reason with.
 *
 * ── AND ONE ABOUT FAILURE ───────────────────────────────────────────────────
 *
 * A source that throws is REPORTED (`SetupOutcome`), never folded to an empty
 * list. The card disappears when there is nothing left to do, so a source that
 * failed silently would look exactly like a business that is set up — and the
 * whole point of the card is that its absence can be trusted.
 */

/**
 * What a source is told. Deliberately only the tenant: the caller's `tx` is
 * already scoped, and a step is a fact about the business, not about a person.
 */
export interface SetupCtx {
  tenantId: string;
}

/**
 * One thing a tool is waiting for.
 *
 * No `id`: a step is derived, so it has no identity beyond the prerequisite it
 * names. `key` is stable per prerequisite so a test can say which steps stand.
 */
export interface SetupStep {
  /** Stable per prerequisite. "accounting.bank-account". */
  key: string;
  /** The ask, as a verb, one line, no trailing period. "Add your bank account". */
  title: string;
  /** One line on what it is for, or what it unlocks. */
  detail: string;
  /** Where it is done. Root-relative, and the screen itself, not a list of screens. */
  href: string;
  /** The button's label. "Add account". */
  cta: string;
  /**
   * The guide for that screen, as its `docs/help` slug ("accounting/banking"),
   * or null when the screen has none. A slug rather than a resolved href
   * because the Overview is not traced to read `docs/help` at request time
   * (next.config.ts), so the card must not go looking; the db-backed test
   * checks every slug a source names is a file.
   */
  guide: string | null;
}

/**
 * A module's contribution.
 *
 * `moduleSlug` gates it: a source whose module is switched off contributes
 * nothing, and is not reported as a failure — "you do not have Retail" and
 * "Retail broke" are different sentences.
 */
export interface SetupSource {
  /** Stable identifier, used in logs and in the "could not check" line. */
  slug: string;
  /** Module that must be enabled for this source to run. */
  moduleSlug: string;
  /** Shown above each of its steps. "Accounting", not "accounting". */
  label: string;
  collect(tx: Tx, ctx: SetupCtx): Promise<SetupStep[]>;
}

/**
 * What one source produced — or why it produced nothing. The discriminator is
 * the point: flattening this to `SetupStep[]` would make a broken source
 * indistinguishable from a finished one.
 */
export type SetupOutcome =
  | { status: "ok"; source: SetupSource; steps: SetupStep[] }
  | { status: "failed"; source: SetupSource; reason: "error" | "timeout" };
