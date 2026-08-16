import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { withTenant, withSystem, schema } from "../src/db";
import { createParty } from "../src/lib/parties";
import { addContactPoint } from "../src/lib/parties/contacts";
import { applyMerge, findMergeCandidates, previewMerge } from "../src/modules/crm/merge-ops";

/**
 * The merge EXECUTOR, against a database.
 *
 * `core/merge.ts` decides what a merge does and is tested without one. This
 * file exists for the half that cannot be: hand-written SQL with table aliases,
 * `= any(...)`, and delete-then-update pairs guarding four unique indexes.
 * Every one of those is a statement that either runs or does not, and a merge
 * that aborts halfway is the failure mode with real consequences — so the cases
 * below are chosen to make each guard fire at least once.
 *
 * The step that matters most is the ABSORB: two customer records for one
 * company, both with posted invoices. That is the operation the founder
 * authorised, it re-points a live AR foreign key, and it is the reason this
 * suite asserts the invoice count on both sides rather than just "it did not
 * throw".
 */

const RUN = !!process.env.DATABASE_URL;
const d = RUN ? describe : describe.skip;
const STAMP = `crmmerge-${process.pid}`;

d("crm merge executor (database)", () => {
  let tenantId: string;
  const ctx = { role: "owner" as const, userId: "owner" };

  let entityId: string;

  beforeAll(async () => {
    tenantId = await withSystem(async (tx) => {
      const [row] = await tx
        .insert(schema.tenants)
        .values([{ clerkOrgId: STAMP, name: "Merge Test", slug: STAMP }])
        .returning();
      return row.id;
    });
    // Invoices belong to a company now (ADR 0010), and this fixture writes them
    // raw rather than through the module.
    entityId = await withTenant(tenantId, async (tx) => {
      const [e] = await tx
        .insert(schema.entities)
        .values({ tenantId, name: "Merge Co", isDefault: true })
        .returning();
      return e.id;
    });
  });

  afterAll(async () => {
    await withSystem(async (tx) => {
      await tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantId));
    });
  });

  /** Two fresh records to merge, named so a failure says which test made them. */
  async function twoRecords(tag: string): Promise<{ a: string; b: string }> {
    return withTenant(
      tenantId,
      async (tx) => {
        const a = await createParty(tx, tenantId, {
          kind: "organization",
          displayName: `${tag} A`,
        });
        const b = await createParty(tx, tenantId, {
          kind: "organization",
          displayName: `${tag} B`,
        });
        return { a: a.id, b: b.id };
      },
      ctx,
    );
  }

  it("moves contact points, drops the duplicate and demotes the second primary", async () => {
    const { a, b } = await twoRecords("contacts");
    await withTenant(
      tenantId,
      async (tx) => {
        await addContactPoint(tx, tenantId, a, {
          kind: "email",
          value: "shared@merge.example",
        });
        await addContactPoint(tx, tenantId, b, {
          kind: "email",
          value: "Shared@Merge.EXAMPLE",
        });
        await addContactPoint(tx, tenantId, b, {
          kind: "email",
          value: "second@merge.example",
        });
      },
      ctx,
    );

    await withTenant(tenantId, (tx) => applyMerge(tx, tenantId, a, b), ctx);

    const points = await withTenant(
      tenantId,
      (tx) =>
        tx
          .select()
          .from(schema.partyContactPoints)
          .where(eq(schema.partyContactPoints.partyId, a)),
      ctx,
    );
    // The same address differing only in case is one address.
    expect(points).toHaveLength(2);
    // Exactly one primary survives — the partial unique would have aborted the
    // merge if the demotion had not happened first.
    expect(points.filter((p) => p.isPrimary)).toHaveLength(1);
    expect(points.find((p) => p.isPrimary)!.value).toBe("shared@merge.example");
  });

  it("RE-POINTS a role only the loser holds, touching no invoice", async () => {
    const { a, b } = await twoRecords("repoint");
    const customerId = await withTenant(
      tenantId,
      async (tx) => {
        const [row] = await tx
          .insert(schema.customers)
          .values({ tenantId, partyId: b, name: "Repoint Co" })
          .returning();
        return row.id;
      },
      ctx,
    );

    const preview = await withTenant(
      tenantId,
      (tx) => previewMerge(tx, tenantId, a, b),
      ctx,
    );
    expect(preview.plan.customer).toEqual({ action: "repoint", roleId: customerId });
    // Nothing posted moves in this shape, and the preview must not claim it does.
    expect(preview.plan.moves.invoices).toBe(0);

    await withTenant(tenantId, (tx) => applyMerge(tx, tenantId, a, b), ctx);

    const customer = await withTenant(
      tenantId,
      (tx) =>
        tx.query.customers.findFirst({
          where: eq(schema.customers.id, customerId),
        }),
      ctx,
    );
    expect(customer!.partyId).toBe(a);
  });

  it("ABSORBS a role both hold, moving posted invoices onto the survivor", async () => {
    // The case the founder authorised, and the only one that rewrites a foreign
    // key on a posted record.
    const { a, b } = await twoRecords("absorb");
    const { keepId, loseId } = await withTenant(
      tenantId,
      async (tx) => {
        const [keep] = await tx
          .insert(schema.customers)
          .values({ tenantId, partyId: a, name: "Absorb Co" })
          .returning();
        const [lose] = await tx
          .insert(schema.customers)
          .values({ tenantId, partyId: b, name: "Absorb Co (dup)" })
          .returning();
        await tx.insert(schema.invoices).values([
          {
            tenantId,
            entityId,
            customerId: lose.id,
            invoiceNumber: `${STAMP}-1`,
            status: "issued",
            issueDate: "2026-08-01",
            dueDate: "2026-08-31",
            totalCents: 12_500,
            createdByClerkUserId: "owner",
          },
          {
            tenantId,
            entityId,
            customerId: lose.id,
            invoiceNumber: `${STAMP}-2`,
            status: "issued",
            issueDate: "2026-08-02",
            dueDate: "2026-09-01",
            totalCents: 7_500,
            createdByClerkUserId: "owner",
          },
        ]);
        return { keepId: keep.id, loseId: lose.id };
      },
      ctx,
    );

    const preview = await withTenant(
      tenantId,
      (tx) => previewMerge(tx, tenantId, a, b),
      ctx,
    );
    expect(preview.plan.customer).toEqual({
      action: "absorb",
      survivingRoleId: keepId,
      losingRoleId: loseId,
    });
    // The preview leads with this number, so it had better be the real one.
    expect(preview.plan.moves.invoices).toBe(2);

    await withTenant(tenantId, (tx) => applyMerge(tx, tenantId, a, b), ctx);

    const [survivors, orphans, roleRows] = await withTenant(
      tenantId,
      async (tx) => [
        await tx
          .select()
          .from(schema.invoices)
          .where(eq(schema.invoices.customerId, keepId)),
        await tx
          .select()
          .from(schema.invoices)
          .where(eq(schema.invoices.customerId, loseId)),
        await tx
          .select()
          .from(schema.customers)
          .where(eq(schema.customers.partyId, a)),
      ],
      ctx,
    );
    expect(survivors).toHaveLength(2);
    expect(orphans).toHaveLength(0);
    // One AR relationship, as the unique on (tenant, party) requires.
    expect(roleRows).toHaveLength(1);
  });

  it("DROPS a connection that would point the merged record at itself", async () => {
    // Merging a person into the company they work for. The ends-differ CHECK
    // would abort the whole transaction if the plan did not remove this first.
    const person = await withTenant(
      tenantId,
      (tx) =>
        createParty(tx, tenantId, { kind: "person", displayName: "Aoife Merge" }),
      ctx,
    );
    const org = await withTenant(
      tenantId,
      (tx) =>
        createParty(tx, tenantId, {
          kind: "organization",
          displayName: "Merge Employer",
        }),
      ctx,
    );
    await withTenant(
      tenantId,
      async (tx) => {
        // BOTH ENDPOINTS NEED A DETAILS ROW FIRST. `crm_affiliations` inherits
        // visibility through a positive EXISTS against `crm_party_details` at
        // each end, so an insert naming a party CRM has never been asked about
        // is refused by RLS — which is the policy working, not a test quirk.
        await tx.insert(schema.crmPartyDetails).values([
          { tenantId, partyId: person.id },
          { tenantId, partyId: org.id },
        ]);
        await tx.insert(schema.crmAffiliations).values({
          tenantId,
          personPartyId: person.id,
          organizationPartyId: org.id,
          title: "Site manager",
        });
      },
      ctx,
    );

    await withTenant(
      tenantId,
      (tx) => applyMerge(tx, tenantId, org.id, person.id),
      ctx,
    );

    const left = await withTenant(
      tenantId,
      (tx) => tx.select().from(schema.crmAffiliations),
      ctx,
    );
    expect(left.filter((r) => r.organizationPartyId === org.id)).toHaveLength(0);
  });

  it("keeps both records' notes and takes the more restrictive visibility", async () => {
    const { a, b } = await twoRecords("details");
    await withTenant(
      tenantId,
      async (tx) => {
        await tx.insert(schema.crmPartyDetails).values([
          {
            tenantId,
            partyId: a,
            notes: "Pays on time.",
            visibility: "members",
            lifecycleStage: "customer",
          },
          {
            tenantId,
            partyId: b,
            notes: "Site contact is Aoife.",
            visibility: "restricted",
            source: "referral",
          },
        ]);
      },
      ctx,
    );

    await withTenant(tenantId, (tx) => applyMerge(tx, tenantId, a, b), ctx);

    const details = await withTenant(
      tenantId,
      (tx) =>
        tx.query.crmPartyDetails.findFirst({
          where: and(
            eq(schema.crmPartyDetails.tenantId, tenantId),
            eq(schema.crmPartyDetails.partyId, a),
          ),
        }),
      ctx,
    );
    expect(details!.notes).toContain("Pays on time.");
    expect(details!.notes).toContain("Site contact is Aoife.");
    // Merging must never widen who can see a record.
    expect(details!.visibility).toBe("restricted");
    // Survivor wins the contested field, loser fills the blank.
    expect(details!.lifecycleStage).toBe("customer");
    expect(details!.source).toBe("referral");

    const leftovers = await withTenant(
      tenantId,
      (tx) =>
        tx
          .select()
          .from(schema.crmPartyDetails)
          .where(eq(schema.crmPartyDetails.partyId, b)),
      ctx,
    );
    expect(leftovers).toHaveLength(0);
  });

  it("CARRIES ACCESS GRANTS ACROSS instead of letting the cascade eat them", async () => {
    // `crm_record_collaborators` has ON DELETE CASCADE on the party, so a merge
    // that did not handle the table would not fail — it would silently revoke
    // access for everyone named on the losing record. This is the assertion
    // that the grant is still there afterwards, and the one that would have
    // caught the bug.
    const { a, b } = await twoRecords("grants");
    await withTenant(
      tenantId,
      async (tx) => {
        await tx.insert(schema.crmPartyDetails).values([
          { tenantId, partyId: a, visibility: "restricted" },
          { tenantId, partyId: b, visibility: "restricted" },
        ]);
        await tx.insert(schema.crmRecordCollaborators).values([
          // On the survivor and the loser alike — the shared one must not be
          // duplicated on the way across.
          { tenantId, partyId: a, clerkUserId: "shared", grantedByClerkUserId: "owner" },
          { tenantId, partyId: b, clerkUserId: "shared", grantedByClerkUserId: "owner" },
          { tenantId, partyId: b, clerkUserId: "aoife", grantedByClerkUserId: "owner" },
        ]);
      },
      ctx,
    );

    await withTenant(tenantId, (tx) => applyMerge(tx, tenantId, a, b), ctx);

    const grants = await withTenant(
      tenantId,
      (tx) =>
        tx
          .select()
          .from(schema.crmRecordCollaborators)
          .where(eq(schema.crmRecordCollaborators.partyId, a)),
      ctx,
    );
    expect(grants.map((g) => g.clerkUserId).sort()).toEqual(["aoife", "shared"]);
  });

  it("removes the losing identity, so the duplicate leaves the records list", async () => {
    const { a, b } = await twoRecords("identity");
    await withTenant(tenantId, (tx) => applyMerge(tx, tenantId, a, b), ctx);

    const parties = await withTenant(
      tenantId,
      (tx) =>
        tx.query.parties.findFirst({
          where: and(eq(schema.parties.tenantId, tenantId), eq(schema.parties.id, b)),
        }),
      ctx,
    );
    expect(parties).toBeUndefined();
  });

  it("refuses to merge a record with itself", async () => {
    const { a } = await twoRecords("self");
    await expect(
      withTenant(tenantId, (tx) => applyMerge(tx, tenantId, a, a), ctx),
    ).rejects.toThrow();
  });

  it("proposes a pair sharing an address ahead of one sharing only a name", async () => {
    // Exercises both candidate queries, including the self-join aliases and the
    // SQL name fold — none of which any other test reaches.
    const { a, b } = await twoRecords("cand-addr");
    await withTenant(
      tenantId,
      async (tx) => {
        await addContactPoint(tx, tenantId, a, {
          kind: "email",
          value: "dup@candidates.example",
        });
        await addContactPoint(tx, tenantId, b, {
          kind: "email",
          value: "dup@candidates.example",
        });
        await createParty(tx, tenantId, {
          kind: "organization",
          displayName: "Twin Name Co",
        });
        await createParty(tx, tenantId, {
          kind: "organization",
          displayName: "  twin   name co ",
        });
      },
      ctx,
    );

    const candidates = await withTenant(
      tenantId,
      (tx) => findMergeCandidates(tx, tenantId, 50),
      ctx,
    );

    const shared = candidates.find(
      (c) =>
        (c.aPartyId === a && c.bPartyId === b) ||
        (c.aPartyId === b && c.bPartyId === a),
    );
    expect(shared).toBeDefined();
    expect(shared!.evidence.some((e) => e.kind === "shared_email")).toBe(true);

    // The name fold in SQL must agree with `matchableName` in TypeScript —
    // whitespace collapsed and case folded, nothing else.
    const byName = candidates.find((c) =>
      c.evidence.some((e) => e.kind === "same_name"),
    );
    expect(byName).toBeDefined();
    // An address outranks a name, every time.
    expect(shared!.score).toBeGreaterThan(byName!.score);
  });
});
