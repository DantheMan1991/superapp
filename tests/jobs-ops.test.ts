import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { withSystem, withTenant, schema, type Tx } from "../src/db";
import {
  JobsError,
  committedTotals,
  createCommitment,
  createContract,
  createCostCode,
  createCostCodeSet,
  createProject,
  getDefaultCostCodeSet,
  listContracts,
  projectValues,
  jobCostRows,
  listCommitments,
  setBudgetLines,
  updateCommitment,
  updateContract,
  updateCostCode,
  updateCostCodeSet,
  updateProject,
  type JobsCtx,
} from "../src/packs/jobs/ops";
import {
  COST_CODE_DIMENSION,
  PROJECT_DIMENSION,
} from "../src/packs/jobs/vocabulary";
import { listDimensionMembers } from "../src/modules/accounting/core";

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

  /** A commitment needs somebody to pay — see the schema header. */
  let vendorSeq = 0;
  const seedVendor = async (tx: Tx, name: string): Promise<string> => {
    const rows = await tx
      .insert(schema.parties)
      .values({
        tenantId,
        displayName: `${name} ${(vendorSeq += 1)}`,
        kind: "organization",
      })
      .returning();
    return rows[0].id;
  };

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

  it("a cost code becomes a cost object, and its retirement follows", async () => {
    /*
     * The reason this slice exists at all: once a code is a dimension member, a
     * bill line can be charged to it and every accounting report can group by it
     * — with no change in accounting, because the bill builder derives the types
     * it offers from whatever members exist.
     */
    const { onCreate, onRename, onRetire, onRestore } = await run(async (tx) => {
      const set = await createCostCodeSet(tx, ctx, { name: "Dim codes" });
      const code = await createCostCode(tx, ctx, {
        setId: set.id,
        code: "06 10 00",
        name: "Rough carpentry",
      });
      const memberOf = async () => {
        const all = await listDimensionMembers(tx, tenantId, COST_CODE_DIMENSION);
        return all.find((m) => m.packEntityId === code.id)!;
      };
      const onCreate = await memberOf();
      await updateCostCode(tx, ctx, code.id, { code: "06 11 00" });
      const onRename = await memberOf();
      await updateCostCode(tx, ctx, code.id, { isActive: false });
      const onRetire = await memberOf();
      await updateCostCode(tx, ctx, code.id, { isActive: true });
      const onRestore = await memberOf();
      return { onCreate, onRename, onRetire, onRestore };
    });
    expect(onCreate.displayName).toBe("06 10 00 · Rough carpentry");
    expect(onCreate.isActive).toBe(true);
    // A renumbered code must not leave reports grouping by the old number.
    expect(onRename.displayName).toBe("06 11 00 · Rough carpentry");
    // A retired code stops being offered; what is charged to it keeps reporting.
    expect(onRetire.isActive).toBe(false);
    expect(onRestore.isActive).toBe(true);
  });

  it("ONLY ISSUED AND CLOSED ORDERS COUNT as committed", async () => {
    // The same shape of rule as a proposed contract not being revenue: a draft
    // order has not been sent, so nobody is owed anything.
    const { byProject, byCostCode, codeId } = await run(async (tx) => {
      const p = await createProject(tx, ctx, {
        entityId,
        number: "OPS-C1",
        name: "Committed",
      });
      const set = await createCostCodeSet(tx, ctx, { name: "C1 codes" });
      const code = await createCostCode(tx, ctx, {
        setId: set.id,
        code: "03 30 00",
        name: "Concrete",
      });
      const party = await seedVendor(tx, "Valley Concrete");

      await createCommitment(tx, ctx, {
        projectId: p.id,
        partyId: party,
        number: "PO-1",
        status: "issued",
        lines: [{ costCodeId: code.id, amountCents: 4_000_00 }],
      });
      await createCommitment(tx, ctx, {
        projectId: p.id,
        partyId: party,
        number: "PO-2",
        status: "closed",
        lines: [{ costCodeId: code.id, amountCents: 1_000_00 }],
      });
      await createCommitment(tx, ctx, {
        projectId: p.id,
        partyId: party,
        number: "PO-3",
        status: "draft",
        lines: [{ costCodeId: code.id, amountCents: 9_999_00 }],
      });
      await createCommitment(tx, ctx, {
        projectId: p.id,
        partyId: party,
        number: "PO-4",
        status: "cancelled",
        lines: [{ costCodeId: code.id, amountCents: 7_777_00 }],
      });
      const totals = await committedTotals(tx, tenantId);
      return {
        byProject: totals.byProject.get(p.id),
        byCostCode: totals.byCostCode.get(code.id),
        codeId: code.id,
      };
    });
    expect(codeId).toBeTruthy();
    // 4,000 + 1,000 only. The draft and the cancelled one are not money.
    expect(byProject).toBe(5_000_00);
    expect(byCostCode).toBe(5_000_00);
  });

  it("sums a multi-line subcontract across its cost codes", async () => {
    const { total, labour, material } = await run(async (tx) => {
      const p = await createProject(tx, ctx, {
        entityId,
        number: "OPS-C2",
        name: "Framing",
      });
      const set = await createCostCodeSet(tx, ctx, { name: "C2 codes" });
      const lab = await createCostCode(tx, ctx, {
        setId: set.id,
        code: "06 10 10",
        name: "Framing labour",
      });
      const mat = await createCostCode(tx, ctx, {
        setId: set.id,
        code: "06 10 20",
        name: "Framing material",
      });
      const party = await seedVendor(tx, "Hill Framing");
      await createCommitment(tx, ctx, {
        projectId: p.id,
        partyId: party,
        kind: "subcontract",
        number: "SC-1",
        status: "issued",
        lines: [
          { costCodeId: lab.id, amountCents: 62_000_00 },
          { costCodeId: mat.id, amountCents: 38_500_00 },
        ],
      });
      const totals = await committedTotals(tx, tenantId);
      return {
        total: totals.byProject.get(p.id),
        labour: totals.byCostCode.get(lab.id),
        material: totals.byCostCode.get(mat.id),
      };
    });
    expect(total).toBe(100_500_00);
    expect(labour).toBe(62_000_00);
    expect(material).toBe(38_500_00);
  });

  it("REFUSES a commitment with no lines", async () => {
    // It would sit on the project looking like an order and add nothing to what
    // the job owes, which is worse than a refusal.
    await expect(
      run(async (tx) => {
        const p = await createProject(tx, ctx, {
          entityId,
          number: "OPS-C3",
          name: "Empty",
        });
        const party = await seedVendor(tx, "Nobody Supply");
        await createCommitment(tx, ctx, {
          projectId: p.id,
          partyId: party,
          number: "PO-EMPTY",
          lines: [],
        });
      }),
    ).rejects.toMatchObject({ code: "NO_LINES" });
  });

  it("REPLACES lines on edit rather than merging them", async () => {
    const after = await run(async (tx) => {
      const p = await createProject(tx, ctx, {
        entityId,
        number: "OPS-C4",
        name: "Replaced",
      });
      const party = await seedVendor(tx, "Swap Supply");
      const c = await createCommitment(tx, ctx, {
        projectId: p.id,
        partyId: party,
        number: "PO-SWAP",
        status: "issued",
        lines: [{ amountCents: 1_00 }, { amountCents: 2_00 }, { amountCents: 3_00 }],
      });
      await updateCommitment(tx, ctx, c.id, {
        lines: [{ amountCents: 10_00 }],
        version: c.version,
      });
      const rows = await listCommitments(tx, tenantId, p.id);
      return rows[0];
    });
    expect(after.lines).toHaveLength(1);
    expect(after.totalCents).toBe(10_00);
  });

  it("leaves the lines alone when an edit does not mention them", async () => {
    // A status change must not disturb the money.
    const after = await run(async (tx) => {
      const p = await createProject(tx, ctx, {
        entityId,
        number: "OPS-C5",
        name: "Untouched",
      });
      const party = await seedVendor(tx, "Steady Supply");
      const c = await createCommitment(tx, ctx, {
        projectId: p.id,
        partyId: party,
        number: "PO-STEADY",
        status: "draft",
        lines: [{ amountCents: 55_00 }, { amountCents: 45_00 }],
      });
      await updateCommitment(tx, ctx, c.id, {
        status: "issued",
        version: c.version,
      });
      const rows = await listCommitments(tx, tenantId, p.id);
      return rows[0];
    });
    expect(after.lines).toHaveLength(2);
    expect(after.totalCents).toBe(100_00);
    expect(after.commitment.status).toBe("issued");
  });

  it("refuses a negative committed amount", async () => {
    await expect(
      run(async (tx) => {
        const p = await createProject(tx, ctx, {
          entityId,
          number: "OPS-C6",
          name: "Negative",
        });
        const party = await seedVendor(tx, "Credit Supply");
        await createCommitment(tx, ctx, {
          projectId: p.id,
          partyId: party,
          number: "PO-NEG",
          lines: [{ amountCents: -100 }],
        });
      }),
    ).rejects.toMatchObject({ code: "INVALID_VALUE" });
  });

  it("a budget is one line per code, and a second write is an EDIT", async () => {
    // Two rows for one code would make every variance ambiguous and every total
    // quietly wrong, so the unique index is the mechanism rather than a backstop.
    const { first, second, count } = await run(async (tx) => {
      const p = await createProject(tx, ctx, {
        entityId,
        number: "OPS-B1",
        name: "Budgeted",
      });
      const set = await createCostCodeSet(tx, ctx, { name: "B1 codes" });
      const code = await createCostCode(tx, ctx, {
        setId: set.id,
        code: "06 10 00",
        name: "Carpentry",
      });
      const first = await setBudgetLines(tx, ctx, p.id, [
        { costCodeId: code.id, originalCents: 50_000_00 },
      ]);
      const second = await setBudgetLines(tx, ctx, p.id, [
        { costCodeId: code.id, originalCents: 55_000_00 },
      ]);
      const rows = await tx
        .select()
        .from(schema.jobBudgetLines)
        .where(eq(schema.jobBudgetLines.projectId, p.id));
      return { first: first[0], second: second[0], count: rows.length };
    });
    expect(first.originalCents).toBe(50_000_00);
    expect(second.originalCents).toBe(55_000_00);
    expect(second.id).toBe(first.id);
    expect(count).toBe(1);
  });

  it("LEAVES A CODE ALONE when a save does not mention it", async () => {
    /*
     * The difference from a commitment's lines, which are replaced. A budget is
     * built up over weeks by different people; replacing it would make "I added
     * the concrete number" quietly delete everything typed since.
     */
    const rows = await run(async (tx) => {
      const p = await createProject(tx, ctx, {
        entityId,
        number: "OPS-B2",
        name: "Incremental",
      });
      const set = await createCostCodeSet(tx, ctx, { name: "B2 codes" });
      const a = await createCostCode(tx, ctx, {
        setId: set.id,
        code: "03 30 00",
        name: "Concrete",
      });
      const b = await createCostCode(tx, ctx, {
        setId: set.id,
        code: "06 10 00",
        name: "Carpentry",
      });
      await setBudgetLines(tx, ctx, p.id, [
        { costCodeId: a.id, originalCents: 10_000_00 },
        { costCodeId: b.id, originalCents: 20_000_00 },
      ]);
      // A later save that only mentions one of them.
      await setBudgetLines(tx, ctx, p.id, [
        { costCodeId: a.id, originalCents: 11_000_00 },
      ]);
      return tx
        .select()
        .from(schema.jobBudgetLines)
        .where(eq(schema.jobBudgetLines.projectId, p.id));
    });
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.originalCents === 11_000_00)).toBeDefined();
    // The untouched one survived.
    expect(rows.find((r) => r.originalCents === 20_000_00)).toBeDefined();
  });

  it("refuses a negative budget", async () => {
    await expect(
      run(async (tx) => {
        const p = await createProject(tx, ctx, {
          entityId,
          number: "OPS-B3",
          name: "Negative",
        });
        const set = await createCostCodeSet(tx, ctx, { name: "B3 codes" });
        const code = await createCostCode(tx, ctx, {
          setId: set.id,
          code: "01",
          name: "X",
        });
        await setBudgetLines(tx, ctx, p.id, [
          { costCodeId: code.id, originalCents: -1 },
        ]);
      }),
    ).rejects.toMatchObject({ code: "INVALID_VALUE" });
  });

  it("THE JOB COST REPORT shows budget against committed, per code", async () => {
    const rows = await run(async (tx) => {
      const p = await createProject(tx, ctx, {
        entityId,
        number: "OPS-B4",
        name: "Report",
      });
      const set = await createCostCodeSet(tx, ctx, { name: "B4 codes" });
      const conc = await createCostCode(tx, ctx, {
        setId: set.id,
        code: "03 30 00",
        name: "Concrete",
        sortOrder: 10,
      });
      const carp = await createCostCode(tx, ctx, {
        setId: set.id,
        code: "06 10 00",
        name: "Carpentry",
        sortOrder: 20,
      });
      const surprise = await createCostCode(tx, ctx, {
        setId: set.id,
        code: "09 90 00",
        name: "Painting",
        sortOrder: 30,
      });
      const party = await seedVendor(tx, "Report Supply");

      await setBudgetLines(tx, ctx, p.id, [
        { costCodeId: conc.id, originalCents: 40_000_00 },
        { costCodeId: carp.id, originalCents: 60_000_00 },
      ]);
      await createCommitment(tx, ctx, {
        projectId: p.id,
        partyId: party,
        number: "PO-B4-1",
        status: "issued",
        lines: [
          { costCodeId: conc.id, amountCents: 35_000_00 },
          // Over its budget.
          { costCodeId: carp.id, amountCents: 72_000_00 },
          // Never budgeted at all.
          { costCodeId: surprise.id, amountCents: 5_000_00 },
        ],
      });
      // A DRAFT on the same job must not reach the report.
      await createCommitment(tx, ctx, {
        projectId: p.id,
        partyId: party,
        number: "PO-B4-2",
        status: "draft",
        lines: [{ costCodeId: conc.id, amountCents: 99_999_00 }],
      });
      return jobCostRows(tx, tenantId, p.id);
    });

    // Sorted by the business's own chart order, not by id.
    expect(rows.map((r) => r.code)).toEqual(["03 30 00", "06 10 00", "09 90 00"]);

    const conc = rows[0];
    expect(conc.budgetCents).toBe(40_000_00);
    expect(conc.committedCents).toBe(35_000_00); // the draft is excluded
    expect(conc.varianceCents).toBe(5_000_00);

    const carp = rows[1];
    expect(carp.varianceCents).toBe(-12_000_00); // negative means over

    // THE MOST INTERESTING ROW: ordered against, never budgeted.
    const paint = rows[2];
    expect(paint.hasBudget).toBe(false);
    expect(paint.budgetCents).toBe(0);
    expect(paint.committedCents).toBe(5_000_00);
  });

  it("does NOT borrow another job's orders into this job's report", async () => {
    /*
     * `committedTotals` answers for the whole tenant; a job cost report must
     * not. Two projects sharing a cost code is the ordinary case, and getting
     * this wrong would show every job the sum of all of them.
     */
    const { mine, theirs } = await run(async (tx) => {
      const set = await createCostCodeSet(tx, ctx, { name: "Shared codes" });
      const code = await createCostCode(tx, ctx, {
        setId: set.id,
        code: "31 00 00",
        name: "Earthwork",
      });
      const party = await seedVendor(tx, "Shared Supply");
      const a = await createProject(tx, ctx, {
        entityId,
        number: "OPS-B5a",
        name: "Mine",
      });
      const b = await createProject(tx, ctx, {
        entityId,
        number: "OPS-B5b",
        name: "Theirs",
      });
      await setBudgetLines(tx, ctx, a.id, [
        { costCodeId: code.id, originalCents: 10_000_00 },
      ]);
      await createCommitment(tx, ctx, {
        projectId: a.id,
        partyId: party,
        number: "PO-B5a",
        status: "issued",
        lines: [{ costCodeId: code.id, amountCents: 3_000_00 }],
      });
      await createCommitment(tx, ctx, {
        projectId: b.id,
        partyId: party,
        number: "PO-B5b",
        status: "issued",
        lines: [{ costCodeId: code.id, amountCents: 8_000_00 }],
      });
      return {
        mine: await jobCostRows(tx, tenantId, a.id),
        theirs: await jobCostRows(tx, tenantId, b.id),
      };
    });
    expect(mine[0].committedCents).toBe(3_000_00);
    expect(theirs[0].committedCents).toBe(8_000_00);
  });

  it("a cost code with a BUDGET against it cannot be deleted", async () => {
    // Same backstop as a commitment line's: codes are retired, never deleted.
    await expect(
      run(async (tx) => {
        const p = await createProject(tx, ctx, {
          entityId,
          number: "OPS-B6",
          name: "Protected",
        });
        const set = await createCostCodeSet(tx, ctx, { name: "B6 codes" });
        const code = await createCostCode(tx, ctx, {
          setId: set.id,
          code: "01",
          name: "X",
        });
        await setBudgetLines(tx, ctx, p.id, [
          { costCodeId: code.id, originalCents: 1_00 },
        ]);
        await tx
          .delete(schema.jobCostCodes)
          .where(eq(schema.jobCostCodes.id, code.id));
      }),
    ).rejects.toThrow();
  });
});
