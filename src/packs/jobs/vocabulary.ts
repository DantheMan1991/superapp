/**
 * The words this pack uses. **NO IMPORTS AND NO DIRECTIVE** — client components
 * read this, and importing from `src/db/schema` would drag drizzle into the
 * bundle. Same arrangement as every other pack's.
 *
 * ── WHAT IS NOT HERE, AND WHY ───────────────────────────────────────────────
 *
 * **A LIST OF DELIVERY METHODS.** No `["production_residential", "commercial",
 * …]`, not even as a suggestion. A pack that knew what "commercial" meant would
 * know what industry it was in, which is the boundary ADR 0004 draws and the
 * one `production` states best about its own missing list of run kinds. The
 * industry profile supplies the suggestions through `packConfig`; a business
 * with a kind nobody listed types it, and the format check is the only thing
 * with an opinion.
 *
 * **A LIST OF COST CODES.** For the same reason twice over: CSI MasterFormat is
 * commercial vocabulary, NAHB's chart is residential, and the pilot invented its
 * own. A starter set is a profile's seed, and the rows are the tenant's from the
 * moment they exist.
 */

/**
 * The pack's slug, as `modules.id` and as the route segment.
 *
 * HERE RATHER THAN IN `actions.ts`, and the reason is a rule neither `tsc` nor
 * eslint enforces: **a `"use server"` file may export nothing but async
 * functions.** `export const PACK` in one is a build error that only shows when
 * the page is actually rendered — found by running it, 2026-09-14.
 */
export const PACK = "jobs";

/** Mirrors `job_projects_delivery_method_format`. Kept in sync by tests/jobs.test.ts. */
export const DELIVERY_METHOD_FORMAT = /^[a-z][a-z0-9_]{0,62}$/;

/** Mirrors `job_projects_status_valid`. */
export const PROJECT_STATUSES = [
  "planned",
  "active",
  "on_hold",
  "complete",
  "cancelled",
] as const;

export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export function isProjectStatus(value: string): value is ProjectStatus {
  return (PROJECT_STATUSES as readonly string[]).includes(value);
}

/** What a status is called on screen. */
export const STATUS_LABELS: Record<ProjectStatus, string> = {
  planned: "Planned",
  active: "Active",
  on_hold: "On hold",
  complete: "Complete",
  cancelled: "Cancelled",
};

/**
 * The dimension type a project syncs into `dimension_members`.
 *
 * **THE REASON THIS PACK IS WORTH ANYTHING ON DAY ONE.** Once a project is a
 * cost object, a bill line and a timecard can be tagged to it and every existing
 * accounting report groups by it — with no change to accounting, which must
 * never learn that this pack exists.
 */
export const PROJECT_DIMENSION = "project";

/**
 * The dimension type a COST CODE syncs into, from slice 2.
 *
 * **THIS IS WHAT MAKES A CODE MORE THAN A LIST.** Once a code is a cost object,
 * a bill line can be charged to it and every accounting report can group by it —
 * and accounting needs no change at all, because the bill builder derives the
 * types it offers from whatever members exist (`dimensionTypesFrom`). A project
 * says WHICH JOB; a cost code says WHICH TRADE; a line may carry one of each,
 * because `loadDimensionMembers` refuses only two members of the SAME type.
 */
export const COST_CODE_DIMENSION = "cost_code";

/** "laying_hens" → "Laying hens". Slugs are for machines. */
export function slugLabel(slug: string): string {
  const spaced = slug.replace(/_/g, " ").trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * Delivery-method suggestions from the installed profile's config.
 *
 * **TOTAL BY CONSTRUCTION**, like `speciesFrom` and `runKindsFrom`: the config
 * is jsonb with no shape constraint and most tenants have no profile, so
 * anything unreadable means an empty list and a free-text field — never a crash,
 * and never a default that asserts an industry.
 */
export function deliveryMethodsFrom(config: unknown): string[] {
  if (config && typeof config === "object" && !Array.isArray(config)) {
    const value = (config as Record<string, unknown>).deliveryMethods;
    if (Array.isArray(value)) {
      return value.filter(
        (v): v is string => typeof v === "string" && DELIVERY_METHOD_FORMAT.test(v),
      );
    }
  }
  return [];
}

// ------------------------------------------------------------------ contracts

/** Mirrors `job_contracts_role_valid`. Kept in sync by tests/jobs.test.ts. */
export const CONTRACT_ROLES = ["prime", "subcontract"] as const;
export type ContractRole = (typeof CONTRACT_ROLES)[number];

export const ROLE_LABELS: Record<ContractRole, string> = {
  prime: "We hold the contract",
  subcontract: "We are a subcontractor",
};

/** Mirrors `job_contracts_status_valid`. */
export const CONTRACT_STATUSES = [
  "proposed",
  "signed",
  "complete",
  "declined",
  "cancelled",
] as const;
export type ContractStatus = (typeof CONTRACT_STATUSES)[number];

export const CONTRACT_STATUS_LABELS: Record<ContractStatus, string> = {
  proposed: "Proposed",
  signed: "Signed",
  complete: "Complete",
  /** The client who looked at the number and walked. A real and common end. */
  declined: "Declined",
  cancelled: "Cancelled",
};

/**
 * Statuses whose value counts toward what a project is worth.
 *
 * **PROPOSED IS NOT IN IT, AND THAT IS THE WHOLE POINT.** A concept the client
 * has not signed is not money, and a project list that added it up would report
 * a business as bigger than it is — which is the number an owner would take to a
 * bank. `declined` and `cancelled` are out for the obvious reason.
 */
export const VALUED_CONTRACT_STATUSES: readonly ContractStatus[] = [
  "signed",
  "complete",
];

/**
 * Mirrors `job_contracts_billing_method_valid`.
 *
 * A CLOSED list, unlike `kind` and unlike a delivery method — each of these is a
 * different sum, so the pack has to implement one before it can offer it, and
 * adding a method is a code change and therefore a migration. **Slice 1 only
 * records which one applies; nothing bills yet.**
 */
export const BILLING_METHODS = [
  "fixed_price",
  "progress_draw",
  "schedule_of_values",
  "draw_schedule",
  "cost_plus_fee",
  "unit_price",
  "time_and_materials",
] as const;
export type BillingMethod = (typeof BILLING_METHODS)[number];

/**
 * What each method is called, in the words a person doing the billing uses.
 *
 * The pilot's three are `progress_draw` (fixed price billed monthly),
 * `schedule_of_values` (an AIA pay application) and `draw_schedule` (a home's
 * milestone draws). Cost-plus, unit price and T&M are in the list because the
 * market needs them, not because the pilot does.
 */
export const BILLING_METHOD_LABELS: Record<BillingMethod, string> = {
  fixed_price: "Fixed price, billed at the end",
  progress_draw: "Fixed price, billed monthly on progress",
  schedule_of_values: "Schedule of values (AIA pay application)",
  draw_schedule: "Draw schedule (milestones)",
  cost_plus_fee: "Cost plus a fee",
  unit_price: "Unit price",
  time_and_materials: "Time and materials",
};

export function isContractRole(v: string): v is ContractRole {
  return (CONTRACT_ROLES as readonly string[]).includes(v);
}
export function isContractStatus(v: string): v is ContractStatus {
  return (CONTRACT_STATUSES as readonly string[]).includes(v);
}
export function isBillingMethod(v: string): v is BillingMethod {
  return (BILLING_METHODS as readonly string[]).includes(v);
}

/**
 * Contract-kind suggestions from the installed profile's config.
 *
 * Same shape and same reason as `deliveryMethodsFrom`: the pilot's five kinds —
 * Concept Design, Construction Drawings, New Home, Misc Proposal, AIA — are that
 * business's own ladder, and a list here would make the pack know its industry.
 * Total by construction: anything unreadable means an empty list and a free-text
 * field, never a crash.
 */
export function contractKindsFrom(config: unknown): string[] {
  if (config && typeof config === "object" && !Array.isArray(config)) {
    const value = (config as Record<string, unknown>).contractKinds;
    if (Array.isArray(value)) {
      return value.filter(
        (v): v is string => typeof v === "string" && DELIVERY_METHOD_FORMAT.test(v),
      );
    }
  }
  return [];
}

// ---------------------------------------------------------------- commitments

/** Mirrors `job_commitments_kind_valid`. Kept in sync by tests/jobs.test.ts. */
export const COMMITMENT_KINDS = ["purchase_order", "subcontract"] as const;
export type CommitmentKind = (typeof COMMITMENT_KINDS)[number];

/**
 * A CHECK list of two, unlike a contract's `kind`. The two diverge in BEHAVIOUR
 * later — retainage, lien waivers and certified payroll attach to bought labour
 * and not to bought material — so the pack has to be able to tell them apart.
 * What each is CALLED is a label; what each IS, is this.
 */
export const COMMITMENT_KIND_LABELS: Record<CommitmentKind, string> = {
  purchase_order: "Purchase order",
  subcontract: "Subcontract",
};

/** Mirrors `job_commitments_status_valid`. */
export const COMMITMENT_STATUSES = [
  "draft",
  "issued",
  "closed",
  "cancelled",
] as const;
export type CommitmentStatus = (typeof COMMITMENT_STATUSES)[number];

export const COMMITMENT_STATUS_LABELS: Record<CommitmentStatus, string> = {
  draft: "Draft",
  issued: "Issued",
  closed: "Closed",
  cancelled: "Cancelled",
};

/**
 * The statuses whose money is actually COMMITTED.
 *
 * **A DRAFT IS NOT A COMMITMENT**, for the same reason a proposed contract is
 * not revenue: nobody has been told. `closed` still counts — the work was
 * ordered and done, and dropping it would make a finished job look cheaper than
 * it was. `cancelled` never happened.
 *
 * One constant, read by the SQL roll-up and by anything on a page that sums, so
 * the two cannot disagree about what a job has committed.
 */
export const COMMITTED_STATUSES: readonly CommitmentStatus[] = ["issued", "closed"];

export function isCommitmentKind(v: string): v is CommitmentKind {
  return (COMMITMENT_KINDS as readonly string[]).includes(v);
}
export function isCommitmentStatus(v: string): v is CommitmentStatus {
  return (COMMITMENT_STATUSES as readonly string[]).includes(v);
}

// -------------------------------------------------------------- change orders

/** Mirrors `job_change_orders_status_valid`. Kept in sync by tests/jobs.test.ts. */
export const CHANGE_ORDER_STATUSES = [
  "proposed",
  "approved",
  "declined",
  "void",
] as const;
export type ChangeOrderStatus = (typeof CHANGE_ORDER_STATUSES)[number];

/**
 * What each status is called. `proposed` is what a commercial job calls a PCO —
 * priced and put to the owner, not yet answered. The words are the pack's
 * because every flavour of the trade uses them; a profile that wanted "PCO" on
 * screen would relabel, not restructure.
 */
export const CHANGE_ORDER_STATUS_LABELS: Record<ChangeOrderStatus, string> = {
  proposed: "Proposed",
  approved: "Approved",
  declined: "Declined",
  void: "Void",
};

/**
 * The statuses whose money COUNTS — toward what a contract is now worth and
 * toward what a cost code is now budgeted at.
 *
 * **ONLY APPROVED**, and it is a one-element list on purpose: the rule lives in
 * one exported constant so the SQL roll-ups and anything on a page that sums
 * cannot disagree, which is the shape `VALUED_CONTRACT_STATUSES` and
 * `COMMITTED_STATUSES` already have. A proposed change is a price somebody has
 * been shown; nothing has moved until they say yes.
 */
export const APPROVED_CHANGE_STATUSES: readonly ChangeOrderStatus[] = ["approved"];

export function isChangeOrderStatus(v: string): v is ChangeOrderStatus {
  return (CHANGE_ORDER_STATUSES as readonly string[]).includes(v);
}

// ------------------------------------------------------------------- billing

/** Mirrors `job_pay_applications_status_valid`. Kept in sync by tests/jobs.test.ts. */
export const PAY_APPLICATION_STATUSES = ["draft", "issued", "void"] as const;
export type PayApplicationStatus = (typeof PAY_APPLICATION_STATUSES)[number];

/**
 * There is no `paid` here on purpose: whether the client has paid is the
 * INVOICE's business, and the page reads it from the invoice. A second copy
 * of a payment status would be the drift every derived status exists to
 * prevent.
 */
export const PAY_APPLICATION_STATUS_LABELS: Record<PayApplicationStatus, string> = {
  draft: "Draft",
  issued: "Issued",
  void: "Void",
};

export function isPayApplicationStatus(v: string): v is PayApplicationStatus {
  return (PAY_APPLICATION_STATUSES as readonly string[]).includes(v);
}

/** A rate in parts per million, so 100% is a million. Mirrors the CHECK. */
export const RETAINAGE_PPM_MAX = 1_000_000;

/**
 * The account codes billing posts to, by the convention the profiles seed:
 * contract revenue, else the general chart's Sales; and the retainage
 * receivable the construction profile adds. A tenant whose chart lacks the
 * second cannot withhold retainage until it adds it, and the refusal says so —
 * a pack must not create accounts in a business's chart on its own.
 */
export const REVENUE_ACCOUNT_CODES = ["4030", "4000"] as const;
export const RETAINAGE_RECEIVABLE_CODE = "1230";

// --------------------------------------------------------------------- field

/**
 * The entity types this pack hangs Layer 0 rows on — the ONE thing only the
 * owning pack may name. A photo attaches to a DAY (`document_attachments`);
 * a punch item links to the PROJECT (`work_item_links`). Both tables are
 * polymorphic and police nothing, so the pack's own actions are what prove
 * the row exists before anything is hung on it.
 */
export const DAILY_LOG_ENTITY = "job_daily_log";
export const PROJECT_ENTITY = "project";
/** A lien waiver's signed copy hangs on the waiver (Documents' attachments, ADR 0066). */
export const LIEN_WAIVER_ENTITY = "job_lien_waiver";
/** Work raised about an order — a waiver to chase — is linked to the order, not to the job's punch list. */
export const COMMITMENT_ENTITY = "job_commitment";
/** A selection's samples and spec sheets hang on the selection; a reminder to the client is Work linked to it (ADR 0067). */
export const SELECTION_ENTITY = "job_selection";
/** A subcontractor's certificate or W-9 hangs on the document row; the chase for one is Work linked to the PARTY (ADR 0068). */
export const PARTY_DOCUMENT_ENTITY = "job_party_document";
export const PARTY_ENTITY = "party";

// ------------------------------------------------------------ party documents

/**
 * The kinds of document a business asks a subcontractor for — an OPEN
 * taxonomy with a format check, as a contract's kind is, because what is
 * required differs by state, by insurer and by lawyer. The pack suggests the
 * common three and labels them; anything else is spelled by `slugLabel`.
 */
export const PARTY_DOCUMENT_FORMAT = /^[a-z][a-z0-9_]{0,62}$/;
export const SUGGESTED_PARTY_DOCUMENT_KINDS = ["insurance_certificate", "w9", "license"] as const;
export const PARTY_DOCUMENT_KIND_LABELS: Record<string, string> = {
  insurance_certificate: "Certificate of insurance",
  w9: "W-9",
  license: "Licence",
};
export function partyDocumentKindLabel(kind: string): string {
  return PARTY_DOCUMENT_KIND_LABELS[kind] ?? slugLabel(kind);
}
export function isPartyDocumentKind(v: string): boolean {
  return PARTY_DOCUMENT_FORMAT.test(v);
}

/** Mirrors `job_party_documents_status_valid`. */
export const PARTY_DOCUMENT_STATUSES = ["requested", "received", "void"] as const;
export type PartyDocumentStatus = (typeof PARTY_DOCUMENT_STATUSES)[number];
export const PARTY_DOCUMENT_STATUS_LABELS: Record<PartyDocumentStatus, string> = {
  requested: "Requested",
  received: "On file",
  void: "Void",
};
export function isPartyDocumentStatus(v: string): v is PartyDocumentStatus {
  return (PARTY_DOCUMENT_STATUSES as readonly string[]).includes(v);
}

/**
 * Which kinds a party must have on file, current, to be in good standing:
 * the pack's default, or the tenant's own list from the pack config
 * (`requiredPartyDocuments`) — a value, never a branch. The same shape as
 * `deliveryMethodsFrom`.
 */
export const DEFAULT_REQUIRED_PARTY_DOCUMENTS: readonly string[] = ["insurance_certificate", "w9"];
export function requiredPartyDocumentsFrom(config: unknown): string[] {
  if (config && typeof config === "object" && !Array.isArray(config)) {
    const value = (config as Record<string, unknown>).requiredPartyDocuments;
    if (Array.isArray(value)) {
      const kinds = value.filter((v): v is string => typeof v === "string" && PARTY_DOCUMENT_FORMAT.test(v));
      if (kinds.length > 0) return kinds;
    }
  }
  return [...DEFAULT_REQUIRED_PARTY_DOCUMENTS];
}

/** A certificate this close to its date is worth a sentence before it is a gap. */
export const EXPIRING_SOON_DAYS = 30;

// ------------------------------------------------------------------ estimates

/**
 * Mirrors `job_estimates_status_valid`. Kept in sync by tests/jobs.test.ts.
 *
 * `draft` is being written; `sent` is in the client's hands; `accepted` is
 * the one that became a contract; `declined` is the client saying no;
 * `superseded` is a revision that replaced it.
 */
export const ESTIMATE_STATUSES = ["draft", "sent", "accepted", "declined", "superseded"] as const;
export type EstimateStatus = (typeof ESTIMATE_STATUSES)[number];

export const ESTIMATE_STATUS_LABELS: Record<EstimateStatus, string> = {
  draft: "Draft",
  sent: "Sent",
  accepted: "Accepted",
  declined: "Declined",
  superseded: "Superseded",
};

export function isEstimateStatus(v: string): v is EstimateStatus {
  return (ESTIMATE_STATUSES as readonly string[]).includes(v);
}

/** The most a markup, an overhead or a profit rate may be: 1,000% in ppm, which is a typo guard, not a policy. */
export const RATE_PPM_MAX = 10_000_000;

// ------------------------------------------------------------------ selections

/**
 * Mirrors `job_selections_status_valid`. Kept in sync by tests/jobs.test.ts.
 *
 * `pending` is a decision the client owes; `selected` is the client having
 * chosen; `approved` is the builder confirming the choice and its price, the
 * point from which the difference can be raised as a change order;
 * `cancelled` is a selection that is no longer part of the job.
 */
export const SELECTION_STATUSES = ["pending", "selected", "approved", "cancelled"] as const;
export type SelectionStatus = (typeof SELECTION_STATUSES)[number];

export const SELECTION_STATUS_LABELS: Record<SelectionStatus, string> = {
  pending: "Pending",
  selected: "Selected",
  approved: "Approved",
  cancelled: "Cancelled",
};

/** The statuses whose chosen price COUNTS against the allowance: the client has chosen, or the builder has confirmed. */
export const CHOSEN_SELECTION_STATUSES: readonly SelectionStatus[] = ["selected", "approved"];

export function isSelectionStatus(v: string): v is SelectionStatus {
  return (SELECTION_STATUSES as readonly string[]).includes(v);
}

// ---------------------------------------------------------------- lien waivers

/**
 * Mirrors `job_lien_waivers_kind_valid`. Kept in sync by tests/jobs.test.ts.
 *
 * Conditional or unconditional, progress or final — the vocabulary every
 * American form uses, whatever the state's words on the page. A conditional
 * waiver is given with the application and takes effect when the payment
 * clears; an unconditional one is given once the money arrived, and is the
 * one the owner's bank wants to see before the next draw.
 */
export const LIEN_WAIVER_KINDS = [
  "conditional_progress",
  "unconditional_progress",
  "conditional_final",
  "unconditional_final",
] as const;
export type LienWaiverKind = (typeof LIEN_WAIVER_KINDS)[number];

export const LIEN_WAIVER_KIND_LABELS: Record<LienWaiverKind, string> = {
  conditional_progress: "Conditional, progress",
  unconditional_progress: "Unconditional, progress",
  conditional_final: "Conditional, final",
  unconditional_final: "Unconditional, final",
};

/** Mirrors `job_lien_waivers_status_valid`. */
export const LIEN_WAIVER_STATUSES = ["requested", "received", "void"] as const;
export type LienWaiverStatus = (typeof LIEN_WAIVER_STATUSES)[number];

export const LIEN_WAIVER_STATUS_LABELS: Record<LienWaiverStatus, string> = {
  requested: "Requested",
  received: "Received",
  void: "Void",
};

export function isLienWaiverKind(v: string): v is LienWaiverKind {
  return (LIEN_WAIVER_KINDS as readonly string[]).includes(v);
}
export function isLienWaiverStatus(v: string): v is LienWaiverStatus {
  return (LIEN_WAIVER_STATUSES as readonly string[]).includes(v);
}
/** The waiver that stands on its own once given: the one a bank asks for. */
export function isUnconditionalWaiver(kind: string): boolean {
  return kind === "unconditional_progress" || kind === "unconditional_final";
}
/** A final waiver covers the whole job, whatever its through date says. */
export function isFinalWaiver(kind: string): boolean {
  return kind === "conditional_final" || kind === "unconditional_final";
}

/** "6.5" → 65 tenths of an hour; null for anything that is not a non-negative number of hours. */
export function hoursToTenths(input: string): number | null {
  const s = input.trim();
  if (s === "") return 0;
  if (!/^\d{1,4}(\.\d{1,2})?$/.test(s)) return null;
  return Math.round(Number(s) * 10);
}

/** 65 → "6.5"; 80 → "8". */
export function tenthsToHours(tenths: number): string {
  const h = tenths / 10;
  return Number.isInteger(h) ? String(h) : h.toFixed(1);
}

// ------------------------------------------------------------------------ wip

/** Mirrors `job_wip_periods_status_valid`. Kept in sync by tests/jobs.test.ts. */
export const WIP_STATUSES = ["draft", "posted"] as const;
export type WipStatus = (typeof WIP_STATUSES)[number];

export const WIP_STATUS_LABELS: Record<WipStatus, string> = {
  draft: "Draft",
  posted: "Posted",
};

export function isWipStatus(v: string): v is WipStatus {
  return (WIP_STATUSES as readonly string[]).includes(v);
}

/** Mirrors `job_wip_lines_reason_valid`: why a job was left out of the entry. */
export const WIP_REASONS = ["", "no_value", "no_estimate", "no_rate"] as const;
export type WipReason = (typeof WIP_REASONS)[number];

export const WIP_REASON_LABELS: Record<WipReason, string> = {
  "": "",
  no_value: "No fixed contract value to earn against",
  no_estimate: "No budget and no estimate to measure cost against",
  no_rate: "Hours on the job with no bill rate — set one in Time, or one rate on the contract",
};

/**
 * The two balance-sheet accounts the adjustment posts to, by the codes the
 * construction profile seeds: under-billing to an ASSET (work done and not
 * yet billed), over-billing to a LIABILITY (billed ahead of the work). A
 * tenant whose chart lacks the one a period needs is refused by name, the
 * same rule as `1230` — a pack must not create accounts in a business's chart.
 * Revenue is `REVENUE_ACCOUNT_CODES`, the account billing itself posts to.
 */
export const UNDERBILLING_ACCOUNT_CODE = "1240";
export const OVERBILLING_ACCOUNT_CODE = "2420";

/**
 * The journal source both entries of a period carry — the adjustment and its
 * reversal. A value of `journal_entry_source` (drizzle/0339), and in
 * Accounting's `MANAGED_SOURCES`, so the journal refuses to void either and
 * only the pack's own unpost does.
 */
export const WIP_ENTRY_SOURCE = "wip_adjustment" as const;


// ------------------------------------------------------------ cost plus a fee

/**
 * WHICH BILLING METHODS ARE WHICH SUM (slices 5b and 5d). Four bill a share
 * of a FIXED value against a schedule of values; one bills the ledger's COST
 * plus a fee; one bills approved HOURS at a rate plus the books' other cost
 * marked up (ADR 0062); one is recorded and billed by nothing yet. The
 * contract page and the application verbs branch on these groups, never on a
 * contract's kind.
 */
export const FIXED_VALUE_METHODS: readonly BillingMethod[] = [
  "fixed_price",
  "progress_draw",
  "schedule_of_values",
  "draw_schedule",
  // Bills against a schedule too — of items with a unit, an estimated
  // quantity and a price, the quantities installed being what an
  // application says (slice 5f, ADR 0064). The contract's value is the
  // estimate the schedule adds up to.
  "unit_price",
];
export const UNIT_PRICE_METHODS: readonly BillingMethod[] = ["unit_price"];
export const COST_PLUS_METHODS: readonly BillingMethod[] = ["cost_plus_fee"];
/** Cost plus with a rate card in place of labour cost (slice 5d, ADR 0062). */
export const TIME_AND_MATERIALS_METHODS: readonly BillingMethod[] = ["time_and_materials"];
/** Every method bills since slice 5f; kept so the grouping test can say so. */
export const UNBILLED_METHODS: readonly BillingMethod[] = [];

export function isCostPlusMethod(v: string): boolean {
  return (COST_PLUS_METHODS as readonly string[]).includes(v);
}
export function isUnitPriceMethod(v: string): boolean {
  return (UNIT_PRICE_METHODS as readonly string[]).includes(v);
}
export function isTimeAndMaterialsMethod(v: string): boolean {
  return (TIME_AND_MATERIALS_METHODS as readonly string[]).includes(v);
}
/**
 * Cost plus a fee and time and materials both bill the JOB'S BOOKS, so one
 * such contract may bill a job (`ONE_COST_PLUS`) and both share the cost
 * lines, the sync and the certificate; only the labour differs.
 */
export function billsTheLedger(v: string): boolean {
  return isCostPlusMethod(v) || isTimeAndMaterialsMethod(v);
}
export function isFixedValueMethod(v: string): boolean {
  return (FIXED_VALUE_METHODS as readonly string[]).includes(v);
}

/** A fee rate between nothing and everything, in parts per million. Mirrors `job_contracts_fee_ppm_range`. */
export const FEE_PPM_MAX = 1_000_000;

/** Mirrors `job_wip_lines_method_valid`: how a WIP line's earned figure was measured. */
export const WIP_METHODS = ["cost_to_cost", "cost_plus", "time_and_materials"] as const;
export type WipMethod = (typeof WIP_METHODS)[number];

export const WIP_METHOD_LABELS: Record<WipMethod, string> = {
  cost_to_cost: "Cost-to-cost",
  cost_plus: "Cost plus fee",
  time_and_materials: "Time and materials",
};


// ------------------------------------------------- subcontractor applications

/** Mirrors `job_sub_applications_status_valid`. Kept in sync by tests/jobs.test.ts. */
export const SUB_APPLICATION_STATUSES = ["draft", "billed", "void"] as const;
export type SubApplicationStatus = (typeof SUB_APPLICATION_STATUSES)[number];

/**
 * `billed` where a pay application says `issued`: the business RECEIVED this
 * one and made it a bill. Whether the subcontractor has been paid is the
 * bill's word, read from it.
 */
export const SUB_APPLICATION_STATUS_LABELS: Record<SubApplicationStatus, string> = {
  draft: "Draft",
  billed: "Billed",
  void: "Void",
};

export function isSubApplicationStatus(v: string): v is SubApplicationStatus {
  return (SUB_APPLICATION_STATUSES as readonly string[]).includes(v);
}

/**
 * The accounts a subcontractor's application posts to, by the convention the
 * charts seed: the general chart's `5100 Subcontractor Expense` for the work
 * (the account the agency profile leans on too, which is why it is general),
 * and the construction profile's `2120 Retainage Payable` for what is held
 * back. A tenant whose chart lacks the second cannot hold retainage until it
 * adds the account, and the refusal says so — the receivable side's rule.
 */
export const SUBCONTRACT_EXPENSE_CODES = ["5100"] as const;
export const RETAINAGE_PAYABLE_CODE = "2120";
