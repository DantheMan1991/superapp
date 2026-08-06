import "server-only";
import { and, asc, desc, eq, ilike, inArray, isNotNull, or, sql } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import type {
  CrmAffiliation,
  CrmFieldDef,
  CrmPartyDetails,
  Party,
} from "@/db/schema";
import type { CustomValue } from "./core/custom-fields";
import {
  createParty,
  loadParty,
  updateParty,
  PartyError,
} from "@/lib/parties";
import { CrmError } from "./core/errors";
import { runTrigger } from "./automation-ops";
import {
  mergeCustomValues,
  missingRequired,
  sanitizeCustomValues,
} from "./core/custom-fields";
import { listFieldDefs } from "./field-ops";
import { compileConditions, compileSort } from "./view-ops";
import { DEFAULT_SORT } from "./core/views";
import type {
  CrmAffiliationRow,
  CrmCtx,
  CrmRecord,
  CrmRecordFilter,
  CrmRecordPage,
  CrmRecordInput,
  CrmRecordPatch,
} from "./core/types";

/**
 * CRM's operations over the shared party spine.
 *
 * THE DIVISION OF LABOUR, which is the thing to understand before editing:
 * identity (`parties`) is written ONLY through `@/lib/parties` — this file
 * never inserts or updates that table itself, because Accounting writes it too
 * and two modules issuing their own UPDATEs is how last-write-wins bugs get in.
 * CRM's own knowledge (`crm_party_details`, `crm_affiliations`) is written
 * here, and belongs to this module alone.
 *
 * Every function takes the caller's `tx`. Visibility is enforced by RLS reached
 * through that transaction, so the caller MUST have opened it with
 * `{ role: ctx.role }` — nothing in this file filters on visibility, and it
 * would be wrong to add such a filter, because the surface that forgets it is
 * always the one nobody remembers exists.
 */

/** One `%term%` fragment, bound as a parameter — never interpolated. */
function contains(term: string): string {
  // Escape LIKE's own wildcards so searching for "50%" is not "match anything".
  return `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/** Translate the shared subsystem's failures into this module's vocabulary. */
function asCrmError(err: unknown): never {
  if (err instanceof PartyError) {
    switch (err.code) {
      case "PARTY_NOT_FOUND":
        throw new CrmError("RECORD_NOT_FOUND", err.message);
      case "PARTY_NAME_REQUIRED":
        throw new CrmError("NAME_REQUIRED", err.message);
      case "STALE_VERSION":
        throw new CrmError("STALE_VERSION", err.message);
    }
  }
  throw err;
}

/* -- Reading -------------------------------------------------------------- */

/**
 * The records list.
 *
 * A LEFT JOIN, deliberately. A tenant who has been invoicing through Accounting
 * for months already has parties; if CRM only listed the ones it had a details
 * row for, their first visit would show an empty product beside a full customer
 * ledger — which is the "two lists" failure this whole design exists to
 * prevent, wearing a different hat. So every identity appears, and the ones CRM
 * has never been asked about come back with `details: null`.
 *
 * A restricted record ALSO comes back with `details: null` for a staff member,
 * because RLS removed the joined row. The party itself stays visible, and that
 * is the honest boundary rather than an oversight: the identity is shared with
 * Accounting, where the same staff member can already see it as a customer.
 * `restricted` hides what CRM KNOWS — stage, owner, notes, connections — not
 * the fact that the business deals with somebody.
 */
export const PAGE_SIZE = 50;

export async function listRecords(
  tx: Tx,
  tenantId: string,
  filter: CrmRecordFilter = {},
): Promise<CrmRecordPage> {
  const conditions = [eq(schema.parties.tenantId, tenantId)];

  const term = filter.query?.trim();
  if (term) {
    const like = contains(term);
    conditions.push(
      or(
        ilike(schema.parties.displayName, like),
        ilike(schema.parties.legalName, like),
      )!,
    );
  }
  if (filter.kind) conditions.push(eq(schema.parties.kind, filter.kind));
  if (!filter.includeInactive) {
    conditions.push(eq(schema.parties.isActive, true));
  }
  if (filter.workedOnly) {
    conditions.push(isNotNull(schema.crmPartyDetails.id));
  }

  // A SAVED VIEW'S CONDITIONS, COMPILED. They arrive already validated against
  // the field registry, and every value below is bound as a parameter — see the
  // header of `view-ops.ts` for why those two properties are the whole of the
  // safety argument.
  //
  // A DETAILS-COLUMN FILTER EXCLUDES UNWORKED RECORDS, and that is inherent
  // rather than a bug to fix: this is a LEFT JOIN, so a party CRM has never
  // been asked about has no `lifecycle_stage` to compare, and neither does a
  // restricted record RLS removed for this caller. "Stage is lead" therefore
  // means "records CRM knows about, whose stage is lead". `not_equals` and
  // `not_contains` deliberately keep the nulls; see `compileConditions`.
  conditions.push(...compileConditions(filter.conditions ?? [], new Date()));

  const sort = filter.sort ?? DEFAULT_SORT;
  const pageSize = Math.min(Math.max(filter.pageSize ?? PAGE_SIZE, 1), 200);
  const page = Math.max(filter.page ?? 1, 1);

  const where = and(...conditions);

  // The details join is spelled out in both queries below rather than factored
  // into a helper: drizzle's join types change the builder's type parameter, so
  // a generic wrapper only typechecks behind a cast that is not sound.
  const detailsJoin = and(
    eq(schema.crmPartyDetails.tenantId, schema.parties.tenantId),
    eq(schema.crmPartyDetails.partyId, schema.parties.id),
  );

  const rows = await tx
    .select({
      party: schema.parties,
      details: schema.crmPartyDetails,
      customerId: schema.customers.id,
      vendorId: schema.vendors.id,
    })
    .from(schema.parties)
    .leftJoin(schema.crmPartyDetails, detailsJoin)
    .leftJoin(
      schema.customers,
      and(
        eq(schema.customers.tenantId, schema.parties.tenantId),
        eq(schema.customers.partyId, schema.parties.id),
      ),
    )
    .leftJoin(
      schema.vendors,
      and(
        eq(schema.vendors.tenantId, schema.parties.tenantId),
        eq(schema.vendors.partyId, schema.parties.id),
      ),
    )
    .where(where)
    .orderBy(...compileSort(sort))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  // THE COUNT MUST MATCH THE LIST, so it carries the same predicate and the
  // same details join — a filter on `lifecycle_stage` changes what matches, and
  // a count taken without that join would label the page with a number the page
  // contradicts. The customers/vendors joins are omitted because they only
  // supply display flags and, being unique per party, cannot change the row
  // count. **If a filter field is ever added over those tables, this query
  // needs their joins too.**
  const counted = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.parties)
    .leftJoin(schema.crmPartyDetails, detailsJoin)
    .where(where);

  return {
    rows: rows.map((r) => ({
      party: r.party,
      details: r.details,
      isCustomer: r.customerId !== null,
      isVendor: r.vendorId !== null,
    })),
    total: counted[0]?.n ?? 0,
    page,
    pageSize,
  };
}

async function loadDetails(
  tx: Tx,
  tenantId: string,
  partyId: string,
): Promise<CrmPartyDetails | null> {
  const row = await tx.query.crmPartyDetails.findFirst({
    where: and(
      eq(schema.crmPartyDetails.tenantId, tenantId),
      eq(schema.crmPartyDetails.partyId, partyId),
    ),
  });
  return row ?? null;
}

/**
 * Every current and former connection for one record, with the other end
 * resolved.
 *
 * Two queries rather than a join with a CASE: the counterparty is whichever
 * column is not the record being viewed, and expressing that in SQL costs more
 * to read than it saves for a handful of rows. Counterparties that RLS has
 * hidden are simply absent from the map, and their affiliation is dropped —
 * the same "dangling links render as nothing" behaviour the mail extension
 * resolver has.
 */
async function loadAffiliations(
  tx: Tx,
  tenantId: string,
  partyId: string,
): Promise<CrmAffiliationRow[]> {
  const rows: CrmAffiliation[] = await tx.query.crmAffiliations.findMany({
    where: and(
      eq(schema.crmAffiliations.tenantId, tenantId),
      or(
        eq(schema.crmAffiliations.personPartyId, partyId),
        eq(schema.crmAffiliations.organizationPartyId, partyId),
      ),
    ),
    orderBy: [
      // Current before former, then the primary one first.
      asc(schema.crmAffiliations.endedOn),
      desc(schema.crmAffiliations.isPrimary),
    ],
  });
  if (rows.length === 0) return [];

  const otherIds = rows.map((r) =>
    r.personPartyId === partyId ? r.organizationPartyId : r.personPartyId,
  );
  const others = await tx
    .select()
    .from(schema.parties)
    .where(
      and(
        eq(schema.parties.tenantId, tenantId),
        inArray(schema.parties.id, otherIds),
      ),
    );
  const byId = new Map<string, Party>(others.map((p) => [p.id, p]));

  return rows.flatMap((affiliation) => {
    const viewedAsPerson = affiliation.personPartyId === partyId;
    const otherId = viewedAsPerson
      ? affiliation.organizationPartyId
      : affiliation.personPartyId;
    const counterparty = byId.get(otherId);
    if (!counterparty) return [];
    return [{ affiliation, counterparty, viewedAsPerson }];
  });
}

export async function loadRecord(
  tx: Tx,
  tenantId: string,
  partyId: string,
): Promise<CrmRecord> {
  const party = await loadParty(tx, tenantId, partyId).catch(asCrmError);

  const [details, affiliations, fieldDefs, customer, vendor] = await Promise.all([
    loadDetails(tx, tenantId, partyId),
    loadAffiliations(tx, tenantId, partyId),
    listFieldDefs(tx, tenantId, "party"),
    tx.query.customers.findFirst({
      where: and(
        eq(schema.customers.tenantId, tenantId),
        eq(schema.customers.partyId, partyId),
      ),
    }),
    tx.query.vendors.findFirst({
      where: and(
        eq(schema.vendors.tenantId, tenantId),
        eq(schema.vendors.partyId, partyId),
      ),
    }),
  ]);

  return {
    party,
    details,
    affiliations,
    fieldDefs,
    isCustomer: !!customer,
    isVendor: !!vendor,
  };
}

/**
 * Validate an incoming custom payload against the tenant's LIVE definitions.
 *
 * Throws with the per-field issues attached rather than returning them, so a
 * caller cannot accidentally write a payload it forgot to check — the failure
 * path is the one that takes no effort.
 */
async function validateCustom(
  tx: Tx,
  tenantId: string,
  incoming: Record<string, unknown> | undefined,
  opts: { requireComplete: boolean },
): Promise<{ defs: CrmFieldDef[]; values: Record<string, CustomValue> }> {
  const defs = await listFieldDefs(tx, tenantId, "party");
  const { values, issues } = sanitizeCustomValues(defs, incoming ?? {}, {
    requireComplete: opts.requireComplete,
  });
  if (issues.length > 0) {
    throw new CrmError("CUSTOM_VALUES_INVALID", "custom field values rejected", issues);
  }
  return { defs, values };
}

/* -- Writing -------------------------------------------------------------- */

/**
 * Create the CRM row for a party that already exists — "start working this
 * customer". Idempotent: adopting twice returns the existing row rather than
 * tripping the unique index, because the button that does it is one a person
 * can double-click.
 */
export async function adoptRecord(
  tx: Tx,
  ctx: CrmCtx,
  partyId: string,
): Promise<CrmPartyDetails> {
  await loadParty(tx, ctx.tenantId, partyId).catch(asCrmError);
  const existing = await loadDetails(tx, ctx.tenantId, partyId);
  if (existing) return existing;

  const [row] = await tx
    .insert(schema.crmPartyDetails)
    .values({ tenantId: ctx.tenantId, partyId })
    .returning();
  return row;
}

export async function createRecord(
  tx: Tx,
  ctx: CrmCtx,
  input: CrmRecordInput,
): Promise<{ party: Party; details: CrmPartyDetails }> {
  const party = await createParty(tx, ctx.tenantId, {
    kind: input.kind,
    displayName: input.displayName,
    givenName: input.givenName,
    familyName: input.familyName,
    legalName: input.legalName,
  }).catch(asCrmError);

  // Not `requireComplete`: a record being created is the most half-known a
  // record ever is, and refusing it here is how lead capture and imports stop
  // being usable. The requirement bites when the stage moves.
  const { values } = await validateCustom(tx, ctx.tenantId, input.custom, {
    requireComplete: false,
  });

  const [details] = await tx
    .insert(schema.crmPartyDetails)
    .values({
      tenantId: ctx.tenantId,
      partyId: party.id,
      ownerClerkUserId: input.ownerClerkUserId ?? null,
      visibility: input.visibility ?? "members",
      lifecycleStage: input.lifecycleStage ?? "",
      source: input.source ?? "",
      notes: input.notes ?? "",
      custom: values,
    })
    .returning();

  // TRIGGER. Runs in this transaction with this caller's role, so a rule can
  // only touch what they could — see `automation-ops.ts`. It never throws: a
  // broken rule must not stop somebody adding a record.
  await runTrigger(
    tx,
    { tenantId: ctx.tenantId, userId: ctx.userId, partyId: party.id },
    "record_created",
  );

  return { party, details };
}

/**
 * Edit both halves of a record in one transaction.
 *
 * Two version numbers, because there are genuinely two rows with two owners:
 * `partyVersion` guards the identity Accounting also edits, `detailsVersion`
 * guards CRM's own knowledge. Collapsing them into one would mean a colleague
 * renaming a customer in Accounting silently invalidating an unrelated edit to
 * the lifecycle stage here.
 */
export async function updateRecord(
  tx: Tx,
  ctx: CrmCtx,
  args: {
    partyId: string;
    partyVersion: number;
    detailsVersion: number;
    patch: CrmRecordPatch;
  },
): Promise<void> {
  const { patch } = args;

  const identityTouched =
    patch.displayName !== undefined ||
    patch.givenName !== undefined ||
    patch.familyName !== undefined ||
    patch.legalName !== undefined ||
    patch.kind !== undefined;

  if (identityTouched) {
    await updateParty(tx, ctx.tenantId, {
      partyId: args.partyId,
      expectedVersion: args.partyVersion,
      patch: {
        kind: patch.kind,
        displayName: patch.displayName,
        givenName: patch.givenName,
        familyName: patch.familyName,
        legalName: patch.legalName,
      },
    }).catch(asCrmError);
  }

  // THE STAGE TRANSITION IS WHAT MAKES REQUIRED FIELDS BITE. An ordinary save
  // that leaves the stage alone never demands them; moving the record is the
  // point at which the business actually asserts something about it, so that is
  // where completeness is checked. Read the current row first — "the stage
  // changed" is a comparison, not a claim the caller gets to make.
  const existing = await loadDetails(tx, ctx.tenantId, args.partyId);
  if (!existing) {
    throw new CrmError("RECORD_NOT_FOUND", `crm record for ${args.partyId} missing`);
  }
  const movingStage =
    patch.lifecycleStage !== undefined &&
    patch.lifecycleStage !== existing.lifecycleStage;

  let nextCustom: Record<string, CustomValue> | undefined;
  if (patch.custom !== undefined) {
    const { defs, values } = await validateCustom(tx, ctx.tenantId, patch.custom, {
      requireComplete: movingStage,
    });
    nextCustom = mergeCustomValues(existing.custom, defs, values);
  } else if (movingStage) {
    // A stage move from a surface that does not render custom fields still has
    // to satisfy the required ones — but it asks the NARROW question. Full
    // re-validation would also re-check stored values against the current
    // definitions, so an owner removing a select option would start blocking
    // stage moves on every record that had picked it, with an error about a
    // field nobody touched. Those values were valid when written.
    const defs = await listFieldDefs(tx, ctx.tenantId, "party");
    const issues = missingRequired(defs, existing.custom);
    if (issues.length > 0) {
      throw new CrmError("CUSTOM_VALUES_INVALID", "required fields unanswered", issues);
    }
  }

  const rows = await tx
    .update(schema.crmPartyDetails)
    .set({
      ...(patch.ownerClerkUserId !== undefined
        ? { ownerClerkUserId: patch.ownerClerkUserId }
        : {}),
      ...(patch.visibility !== undefined ? { visibility: patch.visibility } : {}),
      ...(patch.lifecycleStage !== undefined
        ? { lifecycleStage: patch.lifecycleStage }
        : {}),
      ...(patch.source !== undefined ? { source: patch.source } : {}),
      ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
      ...(nextCustom !== undefined ? { custom: nextCustom } : {}),
      version: args.detailsVersion + 1,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.crmPartyDetails.tenantId, ctx.tenantId),
        eq(schema.crmPartyDetails.partyId, args.partyId),
        eq(schema.crmPartyDetails.version, args.detailsVersion),
      ),
    )
    .returning();

  // Zero rows means either a concurrent edit or — for a staff member who just
  // set `restricted` — that the WITH CHECK refused the write. Both are "your
  // edit did not land", and neither should report which.
  if (rows.length === 0) {
    throw new CrmError("STALE_VERSION", "record changed since loaded");
  }
}

/**
 * Archive rather than delete. Nothing in this module hard-deletes an identity:
 * an invoice, a filed email or a bill may point at it, and "we stopped dealing
 * with them" is not "this never happened".
 */
export async function setRecordActive(
  tx: Tx,
  ctx: CrmCtx,
  args: { partyId: string; partyVersion: number; isActive: boolean },
): Promise<void> {
  const rows = await tx
    .update(schema.parties)
    .set({
      isActive: args.isActive,
      version: args.partyVersion + 1,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.parties.tenantId, ctx.tenantId),
        eq(schema.parties.id, args.partyId),
        eq(schema.parties.version, args.partyVersion),
      ),
    )
    .returning();
  if (rows.length === 0) {
    throw new CrmError("STALE_VERSION", "record changed since loaded");
  }
}

/* -- Affiliations --------------------------------------------------------- */

export async function addAffiliation(
  tx: Tx,
  ctx: CrmCtx,
  args: {
    personPartyId: string;
    organizationPartyId: string;
    title?: string;
    isPrimary?: boolean;
    startedOn?: string | null;
  },
): Promise<CrmAffiliation> {
  if (args.personPartyId === args.organizationPartyId) {
    throw new CrmError("AFFILIATION_INVALID", "a party cannot be its own employer");
  }

  const [person, organization] = await Promise.all([
    loadParty(tx, ctx.tenantId, args.personPartyId).catch(asCrmError),
    loadParty(tx, ctx.tenantId, args.organizationPartyId).catch(asCrmError),
  ]);
  // The kinds are checked HERE rather than by a database CHECK, because the
  // constraint would have to reach into another table and because a sole trader
  // is a real edge — see the note on `parties.given_name`. What the database
  // does enforce is that the two ends differ.
  if (person.kind !== "person" || organization.kind !== "organization") {
    throw new CrmError(
      "AFFILIATION_INVALID",
      "affiliations connect a person to an organization",
    );
  }

  // Both ends must be records CRM has been asked about, or the RLS policy's
  // positive inheritance refuses the insert with a bare policy error. Adopting
  // first turns that into ordinary behaviour instead of an error message.
  await adoptRecord(tx, ctx, args.personPartyId);
  await adoptRecord(tx, ctx, args.organizationPartyId);

  try {
    const [row] = await tx
      .insert(schema.crmAffiliations)
      .values({
        tenantId: ctx.tenantId,
        personPartyId: args.personPartyId,
        organizationPartyId: args.organizationPartyId,
        title: args.title ?? "",
        isPrimary: args.isPrimary ?? false,
        startedOn: args.startedOn ?? null,
      })
      .returning();
    return row;
  } catch (err) {
    // The partial uniques are the enforcement; this only translates them.
    if (err instanceof Error && /unique|duplicate key/i.test(err.message)) {
      throw new CrmError(
        "AFFILIATION_DUPLICATE",
        "that connection already exists, or another is already primary",
      );
    }
    throw err;
  }
}

/**
 * End a connection rather than remove it. `ended_on` is what turns "works at"
 * into "used to work at", and the former employer is exactly the fact somebody
 * wants when a three-year-old thread turns up.
 */
export async function endAffiliation(
  tx: Tx,
  ctx: CrmCtx,
  args: { affiliationId: string; expectedVersion: number; endedOn: string },
): Promise<void> {
  const rows = await tx
    .update(schema.crmAffiliations)
    .set({
      endedOn: args.endedOn,
      // A former connection is nobody's primary contact. Left set, it would go
      // on holding the partial unique and block the successor.
      isPrimary: false,
      version: args.expectedVersion + 1,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.crmAffiliations.tenantId, ctx.tenantId),
        eq(schema.crmAffiliations.id, args.affiliationId),
        eq(schema.crmAffiliations.version, args.expectedVersion),
      ),
    )
    .returning();
  if (rows.length === 0) {
    throw new CrmError("AFFILIATION_NOT_FOUND", "connection changed since loaded");
  }
}
