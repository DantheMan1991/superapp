import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { withTenant, withSystem, schema } from "../src/db";
import { createRecord } from "../src/modules/crm/party-ops";
import { createRule, listRules, runTrigger } from "../src/modules/crm/automation-ops";
import type { AutomationRule } from "../src/modules/crm/core/automation";

/**
 * The automation engine, against a database.
 *
 * TWO PROPERTIES CARRY THIS FILE, and neither can be tested without Postgres.
 *
 * The first is that a rule runs with the TRIGGERING PERSON'S permissions, so a
 * staff member's edit cannot cause a rule to touch a restricted record. That is
 * RLS doing the work, and asserting it needs two roles and a real policy.
 *
 * The second is the savepoint. A failing action must not roll back the write
 * that triggered it — and catching the exception in TypeScript is NOT enough,
 * because Postgres aborts the whole transaction on any error and the caller's
 * own commit would fail afterwards. The test for that deliberately breaks a
 * rule and then asserts the record still exists.
 */

const RUN = !!process.env.DATABASE_URL;
const d = RUN ? describe : describe.skip;
const STAMP = `crmauto-${process.pid}`;

d("crm automation engine (database)", () => {
  let tenantId: string;
  const owner = { role: "owner" as const, userId: "owner-user" };
  const staff = { role: "staff" as const, userId: "staff-user" };

  const ctx = (role: "owner" | "staff", userId: string) => ({
    tenantId,
    userId,
    role,
  });

  beforeAll(async () => {
    tenantId = await withSystem(async (tx) => {
      const [row] = await tx
        .insert(schema.tenants)
        .values([{ clerkOrgId: STAMP, name: "Automation Test", slug: STAMP }])
        .returning();

      /*
       * `rep-a` IS A REAL MEMBER NOW, and that is the point of the fixture.
       *
       * Before work.md slice 5b a rule could assign a follow-up to any string,
       * and this test passed with `rep-a` belonging to nobody — which is
       * exactly the gap crm.md described as "work that appears in nobody's list
       * and nobody's digest". Work validates against the roster, so the fixture
       * has to describe a workspace that could really exist.
       */
      const [profile] = await tx
        .insert(schema.profiles)
        .values({ clerkUserId: "rep-a", email: `rep-a-${STAMP}@example.test` })
        .returning();
      await tx
        .insert(schema.memberships)
        .values({ tenantId: row.id, profileId: profile.id, role: "staff" });
      return row.id;
    });
  });

  afterAll(async () => {
    await withSystem(async (tx) => {
      await tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantId));
      // `profiles` is NOT tenant-scoped, so deleting the tenant leaves this
      // row behind and the next run would collide on `clerk_user_id`. The id
      // cannot be stamped per process because the rule under test names it.
      await tx
        .delete(schema.profiles)
        .where(eq(schema.profiles.clerkUserId, "rep-a"));
    });
  });

  async function addRule(name: string, rule: AutomationRule) {
    return withTenant(
      tenantId,
      (tx) => createRule(tx, tenantId, owner.userId, { name, rule, isActive: true }),
      owner,
    );
  }

  it("A RULE FIRES ON THE TRIGGER AND DOES ITS ACTION", async () => {
    await addRule("Welcome follow-up", {
      trigger: "record_created",
      conditions: [],
      action: {
        kind: "create_task",
        title: "Say hello",
        dueInDays: 2,
        assignee: "rep-a",
      },
    });

    const { party } = await withTenant(
      tenantId,
      (tx) =>
        createRecord(tx, ctx("owner", owner.userId), {
          kind: "organization",
          displayName: "Fires Ltd",
        }),
      owner,
    );

    const tasks = await withTenant(
      tenantId,
      (tx) =>
        // A rule's follow-up is a WORK ITEM linked to the record since
        // work.md slice 5b, so this reads the join rather than a column.
        tx
          .select({
            title: schema.workItems.title,
            assigneeClerkUserId: schema.workItems.assigneeClerkUserId,
            createdByClerkUserId: schema.workItems.createdByClerkUserId,
            dueOn: schema.workItems.dueOn,
          })
          .from(schema.workItems)
          .innerJoin(
            schema.workItemLinks,
            eq(schema.workItemLinks.itemId, schema.workItems.id),
          )
          .where(eq(schema.workItemLinks.entityId, party.id)),
      owner,
    );
    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toBe("Say hello");
    expect(tasks[0].assigneeClerkUserId).toBe("rep-a");
    // Attributed to the person whose action triggered it — there is no system
    // user, and inventing one would make the audit trail lie.
    expect(tasks[0].createdByClerkUserId).toBe(owner.userId);
  });

  it("ONE HOP: the follow-up it created does not wake a follow-up rule", async () => {
    // A loop is not merely unlikely here, it is unrepresentable — the actions
    // write tables directly and never call back into a triggering path.
    await addRule("Would loop", {
      trigger: "task_completed",
      conditions: [],
      action: { kind: "create_task", title: "Loop", dueInDays: 0 },
    });

    const { party } = await withTenant(
      tenantId,
      (tx) =>
        createRecord(tx, ctx("owner", owner.userId), {
          kind: "organization",
          displayName: "No Loop Ltd",
        }),
      owner,
    );

    const tasks = await withTenant(
      tenantId,
      (tx) =>
        // A rule's follow-up is a WORK ITEM linked to the record since
        // work.md slice 5b, so this reads the join rather than a column.
        tx
          .select({
            title: schema.workItems.title,
            assigneeClerkUserId: schema.workItems.assigneeClerkUserId,
            createdByClerkUserId: schema.workItems.createdByClerkUserId,
            dueOn: schema.workItems.dueOn,
          })
          .from(schema.workItems)
          .innerJoin(
            schema.workItemLinks,
            eq(schema.workItemLinks.itemId, schema.workItems.id),
          )
          .where(eq(schema.workItemLinks.entityId, party.id)),
      owner,
    );
    // Exactly the one the record_created rule made, and nothing else.
    expect(tasks).toHaveLength(1);
  });

  it("skips a rule whose conditions do not match", async () => {
    await addRule("Only people", {
      trigger: "record_created",
      conditions: [{ field: "kind", operator: "equals", value: "person" }],
      action: { kind: "set_lifecycle_stage", stage: "lead" },
    });

    const { party, details } = await withTenant(
      tenantId,
      (tx) =>
        createRecord(tx, ctx("owner", owner.userId), {
          kind: "organization",
          displayName: "Not A Person Ltd",
        }),
      owner,
    );
    expect(details.lifecycleStage).toBe("");

    const person = await withTenant(
      tenantId,
      (tx) =>
        createRecord(tx, ctx("owner", owner.userId), {
          kind: "person",
          displayName: "Aoife Person",
        }),
      owner,
    );
    const after = await withTenant(
      tenantId,
      (tx) =>
        tx.query.crmPartyDetails.findFirst({
          where: and(
            eq(schema.crmPartyDetails.tenantId, tenantId),
            eq(schema.crmPartyDetails.partyId, person.party.id),
          ),
        }),
      owner,
    );
    expect(after!.lifecycleStage).toBe("lead");
    void party;
  });

  it("A BROKEN RULE DOES NOT ROLL BACK THE PERSON'S OWN WORK", async () => {
    // The savepoint test, and the reason this file exists. Postgres aborts the
    // whole transaction on any error, so catching the exception in TypeScript
    // alone would leave the caller's commit poisoned. This rule's action names
    // a record with no details row to update, which throws inside the engine.
    const broken = await withTenant(
      tenantId,
      (tx) =>
        createRule(tx, tenantId, owner.userId, {
          name: "Breaks on purpose",
          rule: {
            trigger: "deal_stage_changed",
            conditions: [],
            action: { kind: "set_lifecycle_stage", stage: "won" },
          },
          isActive: true,
        }),
      owner,
    );

    // A party with NO details row, so `set_lifecycle_stage` updates nothing and
    // the engine throws inside its savepoint.
    const partyId = await withTenant(
      tenantId,
      async (tx) => {
        const [row] = await tx
          .insert(schema.parties)
          .values({ tenantId, kind: "organization", displayName: "No Details Co" })
          .returning();
        return row.id;
      },
      owner,
    );

    const outcome = await withTenant(
      tenantId,
      async (tx) => {
        const result = await runTrigger(
          tx,
          { tenantId, userId: owner.userId, partyId },
          "deal_stage_changed",
        );
        // THE PROOF: the transaction is still usable after the rule blew up.
        // Without the savepoint this insert would fail with "current
        // transaction is aborted".
        await tx
          .insert(schema.parties)
          .values({ tenantId, kind: "organization", displayName: "Still Works Ltd" });
        return result;
      },
      owner,
    );

    expect(outcome.failed).toBe(1);

    const survived = await withTenant(
      tenantId,
      (tx) =>
        tx.query.parties.findFirst({
          where: and(
            eq(schema.parties.tenantId, tenantId),
            eq(schema.parties.displayName, "Still Works Ltd"),
          ),
        }),
      owner,
    );
    expect(survived).toBeDefined();
    void broken;
  });

  it("A RULE CANNOT DO WHAT THE TRIGGERING PERSON COULD NOT", async () => {
    // The security property, and the reason automation needed no permission
    // model of its own. The rule would set a stage on a RESTRICTED record; run
    // by staff, RLS has already removed that details row, so the update matches
    // nothing and the rule fails rather than escalating.
    const partyId = await withTenant(
      tenantId,
      async (tx) => {
        const [party] = await tx
          .insert(schema.parties)
          .values({ tenantId, kind: "organization", displayName: "Confidential Ltd" })
          .returning();
        await tx.insert(schema.crmPartyDetails).values({
          tenantId,
          partyId: party.id,
          visibility: "restricted",
          lifecycleStage: "secret",
        });
        return party.id;
      },
      owner,
    );

    const asStaff = await withTenant(
      tenantId,
      (tx) =>
        runTrigger(tx, { tenantId, userId: staff.userId, partyId }, "deal_stage_changed"),
      staff,
    );
    expect(asStaff.applied).toBe(0);

    // And the record is untouched, seen by somebody who can see it.
    const details = await withTenant(
      tenantId,
      (tx) =>
        tx.query.crmPartyDetails.findFirst({
          where: and(
            eq(schema.crmPartyDetails.tenantId, tenantId),
            eq(schema.crmPartyDetails.partyId, partyId),
          ),
        }),
      owner,
    );
    expect(details!.lifecycleStage).toBe("secret");
  });

  it("STAFF CANNOT DELETE THE RULES — the WITH-CHECK-not-consulted-for-DELETE trap", async () => {
    // 0067's lesson again, and here it would mean a business quietly losing the
    // automations it thought it had.
    const deleted = await withTenant(
      tenantId,
      (tx) =>
        tx
          .delete(schema.crmAutomationRules)
          .where(eq(schema.crmAutomationRules.tenantId, tenantId))
          .returning(),
      staff,
    );
    expect(deleted).toHaveLength(0);

    // But staff CAN read them, which is the transparency half: somebody who
    // finds a follow-up they did not create is owed the ability to find out why.
    const visible = await withTenant(
      tenantId,
      (tx) => listRules(tx, tenantId),
      staff,
    );
    expect(visible.length).toBeGreaterThan(0);
  });

  it("staff cannot create one either", async () => {
    await expect(
      withTenant(
        tenantId,
        (tx) =>
          createRule(tx, tenantId, staff.userId, {
            name: "Sneaky",
            rule: {
              trigger: "record_created",
              conditions: [],
              action: { kind: "create_task", title: "x", dueInDays: 0 },
            },
            isActive: true,
          }),
        staff,
      ),
    ).rejects.toThrow();
  });
});
