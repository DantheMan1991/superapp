import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { withSystem, withTenant, schema, type Tx } from "../src/db";
import {
  JobsError,
  committedTotals,
  contractBilling,
  createChangeOrder,
  createCommitment,
  createPayApplication,
  issuePayApplication,
  listPayApplications,
  saveSovLines,
  updatePayApplication,
  voidPayApplication,
  createContract,
  createCostCode,
  createCostCodeSet,
  createProject,
  getDefaultCostCodeSet,
  listContracts,
  projectValues,
  actualByProject,
  jobCostReport,
  jobCostRows,
  listChangeOrders,
  listCommitments,
  setBudgetLines,
  updateChangeOrder,
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
import { getBalances, listDimensionMembers, postEntry } from "../src/modules/accounting/core";
import { violatedUniqueIndex } from "../src/lib/db-errors";
import {
  addCrew,
  addPunchItem,
  deleteDailyLog,
  listDailyLogs,
  listPunchItems,
  saveDailyLog,
  setPunchDone,
} from "../src/packs/jobs/field-ops";
import {
  listWipPeriods,
  postWip,
  saveWipEstimate,
  unpostWip,
  wipSchedule,
} from "../src/packs/jobs/wip-ops";
import { loadInvoice, loadInvoiceLines } from "../src/modules/accounting/invoicing/invoices";
import { provisionAccounting } from "../src/modules/accounting/templates/apply";
import { CONSTRUCTION_COA } from "../src/industries/construction/accounts";

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

  // ------------------------------------------------------------ change orders

  it("ONLY AN APPROVED CHANGE ORDER moves what a project is worth", async () => {
    const { values, p } = await run(async (tx) => {
      const p = await createProject(tx, ctx, {
        entityId,
        number: "OPS-X1",
        name: "Changed",
      });
      const c = await createContract(tx, ctx, {
        projectId: p.id,
        kind: "new_home",
        valueCents: 500_000_00,
        status: "signed",
      });
      await createChangeOrder(tx, ctx, {
        contractId: c.id,
        number: "CO-1",
        title: "Covered porch",
        status: "approved",
        approvedOn: "2026-09-01",
        valueCents: 12_500_00,
      });
      // Shown to the owner, not yet answered. Not money.
      await createChangeOrder(tx, ctx, {
        contractId: c.id,
        number: "CO-2",
        title: "Pool",
        status: "proposed",
        valueCents: 60_000_00,
      });
      await createChangeOrder(tx, ctx, {
        contractId: c.id,
        number: "CO-3",
        title: "Declined thing",
        status: "declined",
        valueCents: 9_000_00,
      });
      return { values: await projectValues(tx, tenantId), p };
    });
    const v = values.get(p.id)!;
    expect(v.valueCents).toBe(512_500_00); // revised, not original
    expect(v.changesCents).toBe(12_500_00);
    expect(v.signedCount).toBe(1);
  });

  it("a DEDUCTIVE change order is a negative number, and it lowers the value", async () => {
    // The only money in this pack that may be negative. Not a "credit" concept.
    const { values, p, rows } = await run(async (tx) => {
      const p = await createProject(tx, ctx, {
        entityId,
        number: "OPS-X2",
        name: "Deducted",
      });
      const c = await createContract(tx, ctx, {
        projectId: p.id,
        kind: "new_home",
        valueCents: 500_000_00,
        status: "signed",
      });
      await createChangeOrder(tx, ctx, {
        contractId: c.id,
        number: "CO-1",
        title: "Drop the pool",
        status: "approved",
        approvedOn: "2026-09-02",
        valueCents: -18_500_00,
      });
      return {
        values: await projectValues(tx, tenantId),
        p,
        rows: await listChangeOrders(tx, tenantId, p.id),
      };
    });
    expect(values.get(p.id)!.valueCents).toBe(481_500_00);
    expect(values.get(p.id)!.changesCents).toBe(-18_500_00);
    expect(rows[0].changeOrder.valueCents).toBe(-18_500_00);
  });

  it("an approved change on a contract that does not count, counts for nothing", async () => {
    /*
     * `countedChange` needs BOTH halves: the change approved AND the contract
     * signed or complete. An approved change on a proposed or declined
     * agreement is a change to nothing, and summing it would grow a job the
     * business never got.
     */
    const { values, p } = await run(async (tx) => {
      const p = await createProject(tx, ctx, {
        entityId,
        number: "OPS-X3",
        name: "Not counted",
      });
      const proposed = await createContract(tx, ctx, {
        projectId: p.id,
        kind: "new_home",
        valueCents: 500_000_00,
        status: "proposed",
      });
      const declined = await createContract(tx, ctx, {
        projectId: p.id,
        kind: "aia",
        valueCents: 900_000_00,
        status: "declined",
      });
      for (const c of [proposed, declined]) {
        await createChangeOrder(tx, ctx, {
          contractId: c.id,
          number: "CO-1",
          title: "Approved on nothing",
          status: "approved",
          approvedOn: "2026-09-01",
          valueCents: 10_000_00,
        });
      }
      return { values: await projectValues(tx, tenantId), p };
    });
    const v = values.get(p.id)!;
    expect(v.signedCount).toBe(0);
    expect(v.valueCents).toBe(0);
    expect(v.changesCents).toBe(0);
  });

  it("an approved change order REVISES THE BUDGET per code and keeps the original", async () => {
    const rows = await run(async (tx) => {
      const p = await createProject(tx, ctx, {
        entityId,
        number: "OPS-X4",
        name: "Revised budget",
      });
      const set = await createCostCodeSet(tx, ctx, { name: "C4 codes" });
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
      const elec = await createCostCode(tx, ctx, {
        setId: set.id,
        code: "26 00 00",
        name: "Electrical",
        sortOrder: 30,
      });
      await setBudgetLines(tx, ctx, p.id, [
        { costCodeId: conc.id, originalCents: 40_000_00 },
        { costCodeId: carp.id, originalCents: 60_000_00 },
      ]);
      const c = await createContract(tx, ctx, {
        projectId: p.id,
        kind: "new_home",
        valueCents: 500_000_00,
        status: "signed",
      });
      await createChangeOrder(tx, ctx, {
        contractId: c.id,
        number: "CO-1",
        title: "Scope moved and added",
        status: "approved",
        approvedOn: "2026-09-01",
        valueCents: 4_000_00,
        lines: [
          { costCodeId: conc.id, amountCents: 5_000_00 },
          { costCodeId: carp.id, amountCents: -10_000_00 },
          // A code nobody budgeted, now budgeted by the change.
          { costCodeId: elec.id, amountCents: 3_000_00 },
        ],
      });
      // Proposed: the lines must not reach the report.
      await createChangeOrder(tx, ctx, {
        contractId: c.id,
        number: "CO-2",
        title: "Still a PCO",
        status: "proposed",
        lines: [{ costCodeId: conc.id, amountCents: 99_000_00 }],
      });
      return jobCostRows(tx, tenantId, p.id);
    });

    expect(rows.map((r) => r.code)).toEqual(["03 30 00", "06 10 00", "26 00 00"]);
    const [conc, carp, elec] = rows;
    expect(conc.originalCents).toBe(40_000_00);
    expect(conc.changesCents).toBe(5_000_00);
    expect(conc.budgetCents).toBe(45_000_00);
    expect(carp.budgetCents).toBe(50_000_00); // a negative line moves it down
    expect(carp.varianceCents).toBe(50_000_00); // nothing ordered yet
    // Budgeted by the change alone: no line, a revised figure, not "Not budgeted".
    expect(elec.originalCents).toBeNull();
    expect(elec.changesCents).toBe(3_000_00);
    expect(elec.budgetCents).toBe(3_000_00);
    expect(elec.hasBudget).toBe(true);
  });

  it("a SIGNED contract's value is LOCKED, and moves only by change order", async () => {
    const { locked, sameValue, statusOnly, filledOnce } = await run(async (tx) => {
      const p = await createProject(tx, ctx, {
        entityId,
        number: "OPS-X5",
        name: "Locked",
      });
      const c = await createContract(tx, ctx, {
        projectId: p.id,
        kind: "new_home",
        valueCents: 500_000_00,
        status: "signed",
      });
      const locked = await updateContract(tx, ctx, c.id, { valueCents: 510_000_00 })
        .then(() => null)
        .catch((e: unknown) => (e instanceof JobsError ? e.code : "other"));
      // The form round-trips the value unchanged; that must not be refused.
      const sameValue = await updateContract(tx, ctx, c.id, {
        valueCents: 500_000_00,
        notes: "Round trip",
      });
      const statusOnly = await updateContract(tx, ctx, c.id, { status: "complete" });

      // Signed with no value recorded: filling it in the first time is entry,
      // not revision — and then it is locked.
      const blank = await createContract(tx, ctx, {
        projectId: p.id,
        kind: "aia",
        valueCents: null,
        status: "signed",
      });
      await updateContract(tx, ctx, blank.id, { valueCents: 90_000_00 });
      const filledOnce = await updateContract(tx, ctx, blank.id, { valueCents: 91_000_00 })
        .then(() => null)
        .catch((e: unknown) => (e instanceof JobsError ? e.code : "other"));
      return { locked, sameValue, statusOnly, filledOnce };
    });
    expect(locked).toBe("VALUE_LOCKED");
    expect(sameValue.notes).toBe("Round trip");
    expect(statusOnly.status).toBe("complete");
    expect(filledOnce).toBe("VALUE_LOCKED");
  });

  it("a PROPOSED contract's value is still editable", async () => {
    const updated = await run(async (tx) => {
      const p = await createProject(tx, ctx, {
        entityId,
        number: "OPS-X6",
        name: "Still open",
      });
      const c = await createContract(tx, ctx, {
        projectId: p.id,
        kind: "new_home",
        valueCents: 500_000_00,
        status: "proposed",
      });
      return updateContract(tx, ctx, c.id, { valueCents: 525_000_00 });
    });
    expect(updated.valueCents).toBe(525_000_00);
  });

  it("APPROVED NEEDS A DATE, and un-approving clears it", async () => {
    const { noDate, approved, backToProposed, reApproveNoDate } = await run(
      async (tx) => {
        const p = await createProject(tx, ctx, {
          entityId,
          number: "OPS-X7",
          name: "Dated",
        });
        const c = await createContract(tx, ctx, {
          projectId: p.id,
          kind: "new_home",
          valueCents: 100_000_00,
          status: "signed",
        });
        const noDate = await createChangeOrder(tx, ctx, {
          contractId: c.id,
          number: "CO-1",
          title: "No date",
          status: "approved",
          valueCents: 1_00,
        })
          .then(() => null)
          .catch((e: unknown) => (e instanceof JobsError ? e.code : "other"));
        const approved = await createChangeOrder(tx, ctx, {
          contractId: c.id,
          number: "CO-1",
          title: "Dated",
          status: "approved",
          approvedOn: "2026-09-03",
          valueCents: 1_00,
        });
        const backToProposed = await updateChangeOrder(tx, ctx, approved.id, {
          status: "proposed",
        });
        const reApproveNoDate = await updateChangeOrder(tx, ctx, approved.id, {
          status: "approved",
        })
          .then(() => null)
          .catch((e: unknown) => (e instanceof JobsError ? e.code : "other"));
        return { noDate, approved, backToProposed, reApproveNoDate };
      },
    );
    expect(noDate).toBe("APPROVAL_DATE_REQUIRED");
    expect(approved.approvedOn).toBe("2026-09-03");
    expect(backToProposed.approvedOn).toBeNull(); // cleared, not carried
    // The date was cleared by the un-approval, so approving again needs one.
    expect(reApproveNoDate).toBe("APPROVAL_DATE_REQUIRED");
  });

  it("REPLACES a change order's lines on edit, and an EMPTY list is an instruction", async () => {
    const { afterOne, afterNone, untouched } = await run(async (tx) => {
      const p = await createProject(tx, ctx, {
        entityId,
        number: "OPS-X8",
        name: "Relined",
      });
      const set = await createCostCodeSet(tx, ctx, { name: "C8 codes" });
      const a = await createCostCode(tx, ctx, { setId: set.id, code: "01", name: "A" });
      const b = await createCostCode(tx, ctx, { setId: set.id, code: "02", name: "B" });
      const c = await createContract(tx, ctx, {
        projectId: p.id,
        kind: "new_home",
        valueCents: 100_000_00,
        status: "signed",
      });
      const co = await createChangeOrder(tx, ctx, {
        contractId: c.id,
        number: "CO-1",
        title: "Two lines",
        lines: [
          { costCodeId: a.id, amountCents: 1_000_00 },
          { costCodeId: b.id, amountCents: 2_000_00 },
        ],
      });
      const linesOf = async () =>
        (await listChangeOrders(tx, tenantId, p.id))[0].lines;
      await updateChangeOrder(tx, ctx, co.id, {
        lines: [{ costCodeId: a.id, amountCents: 5_000_00 }],
      });
      const afterOne = await linesOf();
      // A change order with no lines is a legitimate thing to be — a pure
      // price change — so [] means "remove them", unlike on a commitment.
      await updateChangeOrder(tx, ctx, co.id, { lines: [] });
      const afterNone = await linesOf();
      await updateChangeOrder(tx, ctx, co.id, {
        lines: [{ costCodeId: b.id, amountCents: 7_00 }],
      });
      await updateChangeOrder(tx, ctx, co.id, { title: "Renamed only" });
      const untouched = await linesOf();
      return { afterOne, afterNone, untouched };
    });
    expect(afterOne).toHaveLength(1);
    expect(afterOne[0].amountCents).toBe(5_000_00);
    expect(afterNone).toHaveLength(0);
    expect(untouched).toHaveLength(1);
    expect(untouched[0].amountCents).toBe(7_00);
  });

  it("numbers a change order per CONTRACT, so two agreements may both have a CO-1", async () => {
    const { dup } = await run(async (tx) => {
      const p = await createProject(tx, ctx, {
        entityId,
        number: "OPS-X9",
        name: "Numbered",
      });
      const one = await createContract(tx, ctx, {
        projectId: p.id,
        kind: "construction_drawings",
        valueCents: 10_000_00,
        status: "signed",
      });
      const two = await createContract(tx, ctx, {
        projectId: p.id,
        kind: "new_home",
        valueCents: 500_000_00,
        status: "signed",
      });
      await createChangeOrder(tx, ctx, { contractId: one.id, number: "CO-1", title: "a" });
      await createChangeOrder(tx, ctx, { contractId: two.id, number: "CO-1", title: "b" });
      const dup = await createChangeOrder(tx, ctx, {
        contractId: two.id,
        number: "CO-1",
        title: "again",
      })
        .then(() => "allowed")
        // The constraint is on the CAUSE, not the message — see src/lib/db-errors.ts.
        .catch((e: unknown) => violatedUniqueIndex(e) ?? "some other failure");
      return { dup };
    });
    expect(dup).toBe("job_change_orders_contract_number_idx");
  });

  it("lists a project's change orders THROUGH ITS CONTRACTS, with their cost", async () => {
    const { mine, theirs } = await run(async (tx) => {
      const set = await createCostCodeSet(tx, ctx, { name: "C10 codes" });
      const code = await createCostCode(tx, ctx, { setId: set.id, code: "01", name: "A" });
      const a = await createProject(tx, ctx, { entityId, number: "OPS-X10a", name: "Mine" });
      const b = await createProject(tx, ctx, { entityId, number: "OPS-X10b", name: "Theirs" });
      const ca = await createContract(tx, ctx, {
        projectId: a.id,
        kind: "new_home",
        name: "Lot 4",
        status: "signed",
      });
      const cb = await createContract(tx, ctx, { projectId: b.id, kind: "aia", status: "signed" });
      await createChangeOrder(tx, ctx, {
        contractId: ca.id,
        number: "CO-1",
        title: "Mine",
        valueCents: 3_000_00,
        lines: [
          { costCodeId: code.id, amountCents: 1_000_00 },
          { costCodeId: code.id, amountCents: 1_250_00, description: "second" },
        ],
      });
      await createChangeOrder(tx, ctx, { contractId: cb.id, number: "CO-1", title: "Theirs" });
      return {
        mine: await listChangeOrders(tx, tenantId, a.id),
        theirs: await listChangeOrders(tx, tenantId, b.id),
      };
    });
    expect(mine).toHaveLength(1);
    expect(mine[0].contract.kind).toBe("new_home");
    expect(mine[0].contract.name).toBe("Lot 4");
    expect(mine[0].costCents).toBe(2_250_00);
    expect(mine[0].lines).toHaveLength(2);
    expect(theirs).toHaveLength(1);
    expect(theirs[0].changeOrder.title).toBe("Theirs");
  });

  it("STAFF cannot raise a change order", async () => {
    await expect(
      withTenant(
        tenantId,
        async (tx) => {
          const p = await createProject(tx, ctx, {
            entityId,
            number: "OPS-X11",
            name: "Staff",
          });
          const c = await createContract(tx, ctx, {
            projectId: p.id,
            kind: "new_home",
            status: "signed",
          });
          return createChangeOrder(tx, staffCtx, {
            contractId: c.id,
            number: "CO-1",
            title: "Nope",
          });
        },
        { role: "owner", userId: `${STAMP}-owner` },
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("a change order against a contract that is not there is NOT_FOUND", async () => {
    await expect(
      run((tx) =>
        createChangeOrder(tx, ctx, {
          contractId: "00000000-0000-0000-0000-000000000000",
          number: "CO-1",
          title: "Orphan",
        }),
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("a cost code with a CHANGE against it cannot be deleted", async () => {
    await expect(
      run(async (tx) => {
        const p = await createProject(tx, ctx, { entityId, number: "OPS-X12", name: "P" });
        const set = await createCostCodeSet(tx, ctx, { name: "C12 codes" });
        const code = await createCostCode(tx, ctx, { setId: set.id, code: "01", name: "X" });
        const c = await createContract(tx, ctx, { projectId: p.id, kind: "new_home" });
        await createChangeOrder(tx, ctx, {
          contractId: c.id,
          number: "CO-1",
          title: "Protects the code",
          lines: [{ costCodeId: code.id, amountCents: 1_00 }],
        });
        await tx.delete(schema.jobCostCodes).where(eq(schema.jobCostCodes.id, code.id));
      }),
    ).rejects.toThrow();
  });

  // ------------------------------------------------------------------ billing

  /**
   * Billing posts INVOICES, so these tests need a chart of accounts — the
   * general one Accounting provisions, plus the construction profile's
   * additions, which is what proves the seeded `1230` is the account billing
   * withholds retainage to. Provisioned once, as the tenant, the way
   * switching Accounting on does.
   */
  let billingReady = false;
  const ensureBilling = async (tx: Tx) => {
    if (billingReady) return;
    await provisionAccounting(tx, tenantId);
    await provisionAccounting(tx, tenantId, CONSTRUCTION_COA);
    billingReady = true;
  };

  /** A project with a signed contract to a real party, ready to schedule. */
  const billableContract = async (
    tx: Tx,
    number: string,
    valueCents = 100_000_00,
  ) => {
    await ensureBilling(tx);
    const p = await createProject(tx, ctx, { entityId, number, name: `Billed ${number}` });
    const party = await seedVendor(tx, `Owner ${number}`);
    const c = await createContract(tx, ctx, {
      projectId: p.id,
      kind: "new_home",
      counterpartyPartyId: party,
      valueCents,
      status: "signed",
    });
    return { project: p, contract: c, party };
  };

  it("a schedule is REPLACED whole, re-sequenced, and a billed line will not go", async () => {
    const { contract } = await run((tx) => billableContract(tx, "OPS-S1"));
    const first = await run((tx) =>
      saveSovLines(tx, ctx, contract.id, [
        { description: "Foundation", scheduledCents: 30_000_00 },
        { description: "Framing", scheduledCents: 70_000_00 },
      ]),
    );
    expect(first.map((l) => [l.description, l.sortOrder])).toEqual([
      ["Foundation", 10],
      ["Framing", 20],
    ]);
    // Reorder, rename, drop one: what is given is what remains.
    const second = await run((tx) =>
      saveSovLines(tx, ctx, contract.id, [
        { id: first[1].id, description: "Framing and roof", scheduledCents: 70_000_00 },
      ]),
    );
    expect(second.map((l) => l.description)).toEqual(["Framing and roof"]);
    expect(second[0].id).toBe(first[1].id);

    // Bill against it, then try to remove it.
    await run(async (tx) => {
      const app = await createPayApplication(tx, ctx, {
        contractId: contract.id,
        periodTo: "2026-09-30",
      });
      await updatePayApplication(tx, ctx, app.id, {
        lines: [{ sovLineId: second[0].id, thisPeriodCents: 10_000_00, storedCents: 0 }],
      });
    });
    await expect(
      run((tx) => saveSovLines(tx, ctx, contract.id, [{ description: "Fresh", scheduledCents: 1 }])),
    ).rejects.toMatchObject({ code: "SOV_LINE_BILLED" });
  });

  it("refuses a negative scheduled value and an empty description", async () => {
    const { contract } = await run((tx) => billableContract(tx, "OPS-S2"));
    await expect(
      run((tx) => saveSovLines(tx, ctx, contract.id, [{ description: "x", scheduledCents: -1 }])),
    ).rejects.toMatchObject({ code: "INVALID_VALUE" });
    await expect(
      run((tx) => saveSovLines(tx, ctx, contract.id, [{ description: "  ", scheduledCents: 1 }])),
    ).rejects.toMatchObject({ code: "INVALID_VALUE" });
  });

  it("an application needs a schedule, and a contract holds ONE draft at a time", async () => {
    const { contract } = await run((tx) => billableContract(tx, "OPS-S3"));
    await expect(
      run((tx) => createPayApplication(tx, ctx, { contractId: contract.id, periodTo: "2026-09-30" })),
    ).rejects.toMatchObject({ code: "NO_LINES" });
    await run((tx) =>
      saveSovLines(tx, ctx, contract.id, [{ description: "Contract sum", scheduledCents: 100_000_00 }]),
    );
    const one = await run((tx) =>
      createPayApplication(tx, ctx, { contractId: contract.id, periodTo: "2026-09-30", retainagePpm: 100_000 }),
    );
    expect(one.number).toBe(1);
    expect(one.status).toBe("draft");
    await expect(
      run((tx) => createPayApplication(tx, ctx, { contractId: contract.id, periodTo: "2026-10-31" })),
    ).rejects.toMatchObject({ code: "ONE_DRAFT" });
  });

  it("ISSUING posts an ordinary invoice: net to AR, retainage to 1230, revenue gross, tagged with the project", async () => {
    const { project, contract } = await run((tx) => billableContract(tx, "OPS-S4", 100_000_00));
    const sov = await run((tx) =>
      saveSovLines(tx, ctx, contract.id, [
        { description: "Foundation", scheduledCents: 30_000_00 },
        { description: "Framing", scheduledCents: 70_000_00 },
      ]),
    );
    const app = await run((tx) =>
      createPayApplication(tx, ctx, { contractId: contract.id, periodTo: "2026-09-30", retainagePpm: 100_000 }),
    );
    await run((tx) =>
      updatePayApplication(tx, ctx, app.id, {
        lines: [
          { sovLineId: sov[0].id, thisPeriodCents: 30_000_00, storedCents: 0 },
          { sovLineId: sov[1].id, thisPeriodCents: 10_000_00, storedCents: 5_000_00 },
        ],
      }),
    );
    const issued = await run((tx) => issuePayApplication(tx, ctx, app.id, { issueDate: "2026-10-01" }));
    // The certificate: 45,000 completed and stored, 10% held, nothing before.
    expect(issued.app.status).toBe("issued");
    expect(issued.app.completedToDateCents).toBe(45_000_00);
    expect(issued.app.retainageCents).toBe(4_500_00);
    expect(issued.app.previousCertificatesCents).toBe(0);
    expect(issued.app.dueCents).toBe(40_500_00);
    expect(issued.app.invoiceId).toBe(issued.invoiceId);

    const { invoice, lines, entryLines, accounts, dims } = await run(async (tx) => {
      const invoice = await loadInvoice(tx, tenantId, issued.invoiceId);
      const lines = await loadInvoiceLines(tx, tenantId, invoice.id);
      const entryLines = await tx
        .select()
        .from(schema.journalLines)
        .where(eq(schema.journalLines.entryId, invoice.journalEntryId!));
      const accounts = await tx
        .select({ id: schema.accounts.id, code: schema.accounts.code })
        .from(schema.accounts)
        .where(eq(schema.accounts.tenantId, tenantId));
      const dims = await tx
        .select({ invoiceLineId: schema.lineDimensions.invoiceLineId, memberId: schema.lineDimensions.memberId })
        .from(schema.lineDimensions)
        .where(
          and(
            eq(schema.lineDimensions.tenantId, tenantId),
            inArray(schema.lineDimensions.invoiceLineId, lines.map((l) => l.id)),
          ),
        );
      return { invoice, lines, entryLines, accounts, dims };
    });
    const codeOf = new Map(accounts.map((a) => [a.id, a.code]));
    expect(invoice.status).toBe("issued");
    expect(invoice.totalCents).toBe(40_500_00); // what the client owes: net of retainage
    expect(invoice.entityId).toBe(project.entityId);
    expect(lines.map((l) => [codeOf.get(l.incomeAccountId), l.amountCents])).toEqual([
      ["4030", 45_000_00],
      ["1230", -4_500_00],
    ]);
    // The ledger: Dr AR 40,500 · Dr Retainage Receivable 4,500 · Cr Contract Revenue 45,000.
    const byCode = new Map(entryLines.map((l) => [codeOf.get(l.accountId), l.amountCents]));
    expect(byCode.get("1200")).toBe(40_500_00);
    expect(byCode.get("1230")).toBe(4_500_00);
    expect(byCode.get("4030")).toBe(-45_000_00);
    // Every line carries the project, so the job's revenue is on every report.
    const [member] = await run((tx) => memberFor(tx, project.id));
    expect(dims).toHaveLength(2);
    expect(new Set(dims.map((d) => d.memberId))).toEqual(new Set([member.id]));
  });

  it("the NEXT application carries work forward, certifies against the last, and a rate of zero releases the retainage", async () => {
    const { contract } = await run((tx) => billableContract(tx, "OPS-S5", 100_000_00));
    const sov = await run((tx) =>
      saveSovLines(tx, ctx, contract.id, [{ description: "Contract sum", scheduledCents: 100_000_00 }]),
    );
    const first = await run(async (tx) => {
      const a = await createPayApplication(tx, ctx, { contractId: contract.id, periodTo: "2026-09-30", retainagePpm: 100_000 });
      await updatePayApplication(tx, ctx, a.id, {
        lines: [{ sovLineId: sov[0].id, thisPeriodCents: 60_000_00, storedCents: 10_000_00 }],
      });
      return issuePayApplication(tx, ctx, a.id, { issueDate: "2026-10-01" });
    });
    expect(first.app.dueCents).toBe(63_000_00); // 70,000 − 7,000 held

    // Second: the rate carries (10%), previous = work only (60,000), stored re-entered.
    const second = await run(async (tx) => {
      const a = await createPayApplication(tx, ctx, { contractId: contract.id, periodTo: "2026-10-31" });
      expect(a.retainagePpm).toBe(100_000);
      const rows = await listPayApplications(tx, tenantId, contract.id);
      const draft = rows.find((r) => r.app.id === a.id)!;
      expect(draft.lines[0].previousCents).toBe(60_000_00);
      expect(draft.totals.previousCertificatesCents).toBe(63_000_00);
      await updatePayApplication(tx, ctx, a.id, {
        lines: [{ sovLineId: sov[0].id, thisPeriodCents: 40_000_00, storedCents: 0 }],
      });
      return issuePayApplication(tx, ctx, a.id, { issueDate: "2026-11-01" });
    });
    // 100,000 complete, 10,000 held, 63,000 already certified → 27,000 due.
    expect(second.app.completedToDateCents).toBe(100_000_00);
    expect(second.app.retainageCents).toBe(10_000_00);
    expect(second.app.dueCents).toBe(27_000_00);

    // Final: nothing more done, rate to zero → the held 10,000 is released.
    const final = await run(async (tx) => {
      const a = await createPayApplication(tx, ctx, { contractId: contract.id, periodTo: "2026-11-30", retainagePpm: 0 });
      return issuePayApplication(tx, ctx, a.id, { issueDate: "2026-12-01" });
    });
    expect(final.app.dueCents).toBe(10_000_00);
    const { lines, accounts } = await run(async (tx) => ({
      lines: await loadInvoiceLines(tx, tenantId, final.invoiceId),
      accounts: await tx.select({ id: schema.accounts.id, code: schema.accounts.code }).from(schema.accounts).where(eq(schema.accounts.tenantId, tenantId)),
    }));
    const codeOf = new Map(accounts.map((a) => [a.id, a.code]));
    // No work line (nothing earned this period); one positive line to 1230.
    expect(lines.map((l) => [codeOf.get(l.incomeAccountId), l.amountCents, l.description])).toEqual([
      ["1230", 10_000_00, "Retainage released"],
    ]);
    // What has been billed over the whole contract equals its value.
    const billing = await run((tx) => contractBilling(tx, tenantId, first.app.contractId));
    void billing;
  });

  it("refuses to issue when nothing is due, when nobody is named, or when the chart lacks 1230", async () => {
    const { contract } = await run((tx) => billableContract(tx, "OPS-S6"));
    const sov = await run((tx) =>
      saveSovLines(tx, ctx, contract.id, [{ description: "Contract sum", scheduledCents: 100_000_00 }]),
    );
    const app = await run((tx) =>
      createPayApplication(tx, ctx, { contractId: contract.id, periodTo: "2026-09-30", retainagePpm: 100_000 }),
    );
    await expect(
      run((tx) => issuePayApplication(tx, ctx, app.id, { issueDate: "2026-10-01" })),
    ).rejects.toMatchObject({ code: "NOTHING_DUE" });

    await run((tx) =>
      updatePayApplication(tx, ctx, app.id, {
        lines: [{ sovLineId: sov[0].id, thisPeriodCents: 10_000_00, storedCents: 0 }],
      }),
    );
    // Nobody to bill.
    await run((tx) => updateContract(tx, ctx, contract.id, { counterpartyPartyId: null }));
    await expect(
      run((tx) => issuePayApplication(tx, ctx, app.id, { issueDate: "2026-10-01" })),
    ).rejects.toMatchObject({ code: "COUNTERPARTY_REQUIRED" });

    // Retire the retainage account, then try to withhold.
    const party = await run((tx) => seedVendor(tx, "Late owner"));
    await run((tx) => updateContract(tx, ctx, contract.id, { counterpartyPartyId: party }));
    await run((tx) =>
      tx
        .update(schema.accounts)
        .set({ isActive: false })
        .where(and(eq(schema.accounts.tenantId, tenantId), eq(schema.accounts.code, "1230"))),
    );
    await expect(
      run((tx) => issuePayApplication(tx, ctx, app.id, { issueDate: "2026-10-01" })),
    ).rejects.toMatchObject({ code: "ACCOUNT_MISSING" });
    await run((tx) =>
      tx
        .update(schema.accounts)
        .set({ isActive: true })
        .where(and(eq(schema.accounts.tenantId, tenantId), eq(schema.accounts.code, "1230"))),
    );
  });

  it("only a draft changes; only the LATEST issued application voids, and its invoice goes with it", async () => {
    const { contract } = await run((tx) => billableContract(tx, "OPS-S7"));
    const sov = await run((tx) =>
      saveSovLines(tx, ctx, contract.id, [{ description: "Contract sum", scheduledCents: 100_000_00 }]),
    );
    const issueOne = (periodTo: string, issueDate: string, cents: number) =>
      run(async (tx) => {
        const a = await createPayApplication(tx, ctx, { contractId: contract.id, periodTo });
        await updatePayApplication(tx, ctx, a.id, {
          lines: [{ sovLineId: sov[0].id, thisPeriodCents: cents, storedCents: 0 }],
        });
        return issuePayApplication(tx, ctx, a.id, { issueDate });
      });
    const one = await issueOne("2026-09-30", "2026-10-01", 20_000_00);
    const two = await issueOne("2026-10-31", "2026-11-01", 30_000_00);

    await expect(
      run((tx) => updatePayApplication(tx, ctx, one.app.id, { notes: "late" })),
    ).rejects.toMatchObject({ code: "INVALID_STATUS" });
    await expect(run((tx) => voidPayApplication(tx, ctx, one.app.id))).rejects.toMatchObject({
      code: "NOT_LAST",
    });

    const voided = await run((tx) => voidPayApplication(tx, ctx, two.app.id));
    expect(voided.status).toBe("void");
    const invoice = await run((tx) => loadInvoice(tx, tenantId, two.invoiceId));
    expect(invoice.status).toBe("void");
    // The next draft certifies against ONE again, not the voided two.
    const next = await run(async (tx) => {
      const a = await createPayApplication(tx, ctx, { contractId: contract.id, periodTo: "2026-11-30" });
      const rows = await listPayApplications(tx, tenantId, contract.id);
      return rows.find((r) => r.app.id === a.id)!;
    });
    expect(next.app.number).toBe(3);
    expect(next.totals.previousCertificatesCents).toBe(20_000_00);
    expect(next.lines[0].previousCents).toBe(20_000_00);
  });

  it("a draft picks up schedule lines added after it was started", async () => {
    const { contract } = await run((tx) => billableContract(tx, "OPS-S8"));
    const sov = await run((tx) =>
      saveSovLines(tx, ctx, contract.id, [{ description: "Original", scheduledCents: 50_000_00 }]),
    );
    const app = await run((tx) =>
      createPayApplication(tx, ctx, { contractId: contract.id, periodTo: "2026-09-30" }),
    );
    await run((tx) =>
      saveSovLines(tx, ctx, contract.id, [
        { id: sov[0].id, description: "Original", scheduledCents: 50_000_00 },
        { description: "Added by change order", scheduledCents: 5_000_00 },
      ]),
    );
    const rows = await run(async (tx) => {
      await updatePayApplication(tx, ctx, app.id, {});
      return listPayApplications(tx, tenantId, contract.id);
    });
    expect(rows[0].lines.map((l) => l.description)).toEqual(["Original", "Added by change order"]);
    expect(rows[0].totals.scheduledCents).toBe(55_000_00);
  });

  it("STAFF cannot bill", async () => {
    const { contract } = await run((tx) => billableContract(tx, "OPS-S9"));
    await expect(
      run((tx) => saveSovLines(tx, staffCtx, contract.id, [{ description: "x", scheduledCents: 1 }])),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  // ------------------------------------------------------------------- field

  it("a day's log is ONE row per job per day: saying it again edits it, appending a line", async () => {
    const { days } = await run(async (tx) => {
      const p = await createProject(tx, ctx, { entityId, number: "OPS-F1", name: "Field" });
      const first = await saveDailyLog(tx, ctx, {
        projectId: p.id,
        logDate: "2026-09-14",
        weather: "Clear",
        notes: "Poured the slab",
        crews: [{ trade: "Concrete", workers: 4, hoursTenths: 60 }],
      });
      const again = await saveDailyLog(tx, ctx, {
        projectId: p.id,
        logDate: "2026-09-14",
        appendNotes: "Framers started",
      });
      expect(again.id).toBe(first.id);
      // A second day is a second row.
      await saveDailyLog(tx, ctx, { projectId: p.id, logDate: "2026-09-15", notes: "Rained out" });
      return { days: await listDailyLogs(tx, tenantId, p.id) };
    });
    expect(days.map((d) => d.log.logDate)).toEqual(["2026-09-15", "2026-09-14"]); // newest first
    expect(days[1].log.notes).toBe("Poured the slab\nFramers started");
    expect(days[1].log.weather).toBe("Clear"); // left alone by the append
    expect(days[1].crews.map((c) => [c.trade, c.workers, c.hoursTenths])).toEqual([["Concrete", 4, 60]]);
    expect(days[1].manHoursTenths).toBe(240);
    expect(days[1].photoCount).toBe(0);
  });

  it("crews REPLACE on save and ADD one at a time from a sentence; a line naming nobody is refused", async () => {
    const { crews } = await run(async (tx) => {
      const p = await createProject(tx, ctx, { entityId, number: "OPS-F2", name: "Crews" });
      const sub = await seedVendor(tx, "Framing Co");
      const log = await saveDailyLog(tx, ctx, {
        projectId: p.id,
        logDate: "2026-09-14",
        crews: [
          { trade: "Concrete", workers: 4, hoursTenths: 60 },
          { partyId: sub, workers: 3, hoursTenths: 80 },
        ],
      });
      await saveDailyLog(tx, ctx, {
        projectId: p.id,
        logDate: "2026-09-14",
        crews: [{ partyId: sub, trade: "Framing", workers: 5, hoursTenths: 80 }],
      });
      await addCrew(tx, ctx, log.id, { trade: "Electrical", workers: 2, hoursTenths: 40 });
      await expect(
        addCrew(tx, ctx, log.id, { workers: 1, hoursTenths: 10 }),
      ).rejects.toMatchObject({ code: "INVALID_VALUE" });
      await expect(
        addCrew(tx, ctx, log.id, { trade: "x", workers: -1, hoursTenths: 10 }),
      ).rejects.toMatchObject({ code: "INVALID_VALUE" });
      return { crews: (await listDailyLogs(tx, tenantId, p.id))[0].crews };
    });
    expect(crews.map((c) => [c.trade, c.partyName, c.workers])).toEqual([
      ["Framing", expect.stringContaining("Framing Co"), 5],
      ["Electrical", null, 2],
    ]);
  });

  it("STAFF log the day — the field is a chore, not a decision", async () => {
    const log = await run(async (tx) => {
      const p = await createProject(tx, ctx, { entityId, number: "OPS-F3", name: "Staffed" });
      return saveDailyLog(tx, staffCtx, { projectId: p.id, logDate: "2026-09-14", notes: "On it" });
    });
    expect(log.notes).toBe("On it");
  });

  it("removing a day takes its crews and refuses a day that is not there", async () => {
    await run(async (tx) => {
      const p = await createProject(tx, ctx, { entityId, number: "OPS-F4", name: "Removed" });
      const log = await saveDailyLog(tx, ctx, {
        projectId: p.id,
        logDate: "2026-09-14",
        crews: [{ trade: "Concrete", workers: 1, hoursTenths: 10 }],
      });
      await deleteDailyLog(tx, ctx, log.id);
      expect(await listDailyLogs(tx, tenantId, p.id)).toEqual([]);
      const crews = await tx
        .select()
        .from(schema.jobDailyLogCrews)
        .where(eq(schema.jobDailyLogCrews.logId, log.id));
      expect(crews).toEqual([]);
      await expect(deleteDailyLog(tx, ctx, log.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  });

  it("a punch item is a WORK item linked to the job, listed from the job and ticked off", async () => {
    const { before, after } = await run(async (tx) => {
      const p = await createProject(tx, ctx, { entityId, number: "OPS-F5", name: "Punched" });
      const id = await addPunchItem(tx, staffCtx, p.id, { title: "Touch up paint", dueOn: "2026-09-20" });
      const before = await listPunchItems(tx, tenantId, p.id);
      await setPunchDone(tx, staffCtx, id, true);
      const after = await listPunchItems(tx, tenantId, p.id);
      await expect(addPunchItem(tx, ctx, p.id, { title: "  " })).rejects.toMatchObject({ code: "INVALID_VALUE" });
      return { before, after };
    });
    expect(before.map((i) => [i.title, i.dueOn, i.completedAt])).toEqual([["Touch up paint", "2026-09-20", null]]);
    expect(before[0].links).toEqual([{ entityType: "project", entityId: expect.any(String) }]);
    expect(after[0].completedAt).not.toBeNull();
  });

  // ------------------------------------------------------------------- wip

  /**
   * EACH TEST BELOW GETS ITS OWN COMPANY, because a schedule is per company
   * and every job the earlier sections made on the default one would land on
   * it — most with no budget, which would block every post here with a
   * refusal about somebody else's job. A company is one row.
   */
  const newCompany = (name: string) =>
    withSystem(async (tx) => {
      const rows = await tx.insert(schema.entities).values({ tenantId, name }).returning();
      return rows[0].id;
    });

  const accountByCodeId = async (tx: Tx, code: string): Promise<string> => {
    const rows = await tx
      .select({ id: schema.accounts.id })
      .from(schema.accounts)
      .where(and(eq(schema.accounts.tenantId, tenantId), eq(schema.accounts.code, code)));
    if (!rows[0]) throw new Error(`no account ${code}`);
    return rows[0].id;
  };

  /** A cost on the job: Dr 5200 Job Materials tagged with the project / Cr 2000 Accounts Payable. */
  const postCost = async (tx: Tx, entity: string, projectId: string, cents: number, date: string) => {
    const [member] = await memberFor(tx, projectId);
    await postEntry(tx, ctx, {
      entityId: entity,
      status: "posted",
      entryDate: date,
      memo: "job cost",
      lines: [
        { accountId: await accountByCodeId(tx, "5200"), amountCents: cents, dimensionMemberIds: [member.id] },
        { accountId: await accountByCodeId(tx, "2000"), amountCents: -cents },
      ],
    });
  };

  /** A signed job on a company: its contract, an optional budget, some cost, some billing. */
  const wipJob = async (
    tx: Tx,
    entity: string,
    number: string,
    args: {
      contractCents: number | null;
      budgetCents?: number;
      costCents?: number;
      costDate?: string;
      billedCents?: number;
      billDate?: string;
    },
  ) => {
    await ensureBilling(tx);
    const project = await createProject(tx, ctx, { entityId: entity, number, name: `WIP ${number}` });
    const party = await seedVendor(tx, `Owner ${number}`);
    const contract = await createContract(tx, ctx, {
      projectId: project.id,
      kind: "new_home",
      counterpartyPartyId: party,
      valueCents: args.contractCents,
      status: "signed",
    });
    if (args.budgetCents !== undefined) {
      const set =
        (await getDefaultCostCodeSet(tx, tenantId)) ??
        (await createCostCodeSet(tx, ctx, { name: "WIP codes" }));
      const code = await createCostCode(tx, ctx, { setId: set.id, code: `W-${number}`, name: "Work" });
      await setBudgetLines(tx, ctx, project.id, [{ costCodeId: code.id, originalCents: args.budgetCents }]);
    }
    if (args.costCents) {
      await postCost(tx, entity, project.id, args.costCents, args.costDate ?? "2026-09-10");
    }
    if (args.billedCents) {
      const sov = await saveSovLines(tx, ctx, contract.id, [
        { description: "Contract sum", scheduledCents: args.contractCents ?? args.billedCents },
      ]);
      const app = await createPayApplication(tx, ctx, {
        contractId: contract.id,
        periodTo: args.billDate ?? "2026-09-12",
        retainagePpm: 0,
      });
      await updatePayApplication(tx, ctx, app.id, {
        lines: [{ sovLineId: sov[0].id, thisPeriodCents: args.billedCents, storedCents: 0 }],
      });
      await issuePayApplication(tx, ctx, app.id, { issueDate: args.billDate ?? "2026-09-12" });
    }
    return { project, contract };
  };

  const entryLines = (entryId: string) =>
    run(async (tx) => {
      const lines = await tx
        .select()
        .from(schema.journalLines)
        .where(eq(schema.journalLines.entryId, entryId));
      const accounts = await tx
        .select({ id: schema.accounts.id, code: schema.accounts.code })
        .from(schema.accounts)
        .where(eq(schema.accounts.tenantId, tenantId));
      const codeOf = new Map(accounts.map((a) => [a.id, a.code]));
      return lines.map((l) => [codeOf.get(l.accountId), l.amountCents] as const).sort();
    });

  it("THE SCHEDULE: percent complete is cost over estimate, earned is the contract at that percent, and a job that cannot be measured says so", async () => {
    const entity = await newCompany("WIP Co 1");
    const a = await run((tx) =>
      wipJob(tx, entity, "OPS-W1", {
        contractCents: 100_000_00,
        budgetCents: 80_000_00,
        costCents: 40_000_00,
        billedCents: 30_000_00,
      }),
    );
    const b = await run((tx) => wipJob(tx, entity, "OPS-W2", { contractCents: 50_000_00, costCents: 5_000_00 }));
    const s = await run((tx) => wipSchedule(tx, tenantId, { entityId: entity, periodEnd: "2026-09-30" }));
    expect(s.period).toBeNull();
    const rowA = s.rows.find((r) => r.projectId === a.project.id)!;
    expect(rowA.reason).toBe("");
    expect(rowA.figures).toMatchObject({
      contractCents: 100_000_00,
      estimatedCostCents: 80_000_00,
      costToDateCents: 40_000_00,
      billedCents: 30_000_00,
      percentCompletePpm: 500_000,
      earnedCents: 50_000_00,
      underBilledCents: 20_000_00,
      overBilledCents: 0,
    });
    const rowB = s.rows.find((r) => r.projectId === b.project.id)!;
    expect(rowB.reason).toBe("no_estimate");
    expect(rowB.figures.percentCompletePpm).toBeNull();
    expect(s.blockers).toEqual(["OPS-W2 has no budget and no estimate"]);
    // Only measured jobs count toward the totals.
    expect(s.totals.underBilledCents).toBe(20_000_00);
    expect(s.totals.contractCents).toBe(100_000_00);
    expect(s.missingAccounts).toEqual([]);
    // As of a date before the cost and the billing, the job has only its value.
    const early = await run((tx) => wipSchedule(tx, tenantId, { entityId: entity, periodEnd: "2026-09-01" }));
    expect(early.rows.find((r) => r.projectId === a.project.id)!.figures).toMatchObject({
      costToDateCents: 0,
      billedCents: 0,
      earnedCents: 0,
    });
    // Another company's schedule does not see these jobs at all.
    const other = await run((tx) => wipSchedule(tx, tenantId, { entityId, periodEnd: "2026-09-30" }));
    expect(other.rows.some((r) => r.projectId === a.project.id)).toBe(false);
  });

  it("POSTING writes the adjustment and its reversal the next day, tagged with the job, and freezes the schedule", async () => {
    const entity = await newCompany("WIP Co 2");
    const { project } = await run((tx) =>
      wipJob(tx, entity, "OPS-W3", {
        contractCents: 100_000_00,
        budgetCents: 80_000_00,
        costCents: 40_000_00,
        costDate: "2026-10-05",
        billedCents: 30_000_00,
        billDate: "2026-10-06",
      }),
    );
    await expect(
      run((tx) => postWip(tx, staffCtx, { entityId: entity, periodEnd: "2026-10-31" })),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const posted = await run((tx) => postWip(tx, ctx, { entityId: entity, periodEnd: "2026-10-31" }));
    expect(posted.period.status).toBe("posted");
    expect(posted.period.entryId).toBe(posted.entryId);
    expect(posted.period.reversalEntryId).toBe(posted.reversalEntryId);

    const read = await run(async (tx) => {
      const [entry] = await tx
        .select()
        .from(schema.journalEntries)
        .where(eq(schema.journalEntries.id, posted.entryId));
      const [reversal] = await tx
        .select()
        .from(schema.journalEntries)
        .where(eq(schema.journalEntries.id, posted.reversalEntryId));
      const lines = await tx
        .select()
        .from(schema.journalLines)
        .where(inArray(schema.journalLines.entryId, [posted.entryId, posted.reversalEntryId]));
      const dims = await tx
        .select({ journalLineId: schema.lineDimensions.journalLineId, memberId: schema.lineDimensions.memberId })
        .from(schema.lineDimensions)
        .where(
          and(
            eq(schema.lineDimensions.tenantId, tenantId),
            inArray(schema.lineDimensions.journalLineId, lines.map((l) => l.id)),
          ),
        );
      const [member] = await memberFor(tx, project.id);
      return { entry, reversal, dims, member };
    });
    expect(read.entry).toMatchObject({
      source: "wip_adjustment",
      entryDate: "2026-10-31",
      status: "posted",
      entityId: entity,
      sourceId: posted.period.id,
    });
    expect(read.reversal).toMatchObject({
      source: "wip_adjustment",
      entryDate: "2026-11-01",
      status: "posted",
      reversesEntryId: posted.entryId,
    });
    // Under-billed by 20,000: Dr 1240 / Cr 4030, one pair, tagged with the job; the reversal negated.
    expect(await entryLines(posted.entryId)).toEqual([["1240", 20_000_00], ["4030", -20_000_00]]);
    expect(await entryLines(posted.reversalEntryId)).toEqual([["1240", -20_000_00], ["4030", 20_000_00]]);
    expect(read.dims).toHaveLength(4);
    expect(new Set(read.dims.map((d) => d.memberId))).toEqual(new Set([read.member.id]));

    // The ledger reads EARNED revenue at the period end and BILLINGS the day after.
    const revenue = (asOf: string) =>
      run(async (tx) => {
        const rows = await getBalances(tx, tenantId, {
          scope: { kind: "one", entityId: entity },
          asOf,
          accountIds: [await accountByCodeId(tx, "4030")],
          groupByDimensionType: PROJECT_DIMENSION,
        });
        return rows.find((r) => r.memberId === read.member.id)?.netCents ?? 0;
      });
    expect(await revenue("2026-10-31")).toBe(-50_000_00);
    expect(await revenue("2026-11-01")).toBe(-30_000_00);

    // FROZEN: more cost after posting changes nothing the period says, and the next period reads it.
    await run((tx) => postCost(tx, entity, project.id, 60_000_00, "2026-10-20"));
    const again = await run((tx) => wipSchedule(tx, tenantId, { entityId: entity, periodEnd: "2026-10-31" }));
    expect(again.period?.status).toBe("posted");
    expect(again.rows[0].figures).toMatchObject({
      costToDateCents: 40_000_00,
      percentCompletePpm: 500_000,
      earnedCents: 50_000_00,
    });
    const next = await run((tx) => wipSchedule(tx, tenantId, { entityId: entity, periodEnd: "2026-11-30" }));
    expect(next.rows[0].figures).toMatchObject({
      costToDateCents: 100_000_00,
      percentCompletePpm: 1_000_000,
      earnedCents: 100_000_00,
      billedCents: 30_000_00,
    });
    await expect(
      run((tx) => postWip(tx, ctx, { entityId: entity, periodEnd: "2026-10-31" })),
    ).rejects.toMatchObject({ code: "INVALID_STATUS" });
    expect((await run((tx) => listWipPeriods(tx, tenantId, entity))).map((p) => p.periodEnd)).toEqual([
      "2026-10-31",
    ]);
  });

  it("an estimate typed for the period replaces the budget for THAT period, and can turn an under-billing into an over-billing", async () => {
    const entity = await newCompany("WIP Co 3");
    const { project } = await run((tx) =>
      wipJob(tx, entity, "OPS-W4", {
        contractCents: 100_000_00,
        budgetCents: 80_000_00,
        costCents: 40_000_00,
        billedCents: 30_000_00,
      }),
    );
    const at = (estimateCents: number | null, notes?: string) => ({
      entityId: entity,
      periodEnd: "2026-09-30",
      projectId: project.id,
      estimateCents,
      notes,
    });
    await expect(run((tx) => saveWipEstimate(tx, staffCtx, at(1)))).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(run((tx) => saveWipEstimate(tx, ctx, at(-1)))).rejects.toMatchObject({ code: "INVALID_VALUE" });
    const line = await run((tx) => saveWipEstimate(tx, ctx, at(200_000_00, "sub prices came in high")));
    expect(line.estimateCents).toBe(200_000_00);

    const s = await run((tx) => wipSchedule(tx, tenantId, { entityId: entity, periodEnd: "2026-09-30" }));
    expect(s.period?.status).toBe("draft");
    expect(s.rows[0]).toMatchObject({
      estimateCents: 200_000_00,
      budgetCents: 80_000_00,
      notes: "sub prices came in high",
    });
    expect(s.rows[0].figures).toMatchObject({
      estimatedCostCents: 200_000_00,
      percentCompletePpm: 200_000,
      earnedCents: 20_000_00,
      overBilledCents: 10_000_00,
      underBilledCents: 0,
    });
    // The next period has no estimate of its own and falls back to the budget.
    const next = await run((tx) => wipSchedule(tx, tenantId, { entityId: entity, periodEnd: "2026-10-31" }));
    expect(next.rows[0].estimateCents).toBeNull();
    expect(next.rows[0].figures.estimatedCostCents).toBe(80_000_00);
    // Blank puts the budget back.
    await run((tx) => saveWipEstimate(tx, ctx, at(null)));
    const back = await run((tx) => wipSchedule(tx, tenantId, { entityId: entity, periodEnd: "2026-09-30" }));
    expect(back.rows[0].figures.estimatedCostCents).toBe(80_000_00);

    // Over-billed posts the other way: Dr revenue / Cr 2420.
    await run((tx) => saveWipEstimate(tx, ctx, at(200_000_00)));
    const posted = await run((tx) => postWip(tx, ctx, { entityId: entity, periodEnd: "2026-09-30" }));
    expect(await entryLines(posted.entryId)).toEqual([["2420", -10_000_00], ["4030", 10_000_00]]);
    // A posted period's estimate is frozen with it.
    await expect(run((tx) => saveWipEstimate(tx, ctx, at(1)))).rejects.toMatchObject({ code: "INVALID_STATUS" });
    const frozen = await run((tx) => wipSchedule(tx, tenantId, { entityId: entity, periodEnd: "2026-09-30" }));
    expect(frozen.rows[0]).toMatchObject({ estimateCents: 200_000_00 });
    expect(frozen.rows[0].figures.overBilledCents).toBe(10_000_00);
  });

  it("refuses what it cannot measure or must not do: no estimate, billings without a value, nothing to post, a period behind the last, a chart without the account", async () => {
    // No budget and no estimate — named.
    const one = await newCompany("WIP Co 4a");
    const { project: bare } = await run((tx) =>
      wipJob(tx, one, "OPS-W5", { contractCents: 100_000_00, costCents: 10_000_00 }),
    );
    await expect(
      run((tx) => postWip(tx, ctx, { entityId: one, periodEnd: "2026-09-30" })),
    ).rejects.toMatchObject({ code: "ESTIMATE_REQUIRED", message: "OPS-W5" });
    await run((tx) =>
      saveWipEstimate(tx, ctx, { entityId: one, periodEnd: "2026-09-30", projectId: bare.id, estimateCents: 50_000_00 }),
    );
    const fixed = await run((tx) => postWip(tx, ctx, { entityId: one, periodEnd: "2026-09-30" }));
    expect(await entryLines(fixed.entryId)).toEqual([["1240", 20_000_00], ["4030", -20_000_00]]);

    // Billings on a job with no fixed value — named.
    const two = await newCompany("WIP Co 4b");
    await run((tx) => wipJob(tx, two, "OPS-W6", { contractCents: null, billedCents: 10_000_00 }));
    await expect(
      run((tx) => postWip(tx, ctx, { entityId: two, periodEnd: "2026-09-30" })),
    ).rejects.toMatchObject({ code: "BILLED_NO_VALUE", message: "OPS-W6" });
    const twoRows = await run((tx) => wipSchedule(tx, tenantId, { entityId: two, periodEnd: "2026-09-30" }));
    expect(twoRows.rows[0].reason).toBe("no_value");
    expect(twoRows.blockers).toEqual(["OPS-W6 has billings but no fixed contract value"]);

    // Billings equal earned: nothing to post.
    const three = await newCompany("WIP Co 4c");
    await run((tx) =>
      wipJob(tx, three, "OPS-W7", {
        contractCents: 100_000_00,
        budgetCents: 80_000_00,
        costCents: 40_000_00,
        billedCents: 50_000_00,
      }),
    );
    await expect(
      run((tx) => postWip(tx, ctx, { entityId: three, periodEnd: "2026-09-30" })),
    ).rejects.toMatchObject({ code: "NOTHING_TO_POST" });

    // A period behind the latest posted one.
    await expect(
      run((tx) => postWip(tx, ctx, { entityId: one, periodEnd: "2026-08-31" })),
    ).rejects.toMatchObject({ code: "NOT_FORWARD", message: "2026-09-30" });

    // A chart without 1240 cannot carry an under-billing; the refusal names the code.
    const four = await newCompany("WIP Co 4d");
    await run((tx) =>
      wipJob(tx, four, "OPS-W8", {
        contractCents: 100_000_00,
        budgetCents: 80_000_00,
        costCents: 40_000_00,
        billedCents: 30_000_00,
      }),
    );
    await run((tx) =>
      tx
        .update(schema.accounts)
        .set({ isActive: false })
        .where(and(eq(schema.accounts.tenantId, tenantId), eq(schema.accounts.code, "1240"))),
    );
    const before = await run((tx) => wipSchedule(tx, tenantId, { entityId: four, periodEnd: "2026-09-30" }));
    expect(before.missingAccounts).toEqual(["1240"]);
    await expect(
      run((tx) => postWip(tx, ctx, { entityId: four, periodEnd: "2026-09-30" })),
    ).rejects.toMatchObject({ code: "ACCOUNT_MISSING", message: expect.stringContaining("1240") });
    await run((tx) =>
      tx
        .update(schema.accounts)
        .set({ isActive: true })
        .where(and(eq(schema.accounts.tenantId, tenantId), eq(schema.accounts.code, "1240"))),
    );
    // Five companies and six billed jobs: the slowest test in the file by design.
  }, 120_000);

  it("UNPOST voids both entries, only for the latest period, keeps the estimate, and a re-post is a NEW pair", async () => {
    const entity = await newCompany("WIP Co 5");
    const { project } = await run((tx) =>
      wipJob(tx, entity, "OPS-W9", {
        contractCents: 100_000_00,
        budgetCents: 80_000_00,
        costCents: 40_000_00,
        billedCents: 30_000_00,
      }),
    );
    await run((tx) =>
      saveWipEstimate(tx, ctx, { entityId: entity, periodEnd: "2026-09-30", projectId: project.id, estimateCents: 100_000_00 }),
    );
    const sep = await run((tx) => postWip(tx, ctx, { entityId: entity, periodEnd: "2026-09-30" }));
    const oct = await run((tx) => postWip(tx, ctx, { entityId: entity, periodEnd: "2026-10-31" }));
    await expect(run((tx) => unpostWip(tx, ctx, sep.period.id))).rejects.toMatchObject({
      code: "NOT_LATEST_PERIOD",
      message: "2026-10-31",
    });
    await expect(run((tx) => unpostWip(tx, staffCtx, oct.period.id))).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      run((tx) => unpostWip(tx, ctx, oct.period.id, { version: oct.period.version + 5 })),
    ).rejects.toMatchObject({ code: "STALE_VERSION" });

    const back = await run((tx) => unpostWip(tx, ctx, oct.period.id, { version: oct.period.version }));
    expect(back).toMatchObject({ status: "draft", entryId: null, reversalEntryId: null, postedOn: null });
    const statuses = await run(async (tx) =>
      (
        await tx
          .select({ status: schema.journalEntries.status })
          .from(schema.journalEntries)
          .where(inArray(schema.journalEntries.id, [oct.entryId, oct.reversalEntryId]))
      ).map((r) => r.status),
    );
    expect(statuses).toEqual(["void", "void"]);

    // September is now the latest and can go too; its estimate survives.
    await run((tx) => unpostWip(tx, ctx, sep.period.id));
    const s = await run((tx) => wipSchedule(tx, tenantId, { entityId: entity, periodEnd: "2026-09-30" }));
    expect(s.period?.status).toBe("draft");
    expect(s.rows[0].estimateCents).toBe(100_000_00);
    expect(s.rows[0].figures.percentCompletePpm).toBe(400_000);

    // Posting again makes a new pair rather than reviving the voided one.
    const again = await run((tx) => postWip(tx, ctx, { entityId: entity, periodEnd: "2026-09-30" }));
    expect(again.entryId).not.toBe(sep.entryId);
    const status = await run(async (tx) =>
      (
        await tx
          .select({ status: schema.journalEntries.status })
          .from(schema.journalEntries)
          .where(eq(schema.journalEntries.id, again.entryId))
      )[0].status,
    );
    expect(status).toBe("posted");
    expect(await entryLines(again.entryId)).toEqual([["1240", 10_000_00], ["4030", -10_000_00]]);
  });

  it("the CASH lens drops the adjustment whole: no 1240 balance under cash, the full one under accrual", async () => {
    const entity = await newCompany("WIP Co 6");
    await run((tx) =>
      wipJob(tx, entity, "OPS-W10", {
        contractCents: 100_000_00,
        budgetCents: 80_000_00,
        costCents: 40_000_00,
        billedCents: 30_000_00,
      }),
    );
    await run((tx) => postWip(tx, ctx, { entityId: entity, periodEnd: "2026-09-30" }));
    const balance = (basis: "accrual" | "cash") =>
      run(async (tx) => {
        const rows = await getBalances(tx, tenantId, {
          scope: { kind: "one", entityId: entity },
          asOf: "2026-09-30",
          basis,
          accountIds: [await accountByCodeId(tx, "1240")],
        });
        return rows.reduce((sum, r) => sum + r.netCents, 0);
      });
    expect(await balance("accrual")).toBe(20_000_00);
    expect(await balance("cash")).toBe(0);
  });

  // ------------------------------------------------------- per-code actual

  it("THE SPENT COLUMN: actual per code on THIS job only, the uncoded remainder said, and Left against the greater of ordered and spent", async () => {
    const entity = await newCompany("Per-code Co");
    const set = await run((tx) => createCostCodeSet(tx, ctx, { name: "Per-code codes" }));
    const [conc, carp, paint] = await run((tx) =>
      Promise.all([
        createCostCode(tx, ctx, { setId: set.id, code: "PC-03", name: "Concrete", sortOrder: 10 }),
        createCostCode(tx, ctx, { setId: set.id, code: "PC-06", name: "Carpentry", sortOrder: 20 }),
        createCostCode(tx, ctx, { setId: set.id, code: "PC-09", name: "Painting", sortOrder: 30 }),
      ]),
    );
    const { project } = await run((tx) => wipJob(tx, entity, "OPS-PC1", { contractCents: 500_000_00 }));
    const { project: other } = await run((tx) => wipJob(tx, entity, "OPS-PC2", { contractCents: 500_000_00 }));
    const party = await run((tx) => seedVendor(tx, "Per-code Supply"));
    await run(async (tx) => {
      await setBudgetLines(tx, ctx, project.id, [
        { costCodeId: conc.id, originalCents: 40_000_00 },
        { costCodeId: carp.id, originalCents: 60_000_00 },
      ]);
      await createCommitment(tx, ctx, {
        projectId: project.id,
        partyId: party,
        number: "PO-PC-1",
        status: "issued",
        lines: [
          { costCodeId: conc.id, amountCents: 35_000_00 },
          { costCodeId: carp.id, amountCents: 72_000_00 },
        ],
      });
    });
    const codeMember = async (tx: Tx, codeId: string) => {
      const rows = await tx
        .select({ id: schema.dimensionMembers.id })
        .from(schema.dimensionMembers)
        .where(
          and(
            eq(schema.dimensionMembers.tenantId, tenantId),
            eq(schema.dimensionMembers.dimensionType, COST_CODE_DIMENSION),
            eq(schema.dimensionMembers.packEntityId, codeId),
          ),
        );
      return rows[0].id;
    };
    // Spend, tagged with the job AND a code — and some with the job alone.
    await run(async (tx) => {
      const [job] = await memberFor(tx, project.id);
      const [otherJob] = await memberFor(tx, other.id);
      const expense = await accountByCodeId(tx, "5200");
      const ap = await accountByCodeId(tx, "2000");
      const line = (cents: number, dims: string[]) => ({
        accountId: expense,
        amountCents: cents,
        dimensionMemberIds: dims,
      });
      await postEntry(tx, ctx, {
        entityId: entity,
        status: "posted",
        entryDate: "2026-09-15",
        memo: "bills coded to the job",
        lines: [
          line(12_000_00, [job.id, await codeMember(tx, conc.id)]),
          // Billed BEYOND what was ordered on carpentry.
          line(80_000_00, [job.id, await codeMember(tx, carp.id)]),
          // Spent on a code nobody budgeted or ordered.
          line(1_500_00, [job.id, await codeMember(tx, paint.id)]),
          // On the job, no code.
          line(3_000_00, [job.id]),
          // The OTHER job's concrete — must never reach this report.
          line(999_000_00, [otherJob.id, await codeMember(tx, conc.id)]),
          { accountId: ap, amountCents: -(12_000_00 + 80_000_00 + 1_500_00 + 3_000_00 + 999_000_00) },
        ],
      });
    });

    const report = await run((tx) => jobCostReport(tx, tenantId, project.id));
    expect(report.rows.map((r) => r.code)).toEqual(["PC-03", "PC-06", "PC-09"]);
    const [c, k, p] = report.rows;
    // Concrete: ordered 35,000 is the larger, so Left is measured against it.
    expect(c).toMatchObject({ actualCents: 12_000_00, committedCents: 35_000_00, projectedCents: 35_000_00, varianceCents: 5_000_00 });
    // Carpentry: spent 80,000 beyond the 72,000 ordered — projected is the spend, and the code is 20,000 over.
    expect(k).toMatchObject({ actualCents: 80_000_00, projectedCents: 80_000_00, varianceCents: -20_000_00 });
    // Painting: spent against, never budgeted or ordered — a row, flagged.
    expect(p).toMatchObject({ actualCents: 1_500_00, committedCents: 0, hasBudget: false });
    // The uncoded remainder is said, and the total is what the ledger says the job cost.
    expect(report.uncodedActualCents).toBe(3_000_00);
    expect(report.actualCents).toBe(96_500_00);
    // The other job's 999,000 on the same code is nowhere in this report.
    expect(report.rows.some((r) => r.actualCents >= 999_000_00)).toBe(false);
    // ...and the whole-job figure the page shows agrees.
    const byProject = await run((tx) => actualByProject(tx, tenantId, { kind: "one", entityId: entity }));
    expect(byProject.get(project.id)).toBe(96_500_00);
    expect(byProject.get(other.id)).toBe(999_000_00);
  });
});
