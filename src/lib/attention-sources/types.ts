import type { Tx } from "@/db";

/**
 * The attention-source contract — what a module owes a person, answered live.
 *
 * THIS FILE IMPORTS NOTHING FROM `src/modules/**`, AND MUST NOT. Same trick as
 * `src/lib/mail-extensions/types.ts` and `src/modules/types.ts`:
 *
 *     src/modules/<slug>/attention/source.ts ──imports──▶ types.ts (this file)
 *     src/lib/attention-sources/registry.ts  ──imports──▶ every source
 *     the digest + the in-app page           ──imports──▶ registry.ts
 *
 * Every arrow points one way, `registry.ts` is the single composition root, and
 * eslint.config.mjs enforces it rather than trusting anyone to remember.
 *
 * ── WHAT AN OBLIGATION IS ────────────────────────────────────────────────────
 *
 * **Derived, never stored.** A source answers "what does this person still owe?"
 * as a live query over its module's own state. Paying the invoice makes the
 * item disappear; there is nothing to mark read, and it can never tell somebody
 * about work they already did. The usual events-table-with-`is_read` design
 * cannot self-clear, so it accumulates and gets muted.
 *
 * That is why there is no `id` you can dismiss and no write side to this
 * interface. If you find yourself wanting to store an item so it can be
 * cleared, the thing you actually want is a discrete EVENT (a document shared
 * with you, a mention), which is a different feature with a different table —
 * kept separate so it cannot rot the majority.
 *
 * ── TWO RULES THAT ARE SECURITY, NOT STYLE ───────────────────────────────────
 *
 *  1. `collect` takes the CALLER'S `tx`. It does not open its own transaction,
 *     does not call `withTenant`, and above all never calls `withSystem`. The
 *     caller has already established the RLS context from a `requireTenant()`
 *     result — or, for the digest, from a freshly reconciled membership — so
 *     what a source can find is exactly what that person is allowed to see. A
 *     source cannot widen its own visibility. This is invariant S12 expressed
 *     as a function signature.
 *
 *  2. The `ctx.role` a source receives is the role the CALLER resolved, and a
 *     source must treat it as descriptive, not as permission to look further.
 *     Filtering on it is fine ("staff are not asked to approve bills"); using
 *     it to decide to query more broadly is not — RLS already decided that.
 *
 * ── AND ONE THAT IS NOT LIKE MAIL ────────────────────────────────────────────
 *
 * A mail extension that breaks costs its own chips and the inbox still renders.
 * **A broken attention source means a person is not told about work they owe**,
 * which is worse than a visibly missing panel and much worse than a wrong chip.
 * So `collect` failing is REPORTED (see `SourceOutcome`), never folded to an
 * empty list. "Nothing needs you today" and "we could not ask Accounting" must
 * never render the same way, for the same reason silence is not an acceptable
 * digest: the reader cannot tell a quiet day from a broken one.
 */

/**
 * What a source is told about the person it is answering for.
 *
 * Deliberately small, and deliberately the same shape as `MailExtensionCtx`:
 * the ids and the role, all of which came from `requireTenant()` or from the
 * digest's reconciled membership. Notably absent is anything a source could use
 * to broaden a query — no database handle, no session, no token. It gets the
 * caller's `tx`, and that tx is already scoped.
 */
export interface AttentionCtx {
  tenantId: string;
  /** The Clerk user id of the person this is being collected FOR. */
  userId: string;
  role: "owner" | "staff" | "expert";
  /**
   * Today, in the tenant's timezone, as `yyyy-mm-dd` (0086).
   *
   * Passed in rather than computed per source, so every source in one digest
   * agrees on what day it is. Two sources calling `todayInTimezone()` a
   * millisecond apart across midnight would disagree, and "one number
   * everywhere" is the property this whole feature trades on.
   */
  today: string;
}

/** How much a person is expected to care. Drives ordering, never filtering. */
export type AttentionUrgency = "overdue" | "today" | "soon";

/**
 * One thing a person still owes.
 *
 * No `id`: an obligation is derived, so it has no identity of its own beyond
 * the record it points at. `href` is that record, and is what makes the email
 * actionable without a round trip through a list page.
 */
export interface AttentionItem {
  /** Stable per underlying record — used for dedup and for delta comparison. */
  key: string;
  /** One line, no trailing period. "Invoice 1043 is 6 days overdue". */
  title: string;
  /** Optional second line: the customer, the vendor, the amount. */
  detail?: string;
  urgency: AttentionUrgency;
  /** `yyyy-mm-dd` when this became or becomes due. Null = no agreed date. */
  dueOn: string | null;
  /** Deep link to the record itself, not to a list. Root-relative. */
  href: string;
  /**
   * True when this reached the person because it is assigned to NOBODY and
   * they are the owner, rather than because it is theirs.
   *
   * The design's load-bearing consequence of per-person delivery: work assigned
   * to no one is invisible to everyone. Rolling it up to the owner fixes that,
   * but an owner seeing it mixed in with their own work cannot tell the
   * difference between "you owe this" and "nobody owes this yet" — which are
   * different asks. The renderer groups on this.
   */
  unassigned?: boolean;
}

/**
 * A module's contribution.
 *
 * `moduleSlug` gates it: a source whose module is switched off contributes
 * nothing, the same way a mail extension does. `requireModuleEnabled` is an
 * entitlement check and not a security boundary (security.md §7) — this is
 * about what a tenant has bought, not what they may read. RLS decides that.
 */
export interface AttentionSource {
  /** Stable identifier, used in logs and in the "could not check" message. */
  slug: string;
  /** Module that must be enabled for this source to run. */
  moduleSlug: string;
  /** Shown as the section heading. "Accounting", not "accounting". */
  label: string;
  collect(tx: Tx, ctx: AttentionCtx): Promise<AttentionItem[]>;
}

/**
 * What one source produced — or why it produced nothing.
 *
 * The discriminator is the whole point. A caller that flattened this to
 * `AttentionItem[]` would make a broken source indistinguishable from a quiet
 * one, and would report a number it cannot stand behind.
 */
export type SourceOutcome =
  | { status: "ok"; source: AttentionSource; items: AttentionItem[] }
  | { status: "failed"; source: AttentionSource; reason: "error" | "timeout" };
