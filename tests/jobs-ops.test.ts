import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { withSystem, withTenant, schema, type Tx } from "../src/db";
import {
  JobsError,
  createContract,
  createCostCode,
  createCostCodeSet,
  createProject,
  getDefaultCostCodeSet,
  listContracts,
  projectValues,
  updateContract,
  updateCostCode,
  updateCostCodeSet,
  updateProject,
  type JobsCtx,
} from "../src/packs/jobs/ops";
import { PROJECT_DIMENSION } from "../src/packs/jobs/vocabulary";

/**
 * The `jobs` pack's write verbs, against a real database.
 *
 * **THIS IS THE FILE THE FIRST TWO SLICES DID NOT HAVE.** `tests/isolation/
 * jobs.test.ts` deliberately builds its fixtures under `withSystem` and never
 * calls `ops.ts`, because it certifies what the DATABASE enforces and routing
 * setup through the pack would let a bug in the pack make those tests agree with
 * it. That leaves the pack's own behaviour uncovered, and three of its rules are
 * invisible in the UI when they break:
 *
 *   - a project's COST OBJECT must follow its name, or a report groups by a name
 *     the job list no longer uses and two people reading two screens disagree;
 *   - cancelling a project must ARCHIVE that cost object and completing one must
 *     not, because bills arrive for months after a job finishes;
 *   - an edit must REFUSE a stale version, or two people on one job means the
 *     last save silently wins.
 *
 * None of those throw in the app. They just quietly produce the wrong answer.
 *
 * ── THE GATE IS DECLARED INLINE, AND THAT IS NOT STYLE ──────────────────────
 *
 * It is the same one `tests/isolation/_shared.ts` exports, but
 * `tests/db-backed-files.test.ts` classifies a suite as database-backed by
 * finding either this literal or a `d`/`RUN` import from a SIBLING `_shared`.
 * Importing it from `./isolation/_shared` type-checks, runs, and is invisible to
 * the classifier — so the suite would land in the PARALLEL project and race the
 * other database suites, which is a test that fails once a fortnight on a
 * machine nobody is watching. Found by that classifier failing, which is exactly
 * what it is for. The convention `tests/land-ops.test.ts` and its neighbours
 * follow.
 */
const RUN = !!process.env.DATABASE_URL;
const d = RUN ? describe : describe.skip;

d("jobs ops", () => {
  const STAMP = `ops-jobs-${process.pid}`;
  let tenantId = "";
  let entityId = "";
  let ctx: JobsCtx;
  let staffCtx: JobsCtx;

  const run = <T>(fn: (tx: Tx) => Promise<T>) =>
    withTenant(tenantId, fn, { role: "owner", userId: `${STAMP}-owner` });

  beforeAll(async () => {
    await withSystem(async (tx) => {
      const t = await tx
        .insert(schema.tenants)
        .values({ clerkOrgId: STAMP, name: "Ops Builder", slug: STAMP })
        .returning();
      tenantId = t[0].id;
      const e = await tx
        .insert(schema.entities)
        .values({ tenantId, name: "Ops Builder LLC", isDefault: true })
        .returning();
      entityId = e[0].id;
    });
    ctx = { tenantId, userId: `${STAMP}-owner`, role: "owner" };
    staffCtx = { tenantId, userId: `${STAMP}-mate`, role: "staff" };
  });

  afterAll(async () => {
    await withSystem(async (tx) => {
      await tx.delete(schema.tenants).where(inArray(schema.tenants.id, [tenantId]));
    });
  });

  const memberFor = (tx: Tx, projectId: string) =>
    tx
      .select()
      .from(schema.dimensionMembers)
      .where(
        and(
          eq(schema.dimensionMembers.tenantId, tenantId),
          eq(schema.dimensionMembers.dimensionType, PROJECT_DIMENSION),
          eq(schema.dimensionMembers.packEntityId, projectId),
        ),
      )
      .limit(1);

  it("creating a project makes it a cost object in the same transaction", async () => {
    const { project, member } = await run(async (tx) => {
      const project = await createProject(tx, ctx, {
        entityId,
        number: "OPS-1",
        name: "First job",
      });
      return { project, member: (await memberFor(tx, project.id))[0] };
    });
    expect(member).toBeDefined();
    expect(member.displayName).toBe("OPS-1 · First job");
    expect(member.isActive).toBe(true);
    expect(project.status).toBe("planned");
  });

  it("THE COST OBJECT FOLLOWS A RENAME", async () => {
    // Silent when it breaks: the job list says one thing, every report says
    // another, and nothing errors.
    const member = await run(async (tx) => {
      const p = await createProject(tx, ctx, {
        entityId,
        number: "OPS-2",
        name: "Before",
      });
      await updateProject(tx, ctx, p.id, { name: "After", number: "OPS-2b" });
      return (await memberFor(tx, p.id))[0];
    });
    expect(member.displayName).toBe("OPS-2b · After");
  });

  it("CANCELLING archives the cost object; COMPLETING does not", async () => {
    const { afterComplete, afterCancel, afterReopen } = await run(async (tx) => {
      const p = await createProject(tx, ctx, {
        entityId,
        number: "OPS-3",
        name: "Life",
      });
      await updateProject(tx, ctx, p.id, { status: "complete" });
      const afterComplete = (await memberFor(tx, p.id))[0].isActive;

      await updateProject(tx, ctx, p.id, { status: "cancelled" });
      const afterCancel = (await memberFor(tx, p.id))[0].isActive;

      await updateProject(tx, ctx, p.id, { status: "active" });
      const afterReopen = (await memberFor(tx, p.id))[0].isActive;
      return { afterComplete, afterCancel, afterReopen };
    });
    // A finished job still takes bills for months — retainage, the last
    // subcontractor invoice — so completing must NOT stop it being charged.
    expect(afterComplete).toBe(true);
    expect(afterCancel).toBe(false);
    // And un-cancelling puts it back, or the job is permanently uncostable.
    expect(afterReopen).toBe(true);
  });

  it("REFUSES a stale version rather than overwriting", async () => {
    await expect(
      run(async (tx) => {
        const p = await createProject(tx, ctx, {
          entityId,
          number: "OPS-4",
          name: "Contested",
        });
        // Somebody else saves first.
        await updateProject(tx, ctx, p.id, { name: "Theirs", version: p.version });
        // We still hold the version we read.
        await updateProject(tx, ctx, p.id, { name: "Ours", version: p.version });
      }),
    ).rejects.toMatchObject({ code: "STALE_VERSION" });
  });

  it("refuses a staff write, because a cost object needs an owner", async () => {
    await expect(
      withTenant(
        tenantId,
        (tx) =>
          createProject(tx, staffCtx, { entityId, number: "OPS-5", name: "Nope" }),
        { role: "staff", userId: `${STAMP}-mate` },
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("the FIRST cost code set becomes the default, and only one ever is", async () => {
    const { first, second, defaultAfter } = await run(async (tx) => {
      const first = await createCostCodeSet(tx, ctx, { name: "Ours" });
      const second = await createCostCodeSet(tx, ctx, { name: "CSI", isDefault: true });
      return {
        first,
        second,
        defaultAfter: await getDefaultCostCodeSet(tx, tenantId),
      };
    });
    expect(first.isDefault).toBe(true);
    expect(second.isDefault).toBe(true);
    // Promoting the second demoted the first, in the same transaction — the
    // partial unique index is the backstop, not the mechanism.
    expect(defaultAfter!.id).toBe(second.id);
  });

  it("a project takes the default set at creation and KEEPS it when the default moves", async () => {
    // Resolved once, never read through: a business that changes its default
    // must not silently re-chart a job already underway.
    const { projectSetId, movedTo } = await run(async (tx) => {
      const original = await getDefaultCostCodeSet(tx, tenantId);
      const p = await createProject(tx, ctx, {
        entityId,
        number: "OPS-6",
        name: "Charted",
      });
      const later = await createCostCodeSet(tx, ctx, {
        name: "Newer",
        isDefault: true,
      });
      expect(original).not.toBeNull();
      return { projectSetId: p.costCodeSetId, movedTo: later.id };
    });
    expect(projectSetId).not.toBeNull();
    expect(projectSetId).not.toBe(movedTo);
  });

  it("a retired cost code keeps its row, because deleting one loses history", async () => {
    const after = await run(async (tx) => {
      const set = await createCostCodeSet(tx, ctx, { name: "Retirable" });
      const code = await createCostCode(tx, ctx, {
        setId: set.id,
        code: "1000",
        name: "Sitework",
      });
      return updateCostCode(tx, ctx, code.id, { isActive: false });
    });
    expect(after.isActive).toBe(false);
    expect(after.code).toBe("1000");
  });

  it("renaming a list refuses a stale version", async () => {
    await expect(
      run(async (tx) => {
        const set = await createCostCodeSet(tx, ctx, { name: "Rename me" });
        await updateCostCodeSet(tx, ctx, set.id, {
          name: "Theirs",
          version: set.version,
        });
        await updateCostCodeSet(tx, ctx, set.id, {
          name: "Ours",
          version: set.version,
        });
      }),
    ).rejects.toMatchObject({ code: "STALE_VERSION" });
  });

  it("contracts keep the ladder's order, whatever the dates say", async () => {
    const kinds = await run(async (tx) => {
      const p = await createProject(tx, ctx, {
        entityId,
        number: "OPS-7",
        name: "Ladder",
      });
      // Agreed in this order; the drawings contract is SIGNED last on purpose.
      await createContract(tx, ctx, {
        projectId: p.id,
        kind: "concept_design",
        signedOn: "2026-01-05",
      });
      await createContract(tx, ctx, {
        projectId: p.id,
        kind: "construction_drawings",
        signedOn: "2026-09-01",
      });
      await createContract(tx, ctx, {
        projectId: p.id,
        kind: "new_home",
        signedOn: "2026-03-01",
      });
      return (await listContracts(tx, tenantId, p.id)).map((c) => c.kind);
    });
    expect(kinds).toEqual(["concept_design", "construction_drawings", "new_home"]);
  });

  it("ONLY SIGNED AND COMPLETE CONTRACTS COUNT toward a project's value", async () => {
    // The rule with a money consequence: a proposal is not revenue.
    const { value, projectId } = await run(async (tx) => {
      const p = await createProject(tx, ctx, {
        entityId,
        number: "OPS-8",
        name: "Worth",
      });
      await createContract(tx, ctx, {
        projectId: p.id,
        kind: "concept_design",
        valueCents: 1_250_000,
        status: "complete",
      });
      await createContract(tx, ctx, {
        projectId: p.id,
        kind: "new_home",
        valueCents: 184_200_000,
        status: "signed",
      });
      await createContract(tx, ctx, {
        projectId: p.id,
        kind: "change_order",
        valueCents: 9_500_000,
        status: "proposed",
      });
      await createContract(tx, ctx, {
        projectId: p.id,
        kind: "alternate",
        valueCents: 5_000_000,
        status: "declined",
      });
      return { value: (await projectValues(tx, tenantId)).get(p.id), projectId: p.id };
    });
    expect(projectId).toBeTruthy();
    expect(value!.valueCents).toBe(185_450_000);
    expect(value!.signedCount).toBe(2);
  });

  it("a contract edit refuses a stale version too", async () => {
    await expect(
      run(async (tx) => {
        const p = await createProject(tx, ctx, {
          entityId,
          number: "OPS-9",
          name: "Contested contract",
        });
        const c = await createContract(tx, ctx, { projectId: p.id, kind: "new_home" });
        await updateContract(tx, ctx, c.id, { status: "signed", version: c.version });
        await updateContract(tx, ctx, c.id, { status: "declined", version: c.version });
      }),
    ).rejects.toMatchObject({ code: "STALE_VERSION" });
  });

  it("refuses a billing method it cannot actually bill", async () => {
    await expect(
      run(async (tx) => {
        const p = await createProject(tx, ctx, {
          entityId,
          number: "OPS-10",
          name: "Bad method",
        });
        await createContract(tx, ctx, {
          projectId: p.id,
          kind: "new_home",
          billingMethod: "handshake",
        });
      }),
    ).rejects.toBeInstanceOf(JobsError);
  });
});
