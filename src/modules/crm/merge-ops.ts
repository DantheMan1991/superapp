import "server-only";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import type { AnyColumn } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import { relinkEntity } from "@/lib/work/entity-work";
import type { Party } from "@/db/schema";
import { loadParty } from "@/lib/parties";
import { CrmError } from "./core/errors";
import {
  buildMergePlan,
  matchableName,
  rankCandidates,
  type AffiliationSnapshot,
  type CollaboratorSnapshot,
  type ContactSnapshot,
  type DetailsSnapshot,
  type EvidenceRow,
  type MergeCandidate,
  type MergePlan,
} from "./core/merge";
import type { CustomValue } from "./core/custom-fields";

/**
 * Finding duplicates and merging them.
 *
 * EVERY FUNCTION TAKES THE CALLER'S `tx`, opened with `{ role: ctx.role }` like
 * the rest of this module — merging touches `crm_party_details`, which carries
 * a visibility term. A staff member cannot merge a record they cannot see, and
 * that falls out of the transaction rather than out of a predicate here.
 *
 * THE ONE PLACE IN CRM THAT WRITES ACCOUNTING'S TABLES. `absorbRole` re-points
 * `invoices.customer_id`, `recurring_invoices.customer_id` and
 * `bills.vendor_id` when both records hold the same role. That is not a
 * boundary violation by accident — it is the operation the founder authorised
 * on 2026-08-04, and the alternative was a merge tool that cannot fix the most
 * common duplicate there is. Two facts make it safe to state plainly:
 *
 *   - `journal_entries` carries NO customer or vendor reference, so the
 *     double-entry ledger and every posted balance are untouched. Only the
 *     AR/AP sub-ledger's attribution moves, and it consolidates onto the same
 *     business.
 *   - `document_links` reaches documents through `invoice_id` / `bill_id`, and
 *     those rows survive with their ids intact. Nothing filed against an
 *     invoice comes loose.
 *
 * THE LOSER PARTY IS HARD DELETED, LAST. Everything referencing it has been
 * re-pointed by then, so if this file ever misses a table the DELETE fails on a
 * foreign key and the whole transaction rolls back — loudly, with nothing lost.
 * That is deliberately preferred to a soft delete that would leave a ghost in
 * the records list and quietly hide a missed reference.
 */

/* -- Candidates ----------------------------------------------------------- */

const CANDIDATE_SCAN_LIMIT = 500;

/**
 * Pairs worth proposing, strongest evidence first.
 *
 * Two queries rather than one union: they answer different questions and the
 * ranking cares which. Both are scoped to the caller's tenant and run inside
 * the caller's transaction, so a duplicate involving a record somebody cannot
 * see is not offered to them — the same property `findPartiesByContact` has.
 */
export async function findMergeCandidates(
  tx: Tx,
  tenantId: string,
  limit = 50,
): Promise<MergeCandidate[]> {
  const rows: EvidenceRow[] = [];

  // Shared contact points. `a.party_id < b.party_id` is what stops each pair
  // arriving twice; `rankCandidates` sorts the ids anyway, and the belt and
  // braces cost nothing on an indexed column.
  const contacts = await tx
    .select({
      aPartyId: sql<string>`a.party_id`,
      bPartyId: sql<string>`b.party_id`,
      kind: sql<"email" | "phone" | "website">`a.kind`,
      value: sql<string>`a.value`,
    })
    .from(sql`party_contact_points a`)
    .innerJoin(
      sql`party_contact_points b`,
      sql`b.tenant_id = a.tenant_id
          and b.kind = a.kind
          and b.normalized_value = a.normalized_value
          and b.party_id > a.party_id`,
    )
    .where(sql`a.tenant_id = ${tenantId} and a.kind in ('email', 'phone')`)
    .limit(CANDIDATE_SCAN_LIMIT);

  for (const row of contacts) {
    rows.push({
      aPartyId: row.aPartyId,
      bPartyId: row.bPartyId,
      kind: row.kind === "phone" ? "shared_phone" : "shared_email",
      value: row.value,
    });
  }

  // Identical names. Folded in SQL the same way `matchableName` folds them in
  // TypeScript — the pair that matters is not indexed, and at the scale this
  // module caps its own list at (500 records) a sequential scan is the right
  // trade against an expression index nobody has asked for yet.
  const names = await tx
    .select({
      aPartyId: sql<string>`a.id`,
      bPartyId: sql<string>`b.id`,
      value: sql<string>`a.display_name`,
    })
    .from(sql`parties a`)
    .innerJoin(
      sql`parties b`,
      sql`b.tenant_id = a.tenant_id
          and b.id > a.id
          and lower(regexp_replace(btrim(b.display_name), '\\s+', ' ', 'g'))
            = lower(regexp_replace(btrim(a.display_name), '\\s+', ' ', 'g'))`,
    )
    .where(sql`a.tenant_id = ${tenantId} and btrim(a.display_name) <> ''`)
    .limit(CANDIDATE_SCAN_LIMIT);

  for (const row of names) {
    rows.push({
      aPartyId: row.aPartyId,
      bPartyId: row.bPartyId,
      kind: "same_name",
      // The name as typed, not as folded — the person reading the list should
      // see what is on the records.
      value: row.value,
    });
  }

  return rankCandidates(rows, limit);
}

/**
 * The SQL name fold and `matchableName` must agree, and this is what says so.
 *
 * Not called by the query — Postgres does the folding server-side — but a unit
 * test pins the two together, the same arrangement `contact-values.ts` has with
 * the 0074 backfill. If you change one, change the other.
 */
export const NAME_FOLD_SQL =
  "lower(regexp_replace(btrim(display_name), '\\s+', ' ', 'g'))";

export { matchableName };

/* -- Loading a plan ------------------------------------------------------- */

export interface MergePreview {
  survivor: Party;
  loser: Party;
  plan: MergePlan;
}

/**
 * Everything the merge would do, without doing any of it.
 *
 * The action calls this to render the confirmation screen and calls it AGAIN
 * inside the transaction that commits, rather than trusting a plan that
 * travelled through the browser. A plan is cheap to recompute and a plan the
 * client could edit is a way to merge two records somebody never chose.
 */
export async function previewMerge(
  tx: Tx,
  tenantId: string,
  survivorPartyId: string,
  loserPartyId: string,
): Promise<MergePreview> {
  if (survivorPartyId === loserPartyId) {
    throw new CrmError("MERGE_SAME_RECORD", "a record cannot merge with itself");
  }
  // `loadParty` throws PARTY_NOT_FOUND for a row RLS removed as readily as for
  // one that does not exist, which is the answer we want either way.
  const [survivor, loser] = await Promise.all([
    loadParty(tx, tenantId, survivorPartyId).catch(() => null),
    loadParty(tx, tenantId, loserPartyId).catch(() => null),
  ]);
  if (!survivor || !loser) {
    throw new CrmError("RECORD_NOT_FOUND", "one of those records is missing");
  }

  const [survivorSide, loserSide] = await Promise.all([
    loadSide(tx, tenantId, survivorPartyId),
    loadSide(tx, tenantId, loserPartyId),
  ]);
  const counts = await countMoves(
    tx,
    tenantId,
    loserPartyId,
    survivorSide,
    loserSide,
  );

  return {
    survivor,
    loser,
    plan: buildMergePlan({
      survivorPartyId,
      loserPartyId,
      survivor: survivorSide,
      loser: { ...loserSide, counts },
    }),
  };
}

interface Side {
  customerId: string | null;
  vendorId: string | null;
  details: DetailsSnapshot | null;
  contactPoints: ContactSnapshot[];
  affiliations: AffiliationSnapshot[];
  collaborators: CollaboratorSnapshot[];
}

/**
 * One record's side of the merge.
 *
 * THE COLLABORATOR READ DEPENDS ON THE CALLER BEING AN OWNER, and that is a
 * real coupling rather than an incidental one. `crm_record_collaborators` shows
 * non-owners only their OWN grant, so a merge run by anybody else would build a
 * plan that could not see the other grants — and because the party FK cascades,
 * the ones it could not see would be deleted rather than moved. Silent
 * revocation of access to a confidential record. `merge-actions.ts` gates all
 * three actions on `owner`, which is what makes this safe; if that gate is ever
 * loosened, this function has to stop trusting the caller's transaction for
 * this one read.
 */
async function loadSide(tx: Tx, tenantId: string, partyId: string): Promise<Side> {
  const [customer, vendor, details, contactPoints, affiliations, collaborators] =
    await Promise.all([
      tx.query.customers.findFirst({
        where: and(
          eq(schema.customers.tenantId, tenantId),
          eq(schema.customers.partyId, partyId),
        ),
        columns: { id: true },
      }),
      tx.query.vendors.findFirst({
        where: and(
          eq(schema.vendors.tenantId, tenantId),
          eq(schema.vendors.partyId, partyId),
        ),
        columns: { id: true },
      }),
      tx.query.crmPartyDetails.findFirst({
        where: and(
          eq(schema.crmPartyDetails.tenantId, tenantId),
          eq(schema.crmPartyDetails.partyId, partyId),
        ),
      }),
      tx
        .select({
          id: schema.partyContactPoints.id,
          kind: schema.partyContactPoints.kind,
          normalizedValue: schema.partyContactPoints.normalizedValue,
          isPrimary: schema.partyContactPoints.isPrimary,
        })
        .from(schema.partyContactPoints)
        .where(
          and(
            eq(schema.partyContactPoints.tenantId, tenantId),
            eq(schema.partyContactPoints.partyId, partyId),
          ),
        ),
      // BOTH ENDS. A person's connections name them as the person; a company's
      // name it as the organization, and merging two companies re-points that
      // end for every employee anybody recorded. Loading one end would leave
      // the collisions undetected and abort the merge on an index.
      tx
        .select({
          id: schema.crmAffiliations.id,
          personPartyId: schema.crmAffiliations.personPartyId,
          organizationPartyId: schema.crmAffiliations.organizationPartyId,
          endedOn: schema.crmAffiliations.endedOn,
          isPrimary: schema.crmAffiliations.isPrimary,
        })
        .from(schema.crmAffiliations)
        .where(
          and(
            eq(schema.crmAffiliations.tenantId, tenantId),
            or(
              eq(schema.crmAffiliations.personPartyId, partyId),
              eq(schema.crmAffiliations.organizationPartyId, partyId),
            ),
          ),
        ),
      tx
        .select({
          id: schema.crmRecordCollaborators.id,
          clerkUserId: schema.crmRecordCollaborators.clerkUserId,
        })
        .from(schema.crmRecordCollaborators)
        .where(
          and(
            eq(schema.crmRecordCollaborators.tenantId, tenantId),
            eq(schema.crmRecordCollaborators.partyId, partyId),
          ),
        ),
    ]);

  return {
    customerId: customer?.id ?? null,
    vendorId: vendor?.id ?? null,
    details: details
      ? {
          lifecycleStage: details.lifecycleStage,
          source: details.source,
          notes: details.notes,
          ownerClerkUserId: details.ownerClerkUserId,
          visibility: details.visibility,
          custom: (details.custom ?? {}) as Record<string, CustomValue>,
        }
      : null,
    contactPoints,
    affiliations,
    collaborators,
  };
}

async function countMoves(
  tx: Tx,
  tenantId: string,
  loserPartyId: string,
  survivor: Side,
  loser: Side,
): Promise<MergePlan["moves"]> {
  const [deals, stakeholders, activities, tasks] = await Promise.all([
    countRows(tx, sql`select count(*)::int as n from crm_deals
        where tenant_id = ${tenantId}
          and (party_id = ${loserPartyId} or primary_contact_party_id = ${loserPartyId})`),
    countRows(tx, sql`select count(*)::int as n from crm_deal_parties
        where tenant_id = ${tenantId} and party_id = ${loserPartyId}`),
    countRows(tx, sql`select count(*)::int as n from crm_activities
        where tenant_id = ${tenantId} and party_id = ${loserPartyId}`),
    // Follow-ups are work items linked to the record (work.md slice 5b), so
    // the preview counts what `relinkEntity` will actually move. Counting
    // `crm_tasks` here would report a frozen snapshot that stopped changing
    // the moment the storage did.
    countRows(tx, sql`select count(*)::int as n from work_item_links
        where tenant_id = ${tenantId}
          and entity_type in ('contact', 'company')
          and entity_id = ${loserPartyId}`),
  ]);

  // ONLY WHEN THE ROLE IS ABSORBED — meaning BOTH records hold it. A role only
  // the loser holds is re-pointed whole: its invoices keep pointing at the same
  // customer row, which simply belongs to the survivor afterwards, and not one
  // posted record is touched. Counting them anyway would put "42 invoices will
  // move" in front of somebody committing an operation that moves none.
  const absorbsCustomer = survivor.customerId !== null && loser.customerId !== null;
  const absorbsVendor = survivor.vendorId !== null && loser.vendorId !== null;

  const [invoices, recurringInvoices, bills] = await Promise.all([
    absorbsCustomer
      ? countRows(tx, sql`select count(*)::int as n from invoices
          where tenant_id = ${tenantId} and customer_id = ${loser.customerId}`)
      : Promise.resolve(0),
    absorbsCustomer
      ? countRows(tx, sql`select count(*)::int as n from recurring_invoices
          where tenant_id = ${tenantId} and customer_id = ${loser.customerId}`)
      : Promise.resolve(0),
    absorbsVendor
      ? countRows(tx, sql`select count(*)::int as n from bills
          where tenant_id = ${tenantId} and vendor_id = ${loser.vendorId}`)
      : Promise.resolve(0),
  ]);

  return {
    deals,
    dealStakeholders: stakeholders,
    activities,
    tasks,
    invoices,
    recurringInvoices,
    bills,
  };
}

async function countRows(tx: Tx, query: ReturnType<typeof sql>): Promise<number> {
  const result = await tx.execute(query);
  const rows = result.rows as { n: number }[];
  return rows[0]?.n ?? 0;
}

/* -- Applying it ---------------------------------------------------------- */

/**
 * Merge two records. Irreversible, and the whole thing is one transaction.
 *
 * THE PLAN IS RECOMPUTED HERE rather than accepted from the caller. The
 * confirmation screen showed a plan; this builds it again from the rows as they
 * are at commit time, so a record edited between reading and confirming is
 * merged as it IS rather than as it was — and a plan cannot arrive from a
 * browser naming two records nobody chose.
 *
 * STEP ORDER IS LOAD-BEARING, and each step exists to keep a constraint from
 * aborting the merge:
 *
 *   1. Contact points: delete duplicates, then demote, then re-point. Demoting
 *      while the rows still belong to the loser means the one-primary-per-kind
 *      partial unique never sees two.
 *   2. Affiliations: drop the self-references and duplicates BEFORE re-pointing,
 *      or the ends-differ CHECK fires on a row that was going to be deleted.
 *   3. Everything that simply follows the party.
 *   4. Roles, including the accounting foreign keys.
 *   5. The details row, last of the CRM tables, because its unique on
 *      (tenant, party) is the one a half-finished merge would trip.
 *   6. The loser party itself.
 */
export async function applyMerge(
  tx: Tx,
  tenantId: string,
  survivorPartyId: string,
  loserPartyId: string,
): Promise<MergePlan> {
  const { plan } = await previewMerge(tx, tenantId, survivorPartyId, loserPartyId);
  /** "This table's rows belonging to the loser" — every CRM table spells it the same. */
  const scoped = (table: { tenantId: AnyColumn; partyId: AnyColumn }) =>
    and(eq(table.tenantId, tenantId), eq(table.partyId, loserPartyId));

  /* 1. Contact points */
  if (plan.contactPoints.dropDuplicate.length > 0) {
    await tx
      .delete(schema.partyContactPoints)
      .where(
        and(
          eq(schema.partyContactPoints.tenantId, tenantId),
          inArray(schema.partyContactPoints.id, plan.contactPoints.dropDuplicate),
        ),
      );
  }
  if (plan.contactPoints.demote.length > 0) {
    await tx
      .update(schema.partyContactPoints)
      .set({ isPrimary: false, updatedAt: new Date() })
      .where(
        and(
          eq(schema.partyContactPoints.tenantId, tenantId),
          inArray(schema.partyContactPoints.id, plan.contactPoints.demote),
        ),
      );
  }
  if (plan.contactPoints.move.length > 0) {
    await tx
      .update(schema.partyContactPoints)
      .set({ partyId: survivorPartyId, updatedAt: new Date() })
      .where(
        and(
          eq(schema.partyContactPoints.tenantId, tenantId),
          inArray(schema.partyContactPoints.id, plan.contactPoints.move),
        ),
      );
  }

  /* 2. Affiliations */
  const droppedAffiliations = [
    ...plan.affiliations.dropSelf,
    ...plan.affiliations.dropDuplicate,
  ];
  if (droppedAffiliations.length > 0) {
    await tx
      .delete(schema.crmAffiliations)
      .where(
        and(
          eq(schema.crmAffiliations.tenantId, tenantId),
          inArray(schema.crmAffiliations.id, droppedAffiliations),
        ),
      );
  }
  if (plan.affiliations.demote.length > 0) {
    await tx
      .update(schema.crmAffiliations)
      .set({ isPrimary: false, updatedAt: new Date() })
      .where(
        and(
          eq(schema.crmAffiliations.tenantId, tenantId),
          inArray(schema.crmAffiliations.id, plan.affiliations.demote),
        ),
      );
  }
  if (plan.affiliations.move.length > 0) {
    // Two updates, one per end, because a row can only be re-pointed on the end
    // that names the loser — and after the CHECK-violating rows are gone, no
    // row names it at both.
    for (const column of [
      schema.crmAffiliations.personPartyId,
      schema.crmAffiliations.organizationPartyId,
    ]) {
      await tx
        .update(schema.crmAffiliations)
        .set(
          column === schema.crmAffiliations.personPartyId
            ? { personPartyId: survivorPartyId, updatedAt: new Date() }
            : { organizationPartyId: survivorPartyId, updatedAt: new Date() },
        )
        .where(
          and(
            eq(schema.crmAffiliations.tenantId, tenantId),
            inArray(schema.crmAffiliations.id, plan.affiliations.move),
            eq(column, loserPartyId),
          ),
        );
    }
  }

  /* 3. Everything that just follows the party */
  await tx
    .update(schema.crmDeals)
    .set({ partyId: survivorPartyId, updatedAt: new Date() })
    .where(scoped(schema.crmDeals));
  await tx
    .update(schema.crmDeals)
    .set({ primaryContactPartyId: survivorPartyId, updatedAt: new Date() })
    .where(
      and(
        eq(schema.crmDeals.tenantId, tenantId),
        eq(schema.crmDeals.primaryContactPartyId, loserPartyId),
      ),
    );

  // A stakeholder row for a deal the survivor already stakes would trip the
  // (tenant, deal, party) unique, so those go rather than move.
  await tx.execute(sql`
    delete from crm_deal_parties dp
     where dp.tenant_id = ${tenantId}
       and dp.party_id = ${loserPartyId}
       and exists (
         select 1 from crm_deal_parties other
          where other.tenant_id = dp.tenant_id
            and other.deal_id = dp.deal_id
            and other.party_id = ${survivorPartyId}
       )`);
  await tx
    .update(schema.crmDealParties)
    .set({ partyId: survivorPartyId })
    .where(scoped(schema.crmDealParties));

  await tx
    .update(schema.crmActivities)
    .set({ partyId: survivorPartyId, updatedAt: new Date() })
    .where(scoped(schema.crmActivities));
  // Follow-ups are work items now (work.md slice 5b), so they follow the
  // survivor by having their LINK repointed rather than a column rewritten.
  // `relinkEntity` drops the loser's link where the item already points at the
  // survivor, so a merge cannot violate the unique index.
  for (const entityType of ["contact", "company"] as const) {
    await relinkEntity(
      tx,
      { tenantId },
      { entityType, entityId: loserPartyId },
      { entityType, entityId: survivorPartyId },
    );
  }

  /* 4. Roles, and the accounting rows that hang off them */
  await applyRole(tx, tenantId, "customer", plan, survivorPartyId);
  await applyRole(tx, tenantId, "vendor", plan, survivorPartyId);

  /* 5. Access grants. BEFORE the party delete, because the FK cascades — a
     merge that skipped this would silently revoke everyone's access to a
     confidential record at the moment the two became one. */
  if (plan.collaborators.dropDuplicate.length > 0) {
    await tx
      .delete(schema.crmRecordCollaborators)
      .where(
        and(
          eq(schema.crmRecordCollaborators.tenantId, tenantId),
          inArray(
            schema.crmRecordCollaborators.id,
            plan.collaborators.dropDuplicate,
          ),
        ),
      );
  }
  if (plan.collaborators.move.length > 0) {
    await tx
      .update(schema.crmRecordCollaborators)
      .set({ partyId: survivorPartyId })
      .where(
        and(
          eq(schema.crmRecordCollaborators.tenantId, tenantId),
          inArray(schema.crmRecordCollaborators.id, plan.collaborators.move),
        ),
      );
  }

  /* 6. Mail links */
  await repointMailLinks(tx, tenantId, plan, survivorPartyId, loserPartyId);

  /* 7. CRM's own knowledge */
  if (plan.details.repointLoserDetails) {
    await tx
      .update(schema.crmPartyDetails)
      .set({ partyId: survivorPartyId, updatedAt: new Date() })
      .where(scoped(schema.crmPartyDetails));
  } else if (plan.details.deleteLoserDetails) {
    await tx
      .update(schema.crmPartyDetails)
      .set({
        lifecycleStage: plan.details.patch.lifecycleStage,
        source: plan.details.patch.source,
        notes: plan.details.patch.notes,
        ownerClerkUserId: plan.details.patch.ownerClerkUserId,
        visibility: plan.details.patch.visibility,
        custom: plan.details.patch.custom,
        version: sql`${schema.crmPartyDetails.version} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.crmPartyDetails.tenantId, tenantId),
          eq(schema.crmPartyDetails.partyId, survivorPartyId),
        ),
      );
    await tx.delete(schema.crmPartyDetails).where(scoped(schema.crmPartyDetails));
  }

  /* 8. The loser identity, last. A missed reference fails HERE, on a foreign
     key, and rolls the whole thing back rather than orphaning a row. */
  const removed = await tx
    .delete(schema.parties)
    .where(
      and(eq(schema.parties.tenantId, tenantId), eq(schema.parties.id, loserPartyId)),
    )
    .returning({ id: schema.parties.id });
  if (removed.length === 0) {
    // RLS removed it, or somebody else merged it first. Either way this
    // transaction has been writing against a record it may not own.
    throw new CrmError("RECORD_NOT_FOUND", "that record could not be merged");
  }

  return plan;
}

async function applyRole(
  tx: Tx,
  tenantId: string,
  role: "customer" | "vendor",
  plan: MergePlan,
  survivorPartyId: string,
): Promise<void> {
  const disposition = role === "customer" ? plan.customer : plan.vendor;
  if (disposition.action === "none") return;

  if (disposition.action === "repoint") {
    // The survivor does not hold this role, so the whole role row moves and
    // every invoice or bill on it keeps pointing exactly where it pointed.
    if (role === "customer") {
      await tx
        .update(schema.customers)
        .set({ partyId: survivorPartyId, updatedAt: new Date() })
        .where(
          and(
            eq(schema.customers.tenantId, tenantId),
            eq(schema.customers.id, disposition.roleId),
          ),
        );
    } else {
      await tx
        .update(schema.vendors)
        .set({ partyId: survivorPartyId, updatedAt: new Date() })
        .where(
          and(
            eq(schema.vendors.tenantId, tenantId),
            eq(schema.vendors.id, disposition.roleId),
          ),
        );
    }
    return;
  }

  // Absorb: both records hold the role, so the posted records move onto the
  // surviving role row and the emptied one goes. This is the step that reaches
  // outside CRM; see the file header for why it is safe and who authorised it.
  const { survivingRoleId, losingRoleId } = disposition;
  if (role === "customer") {
    await tx
      .update(schema.invoices)
      .set({ customerId: survivingRoleId, updatedAt: new Date() })
      .where(
        and(
          eq(schema.invoices.tenantId, tenantId),
          eq(schema.invoices.customerId, losingRoleId),
        ),
      );
    await tx
      .update(schema.recurringInvoices)
      .set({ customerId: survivingRoleId, updatedAt: new Date() })
      .where(
        and(
          eq(schema.recurringInvoices.tenantId, tenantId),
          eq(schema.recurringInvoices.customerId, losingRoleId),
        ),
      );
    await tx
      .delete(schema.customers)
      .where(
        and(
          eq(schema.customers.tenantId, tenantId),
          eq(schema.customers.id, losingRoleId),
        ),
      );
  } else {
    await tx
      .update(schema.bills)
      .set({ vendorId: survivingRoleId, updatedAt: new Date() })
      .where(
        and(
          eq(schema.bills.tenantId, tenantId),
          eq(schema.bills.vendorId, losingRoleId),
        ),
      );
    await tx
      .delete(schema.vendors)
      .where(
        and(eq(schema.vendors.tenantId, tenantId), eq(schema.vendors.id, losingRoleId)),
      );
  }
}

/**
 * Threads attached to the losing record, moved to the survivor.
 *
 * CRM WRITING MAIL'S TABLE, and the compromise is recorded rather than hidden.
 * `mail_links.entity_id` holds a party id for `contact`/`company` and a role
 * row id for `customer`/`vendor`, so a merge invalidates both kinds. Leaving
 * them would silently detach correspondence from the record it was filed
 * against — a real loss, and one nobody would notice until they went looking
 * for an email. `src/modules/email/links.ts` owns this table and CRM may not
 * import it, so the right long-term answer is an "entity merged" hook on the
 * extension seam (P5, the same pointer the timeline gap needs). Until that
 * exists, this writes the two columns directly and the dossier says so.
 *
 * The delete-then-update shape is the same one the stakeholder rows use: the
 * unique is (tenant, account, thread, type, id), so a thread linked to BOTH
 * records would collide on the way across.
 */
async function repointMailLinks(
  tx: Tx,
  tenantId: string,
  plan: MergePlan,
  survivorPartyId: string,
  loserPartyId: string,
): Promise<void> {
  const moves: { types: string[]; from: string; to: string }[] = [
    { types: ["contact", "company"], from: loserPartyId, to: survivorPartyId },
  ];
  if (plan.customer.action === "absorb") {
    moves.push({
      types: ["customer"],
      from: plan.customer.losingRoleId,
      to: plan.customer.survivingRoleId,
    });
  }
  if (plan.vendor.action === "absorb") {
    moves.push({
      types: ["vendor"],
      from: plan.vendor.losingRoleId,
      to: plan.vendor.survivingRoleId,
    });
  }

  for (const move of moves) {
    // Both sides in one read, and the collision worked out in TypeScript.
    // The raw-SQL version of this was `entity_type = any(${types})`, which
    // drizzle renders as a parameter LIST — `any(($2, $3))` — and Postgres
    // rejects with `op ANY/ALL (array) requires array on right side`. The
    // builder spells the same thing as `in (...)` and cannot get it wrong.
    const rows = await tx
      .select({
        id: schema.mailLinks.id,
        mailAccountId: schema.mailLinks.mailAccountId,
        threadId: schema.mailLinks.threadId,
        entityType: schema.mailLinks.entityType,
        entityId: schema.mailLinks.entityId,
      })
      .from(schema.mailLinks)
      .where(
        and(
          eq(schema.mailLinks.tenantId, tenantId),
          inArray(schema.mailLinks.entityType, move.types),
          inArray(schema.mailLinks.entityId, [move.from, move.to]),
        ),
      );

    const key = (r: (typeof rows)[number]) =>
      `${r.mailAccountId}:${r.threadId}:${r.entityType}`;
    const alreadyOnSurvivor = new Set(
      rows.filter((r) => r.entityId === move.to).map(key),
    );

    const collisions: string[] = [];
    const movable: string[] = [];
    for (const row of rows) {
      if (row.entityId !== move.from) continue;
      // A thread linked to BOTH records would trip the unique on
      // (tenant, account, thread, type, id) on the way across.
      if (alreadyOnSurvivor.has(key(row))) collisions.push(row.id);
      else movable.push(row.id);
    }

    if (collisions.length > 0) {
      await tx
        .delete(schema.mailLinks)
        .where(
          and(
            eq(schema.mailLinks.tenantId, tenantId),
            inArray(schema.mailLinks.id, collisions),
          ),
        );
    }
    if (movable.length > 0) {
      await tx
        .update(schema.mailLinks)
        .set({ entityId: move.to })
        .where(
          and(
            eq(schema.mailLinks.tenantId, tenantId),
            inArray(schema.mailLinks.id, movable),
          ),
        );
    }
  }
}
