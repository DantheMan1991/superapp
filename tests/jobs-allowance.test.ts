import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { withSystem, withTenant, schema, type Tx } from "../src/db";
import { createContract, createProject, type JobsCtx } from "../src/packs/jobs/ops";
import {
  acceptEstimate,
  createEstimate,
  proposalData,
  updateEstimate,
} from "../src/packs/jobs/estimating-ops";
import { listSelections } from "../src/packs/jobs/selections-ops";
import { buildProposalModel } from "../src/packs/jobs/proposal-model";
import { proposalInputFrom } from "../src/packs/jobs/proposal";

/**
 * AN ALLOWANCE ITEM BECOMES A SELECTION (X12).
 *
 * The founder: *"we ususaly have some items listed as an allowance. things
 * like plumbing fixtures etc."* and, on what the number is:
 * *"the allowance is a cost we mark up like everything else."*
 *
 * The second quote is the whole test. The machinery for reconciling an
 * allowance has been in the pack since slice 8 (ADR 0067); what it never had
 * was a way to start from the estimate, and what it must never do is start
 * from the COST — that would understate every allowance by the margin and
 * make a later change order compare a price against a cost.
 */

const RUN = !!process.env.DATABASE_URL;
const d = RUN ? describe : describe.skip;
const STAMP = `allowance-test-${process.pid}`;

let tenantId = "";
let entityId = "";
let ctx: JobsCtx;

d("an allowance item on an accepted estimate", () => {
  const run = <T>(fn: (tx: Tx) => Promise<T>) =>
    withTenant(tenantId, fn, { role: "owner", userId: `${STAMP}-owner` });

  beforeAll(async () => {
    await withSystem(async (tx) => {
      const t = await tx
        .insert(schema.tenants)
        .values({ clerkOrgId: STAMP, name: `${STAMP} Homes`, slug: STAMP })
        .returning();
      tenantId = t[0].id;
      const e = await tx
        .insert(schema.entities)
        .values({ tenantId, name: `${STAMP} LLC`, isDefault: true })
        .returning();
      entityId = e[0].id;
    });
    ctx = { tenantId, userId: `${STAMP}-owner`, role: "owner" };
  });

  afterAll(async () => {
    await withSystem((tx) => tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantId)));
  });

  /**
   * Two items at 10% markup, 10% overhead and 10% profit, so the allowance's
   * own price is a figure that can be checked by hand rather than by running
   * the code the assertion is about.
   */
  let seq = 0;
  async function bid() {
    const n = (seq += 1);
    return run(async (tx) => {
      const project = await createProject(tx, ctx, {
        entityId,
        number: `${STAMP}-${n}`,
        name: "Allowance house",
      });
      const contract = await createContract(tx, ctx, {
        projectId: project.id,
        kind: "construction",
        signedOn: "2026-09-01",
      });
      const estimate = await createEstimate(tx, ctx, {
        projectId: project.id,
        number: "EST-A1",
        markupPpm: 100_000,
        overheadPpm: 100_000,
        profitPpm: 100_000,
      });
      await updateEstimate(tx, ctx, estimate.id, {
        groups: [
          { key: "fixtures", name: "Plumbing fixtures", isAllowance: true, clientNote: "Chosen by you." },
          { key: "framing", name: "Framing" },
        ],
        lines: [
          { groupRef: "fixtures", description: "Fixtures, allowance", unitCostCents: 1_000_000 },
          { groupRef: "framing", description: "Framing labour", unitCostCents: 4_000_000 },
        ],
      });
      return { project, contract, estimate };
    });
  }

  /**
   * **THE CLIENT HAS TO BE ABLE TO SEE IT**, or the flag is bookkeeping.
   * Driven through the real chain — the stored rows, `proposalInputFrom` and
   * the model the renderers print — because that is where a field gets
   * dropped on the way out.
   */
  it("says so where the client reads it", async () => {
    const { estimate } = await bid();
    const data = await run((tx) => proposalData(tx, ctx.tenantId, estimate.id));
    const input = proposalInputFrom(data!, {
      businessName: `${STAMP} Homes`,
      tagline: "",
      primaryColor: null,
      logo: null,
    });
    expect(input.groups?.find((g) => g.name === "Plumbing fixtures")?.isAllowance).toBe(true);

    const model = buildProposalModel({ ...input, presentation: "groups" });
    const descriptions = model.price.rows.map((r) => r.description);
    expect(descriptions).toContain("Plumbing fixtures (allowance)");
    /** And a firm price is left alone — the marker has to mean something. */
    expect(descriptions).toContain("Framing");
  });

  /**
   * **THE FIGURE IS THE PRICE.** $10,000 of cost at 10% markup is $11,000,
   * and its share of 10% overhead and 10% profit takes it to $13,310 — which
   * is what the client signed for and therefore what they are held to.
   * Taking the cost would have written $10,000 and quietly given away the
   * margin on every allowance in the job.
   */
  it("becomes a selection at the marked-up price, linked by id", async () => {
    const { project, contract, estimate } = await bid();
    await run((tx) => updateEstimate(tx, ctx, estimate.id, { status: "sent", sentOn: "2026-09-10" }));
    await run((tx) =>
      acceptEstimate(tx, ctx, estimate.id, { contractId: contract.id, decidedOn: "2026-09-14" }),
    );

    const selections = await run((tx) => listSelections(tx, ctx.tenantId, project.id, "2026-09-14"));
    expect(selections).toHaveLength(1);
    const made = selections[0].selection;
    expect(made.name).toBe("Plumbing fixtures");
    expect(made.allowanceCents).toBe(13_310_00);
    expect(made.contractId).toBe(contract.id);
    expect(made.status).toBe("pending");
    expect(made.description).toBe("Chosen by you.");

    /** By id, never by name: a builder renames an allowance, and two jobs share one. */
    const group = await run((tx) =>
      tx
        .select()
        .from(schema.jobEstimateGroups)
        .where(eq(schema.jobEstimateGroups.estimateId, estimate.id)),
    );
    expect(made.estimateGroupId).toBe(group.find((g) => g.isAllowance)!.id);
  });

  it("makes nothing at all for an estimate with no allowance on it", async () => {
    const { project, contract, estimate } = await run(async (tx) => {
      const project = await createProject(tx, ctx, {
        entityId,
        number: `${STAMP}-none`,
        name: "Firm price house",
      });
      const contract = await createContract(tx, ctx, {
        projectId: project.id,
        kind: "construction",
        signedOn: "2026-09-01",
      });
      const estimate = await createEstimate(tx, ctx, { projectId: project.id, number: "EST-A2" });
      await updateEstimate(tx, ctx, estimate.id, {
        groups: [{ key: "g", name: "Everything" }],
        lines: [{ groupRef: "g", description: "The job", unitCostCents: 1_000_000 }],
      });
      return { project, contract, estimate };
    });
    await run((tx) =>
      acceptEstimate(tx, ctx, estimate.id, { contractId: contract.id, decidedOn: "2026-09-14" }),
    );
    expect(await run((tx) => listSelections(tx, ctx.tenantId, project.id, "2026-09-14"))).toEqual([]);
  });
});
