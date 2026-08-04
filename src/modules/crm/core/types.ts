import type {
  CrmAffiliation,
  CrmFieldDef,
  CrmPartyDetails,
  CrmRecordVisibility,
  Party,
  PartyKind,
} from "@/db/schema";

/**
 * The shapes the CRM module passes around. No database, no React — importable
 * from a client component without dragging a driver into the bundle.
 */

/** Authorization context, resolved by `gate()` and never by a caller. */
export interface CrmCtx {
  tenantId: string;
  userId: string;
  role: "owner" | "staff" | "expert";
}

/**
 * A row in the records list.
 *
 * `details` IS NULLABLE, and the null carries meaning rather than being a gap:
 * either this party has never been worked in CRM (Accounting created it as a
 * customer or vendor and nobody has opened it here), or it is `restricted` and
 * the caller is not an owner — RLS removed the details row and left the party.
 * The two are indistinguishable from here ON PURPOSE, which is the same
 * property that stops a template being used to probe for hidden records.
 */
export interface CrmRecordRow {
  party: Party;
  details: CrmPartyDetails | null;
  /** Which accounting roles this identity already holds. */
  isCustomer: boolean;
  isVendor: boolean;
}

/** One record's full page: identity, CRM's knowledge, and its connections. */
export interface CrmRecord extends CrmRecordRow {
  affiliations: CrmAffiliationRow[];
  /**
   * The tenant's LIVE custom field definitions, in display order.
   *
   * Loaded with the record rather than separately so the form renders in one
   * pass, and deliberately excluding archived ones — a retired field stops
   * appearing while its stored values stay in `details.custom` untouched.
   */
  fieldDefs: CrmFieldDef[];
}

/** An affiliation with the other end already resolved for display. */
export interface CrmAffiliationRow {
  affiliation: CrmAffiliation;
  /** The party at the OTHER end from whichever record is being viewed. */
  counterparty: Party;
  /** True when the viewed record is the person half. */
  viewedAsPerson: boolean;
}

export interface CrmRecordInput {
  kind: PartyKind;
  displayName?: string;
  givenName?: string | null;
  familyName?: string | null;
  legalName?: string | null;
  lifecycleStage?: string;
  source?: string;
  notes?: string;
  ownerClerkUserId?: string | null;
  visibility?: CrmRecordVisibility;
  /**
   * Custom field values, keyed by field definition id. UNTRUSTED — validated
   * against the live definitions server-side on every write, never taken as
   * given. See core/custom-fields.ts.
   */
  custom?: Record<string, unknown>;
}

/**
 * An edit. Distinct from `CrmRecordInput` because `kind` is REQUIRED to create
 * a record and optional to change one — a create that omitted it would have to
 * guess, which is exactly the assumption slice 0's backfill had to make and
 * this module exists to stop making.
 */
export type CrmRecordPatch = Partial<CrmRecordInput>;

/** What the list view can be narrowed by. Kept small; slice 8 adds saved views. */
export interface CrmRecordFilter {
  /** Free text over display name and legal name. */
  query?: string;
  kind?: PartyKind;
  /** Only records CRM has actually been asked about. */
  workedOnly?: boolean;
  includeInactive?: boolean;
}

/** The record form's editable shape, and its blank value. */
export interface RecordFormValues {
  kind: PartyKind;
  displayName: string;
  givenName: string;
  familyName: string;
  legalName: string;
  lifecycleStage: string;
  source: string;
  notes: string;
  visibility: CrmRecordVisibility;
}

/**
 * DEFINED HERE RATHER THAN IN THE FORM, and the reason is the same one
 * `centsToInput` carries: every export of a `"use client"` module becomes a
 * client reference when a server component imports it. Passing this one as a
 * prop happens to survive that, which makes it the more dangerous shape of the
 * two — it works until somebody reads a property off it on the server, and
 * then fails at render with a message production withholds.
 *
 * A constant a server component touches lives in a module with no directive.
 */
export const EMPTY_RECORD: RecordFormValues = {
  kind: "organization",
  displayName: "",
  givenName: "",
  familyName: "",
  legalName: "",
  lifecycleStage: "",
  source: "",
  notes: "",
  visibility: "members",
};

export const LIFECYCLE_STAGE_MAX = 60;
export const SOURCE_MAX = 60;
export const NOTES_MAX = 4000;
export const TITLE_MAX = 120;
