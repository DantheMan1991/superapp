import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, isNull, ne } from "drizzle-orm";
import { withSystem, withTenant, schema } from "../src/db";
import { applyProfileSeed, seedSummary } from "../src/app/admin/profile-seed";
import { getIndustryProfile, industryRegistry } from "../src/industries";
import { packSeedAppliers } from "../src/packs/seeds";
import { CONSTRUCTION_COST_CODE_SETS } from "../src/industries/construction/cost-codes";
import { CONSTRUCTION_ESTIMATE_OUTLINES } from "../src/industries/construction/estimate-outlines";
import { COST_CODE_DIMENSION } from "../src/packs/jobs/vocabulary";
import { AGENCY_COA } from "../src/industries/agency/accounts";
import { GENERAL_COA } from "../src/modules/accounting/templates/general";
import { provisionAccounting } from "../src/modules/accounting/templates/apply";
import { provisionDocuments } from "../src/modules/documents/templates/apply";

/**
 * A profile's seed reaches the tenant (back-office slice 7a): the agency
 * profile's chart lands on top of the general one when Accounting is on,
 * waits when it is not, and a re-run adds nothing.
 */

const RUN = !!process.env.DATABASE_URL;
const d = RUN ? describe : describe.skip;
const STAMP = `profile-seed-test-${process.pid}`;
const agency = getIndustryProfile("agency")!;

let tenantId = "";

const CODE_COUNT = CONSTRUCTION_COST_CODE_SETS.reduce((n, s) => n + s.codes.length, 0);
const OUTLINE_COUNT = CONSTRUCTION_ESTIMATE_OUTLINES.length;
const STEP_COUNT = CONSTRUCTION_ESTIMATE_OUTLINES.reduce(
  (n, o) => n + o.steps.length,
  0,
);
/** What the outlines ask to be measured before they start asking (X7). */
const MEASURE_COUNT = CONSTRUCTION_ESTIMATE_OUTLINES.reduce(
  (n, o) => n + (o.measures?.length ?? 0),
  0,
);

d("profile seed", () => {
  beforeAll(async () => {
    tenantId = await withSystem(async (tx) => {
      const [row] = await tx
        .insert(schema.tenants)
        .values({ clerkOrgId: STAMP, name: `${STAMP} Studio`, slug: STAMP })
        .returning({ id: schema.tenants.id });
      return row.id;
    });
  });

  afterAll(async () => {
    await withSystem((tx) =>
      tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantId)),
    );
  });

  it("says what it would contribute", () => {
    expect(seedSummary(agency)).toEqual({
      accounts: AGENCY_COA.accounts.length,
      folders: 2,
      packs: [],
    });
  });

  it("waits for a module that is off, and loses nothing", async () => {
    const report = await applyProfileSeed(tenantId, agency, [], STAMP);
    expect(report).toEqual({
      accountsCreated: 0,
      foldersCreated: 0,
      packs: [],
      waitingOn: ["accounting", "documents"],
    });
    const accounts = await withSystem((tx) =>
      tx.select({ id: schema.accounts.id }).from(schema.accounts).where(eq(schema.accounts.tenantId, tenantId)),
    );
    expect(accounts).toHaveLength(0);
  });

  it("lands the chart on top of the general one, parents resolved, once", async () => {
    // What switching Accounting on does first: the general chart.
    await withTenant(tenantId, (tx) => provisionAccounting(tx, tenantId));

    const first = await applyProfileSeed(tenantId, agency, ["accounting"], STAMP);
    expect(first.accountsCreated).toBe(AGENCY_COA.accounts.length);
    expect(first.waitingOn).toEqual(["documents"]);

    const rows = await withSystem((tx) =>
      tx
        .select({
          code: schema.accounts.code,
          name: schema.accounts.name,
          parentId: schema.accounts.parentId,
        })
        .from(schema.accounts)
        .where(eq(schema.accounts.tenantId, tenantId)),
    );
    const byCode = new Map(rows.map((r) => [r.code, r]));
    expect(rows).toHaveLength(GENERAL_COA.accounts.length + AGENCY_COA.accounts.length);
    // The general chart is untouched, and a profile account that names a
    // general parent hangs under it.
    expect(byCode.get("4010")?.name).toBe("Service Revenue");
    const sales = await withSystem((tx) =>
      tx.query.accounts.findFirst({
        where: and(eq(schema.accounts.tenantId, tenantId), eq(schema.accounts.code, "4000")),
        columns: { id: true },
      }),
    );
    expect(byCode.get("4030")?.parentId).toBe(sales!.id);
    expect(byCode.get("1220")?.parentId).toBeNull();

    // Re-run: nothing to add.
    const again = await applyProfileSeed(tenantId, agency, ["accounting"], STAMP);
    expect(again.accountsCreated).toBe(0);
  });

  it("keeps the tenant's own account when a code is already theirs", async () => {
    // A tenant that already numbered something 6320 keeps it, name and all.
    await withSystem(async (tx) => {
      await tx.delete(schema.accounts).where(
        and(eq(schema.accounts.tenantId, tenantId), eq(schema.accounts.code, "6320")),
      );
      await tx.insert(schema.accounts).values({
        tenantId,
        code: "6320",
        name: "Conferences",
        accountType: "expense",
        subtype: "operating_expense",
      });
    });
    const report = await applyProfileSeed(tenantId, agency, ["accounting"], STAMP);
    expect(report.accountsCreated).toBe(0);
    const kept = await withSystem((tx) =>
      tx.query.accounts.findFirst({
        where: and(eq(schema.accounts.tenantId, tenantId), eq(schema.accounts.code, "6320")),
        columns: { name: true },
      }),
    );
    expect(kept?.name).toBe("Conferences");
  });

  it("adds its folders beside the platform's starter cabinet, once", async () => {
    await withSystem((tx) => provisionDocuments(tx, tenantId));
    const first = await applyProfileSeed(tenantId, agency, ["accounting", "documents"], STAMP);
    expect(first.foldersCreated).toBe(2);
    expect(first.waitingOn).toEqual([]);

    const roots = await withSystem((tx) =>
      tx
        .select({ name: schema.documentFolders.name })
        .from(schema.documentFolders)
        .where(and(eq(schema.documentFolders.tenantId, tenantId), isNull(schema.documentFolders.parentId))),
    );
    const names = roots.map((r) => r.name);
    expect(names).toContain("Clients");
    expect(names).toContain("Proposals");
    expect(names).toContain("Contracts");

    const again = await applyProfileSeed(tenantId, agency, ["documents"], STAMP);
    expect(again.foldersCreated).toBe(0);
  });
});

/**
 * The construction profile's seed into a PACK's tables (ADR 0057): two starter
 * cost code lists land through the applier the `jobs` pack registers, every
 * code a cost object, the first list the default — and a re-run adds nothing,
 * and a list the tenant already has by that name is left exactly as it is.
 */
d("a pack seed (construction → jobs)", () => {
  const construction = getIndustryProfile("construction")!;
  const CO_STAMP = `profile-seed-co-${process.pid}`;
  let coTenant = "";

  beforeAll(async () => {
    coTenant = await withSystem(async (tx) => {
      const [row] = await tx
        .insert(schema.tenants)
        .values({ clerkOrgId: CO_STAMP, name: `${CO_STAMP} Builders`, slug: CO_STAMP })
        .returning({ id: schema.tenants.id });
      return row.id;
    });
  });

  afterAll(async () => {
    await withSystem((tx) =>
      tx.delete(schema.tenants).where(eq(schema.tenants.id, coTenant)),
    );
  });

  it("every pack a profile seeds has registered an applier", () => {
    // A key with no applier is silently nothing to do at install, so the
    // configuration error has to be caught here instead.
    for (const profile of Object.values(industryRegistry)) {
      for (const slug of Object.keys(profile.seed?.packs ?? {})) {
        expect(packSeedAppliers[slug], `${profile.slug} seeds ${slug}`).toBeDefined();
      }
    }
  });

  it("says what the pack seed would bring, in the pack's words", () => {
    expect(seedSummary(construction).packs).toEqual([
      `2 cost code lists (${CODE_COUNT} codes), ${OUTLINE_COUNT} estimate outlines ` +
        `(${STEP_COUNT} steps, ${MEASURE_COUNT} measurements)`,
    ]);
  });

  it("waits for the pack when it is off", async () => {
    const report = await applyProfileSeed(coTenant, construction, [], CO_STAMP);
    expect(report.packs).toEqual([]);
    expect(report.waitingOn).toContain("jobs");
    const sets = await withSystem((tx) =>
      tx.select({ id: schema.jobCostCodeSets.id }).from(schema.jobCostCodeSets).where(eq(schema.jobCostCodeSets.tenantId, coTenant)),
    );
    expect(sets).toHaveLength(0);
    const outlines = await withSystem((tx) =>
      tx.select({ id: schema.jobEstimateOutlines.id }).from(schema.jobEstimateOutlines).where(eq(schema.jobEstimateOutlines.tenantId, coTenant)),
    );
    expect(outlines).toHaveLength(0);
  });

  it("lands both lists, every code a cost object, the first one the default — once", async () => {
    const first = await applyProfileSeed(coTenant, construction, ["jobs"], CO_STAMP);
    expect(first.packs).toEqual([
      {
        slug: "jobs",
        created: 2 + OUTLINE_COUNT,
        description:
          `2 cost code lists with ${CODE_COUNT} codes and ` +
          `${OUTLINE_COUNT} estimate outlines with ${STEP_COUNT} steps ` +
          `and ${MEASURE_COUNT} measurements`,
      },
    ]);
    expect(first.waitingOn).not.toContain("jobs");

    const { sets, codes, members } = await withSystem(async (tx) => ({
      sets: await tx
        .select()
        .from(schema.jobCostCodeSets)
        .where(eq(schema.jobCostCodeSets.tenantId, coTenant)),
      codes: await tx
        .select({ id: schema.jobCostCodes.id, setId: schema.jobCostCodes.setId, sortOrder: schema.jobCostCodes.sortOrder })
        .from(schema.jobCostCodes)
        .where(eq(schema.jobCostCodes.tenantId, coTenant)),
      members: await tx
        .select({ packEntityId: schema.dimensionMembers.packEntityId })
        .from(schema.dimensionMembers)
        .where(
          and(
            eq(schema.dimensionMembers.tenantId, coTenant),
            eq(schema.dimensionMembers.dimensionType, COST_CODE_DIMENSION),
          ),
        ),
    }));
    expect(sets.map((s) => s.name).sort()).toEqual(
      CONSTRUCTION_COST_CODE_SETS.map((s) => s.name).sort(),
    );
    // Residential first in the manifest, so it is the default; one default only.
    expect(sets.filter((s) => s.isDefault).map((s) => s.name)).toEqual(["Residential phases"]);
    expect(codes).toHaveLength(CODE_COUNT);
    // THE POINT OF GOING THROUGH THE PACK: every seeded code is chargeable.
    expect(new Set(members.map((m) => m.packEntityId))).toEqual(new Set(codes.map((c) => c.id)));
    // In manifest order, not insertion luck.
    const residential = sets.find((s) => s.name === "Residential phases")!;
    const orders = codes.filter((c) => c.setId === residential.id).map((c) => c.sortOrder);
    expect(orders).toEqual([...orders].sort((a, b) => a - b));

    const again = await applyProfileSeed(coTenant, construction, ["jobs"], CO_STAMP);
    expect(again.packs).toEqual([]);
  });

  it("leaves a list the tenant already has by that name exactly as it is", async () => {
    // Prune the CSI list to one code, re-run: the other twenty-two must not come back.
    const csi = await withSystem(async (tx) => {
      const [set] = await tx
        .select({ id: schema.jobCostCodeSets.id })
        .from(schema.jobCostCodeSets)
        .where(and(eq(schema.jobCostCodeSets.tenantId, coTenant), eq(schema.jobCostCodeSets.name, "CSI divisions")));
      const kept = await tx
        .select({ id: schema.jobCostCodes.id })
        .from(schema.jobCostCodes)
        .where(and(eq(schema.jobCostCodes.tenantId, coTenant), eq(schema.jobCostCodes.setId, set.id)))
        .limit(1);
      await tx
        .delete(schema.dimensionMembers)
        .where(and(eq(schema.dimensionMembers.tenantId, coTenant), eq(schema.dimensionMembers.dimensionType, COST_CODE_DIMENSION)));
      await tx
        .delete(schema.jobCostCodes)
        .where(and(eq(schema.jobCostCodes.setId, set.id), ne(schema.jobCostCodes.id, kept[0].id)));
      return set.id;
    });
    const report = await applyProfileSeed(coTenant, construction, ["jobs"], CO_STAMP);
    expect(report.packs).toEqual([]);
    const left = await withSystem((tx) =>
      tx.select({ id: schema.jobCostCodes.id }).from(schema.jobCostCodes).where(eq(schema.jobCostCodes.setId, csi)),
    );
    expect(left).toHaveLength(1);
  });

  /**
   * THE SECOND PACK SEED (X1, ADR 0098): the starter estimate outlines, by the
   * same three rules. The tree is what makes this worth its own test — an
   * outline is three tables deep, so "created" is easy to report and hard to
   * actually write.
   */
  it("lands both outlines whole, new build the default, questions and all", async () => {
    const { outlines, steps, questions, measures } = await withSystem(async (tx) => ({
      outlines: await tx
        .select()
        .from(schema.jobEstimateOutlines)
        .where(eq(schema.jobEstimateOutlines.tenantId, coTenant)),
      steps: await tx
        .select()
        .from(schema.jobEstimateOutlineSteps)
        .where(eq(schema.jobEstimateOutlineSteps.tenantId, coTenant)),
      questions: await tx
        .select()
        .from(schema.jobEstimateOutlineQuestions)
        .where(eq(schema.jobEstimateOutlineQuestions.tenantId, coTenant)),
      measures: await tx
        .select()
        .from(schema.jobEstimateOutlineMeasures)
        .where(eq(schema.jobEstimateOutlineMeasures.tenantId, coTenant)),
    }));

    expect(outlines.map((o) => o.name).sort()).toEqual(
      CONSTRUCTION_ESTIMATE_OUTLINES.map((o) => o.name).sort(),
    );
    // New build is first in the manifest, so it is the default; one default only.
    expect(outlines.filter((o) => o.isDefault).map((o) => o.name)).toEqual(["New build"]);
    expect(steps).toHaveLength(STEP_COUNT);
    /**
     * **THE MEASURE-UP LIST LANDS TOO** (X7). It is written after the outline
     * rather than inside `createOutline`, which is exactly the kind of extra
     * step that gets counted in a sentence and never actually written.
     */
    expect(measures).toHaveLength(MEASURE_COUNT);
    expect(measures.filter((m) => m.required).length).toBeGreaterThan(0);
    for (const m of measures) {
      expect(["length", "area", "count"]).toContain(m.kind);
      expect(m.name.trim()).not.toBe("");
    }
    expect(questions).toHaveLength(
      CONSTRUCTION_ESTIMATE_OUTLINES.reduce(
        (n, o) => n + o.steps.reduce((m, st) => m + (st.questions?.length ?? 0), 0),
        0,
      ),
    );

    // In manifest order, not insertion luck — the walk is the point of it.
    const newBuild = outlines.find((o) => o.name === "New build")!;
    const walk = steps
      .filter((s) => s.outlineId === newBuild.id)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((s) => s.title);
    expect(walk).toEqual(
      CONSTRUCTION_ESTIMATE_OUTLINES.find((o) => o.name === "New build")!.steps.map(
        (s) => s.title,
      ),
    );

    // A choice arrived as a choice, with its options, through the jsonb.
    const foundation = steps.find(
      (s) => s.outlineId === newBuild.id && s.title === "Foundation",
    )!;
    const asked = questions
      .filter((q) => q.stepId === foundation.id)
      .sort((a, b) => a.sortOrder - b.sortOrder);
    expect(asked[0].kind).toBe("choice");
    expect(asked[0].choices).toEqual([
      "In-house",
      "Bidding it out",
      "By others",
      "Not on this job",
    ]);
    expect(foundation.costCode).toBe("2000");
  });

  it("leaves an outline the tenant has pruned exactly as it is", async () => {
    // Cut the remodel down to one step, re-run: the rest must not come back.
    const remodel = await withSystem(async (tx) => {
      const [row] = await tx
        .select({ id: schema.jobEstimateOutlines.id })
        .from(schema.jobEstimateOutlines)
        .where(
          and(
            eq(schema.jobEstimateOutlines.tenantId, coTenant),
            eq(schema.jobEstimateOutlines.name, "Remodel"),
          ),
        );
      const kept = await tx
        .select({ id: schema.jobEstimateOutlineSteps.id })
        .from(schema.jobEstimateOutlineSteps)
        .where(eq(schema.jobEstimateOutlineSteps.outlineId, row.id))
        .limit(1);
      await tx
        .delete(schema.jobEstimateOutlineSteps)
        .where(
          and(
            eq(schema.jobEstimateOutlineSteps.outlineId, row.id),
            ne(schema.jobEstimateOutlineSteps.id, kept[0].id),
          ),
        );
      return row.id;
    });

    const report = await applyProfileSeed(coTenant, construction, ["jobs"], CO_STAMP);
    expect(report.packs).toEqual([]);
    const left = await withSystem((tx) =>
      tx
        .select({ id: schema.jobEstimateOutlineSteps.id })
        .from(schema.jobEstimateOutlineSteps)
        .where(eq(schema.jobEstimateOutlineSteps.outlineId, remodel)),
    );
    expect(left).toHaveLength(1);
  });
});
