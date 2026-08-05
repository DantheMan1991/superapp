import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { withTenant, withSystem, schema } from "../src/db";
import { createParty } from "../src/lib/parties";
import {
  createReport,
  deleteReport,
  listReports,
  resolveReport,
  runReport,
  updateReport,
} from "../src/modules/crm/report-ops";
import {
  BUILT_IN_REPORTS,
  DEFAULT_DEFINITION,
  REPORT_TYPES,
  type ReportDefinition,
} from "../src/modules/crm/core/reports";

/**
 * The five base queries, against a database.
 *
 * THIS FILE EXISTS BECAUSE `report-ops.ts` IS THREE HUNDRED LINES OF SQL THE
 * COMPILER CANNOT CHECK. A join alias that does not match, a column that was
 * renamed, an enum cast Postgres will not make — none of those are type errors,
 * and every one of them is a report that throws the first time somebody opens
 * it. The first test below runs all five shapes for exactly that reason.
 *
 * The other half is arithmetic: a summary whose groups do not add up to its own
 * total is a report that gets believed.
 */

const RUN = !!process.env.DATABASE_URL;
const d = RUN ? describe : describe.skip;
const STAMP = `crmreports-${process.pid}`;

d("crm reports (database)", () => {
  let tenantId: string;
  const owner = { role: "owner" as const, userId: "owner-user" };
  const staff = { role: "staff" as const, userId: "staff-user" };
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    tenantId = await withSystem(async (tx) => {
      const [row] = await tx
        .insert(schema.tenants)
        .values([{ clerkOrgId: STAMP, name: "Reports Test", slug: STAMP }])
        .returning();
      return row.id;
    });

    await withTenant(
      tenantId,
      async (tx) => {
        const acme = await createParty(tx, tenantId, {
          kind: "organization",
          displayName: "Acme Holdings",
        });
        const bob = await createParty(tx, tenantId, {
          kind: "person",
          displayName: "Bob Smith",
        });
        const secret = await createParty(tx, tenantId, {
          kind: "organization",
          displayName: "Secret Co",
        });
        ids.acme = acme.id;
        ids.bob = bob.id;
        ids.secret = secret.id;

        await tx.insert(schema.crmPartyDetails).values([
          { tenantId, partyId: acme.id, lifecycleStage: "customer", ownerClerkUserId: "rep-a" },
          { tenantId, partyId: bob.id, lifecycleStage: "lead", ownerClerkUserId: "rep-b" },
          // No stage — the null group the summariser must keep.
          { tenantId, partyId: secret.id, visibility: "restricted" },
        ]);

        const [pipeline] = await tx
          .insert(schema.crmPipelines)
          .values({ tenantId, name: "Sales", isDefault: true })
          .returning();
        const [open, won] = await tx
          .insert(schema.crmPipelineStages)
          .values([
            { tenantId, pipelineId: pipeline.id, name: "Qualifying", sortOrder: 1, outcome: "open" },
            { tenantId, pipelineId: pipeline.id, name: "Won", sortOrder: 2, outcome: "won" },
          ])
          .returning();
        ids.open = open.id;
        ids.won = won.id;

        const deals = await tx
          .insert(schema.crmDeals)
          .values([
            {
              tenantId, partyId: acme.id, pipelineId: pipeline.id, stageId: open.id,
              title: "Acme roof", amountCents: 500_000, ownerClerkUserId: "rep-a",
            },
            {
              tenantId, partyId: bob.id, pipelineId: pipeline.id, stageId: open.id,
              title: "Bob extension", amountCents: 250_000, ownerClerkUserId: "rep-b",
            },
            {
              tenantId, partyId: acme.id, pipelineId: pipeline.id, stageId: won.id,
              title: "Acme fit-out", amountCents: 1_000_000, ownerClerkUserId: "rep-a",
            },
            // On the RESTRICTED record — invisible to staff, and the reason the
            // last test in this file exists.
            {
              tenantId, partyId: secret.id, pipelineId: pipeline.id, stageId: open.id,
              title: "Secret job", amountCents: 9_000_000, ownerClerkUserId: "rep-a",
            },
          ])
          .returning();

        await tx.insert(schema.crmDealStageEvents).values(
          deals.slice(0, 2).map((deal) => ({
            tenantId,
            dealId: deal.id,
            fromStageId: null,
            toStageId: open.id,
            changedByClerkUserId: "owner-user",
          })),
        );

        await tx.insert(schema.crmActivities).values([
          {
            tenantId, partyId: acme.id, kind: "call" as const, subject: "Rang about the roof",
            body: "", occurredAt: new Date(), createdByClerkUserId: "owner-user",
          },
          {
            tenantId, partyId: bob.id, kind: "note" as const, subject: "", body: "Left a message",
            occurredAt: new Date(), createdByClerkUserId: "owner-user",
          },
        ]);

        await tx.insert(schema.crmTasks).values([
          {
            tenantId, partyId: acme.id, title: "Send the quote",
            assigneeClerkUserId: "rep-a", createdByClerkUserId: "owner-user",
          },
          {
            tenantId, partyId: null, title: "Ring the accountant",
            assigneeClerkUserId: "rep-a", createdByClerkUserId: "owner-user",
          },
          {
            tenantId, partyId: bob.id, title: "Chase Bob", assigneeClerkUserId: "rep-b",
            completedAt: new Date(), completedByClerkUserId: "rep-b",
            createdByClerkUserId: "owner-user",
          },
        ]);
      },
      owner,
    );
  });

  afterAll(async () => {
    await withSystem(async (tx) => {
      await tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantId));
    });
  });

  const run = (definition: Partial<ReportDefinition>) =>
    withTenant(
      tenantId,
      (tx) => runReport(tx, tenantId, { ...DEFAULT_DEFINITION, ...definition }),
      owner,
    );

  it("EVERY DECLARED TYPE ACTUALLY RUNS, grouped and ungrouped", async () => {
    // The test this file is for. A mismatched alias or a bad cast is not a type
    // error and is a report that throws the first time it is opened.
    for (const type of REPORT_TYPES) {
      const ungrouped = await run({ type: type.id, groupBy: null });
      expect(ungrouped.summary.rows).toHaveLength(1);

      for (const group of type.groupBy) {
        const grouped = await run({ type: type.id, groupBy: group.key });
        expect(grouped.groupLabel).toBe(group.label);
        // Groups must always add up to the total printed beside them.
        expect(
          grouped.summary.rows.reduce((n, r) => n + r.value, 0),
        ).toBe(grouped.summary.total);
      }
    }
  });

  it("every built-in report runs", async () => {
    for (const report of BUILT_IN_REPORTS) {
      const result = await run(report.definition);
      expect(result.summary.total).toBeGreaterThanOrEqual(0);
    }
  });

  it("groups records by stage and KEEPS THE ONE WITH NO STAGE", async () => {
    const result = await run({ type: "records", groupBy: "stage" });
    const byKey = Object.fromEntries(
      result.summary.rows.map((r) => [r.key ?? "__null__", r.value]),
    );
    expect(byKey.customer).toBe(1);
    expect(byKey.lead).toBe(1);
    // "1 record with no stage set" is the actionable line, not a rounding
    // error to hide.
    expect(byKey.__null__).toBe(1);
    expect(result.summary.total).toBe(3);
  });

  it("sums money in Postgres, not in TypeScript", async () => {
    const result = await run({
      type: "records_deals",
      groupBy: "deal_stage",
      measure: "deal_amount_sum",
    });
    const byKey = Object.fromEntries(
      result.summary.rows.map((r) => [r.key, r.value]),
    );
    // Qualifying: 500k + 250k + 9m (the restricted one is visible to an owner)
    expect(byKey.Qualifying).toBe(9_750_000);
    expect(byKey.Won).toBe(1_000_000);
  });

  it("applies a filter using the TYPE's own field registry", async () => {
    const open = await run({
      type: "records_deals",
      groupBy: "deal_stage",
      filter: [{ field: "deal_open", operator: "equals", value: "true" }],
    });
    expect(open.summary.rows.map((r) => r.key)).toEqual(["Qualifying"]);
  });

  it("counts an unattached follow-up, which has no record at all", async () => {
    // A report that dropped these would understate somebody's workload, which
    // is the one thing this report is for.
    const result = await run({
      type: "followups",
      groupBy: "task_assignee",
      filter: [{ field: "task_done", operator: "equals", value: "false" }],
    });
    const byKey = Object.fromEntries(
      result.summary.rows.map((r) => [r.key, r.value]),
    );
    expect(byKey["rep-a"]).toBe(2);
    expect(byKey["rep-b"]).toBeUndefined();
  });

  it("returns detail rows only when asked, and caps them", async () => {
    const without = await run({ type: "records", groupBy: "stage" });
    expect(without.detail).toEqual([]);

    const withDetail = await run({
      type: "records",
      groupBy: "stage",
      showDetail: true,
    });
    expect(withDetail.detail.length).toBe(3);
    expect(withDetail.detail.map((r) => r.title)).toContain("Acme Holdings");
  });

  describe("saved reports", () => {
    it("lists the built-ins with nothing saved, and refuses an unknown id", async () => {
      const listed = await withTenant(
        tenantId,
        (tx) => listReports(tx, tenantId, owner.userId),
        owner,
      );
      expect(listed.filter((r) => r.isBuiltIn).length).toBe(
        BUILT_IN_REPORTS.length,
      );

      // NULL rather than a fallback, unlike a view pin: a report id in a URL is
      // a specific thing somebody asked for, and quietly answering a different
      // question would be worse than a 404.
      const missing = await withTenant(
        tenantId,
        (tx) => resolveReport(tx, tenantId, owner.userId, "builtin:nope"),
        owner,
      );
      expect(missing).toBeNull();
    });

    it("A PRIVATE REPORT IS INVISIBLE TO A COLLEAGUE; a shared one is not", async () => {
      await withTenant(
        tenantId,
        async (tx) => {
          await createReport(tx, tenantId, owner.userId, {
            name: "My private question?",
            definition: { ...DEFAULT_DEFINITION, groupBy: "stage" },
            isShared: false,
          });
          await createReport(tx, tenantId, owner.userId, {
            name: "A team question?",
            definition: { ...DEFAULT_DEFINITION, groupBy: "kind" },
            isShared: true,
          });
        },
        owner,
      );

      const theirs = await withTenant(
        tenantId,
        (tx) => listReports(tx, tenantId, staff.userId),
        staff,
      );
      expect(theirs.filter((r) => !r.isBuiltIn).map((r) => r.name)).toEqual([
        "A team question?",
      ]);
    });

    it("a colleague cannot edit a shared report they can see", async () => {
      const theirs = await withTenant(
        tenantId,
        (tx) => listReports(tx, tenantId, staff.userId),
        staff,
      );
      const shared = theirs.find((r) => r.name === "A team question?")!;
      await expect(
        withTenant(
          tenantId,
          (tx) => updateReport(tx, tenantId, shared.id, { name: "Hijacked?" }),
          staff,
        ),
      ).rejects.toThrow();
    });

    it("BUT A TENANT OWNER MAY DELETE ONE, so a leaver's reports are not permanent", async () => {
      const listed = await withTenant(
        tenantId,
        (tx) => listReports(tx, tenantId, owner.userId),
        owner,
      );
      const shared = listed.find((r) => r.name === "A team question?")!;
      await withTenant(
        tenantId,
        (tx) => deleteReport(tx, tenantId, shared.id),
        { role: "owner", userId: "a-different-owner" },
      );
      const after = await withTenant(
        tenantId,
        (tx) => listReports(tx, tenantId, owner.userId),
        owner,
      );
      expect(after.map((r) => r.name)).not.toContain("A team question?");
    });

    it("a saved report still runs, and re-validates on the way out", async () => {
      const saved = await withTenant(
        tenantId,
        (tx) =>
          createReport(tx, tenantId, owner.userId, {
            name: "Runs from storage?",
            definition: { ...DEFAULT_DEFINITION, groupBy: "kind" },
            isShared: false,
          }),
        owner,
      );
      const resolved = await withTenant(
        tenantId,
        (tx) => resolveReport(tx, tenantId, owner.userId, saved.id),
        owner,
      );
      const result = await withTenant(
        tenantId,
        (tx) => runReport(tx, tenantId, resolved!.definition),
        owner,
      );
      expect(result.summary.total).toBe(3);
    });

    it("refuses a second report with the same name for one person", async () => {
      await expect(
        withTenant(
          tenantId,
          (tx) =>
            createReport(tx, tenantId, owner.userId, {
              name: "Runs from storage?",
              definition: DEFAULT_DEFINITION,
              isShared: false,
            }),
          owner,
        ),
      ).rejects.toThrow();
    });
  });

  it("A STAFF MEMBER'S REPORT OMITS A RESTRICTED RECORD'S DEALS", async () => {
    // The security assertion. Reports run in the caller's transaction, so RLS
    // has already removed what they may not see — two people running one report
    // legitimately get different totals, and the £90,000 job is not one of
    // staff's.
    const asOwner = await run({
      type: "records_deals",
      measure: "deal_amount_sum",
      groupBy: null,
    });
    const asStaff = await withTenant(
      tenantId,
      (tx) =>
        runReport(tx, tenantId, {
          ...DEFAULT_DEFINITION,
          type: "records_deals",
          measure: "deal_amount_sum",
          groupBy: null,
        }),
      staff,
    );

    expect(asOwner.summary.total).toBe(10_750_000);
    expect(asStaff.summary.total).toBe(1_750_000);
  });
});
