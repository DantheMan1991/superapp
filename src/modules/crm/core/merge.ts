import type { PartyContactKind } from "@/db/schema";
import type { CustomValue } from "./custom-fields";

/**
 * Merging two records into one: what moves, what is dropped, and why.
 *
 * PURE — no database, no `server-only`. The rules here decide the fate of live
 * AR foreign keys and of prose somebody wrote about another business, and they
 * are exactly the kind of rules that get quietly wrong and are never noticed,
 * because a merge that lost one connection still looks like a merge that
 * worked.
 *
 * THE PLAN IS THE PRODUCT, and this is the design decision the whole slice
 * rests on. `buildMergePlan` returns a complete description of the merge; the
 * preview RENDERS that plan and the executor APPLIES that same plan. There is
 * no second code path computing "what would happen" — so the screen that asks
 * somebody to commit an irreversible operation cannot be describing a different
 * operation from the one that runs. Any rule added below shows up in both
 * places or in neither.
 *
 * A MERGE IS NEVER AUTOMATIC. Everything here is proposal machinery; a person
 * chooses the survivor and commits. That is the same line the duplicate warning
 * and the AI slices sit on, and it is load-bearing here in a way it is not
 * elsewhere: fusing two real businesses inside a live tenant's books is not
 * something a confidence score should be trusted to do.
 */

/* -- Candidates ----------------------------------------------------------- */

/**
 * Why a pair is being proposed. Ordered strongest first, which is also the
 * order `scoreEvidence` weights them.
 */
export type MergeEvidenceKind = "shared_email" | "shared_phone" | "same_name";

export interface MergeEvidence {
  kind: MergeEvidenceKind;
  /** The value both records share, for showing WHY rather than asserting it. */
  value: string;
}

export interface MergeCandidate {
  /** Stable ordering — the lower uuid first, so one pair is never two rows. */
  aPartyId: string;
  bPartyId: string;
  evidence: MergeEvidence[];
  score: number;
}

/**
 * How much each signal is worth.
 *
 * AN ADDRESS IS EVIDENCE ABOUT A BUSINESS; A NAME IS EVIDENCE ABOUT A STRING.
 * Two records sharing `accounts@probe.example` are almost always one business.
 * Two records both called "Probe Construction" may be a duplicate or may be two
 * genuinely different companies with the same trading name — the 0062 backfill
 * refused to fuse on exactly that, and this weighting is the same judgement
 * expressed as a number rather than as a refusal. Name-only pairs are still
 * PROPOSED, because a human looking at two records can settle in a second what
 * a migration could not settle at all.
 */
const EVIDENCE_WEIGHT: Record<MergeEvidenceKind, number> = {
  shared_email: 100,
  // Below email because a shared phone is a switchboard as often as it is a
  // duplicate — a company's main number is on every one of its people.
  shared_phone: 60,
  same_name: 30,
};

export function scoreEvidence(evidence: readonly MergeEvidence[]): number {
  // Summed rather than maxed, so a pair matching on BOTH an address and a name
  // outranks one matching on an address alone. Distinct kinds only: two shared
  // addresses are one fact about the same relationship, and letting them stack
  // would put a pair with two shared aliases above a pair with a shared address
  // and a shared name.
  const kinds = new Set(evidence.map((e) => e.kind));
  return [...kinds].reduce((sum, kind) => sum + EVIDENCE_WEIGHT[kind], 0);
}

/** One row of raw evidence, as the SQL finds it. */
export interface EvidenceRow {
  aPartyId: string;
  bPartyId: string;
  kind: MergeEvidenceKind;
  value: string;
}

/**
 * Fold raw evidence rows into ranked, deduplicated candidate pairs.
 *
 * PAIRS ARE UNORDERED and the ids are sorted so they cannot arrive as two
 * different rows. A query that finds "A shares an address with B" also finds
 * "B shares an address with A" unless it is written carefully, and a duplicates
 * page listing the same pair twice is one nobody trusts. Sorting here means the
 * SQL does not have to be the thing that remembers.
 */
export function rankCandidates(
  rows: readonly EvidenceRow[],
  limit: number,
): MergeCandidate[] {
  const byPair = new Map<string, MergeCandidate>();

  for (const row of rows) {
    if (row.aPartyId === row.bPartyId) continue;
    const [aPartyId, bPartyId] =
      row.aPartyId < row.bPartyId
        ? [row.aPartyId, row.bPartyId]
        : [row.bPartyId, row.aPartyId];
    const key = `${aPartyId}:${bPartyId}`;

    const existing = byPair.get(key);
    const evidence = existing?.evidence ?? [];
    // The same kind twice with different values is worth showing — "they share
    // two addresses" is a stronger story for a human than "they share one" —
    // but the same kind and value twice is one fact seen from both ends.
    if (!evidence.some((e) => e.kind === row.kind && e.value === row.value)) {
      evidence.push({ kind: row.kind, value: row.value });
    }
    byPair.set(key, {
      aPartyId,
      bPartyId,
      evidence,
      score: scoreEvidence(evidence),
    });
  }

  return [...byPair.values()]
    .sort(
      (x, y) =>
        y.score - x.score ||
        // Stable once scores tie, so the list does not reshuffle between loads.
        x.aPartyId.localeCompare(y.aPartyId) ||
        x.bPartyId.localeCompare(y.bPartyId),
    )
    .slice(0, limit);
}

/**
 * The matchable form of a name, for the `same_name` signal ONLY.
 *
 * Case and whitespace are folded because "probe construction" and "Probe
 * Construction" are the same string typed twice. NOTHING ELSE IS FOLDED — no
 * stripping of "Ltd", "Inc" or "LLC, no punctuation removal. "Probe Ltd" and
 * "Probe Inc" are different legal entities that a suffix-stripping matcher
 * would confidently pair, and a duplicates page that proposes merging two real
 * companies is worse than one that misses a pair: the miss costs a search, the
 * false pair costs a business's books.
 */
export function matchableName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

/* -- The plan ------------------------------------------------------------- */

/** What a role row (customer or vendor) means for the merge. */
export type RoleDisposition =
  /** Only the loser holds it: re-point the role row at the survivor. */
  | { action: "repoint"; roleId: string }
  /**
   * BOTH hold it. The loser's transactions move onto the survivor's role row
   * and the empty role row is removed — the case the founder authorised, and
   * the only one that touches a posted record's foreign key.
   */
  | { action: "absorb"; survivingRoleId: string; losingRoleId: string }
  /** Neither holds it, or only the survivor does. Nothing to do. */
  | { action: "none" };

export interface ContactPointPlan {
  /** Points that move to the survivor, keeping their label. */
  move: string[];
  /** Points the survivor already has, by normalized value. Deleted with the loser. */
  dropDuplicate: string[];
  /**
   * Points that move but lose `is_primary`, because the survivor already has a
   * primary of that kind and the partial unique allows exactly one.
   */
  demote: string[];
}

export interface DetailsPlan {
  /** How the surviving `crm_party_details` row ends up. */
  patch: {
    lifecycleStage: string;
    source: string;
    notes: string;
    ownerClerkUserId: string | null;
    visibility: "members" | "restricted";
    custom: Record<string, CustomValue>;
  };
  /** True when the loser had a details row that must be deleted after merging. */
  deleteLoserDetails: boolean;
  /** True when the survivor had none and the loser's row is simply re-pointed. */
  repointLoserDetails: boolean;
}

export interface AffiliationPlan {
  move: string[];
  /**
   * Connections that would point a record at ITSELF once the two ids are one.
   * Merging a person into the company they work for is a real thing somebody
   * will do by accident, and `crm_affiliations` has a CHECK that the two ends
   * differ — so these must go rather than fail the transaction.
   */
  dropSelf: string[];
  /** The survivor already has this exact connection. */
  dropDuplicate: string[];
}

export interface MergePlan {
  survivorPartyId: string;
  loserPartyId: string;
  customer: RoleDisposition;
  vendor: RoleDisposition;
  contactPoints: ContactPointPlan;
  details: DetailsPlan;
  affiliations: AffiliationPlan;
  /** Counts for the preview: what simply follows the party with no decisions. */
  moves: {
    deals: number;
    dealStakeholders: number;
    activities: number;
    tasks: number;
    invoices: number;
    recurringInvoices: number;
    bills: number;
  };
}

export interface MergeInputs {
  survivorPartyId: string;
  loserPartyId: string;
  survivor: {
    customerId: string | null;
    vendorId: string | null;
    details: DetailsSnapshot | null;
    contactPoints: readonly ContactSnapshot[];
    affiliations: readonly AffiliationSnapshot[];
  };
  loser: {
    customerId: string | null;
    vendorId: string | null;
    details: DetailsSnapshot | null;
    contactPoints: readonly ContactSnapshot[];
    affiliations: readonly AffiliationSnapshot[];
    counts: MergePlan["moves"];
  };
}

export interface ContactSnapshot {
  id: string;
  kind: PartyContactKind;
  normalizedValue: string;
  isPrimary: boolean;
}

export interface AffiliationSnapshot {
  id: string;
  personPartyId: string;
  organizationPartyId: string;
}

export interface DetailsSnapshot {
  lifecycleStage: string;
  source: string;
  notes: string;
  ownerClerkUserId: string | null;
  visibility: "members" | "restricted";
  custom: Record<string, CustomValue>;
}

/**
 * Everything the merge will do, computed once.
 *
 * THE SURVIVOR WINS EVERY CONTESTED FIELD, and the loser only ever fills a
 * blank. Somebody chose which record survives while looking at both; silently
 * preferring the other one's lifecycle stage because it was set more recently
 * would make that choice mean less than it appears to. The exception is
 * `notes`, which are APPENDED rather than contested — two people's prose about
 * the same business are both true, and throwing one away is the single most
 * irreversible thing a merge could do.
 */
export function buildMergePlan(inputs: MergeInputs): MergePlan {
  const { survivor, loser } = inputs;

  return {
    survivorPartyId: inputs.survivorPartyId,
    loserPartyId: inputs.loserPartyId,
    customer: roleDisposition(survivor.customerId, loser.customerId),
    vendor: roleDisposition(survivor.vendorId, loser.vendorId),
    contactPoints: planContactPoints(survivor.contactPoints, loser.contactPoints),
    details: planDetails(survivor.details, loser.details),
    affiliations: planAffiliations(
      inputs.survivorPartyId,
      inputs.loserPartyId,
      survivor.affiliations,
      loser.affiliations,
    ),
    moves: loser.counts,
  };
}

function roleDisposition(
  survivorRoleId: string | null,
  loserRoleId: string | null,
): RoleDisposition {
  if (!loserRoleId) return { action: "none" };
  if (!survivorRoleId) return { action: "repoint", roleId: loserRoleId };
  return {
    action: "absorb",
    survivingRoleId: survivorRoleId,
    losingRoleId: loserRoleId,
  };
}

export function planContactPoints(
  survivor: readonly ContactSnapshot[],
  loser: readonly ContactSnapshot[],
): ContactPointPlan {
  const plan: ContactPointPlan = { move: [], dropDuplicate: [], demote: [] };
  const held = new Set(survivor.map((p) => `${p.kind}:${p.normalizedValue}`));
  const hasPrimary = new Set(
    survivor.filter((p) => p.isPrimary).map((p) => p.kind),
  );

  for (const point of loser) {
    if (held.has(`${point.kind}:${point.normalizedValue}`)) {
      // The unique on (tenant, party, kind, normalized) would refuse this, and
      // one address recorded once is the right answer rather than an error.
      plan.dropDuplicate.push(point.id);
      continue;
    }
    plan.move.push(point.id);
    if (point.isPrimary && hasPrimary.has(point.kind)) {
      plan.demote.push(point.id);
    } else if (point.isPrimary) {
      // The survivor had no primary of this kind, so the incoming one keeps the
      // flag and this kind is now spoken for.
      hasPrimary.add(point.kind);
    }
  }
  return plan;
}

export function planDetails(
  survivor: DetailsSnapshot | null,
  loser: DetailsSnapshot | null,
): DetailsPlan {
  if (!loser) {
    return {
      patch: survivor ? { ...survivor } : EMPTY_DETAILS,
      deleteLoserDetails: false,
      repointLoserDetails: false,
    };
  }
  if (!survivor) {
    // Nothing to reconcile: CRM has never been asked about the survivor, so the
    // loser's row moves across whole and keeps its version and its custom bag.
    return {
      patch: { ...loser },
      deleteLoserDetails: false,
      repointLoserDetails: true,
    };
  }

  return {
    patch: {
      lifecycleStage: survivor.lifecycleStage || loser.lifecycleStage,
      source: survivor.source || loser.source,
      notes: joinNotes(survivor.notes, loser.notes),
      ownerClerkUserId: survivor.ownerClerkUserId ?? loser.ownerClerkUserId,
      // THE MORE RESTRICTIVE VISIBILITY WINS, which is the one field the
      // survivor does not automatically take. Merging must never be a way to
      // widen who can see a record: if either half was restricted, somebody
      // decided that on purpose and the merged record inherits the decision.
      visibility:
        survivor.visibility === "restricted" || loser.visibility === "restricted"
          ? "restricted"
          : "members",
      custom: mergeCustomBags(survivor.custom, loser.custom),
    },
    deleteLoserDetails: true,
    repointLoserDetails: false,
  };
}

/**
 * Two custom-field bags combined: the survivor's answer stands, the loser fills
 * blanks.
 *
 * DELIBERATELY NOT `mergeCustomValues`, which is the FORM-SAVE path and does
 * something this must not: it walks the live field definitions and deletes any
 * key the payload omitted, which is how archiving a field keeps its stored
 * values (see custom-fields.ts). Fed two records it would delete every field
 * the loser answered and the survivor did not — the opposite of filling a
 * blank. Nothing here consults the definitions at all, because a merge must not
 * quietly drop values belonging to an archived field either.
 *
 * "Blank" means the survivor never answered, or answered with something with no
 * content — an empty string or an empty list. That matches the `||` the plain
 * text fields above use, so one record does not keep a blank where the other
 * has an answer.
 */
export function mergeCustomBags(
  survivor: Record<string, CustomValue>,
  loser: Record<string, CustomValue>,
): Record<string, CustomValue> {
  const merged: Record<string, CustomValue> = { ...loser };
  for (const [fieldId, value] of Object.entries(survivor)) {
    if (!isBlankCustom(value)) merged[fieldId] = value;
    else if (!(fieldId in merged)) merged[fieldId] = value;
  }
  return merged;
}

function isBlankCustom(value: CustomValue): boolean {
  if (typeof value === "string") return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  // `false` and `0` are ANSWERS, not blanks. A checkbox somebody deliberately
  // unticked must not be overwritten by the other record's tick.
  return false;
}

const EMPTY_DETAILS: DetailsPlan["patch"] = {
  lifecycleStage: "",
  source: "",
  notes: "",
  ownerClerkUserId: null,
  visibility: "members",
  custom: {},
};

/**
 * Both records' notes, kept.
 *
 * A separator rather than a silent concatenation, because the join has to be
 * visible: somebody reading the merged record needs to see that two people
 * wrote these at different times about what they then thought were two
 * businesses.
 */
export function joinNotes(survivor: string, loser: string): string {
  const a = survivor.trim();
  const b = loser.trim();
  if (!b) return a;
  if (!a) return b;
  if (a === b) return a;
  return `${a}\n\n--- merged from a duplicate record ---\n\n${b}`;
}

export function planAffiliations(
  survivorPartyId: string,
  loserPartyId: string,
  survivor: readonly AffiliationSnapshot[],
  loser: readonly AffiliationSnapshot[],
): AffiliationPlan {
  const plan: AffiliationPlan = { move: [], dropSelf: [], dropDuplicate: [] };
  const held = new Set(
    survivor.map((a) => `${a.personPartyId}:${a.organizationPartyId}`),
  );

  for (const affiliation of loser) {
    const person =
      affiliation.personPartyId === loserPartyId
        ? survivorPartyId
        : affiliation.personPartyId;
    const organization =
      affiliation.organizationPartyId === loserPartyId
        ? survivorPartyId
        : affiliation.organizationPartyId;

    if (person === organization) {
      plan.dropSelf.push(affiliation.id);
      continue;
    }
    if (held.has(`${person}:${organization}`)) {
      plan.dropDuplicate.push(affiliation.id);
      continue;
    }
    held.add(`${person}:${organization}`);
    plan.move.push(affiliation.id);
  }
  return plan;
}

/**
 * Does this merge touch a posted accounting record?
 *
 * The preview leads with this rather than burying it in a count. Re-pointing
 * `invoices.customer_id` is the one thing a merge does that reaches outside
 * CRM, and somebody committing it should be told in a sentence rather than
 * asked to infer it from a table of numbers.
 */
export function touchesLedger(plan: MergePlan): boolean {
  return (
    plan.moves.invoices > 0 ||
    plan.moves.recurringInvoices > 0 ||
    plan.moves.bills > 0
  );
}
