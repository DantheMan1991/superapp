import "server-only";
import { and, asc, desc, eq, ilike, inArray, isNotNull, or, sql } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import type { CrmAffiliation, CrmPartyDetails, Party } from "@/db/schema";
import {
  createParty,
  loadParty,
  updateParty,
  PartyError,
} from "@/lib/parties";
import { CrmError } from "./core/errors";
import type {
  CrmAffiliationRow,
  CrmCtx,
  CrmRecord,
  CrmRecordFilter,
  CrmRecordInput,
  CrmRecordPatch,
  CrmRecordRow,
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
export async function listRecords(
  tx: Tx,
  tenantId: string,
  filter: CrmRecordFilter = {},
): Promise<CrmRecordRow[]> {
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

  const rows = await tx
    .select({
      party: schema.parties,
      details: schema.crmPartyDetails,
      customerId: schema.customers.id,
      vendorId: schema.vendors.id,
    })
    .from(schema.parties)
    .leftJoin(
      schema.crmPartyDetails,
      and(
        eq(schema.crmPartyDetails.tenantId, schema.parties.tenantId),
        eq(schema.crmPartyDetails.partyId, schema.parties.id),
      ),
    )
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
    .where(and(...conditions))
    .orderBy(sql`lower(${schema.parties.displayName})`)
    .limit(500);

  return rows.map((r) => ({
    party: r.party,
    details: r.details,
    isCustomer: r.customerId !== null,
    isVendor: r.vendorId !== null,
  }));
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

  const [details, affiliations, customer, vendor] = await Promise.all([
    loadDetails(tx, tenantId, partyId),
    loadAffiliations(tx, tenantId, partyId),
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
    isCustomer: !!customer,
    isVendor: !!vendor,
  };
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
    })
    .returning();

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
