import "dotenv/config";
import { afterAll, beforeAll, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { withTenant, withSystem, schema } from "../../src/db";
import { crmMailExtension } from "../../src/modules/crm/mail/extension";
import { d } from "./_shared";

/**
 * CRM (slice 1) — tenant isolation PLUS the first record-level visibility
 * outside Documents.
 *
 * The two-tenant cases are the standard certification. The ones that earn their
 * keep are the visibility pair at the bottom: `crm_party_details` carries the
 * flag, and `crm_affiliations` INHERITS it through a positive EXISTS rather
 * than storing a second copy. The inherited half is the one that could silently
 * fail open — see drizzle/0064 for why the negative spelling of that policy
 * would show a restricted record's connections to exactly the person it was
 * hidden from.
 */
const STAMP_CRM = `iso-crm-${process.pid}`;

d("crm isolation (RLS + record visibility)", () => {
  let tenantA: string;
  let tenantB: string;
  const partyOf: Record<string, string> = {};

  /** A party with its CRM row, created as an owner so visibility can be set. */
  async function seedCrmRecord(
    tenantId: string,
    displayName: string,
    kind: "person" | "organization",
    visibility: "members" | "restricted",
  ): Promise<string> {
    return withTenant(
      tenantId,
      async (tx) => {
        const [party] = await tx
          .insert(schema.parties)
          .values({ tenantId, kind, displayName })
          .returning();
        await tx
          .insert(schema.crmPartyDetails)
          .values({ tenantId, partyId: party.id, visibility });
        return party.id;
      },
      { role: "owner" },
    );
  }

  beforeAll(async () => {
    [tenantA, tenantB] = await withSystem(async (tx) => {
      const rows = await tx
        .insert(schema.tenants)
        .values([
          { clerkOrgId: `${STAMP_CRM}-a`, name: "CRM Iso A", slug: `${STAMP_CRM}-a` },
          { clerkOrgId: `${STAMP_CRM}-b`, name: "CRM Iso B", slug: `${STAMP_CRM}-b` },
        ])
        .returning();
      return [rows[0].id, rows[1].id];
    });

    partyOf.aOpen = await seedCrmRecord(tenantA, "Open Co A", "organization", "members");
    partyOf.aPerson = await seedCrmRecord(tenantA, "Person A", "person", "members");
    partyOf.aSecret = await seedCrmRecord(
      tenantA,
      "Secret Co A",
      "organization",
      "restricted",
    );
    partyOf.bOpen = await seedCrmRecord(tenantB, "Open Co B", "organization", "members");
  });

  afterAll(async () => {
    await withSystem(async (tx) => {
      await tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantA));
      await tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantB));
    });
  });

  it("unscoped selects on crm tables return only the tenant's rows", async () => {
    await withTenant(
      tenantA,
      async (tx) => {
        const details = await tx.select().from(schema.crmPartyDetails);
        expect(details.length).toBeGreaterThan(0);
        expect(details.every((r) => r.tenantId === tenantA)).toBe(true);
        const affiliations = await tx.select().from(schema.crmAffiliations);
        expect(affiliations.every((r) => r.tenantId === tenantA)).toBe(true);
      },
      { role: "owner" },
    );
  });

  it("cannot INSERT crm rows attributed to the other tenant", async () => {
    await expect(
      withTenant(
        tenantA,
        (tx) =>
          tx.insert(schema.crmPartyDetails).values({
            tenantId: tenantB,
            partyId: partyOf.bOpen,
          }),
        { role: "owner" },
      ),
    ).rejects.toThrow();
  });

  it("cannot UPDATE or DELETE the other tenant's crm rows (0 rows affected)", async () => {
    const updated = await withTenant(
      tenantA,
      (tx) =>
        tx
          .update(schema.crmPartyDetails)
          .set({ lifecycleStage: "defaced" })
          .where(eq(schema.crmPartyDetails.tenantId, tenantB))
          .returning(),
      { role: "owner" },
    );
    expect(updated).toHaveLength(0);

    const deleted = await withTenant(
      tenantA,
      (tx) =>
        tx
          .delete(schema.crmPartyDetails)
          .where(eq(schema.crmPartyDetails.tenantId, tenantB))
          .returning(),
      { role: "owner" },
    );
    expect(deleted).toHaveLength(0);
  });

  it("a crm row cannot reference another tenant's party", async () => {
    await expect(
      withTenant(
        tenantA,
        (tx) =>
          tx.insert(schema.crmPartyDetails).values({
            tenantId: tenantA,
            partyId: partyOf.bOpen,
          }),
        { role: "owner" },
      ),
    ).rejects.toThrow();
  });

  /* -- Record visibility -------------------------------------------------- */

  it("staff cannot see a restricted record's crm row; an owner can", async () => {
    const asStaff = await withTenant(
      tenantA,
      (tx) => tx.select().from(schema.crmPartyDetails),
      { role: "staff" },
    );
    expect(asStaff.map((r) => r.partyId)).not.toContain(partyOf.aSecret);
    // The open ones are unaffected — this is a visibility term, not a lockout.
    expect(asStaff.map((r) => r.partyId)).toContain(partyOf.aOpen);

    const asOwner = await withTenant(
      tenantA,
      (tx) => tx.select().from(schema.crmPartyDetails),
      { role: "owner" },
    );
    expect(asOwner.map((r) => r.partyId)).toContain(partyOf.aSecret);
  });

  it("a caller who forgets { role } is denied the restricted row, never granted it", async () => {
    // The fail-closed direction: app_current_tenant_role() defaults to 'staff'.
    const rows = await withTenant(tenantA, (tx) =>
      tx.select().from(schema.crmPartyDetails),
    );
    expect(rows.map((r) => r.partyId)).not.toContain(partyOf.aSecret);
  });

  /* -- Explicit collaborators (slice 6) ------------------------------------ */

  /**
   * THE MIDDLE GROUND, certified. `restricted` used to mean "tenant owners
   * only"; a grant names one person and lets them in without widening the
   * record to everybody.
   *
   * The four tests below are the whole feature: it works, it is narrow, it
   * cannot be self-issued, and it cannot be quietly removed. The third and
   * fourth matter most — a visibility grant that a staff member could write for
   * themselves is not a permission system, and one they could DELETE is a way
   * to lock an owner out of their own confidential record.
   */
  it("A COLLABORATOR SEES A RESTRICTED RECORD; a colleague still does not", async () => {
    await withTenant(
      tenantA,
      (tx) =>
        tx.insert(schema.crmRecordCollaborators).values({
          tenantId: tenantA,
          partyId: partyOf.aSecret,
          clerkUserId: "collab-user",
          grantedByClerkUserId: "owner-user",
        }),
      { role: "owner", userId: "owner-user" },
    );

    const asCollaborator = await withTenant(
      tenantA,
      (tx) => tx.select().from(schema.crmPartyDetails),
      { role: "staff", userId: "collab-user" },
    );
    expect(asCollaborator.map((r) => r.partyId)).toContain(partyOf.aSecret);

    // The same role, a different person: nothing changed for them.
    const asColleague = await withTenant(
      tenantA,
      (tx) => tx.select().from(schema.crmPartyDetails),
      { role: "staff", userId: "other-user" },
    );
    expect(asColleague.map((r) => r.partyId)).not.toContain(partyOf.aSecret);

    // And the fail-closed direction, which is the one that would go unnoticed:
    // a transaction that forgot the user id sees no grants and falls back to
    // owner-only, rather than treating "no user" as "any user".
    const anonymous = await withTenant(
      tenantA,
      (tx) => tx.select().from(schema.crmPartyDetails),
      { role: "staff" },
    );
    expect(anonymous.map((r) => r.partyId)).not.toContain(partyOf.aSecret);
  });

  it("the grant carries through to the record's timeline and follow-ups", async () => {
    // The reason the term lives on `crm_party_details` rather than being
    // repeated: the inheriting policies resolve visibility through a positive
    // EXISTS against that row, and not one of them mentions collaborators.
    //
    // Fixtures are created HERE rather than borrowed from the blocks below —
    // those run later in the file, and a test that depends on the order of its
    // neighbours is one that passes for the wrong reason.
    await withTenant(
      tenantA,
      async (tx) => {
        await tx.insert(schema.crmActivities).values({
          tenantId: tenantA,
          partyId: partyOf.aSecret,
          kind: "note",
          body: "Confidential note",
          occurredAt: new Date(),
          createdByClerkUserId: "owner-user",
        });
        await tx.insert(schema.crmTasks).values({
          tenantId: tenantA,
          partyId: partyOf.aSecret,
          title: "Confidential follow-up",
          createdByClerkUserId: "owner-user",
        });
      },
      { role: "owner", userId: "owner-user" },
    );

    const [activities, tasks] = await withTenant(
      tenantA,
      async (tx) => [
        await tx.select().from(schema.crmActivities),
        await tx.select().from(schema.crmTasks),
      ],
      { role: "staff", userId: "collab-user" },
    );
    expect(activities.map((a) => a.partyId)).toContain(partyOf.aSecret);
    expect(tasks.map((t) => t.partyId)).toContain(partyOf.aSecret);

    // And a colleague without the grant still sees neither.
    const [theirActivities, theirTasks] = await withTenant(
      tenantA,
      async (tx) => [
        await tx.select().from(schema.crmActivities),
        await tx.select().from(schema.crmTasks),
      ],
      { role: "staff", userId: "other-user" },
    );
    expect(theirActivities.map((a) => a.partyId)).not.toContain(partyOf.aSecret);
    expect(theirTasks.map((t) => t.partyId)).not.toContain(partyOf.aSecret);
  });

  it("STAFF CANNOT GRANT THEMSELVES ACCESS", async () => {
    await expect(
      withTenant(
        tenantA,
        (tx) =>
          tx.insert(schema.crmRecordCollaborators).values({
            tenantId: tenantA,
            partyId: partyOf.aSecret,
            clerkUserId: "sneaky-user",
            grantedByClerkUserId: "sneaky-user",
          }),
        { role: "staff", userId: "sneaky-user" },
      ),
    ).rejects.toThrow();
  });

  it("STAFF CANNOT DELETE A GRANT — the WITH-CHECK-is-not-consulted-for-DELETE trap", async () => {
    // 0067's lesson, in the place where it would hurt most: a permissive USING
    // with the role test only in WITH CHECK would let staff revoke access to
    // every confidential record in the tenant.
    const deleted = await withTenant(
      tenantA,
      (tx) =>
        tx
          .delete(schema.crmRecordCollaborators)
          .where(eq(schema.crmRecordCollaborators.tenantId, tenantA))
          .returning(),
      { role: "staff", userId: "collab-user" },
    );
    expect(deleted).toHaveLength(0);
  });

  it("a collaborator sees their OWN grant and nobody else's", async () => {
    // Narrow on purpose: somebody who could list grants could ask "which
    // records have collaborators?" and get back the set of confidential ones.
    await withTenant(
      tenantA,
      (tx) =>
        tx.insert(schema.crmRecordCollaborators).values({
          tenantId: tenantA,
          partyId: partyOf.aOpen,
          clerkUserId: "someone-else",
          grantedByClerkUserId: "owner-user",
        }),
      { role: "owner", userId: "owner-user" },
    );

    const mine = await withTenant(
      tenantA,
      (tx) => tx.select().from(schema.crmRecordCollaborators),
      { role: "staff", userId: "collab-user" },
    );
    expect(mine.map((r) => r.clerkUserId)).toEqual(["collab-user"]);

    const asOwner = await withTenant(
      tenantA,
      (tx) => tx.select().from(schema.crmRecordCollaborators),
      { role: "owner", userId: "owner-user" },
    );
    expect(asOwner.length).toBeGreaterThan(1);
  });

  it("staff cannot flip a restricted record back to members", async () => {
    // The WITH CHECK half. Without it a staff member could unhide a record by
    // writing to a row they cannot read.
    const updated = await withTenant(
      tenantA,
      (tx) =>
        tx
          .update(schema.crmPartyDetails)
          .set({ visibility: "members" })
          .where(eq(schema.crmPartyDetails.partyId, partyOf.aSecret))
          .returning(),
      { role: "staff" },
    );
    expect(updated).toHaveLength(0);
  });

  /**
   * THE INHERITED HALF, and the reason drizzle/0064 spells its policy
   * positively. An affiliation names two parties; if either end is restricted,
   * the connection itself is a disclosure — "our restricted account has this
   * person at it" — so it has to disappear for staff without storing a second
   * copy of the flag that could drift from the first.
   */
  it("staff cannot see an affiliation touching a restricted record", async () => {
    await withTenant(
      tenantA,
      (tx) =>
        tx.insert(schema.crmAffiliations).values({
          tenantId: tenantA,
          personPartyId: partyOf.aPerson,
          organizationPartyId: partyOf.aSecret,
          title: "Confidential",
        }),
      { role: "owner" },
    );

    const asOwner = await withTenant(
      tenantA,
      (tx) => tx.select().from(schema.crmAffiliations),
      { role: "owner" },
    );
    expect(asOwner.length).toBeGreaterThan(0);

    const asStaff = await withTenant(
      tenantA,
      (tx) => tx.select().from(schema.crmAffiliations),
      { role: "staff" },
    );
    expect(asStaff).toHaveLength(0);
  });

  /* -- Custom field definitions (slice 2) --------------------------------- */

  /**
   * `crm_field_defs` is the first table here with a READ/WRITE role split
   * rather than a visibility term, and the case that earns its keep is DELETE:
   * a single FOR ALL policy with a permissive USING would have let staff delete
   * every definition in the tenant, because WITH CHECK is not consulted for
   * DELETE. See drizzle/0067.
   */
  it("staff can READ field definitions", async () => {
    // Not a formality — the record form cannot render without them, so a
    // policy that locked staff out would break the module for most of a team.
    await withTenant(
      tenantA,
      (tx) =>
        tx.insert(schema.crmFieldDefs).values({
          tenantId: tenantA,
          key: "warranty_expiry",
          label: "Warranty expiry",
          fieldType: "date",
        }),
      { role: "owner" },
    );

    const asStaff = await withTenant(
      tenantA,
      (tx) => tx.select().from(schema.crmFieldDefs),
      { role: "staff" },
    );
    expect(asStaff.map((r) => r.key)).toContain("warranty_expiry");
  });

  it("staff cannot CREATE a field definition", async () => {
    await expect(
      withTenant(
        tenantA,
        (tx) =>
          tx.insert(schema.crmFieldDefs).values({
            tenantId: tenantA,
            key: "smuggled",
            label: "Smuggled",
            fieldType: "text",
          }),
        { role: "staff" },
      ),
    ).rejects.toThrow();
  });

  it("staff cannot UPDATE a field definition (0 rows affected)", async () => {
    const updated = await withTenant(
      tenantA,
      (tx) =>
        tx
          .update(schema.crmFieldDefs)
          .set({ label: "defaced" })
          .where(eq(schema.crmFieldDefs.tenantId, tenantA))
          .returning(),
      { role: "staff" },
    );
    expect(updated).toHaveLength(0);
  });

  it("STAFF CANNOT DELETE A FIELD DEFINITION — the hole a single FOR ALL policy would leave", async () => {
    const deleted = await withTenant(
      tenantA,
      (tx) =>
        tx
          .delete(schema.crmFieldDefs)
          .where(eq(schema.crmFieldDefs.tenantId, tenantA))
          .returning(),
      { role: "staff" },
    );
    expect(deleted).toHaveLength(0);

    // And the definitions are still there, so the assertion above is about
    // permission rather than about an empty table.
    const remaining = await withTenant(
      tenantA,
      (tx) => tx.select().from(schema.crmFieldDefs),
      { role: "owner" },
    );
    expect(remaining.length).toBeGreaterThan(0);
  });

  it("cannot read or write another tenant's field definitions", async () => {
    const rows = await withTenant(
      tenantA,
      (tx) =>
        tx
          .select()
          .from(schema.crmFieldDefs)
          .where(eq(schema.crmFieldDefs.tenantId, tenantB)),
      { role: "owner" },
    );
    expect(rows).toHaveLength(0);

    await expect(
      withTenant(
        tenantA,
        (tx) =>
          tx.insert(schema.crmFieldDefs).values({
            tenantId: tenantB,
            key: "smuggled",
            label: "Smuggled",
            fieldType: "text",
          }),
        { role: "owner" },
      ),
    ).rejects.toThrow();
  });

  /* -- Pipelines and deals (slice 3) -------------------------------------- */

  /**
   * Deals inherit the party's visibility, and stage history inherits through
   * the deal — a two-link chain. The case that earns its keep is the second
   * link: it is easy to get the deal policy right and leave the history table
   * tenant-scoped only, which would let a staff member read the moves of a deal
   * they cannot see, complete with who changed it and when.
   */
  it("pipelines and stages: staff read, only owners write", async () => {
    const pipelineId = await withTenant(
      tenantA,
      async (tx) => {
        const [p] = await tx
          .insert(schema.crmPipelines)
          .values({ tenantId: tenantA, name: "Iso pipeline", isDefault: true })
          .returning();
        await tx.insert(schema.crmPipelineStages).values([
          { tenantId: tenantA, pipelineId: p.id, name: "New", sortOrder: 0, outcome: "open" },
          { tenantId: tenantA, pipelineId: p.id, name: "Won", sortOrder: 1, outcome: "won", probability: 100 },
        ]);
        return p.id;
      },
      { role: "owner" },
    );
    partyOf.pipeline = pipelineId;

    const asStaff = await withTenant(
      tenantA,
      (tx) => tx.select().from(schema.crmPipelineStages),
      { role: "staff" },
    );
    expect(asStaff.length).toBe(2);

    await expect(
      withTenant(
        tenantA,
        (tx) =>
          tx.insert(schema.crmPipelines).values({
            tenantId: tenantA,
            name: "Smuggled",
          }),
        { role: "staff" },
      ),
    ).rejects.toThrow();

    // The DELETE case again — the 0067 hole, re-checked on this table.
    const deleted = await withTenant(
      tenantA,
      (tx) =>
        tx
          .delete(schema.crmPipelineStages)
          .where(eq(schema.crmPipelineStages.tenantId, tenantA))
          .returning(),
      { role: "staff" },
    );
    expect(deleted).toHaveLength(0);
  });

  it("staff cannot see a deal on a restricted record, nor its stage history", async () => {
    const stages = await withTenant(
      tenantA,
      (tx) =>
        tx
          .select()
          .from(schema.crmPipelineStages)
          .where(eq(schema.crmPipelineStages.pipelineId, partyOf.pipeline)),
      { role: "owner" },
    );
    const openStage = stages.find((s) => s.outcome === "open")!;

    const dealId = await withTenant(
      tenantA,
      async (tx) => {
        const [d] = await tx
          .insert(schema.crmDeals)
          .values({
            tenantId: tenantA,
            // aSecret is `restricted` — set up at the top of this block.
            partyId: partyOf.aSecret,
            pipelineId: partyOf.pipeline,
            stageId: openStage.id,
            title: "Confidential deal",
            amountCents: 40_000_00,
          })
          .returning();
        await tx.insert(schema.crmDealStageEvents).values({
          tenantId: tenantA,
          dealId: d.id,
          toStageId: openStage.id,
          changedByClerkUserId: "user-owner",
        });
        return d.id;
      },
      { role: "owner" },
    );

    const ownerDeals = await withTenant(
      tenantA,
      (tx) => tx.select().from(schema.crmDeals),
      { role: "owner" },
    );
    expect(ownerDeals.map((d) => d.id)).toContain(dealId);

    const staffDeals = await withTenant(
      tenantA,
      (tx) => tx.select().from(schema.crmDeals),
      { role: "staff" },
    );
    expect(staffDeals.map((d) => d.id)).not.toContain(dealId);

    // THE SECOND LINK. Tenant-scoping alone would have leaked this.
    const staffHistory = await withTenant(
      tenantA,
      (tx) => tx.select().from(schema.crmDealStageEvents),
      { role: "staff" },
    );
    expect(staffHistory.map((e) => e.dealId)).not.toContain(dealId);
  });

  it("staff CAN see a deal on an open record", async () => {
    // The other direction, so the test above proves inheritance rather than a
    // blanket denial of the deals table to staff.
    const stages = await withTenant(
      tenantA,
      (tx) =>
        tx
          .select()
          .from(schema.crmPipelineStages)
          .where(eq(schema.crmPipelineStages.pipelineId, partyOf.pipeline)),
      { role: "owner" },
    );
    const openStage = stages.find((s) => s.outcome === "open")!;

    const dealId = await withTenant(
      tenantA,
      async (tx) => {
        const [d] = await tx
          .insert(schema.crmDeals)
          .values({
            tenantId: tenantA,
            partyId: partyOf.aOpen,
            pipelineId: partyOf.pipeline,
            stageId: openStage.id,
            title: "Ordinary deal",
          })
          .returning();
        return d.id;
      },
      { role: "owner" },
    );

    const staffDeals = await withTenant(
      tenantA,
      (tx) => tx.select().from(schema.crmDeals),
      { role: "staff" },
    );
    expect(staffDeals.map((d) => d.id)).toContain(dealId);
  });

  it("a deal cannot reference another tenant's party or stage", async () => {
    const stages = await withTenant(
      tenantA,
      (tx) =>
        tx
          .select()
          .from(schema.crmPipelineStages)
          .where(eq(schema.crmPipelineStages.pipelineId, partyOf.pipeline)),
      { role: "owner" },
    );
    await expect(
      withTenant(
        tenantA,
        (tx) =>
          tx.insert(schema.crmDeals).values({
            tenantId: tenantA,
            partyId: partyOf.bOpen,
            pipelineId: partyOf.pipeline,
            stageId: stages[0].id,
            title: "Cross-tenant deal",
          }),
        { role: "owner" },
      ),
    ).rejects.toThrow();
  });

  /* -- Activity and follow-ups (slice 4) ---------------------------------- */

  it("staff cannot see an activity logged against a restricted record", async () => {
    await withTenant(
      tenantA,
      (tx) =>
        tx.insert(schema.crmActivities).values({
          tenantId: tenantA,
          partyId: partyOf.aSecret,
          kind: "note",
          body: "They will not pay until the dispute settles.",
          createdByClerkUserId: "user-owner",
        }),
      { role: "owner" },
    );

    const asOwner = await withTenant(
      tenantA,
      (tx) => tx.select().from(schema.crmActivities),
      { role: "owner" },
    );
    expect(asOwner.length).toBeGreaterThan(0);

    const asStaff = await withTenant(
      tenantA,
      (tx) => tx.select().from(schema.crmActivities),
      { role: "staff" },
    );
    expect(asStaff.map((a) => a.partyId)).not.toContain(partyOf.aSecret);
  });

  it("staff CAN see an activity on an open record", async () => {
    await withTenant(
      tenantA,
      (tx) =>
        tx.insert(schema.crmActivities).values({
          tenantId: tenantA,
          partyId: partyOf.aOpen,
          kind: "call",
          body: "Ordinary call.",
          createdByClerkUserId: "user-owner",
        }),
      { role: "owner" },
    );

    const asStaff = await withTenant(
      tenantA,
      (tx) => tx.select().from(schema.crmActivities),
      { role: "staff" },
    );
    expect(asStaff.map((a) => a.partyId)).toContain(partyOf.aOpen);
  });

  /**
   * The task policy BRANCHES, which is the one genuinely new shape in slice 4:
   * an unattached task is plain tenant-scoped, an attached one inherits. Both
   * halves need proving, and so does the write side — a staff member must not
   * be able to attach a task to a record they cannot see.
   */
  it("an unattached task is visible to every member", async () => {
    await withTenant(
      tenantA,
      (tx) =>
        tx.insert(schema.crmTasks).values({
          tenantId: tenantA,
          title: "Ring the accountant back",
          createdByClerkUserId: "user-owner",
        }),
      { role: "owner" },
    );

    const asStaff = await withTenant(
      tenantA,
      (tx) => tx.select().from(schema.crmTasks),
      { role: "staff" },
    );
    expect(asStaff.map((t) => t.title)).toContain("Ring the accountant back");
  });

  it("a task attached to a restricted record is hidden from staff", async () => {
    await withTenant(
      tenantA,
      (tx) =>
        tx.insert(schema.crmTasks).values({
          tenantId: tenantA,
          partyId: partyOf.aSecret,
          title: "Chase the confidential one",
          createdByClerkUserId: "user-owner",
        }),
      { role: "owner" },
    );

    const asStaff = await withTenant(
      tenantA,
      (tx) => tx.select().from(schema.crmTasks),
      { role: "staff" },
    );
    expect(asStaff.map((t) => t.title)).not.toContain("Chase the confidential one");

    const asOwner = await withTenant(
      tenantA,
      (tx) => tx.select().from(schema.crmTasks),
      { role: "owner" },
    );
    expect(asOwner.map((t) => t.title)).toContain("Chase the confidential one");
  });

  it("staff cannot ATTACH a task to a restricted record", async () => {
    // The WITH CHECK half. Without it a staff member could file work against a
    // record they cannot open, and then not see what they had just written.
    await expect(
      withTenant(
        tenantA,
        (tx) =>
          tx.insert(schema.crmTasks).values({
            tenantId: tenantA,
            partyId: partyOf.aSecret,
            title: "Smuggled",
            createdByClerkUserId: "user-staff",
          }),
        { role: "staff" },
      ),
    ).rejects.toThrow();
  });

  it("a task cannot be half-completed", async () => {
    // The CHECK constraint: completed_at and completed_by are one fact stored
    // in two columns, and a row carrying only half of it is uninterpretable.
    await expect(
      withTenant(
        tenantA,
        (tx) =>
          tx.insert(schema.crmTasks).values({
            tenantId: tenantA,
            title: "Half done",
            completedAt: new Date(),
            createdByClerkUserId: "user-owner",
          }),
        { role: "owner" },
      ),
    ).rejects.toThrow();
  });

  it("cannot write activity or tasks into the other tenant", async () => {
    await expect(
      withTenant(
        tenantA,
        (tx) =>
          tx.insert(schema.crmTasks).values({
            tenantId: tenantB,
            title: "Cross-tenant task",
            createdByClerkUserId: "attacker",
          }),
        { role: "owner" },
      ),
    ).rejects.toThrow();
  });

  /* -- The CRM mail extension (slice 5) ----------------------------------- */

  /**
   * CRM is the THIRD real user of the mail extension seam, after Accounting and
   * Documents — and this dossier's own rule is that a seam with one user is a
   * seam that has never been tested. What these certify is invariant S12 as the
   * contract states it: `search`, `resolve` and `templateValues` take the
   * CALLER'S transaction and apply no visibility predicate of their own, so RLS
   * reached through that transaction is the entire guard.
   */
  it("the CRM extension cannot reach another tenant's records", async () => {
    const company = crmMailExtension.entityTypes.find((t) => t.type === "company")!;

    const fromA = await withTenant(
      tenantA,
      (tx) =>
        company.search(
          tx,
          { tenantId: tenantA, userId: "user-a", role: "owner" },
          "Open Co",
          10,
        ),
      { role: "owner", userId: "user-a" },
    );
    expect(fromA.map((e) => e.label)).toContain("Open Co A");
    expect(fromA.map((e) => e.label)).not.toContain("Open Co B");

    // And naming B's id directly resolves to nothing rather than to its name.
    const smuggled = await withTenant(
      tenantA,
      (tx) =>
        company.resolve(
          tx,
          { tenantId: tenantA, userId: "user-a", role: "owner" },
          [partyOf.bOpen],
        ),
      { role: "owner", userId: "user-a" },
    );
    expect(smuggled).toHaveLength(0);
  });

  it("CRM template values return null for another tenant's record", async () => {
    // Null is also what "no such record" gives, so a template cannot be used to
    // discover whether one exists.
    const company = crmMailExtension.entityTypes.find((t) => t.type === "company")!;
    const values = await withTenant(
      tenantA,
      (tx) =>
        company.templateValues!(
          tx,
          { tenantId: tenantA, userId: "user-a", role: "owner" },
          partyOf.bOpen,
        ),
      { role: "owner", userId: "user-a" },
    );
    expect(values).toBeNull();
  });

  it("the contact type offers only people, the company type only organizations", async () => {
    // The two share an implementation and differ by `kind`; a mix-up would put
    // companies in a picker asking for a person and nothing would complain.
    const contact = crmMailExtension.entityTypes.find((t) => t.type === "contact")!;
    const found = await withTenant(
      tenantA,
      (tx) =>
        contact.search(
          tx,
          { tenantId: tenantA, userId: "user-a", role: "owner" },
          "Person A",
          10,
        ),
      { role: "owner", userId: "user-a" },
    );
    expect(found.map((e) => e.label)).toEqual(["Person A"]);

    const companies = await withTenant(
      tenantA,
      (tx) =>
        contact.search(
          tx,
          { tenantId: tenantA, userId: "user-a", role: "owner" },
          "Open Co",
          10,
        ),
      { role: "owner", userId: "user-a" },
    );
    expect(companies).toHaveLength(0);
  });

  /**
   * DEALS INHERIT, CONTACTS DO NOT, and the asymmetry is deliberate rather than
   * an oversight — so it is worth pinning before somebody "fixes" one of them.
   *
   * A restricted record's NAME is visible to staff by design (the identity is
   * shared with Accounting), so the picker offers it exactly as the records
   * list does. Its DEALS are not, because `crm_deals` inherits the record's
   * visibility — and no predicate in the extension says so, which is the point.
   */
  it("the picker offers a restricted record's name but not its deals", async () => {
    const company = crmMailExtension.entityTypes.find((t) => t.type === "company")!;
    const deal = crmMailExtension.entityTypes.find((t) => t.type === "deal")!;

    const namesAsStaff = await withTenant(
      tenantA,
      (tx) =>
        company.search(
          tx,
          { tenantId: tenantA, userId: "user-a", role: "staff" },
          "Secret Co",
          10,
        ),
      { role: "staff", userId: "user-a" },
    );
    expect(namesAsStaff.map((e) => e.label)).toContain("Secret Co A");

    const dealsAsStaff = await withTenant(
      tenantA,
      (tx) =>
        deal.search(
          tx,
          { tenantId: tenantA, userId: "user-a", role: "staff" },
          "Confidential",
          10,
        ),
      { role: "staff", userId: "user-a" },
    );
    expect(dealsAsStaff).toHaveLength(0);

    const dealsAsOwner = await withTenant(
      tenantA,
      (tx) =>
        deal.search(
          tx,
          { tenantId: tenantA, userId: "user-a", role: "owner" },
          "Confidential",
          10,
        ),
      { role: "owner", userId: "user-a" },
    );
    expect(dealsAsOwner.map((e) => e.label)).toContain("Confidential deal");
  });

  it("staff CAN see an affiliation between two open records", async () => {
    // The other direction, so the test above is proving inheritance rather than
    // an accidental blanket denial of the whole table to staff.
    await withTenant(
      tenantA,
      (tx) =>
        tx.insert(schema.crmAffiliations).values({
          tenantId: tenantA,
          personPartyId: partyOf.aPerson,
          organizationPartyId: partyOf.aOpen,
          title: "Operations Manager",
        }),
      { role: "owner" },
    );

    const asStaff = await withTenant(
      tenantA,
      (tx) => tx.select().from(schema.crmAffiliations),
      { role: "staff" },
    );
    expect(asStaff.map((r) => r.organizationPartyId)).toEqual([partyOf.aOpen]);
  });
});
