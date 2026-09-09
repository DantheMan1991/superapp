import type { Tx } from "@/db";

/**
 * The paste-target contract — what a module says a pasted list of ITS things
 * looks like, so one dialog and one model call can load any of them.
 *
 * THIS FILE IMPORTS NOTHING FROM `src/modules/**` OR `src/packs/**`, AND MUST
 * NOT. Same arrangement as `src/lib/setup-sources/types.ts`, enforced the same
 * way in eslint.config.mjs:
 *
 *     src/modules/<slug>/paste/targets.ts ──imports──▶ types.ts (this file)
 *     src/packs/<slug>/paste/target.ts    ──imports──▶ types.ts
 *     src/lib/paste-targets/registry.ts   ──imports──▶ every target
 *     the dialog's actions                ──imports──▶ resolve.ts ──▶ registry.ts
 *
 * ── WHAT A TARGET IS ────────────────────────────────────────────────────────
 *
 * **Data, plus the module's own verb** (ADR 0036). A target describes a row as
 * FIELDS — a name, a unit, a date, a choice among the tenant's parcels — and
 * hands over `save`, which is the same function the module's own form calls.
 * The platform builds the model's tool from the fields, draws the review table
 * from the fields, and checks a reviewed row against the fields; it never
 * learns what a vendor or an animal is. What it may not do is write a row
 * itself: every refusal is the module's, raised by the module's verb, with the
 * module's words.
 *
 * **The model never writes.** `describe` and `duplicates` run BEFORE a person
 * sees anything; `save` runs AFTER, on rows the person ticked and may have
 * edited, and it has no way to tell which parts are the model's. That is the
 * CRM note extractor's shape (`crm/note-actions.ts`), and it is the whole
 * safety property: a hallucinated animal cannot reach the herd without
 * somebody reading its row.
 *
 * **Choices are resolved by label, never guessed.** A field with choices shows
 * the model the labels; a label that matches nothing is kept as a HINT beside
 * the empty cell — "the list said Back forty" — for the reviewer to place.
 * Nothing picks the nearest one.
 *
 * **Duplicates are advisory.** `duplicates` names the existing thing a row
 * looks like; the review unticks it and says why. Two customers called Smith
 * are real, so the person may tick it back.
 *
 * **One transaction, all rows or none.** A row the module refuses stops the
 * whole batch and is named. The review is the place to fix it; a half-loaded
 * list that then needs de-duplicating on the next attempt is worse than a
 * refusal that names row 7.
 *
 * ── TWO RULES THAT ARE SECURITY, NOT STYLE ──────────────────────────────────
 *
 *  1. Every function takes the CALLER'S `tx`. A target never opens its own
 *     transaction and never calls `withSystem`; it sees what the person may see
 *     (security.md, invariant S12). The one network call happens between two
 *     transactions, never inside one.
 *
 *  2. The model sees the pasted text, the photo, and the LABELS of the
 *     choices — the names of the tenant's parcels or items, which it needs in
 *     order to map "the back paddock" onto one. Nothing else about the tenant
 *     leaves (S9). A target that put a balance or an address in a choice label
 *     would be widening that, so labels are names.
 */

/** Who is pasting. The tenant's industry is here so a pack can read its vocabulary. */
export interface PasteCtx {
  tenantId: string;
  userId: string;
  role: "owner" | "staff" | "expert";
  /** The tenant's industry slug, or null when none is set. */
  industry: string | null;
}

export type PasteFieldKind = "text" | "number" | "date" | "choice";

/** One thing a `choice` field may be. `value` is what `save` receives; `label` is what the model and the person see. */
export interface PasteChoice {
  value: string;
  label: string;
}

/**
 * One column of a row.
 *
 * `hint` does double duty on purpose: it is the model's instruction for the
 * field and the tooltip on the review cell, so what the model was told to put
 * there is exactly what the person is shown it should hold.
 */
export interface PasteField {
  /** Stable per field; the key in a row. "name". */
  key: string;
  /** The column heading. "Name". */
  label: string;
  kind: PasteFieldKind;
  /** A row without it cannot be saved. */
  required?: boolean;
  /** One sentence on what belongs here. */
  hint: string;
  /** `choice` only: what it may be. Labels are names, nothing more (see the header). */
  choices?: PasteChoice[];
}

export type PasteValue = string | number | null;

/** A row as the person reviewed it: field key → value, choices already as values. */
export type PasteRow = Record<string, PasteValue>;

/** What a target looks like for THIS tenant right now. */
export interface PasteShape {
  fields: PasteField[];
  /**
   * Why rows cannot be taken yet, or null. "Add a parcel first, so a paddock
   * has somewhere to be." Stated rather than folded to an empty field list,
   * because an empty table would look like the model found nothing.
   */
  blocked?: string | null;
}

export interface PasteSaved {
  id: string;
  /** What to call it in the toast and the audit trail. Usually the name. */
  label: string;
}

/** A row `save` took, with its position in the batch, for `afterSave`. */
export interface PasteSavedRow {
  index: number;
  row: PasteRow;
  saved: PasteSaved;
}

/**
 * A refusal the person can act on. A target throws this — usually wrapping
 * its module's own error and message — and the batch stops with the row
 * named. Any other error is a failure, not a refusal, and is reported as one.
 */
export class PasteRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PasteRefusal";
  }
}

/**
 * A module's contribution.
 *
 * `moduleSlug` gates it: a target whose module is switched off does not exist
 * for that tenant, and the dialog is never offered.
 */
export interface PasteTarget {
  /** Stable identifier, in logs and the audit row. "accounting.vendors". */
  slug: string;
  /** Module that must be enabled for this target to exist. */
  moduleSlug: string;
  /** The dialog's title noun. "Vendors". */
  label: string;
  /** For counts and toasts. { one: "vendor", many: "vendors" }. */
  noun: { one: string; many: string };
  /**
   * What the pasted thing usually is, for the model, in the tenant's terms:
   * "vendors — the suppliers and service providers the business buys from".
   */
  about: string;
  /** The fields, with choices read live from the tenant's own rows. */
  describe(tx: Tx, ctx: PasteCtx): Promise<PasteShape>;
  /**
   * For each row, the label of an existing thing it looks like, or null.
   * The target's own notion of "the same": a name, a tag, an email.
   */
  duplicates(tx: Tx, ctx: PasteCtx, rows: PasteRow[]): Promise<Array<string | null>>;
  /** Create ONE reviewed row through the module's own verb. Throw `PasteRefusal` to refuse. */
  save(tx: Tx, ctx: PasteCtx, row: PasteRow): Promise<PasteSaved>;
  /**
   * After every row is saved, in the same transaction: for what can only be
   * done once the batch exists, such as an animal's dam being three rows up.
   */
  afterSave?(tx: Tx, ctx: PasteCtx, saved: PasteSavedRow[]): Promise<void>;
  /** Root-relative paths to revalidate after a save. */
  revalidate: string[];
}
