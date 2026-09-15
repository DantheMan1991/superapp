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
  createCommitmentChangeOrder,
  createPayApplication,
  issuePayApplication,
  listPayApplications,
  payApplicationCertificate,
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
  listCommitmentChangeOrders,
  listCommitments,
  setBudgetLines,
  updateChangeOrder,
  updateCommitment,
  updateCommitmentChangeOrder,
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
import {
  approveSubApplication,
  commitmentBilling,
  createSubApplication,
  listSubApplications,
  updateSubApplication,
  voidSubApplication,
} from "../src/packs/jobs/sub-billing-ops";
import { loadBill, loadBillLines } from "../src/modules/accounting/payables/bills";
import {
  askForWaiver,
  createLienWaiver,
  listLienWaivers,
  listWaiverWork,
  updateLienWaiver,
  waiverCoverage,
  waiverGaps,
} from "../src/packs/jobs/compliance-ops";
import {
  createSelection,
  listSelectionWork,
  listSelections,
  raiseSelectionChangeOrder,
  remindSelection,
  summarise,
  updateSelection,
} from "../src/packs/jobs/selections-ops";
import { certificateInputFrom } from "../src/packs/jobs/certificate";
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
        // A DRAFT: an issued order's lines are locked since 4b (ADR 0065), and the change-order test says so.
        status: "draft",
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
    // Two posts, an unpost and a re-post: four entries and their voids. Slow under load.
  }, 120_000);

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

  // ---------------------------------------------------------- cost plus a fee

  /** A cost-plus contract on its own company, with a party to bill. */
  const costPlusJob = async (
    tx: Tx,
    entity: string,
    number: string,
    terms: { feePpm?: number | null; feeCents?: number | null; gmaxCents?: number | null },
  ) => {
    await ensureBilling(tx);
    const project = await createProject(tx, ctx, { entityId: entity, number, name: `Cost plus ${number}` });
    const party = await seedVendor(tx, `Owner ${number}`);
    const contract = await createContract(tx, ctx, {
      projectId: project.id,
      kind: "cost_plus",
      counterpartyPartyId: party,
      billingMethod: "cost_plus_fee",
      valueCents: null,
      feePpm: terms.feePpm ?? null,
      feeCents: terms.feeCents ?? null,
      gmaxCents: terms.gmaxCents ?? null,
      status: "signed",
    });
    return { project, contract };
  };

  /** Cost on the job tagged with a code, or with the job alone when `codeId` is null. */
  const postCodedCost = async (
    tx: Tx,
    entity: string,
    projectId: string,
    codeId: string | null,
    cents: number,
    date: string,
  ) => {
    const [job] = await memberFor(tx, projectId);
    const dims = [job.id];
    if (codeId) {
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
      dims.push(rows[0].id);
    }
    await postEntry(tx, ctx, {
      entityId: entity,
      status: "posted",
      entryDate: date,
      memo: "job cost",
      lines: [
        { accountId: await accountByCodeId(tx, "5200"), amountCents: cents, dimensionMemberIds: dims },
        { accountId: await accountByCodeId(tx, "2000"), amountCents: -cents },
      ],
    });
  };

  it("COST PLUS A FEE: the draft's lines are the books' cost by code, the fee is on the total, and the invoice carries cost, fee and retainage", async () => {
    const entity = await newCompany("Cost Plus Co 1");
    const { project, contract } = await run((tx) => costPlusJob(tx, entity, "OPS-CP1", { feePpm: 150_000 }));
    expect(contract.feePpm).toBe(150_000);
    expect(contract.billingMethod).toBe("cost_plus_fee");
    const set = await run((tx) => createCostCodeSet(tx, ctx, { name: "CP1 codes" }));
    const [conc, carp] = await run((tx) =>
      Promise.all([
        createCostCode(tx, ctx, { setId: set.id, code: "CP-03", name: "Concrete", sortOrder: 10 }),
        createCostCode(tx, ctx, { setId: set.id, code: "CP-06", name: "Carpentry", sortOrder: 20 }),
      ]),
    );
    await run(async (tx) => {
      await postCodedCost(tx, entity, project.id, conc.id, 40_000_00, "2026-09-05");
      await postCodedCost(tx, entity, project.id, null, 2_000_00, "2026-09-08");
      // Dated after the period end: not on this application.
      await postCodedCost(tx, entity, project.id, carp.id, 9_000_00, "2026-10-02");
    });

    // No schedule of values needed.
    const app = await run((tx) =>
      createPayApplication(tx, ctx, { contractId: contract.id, periodTo: "2026-09-30", retainagePpm: 100_000 }),
    );
    const [row] = await run((tx) => listPayApplications(tx, tenantId, contract.id));
    expect(row.lines).toEqual([]);
    expect(row.costs.map((c) => [c.code, c.ledgerToDateCents, c.previousCents, c.thisPeriodCents])).toEqual([
      ["CP-03", 40_000_00, 0, 40_000_00],
      [null, 2_000_00, 0, 2_000_00],
    ]);
    expect(row.costPlus).toMatchObject({
      costToDateCents: 42_000_00,
      feeToDateCents: 6_300_00,
      completedToDateCents: 48_300_00,
      retainageCents: 4_830_00,
      dueCents: 43_470_00,
      capped: false,
    });

    const issued = await run((tx) => issuePayApplication(tx, ctx, app.id, { issueDate: "2026-10-01" }));
    expect(issued.app).toMatchObject({
      status: "issued",
      costToDateCents: 42_000_00,
      feeToDateCents: 6_300_00,
      completedToDateCents: 48_300_00,
      retainageCents: 4_830_00,
      dueCents: 43_470_00,
      scheduledCents: 0,
    });
    const { lines, entryLines: el, accounts } = await run(async (tx) => {
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
      return { lines, entryLines, accounts };
    });
    const codeOf = new Map(accounts.map((a) => [a.id, a.code]));
    // Cost, then the fee, then retainage: three lines a client can read.
    expect(lines.map((l) => [codeOf.get(l.incomeAccountId), l.amountCents, l.description])).toEqual([
      ["4030", 42_000_00, "Application 1 — cost incurred through 2026-09-30"],
      ["4030", 6_300_00, "Fee (15% of cost)"],
      ["1230", -4_830_00, "Retainage withheld (10%)"],
    ]);
    const netByCode = new Map<string | undefined, number>();
    for (const l of el) netByCode.set(codeOf.get(l.accountId), (netByCode.get(codeOf.get(l.accountId)) ?? 0) + l.amountCents);
    expect(netByCode.get("1200")).toBe(43_470_00);
    expect(netByCode.get("1230")).toBe(4_830_00);
    expect(netByCode.get("4030")).toBe(-48_300_00);
  });

  it("the NEXT application bills what the books added since — a late-posted bill included — and a line typed short stays short", async () => {
    const entity = await newCompany("Cost Plus Co 2");
    const { project, contract } = await run((tx) => costPlusJob(tx, entity, "OPS-CP2", { feePpm: 100_000 }));
    const set = await run((tx) => createCostCodeSet(tx, ctx, { name: "CP2 codes" }));
    const conc = await run((tx) => createCostCode(tx, ctx, { setId: set.id, code: "CP2-03", name: "Concrete" }));
    await run((tx) => postCodedCost(tx, entity, project.id, conc.id, 40_000_00, "2026-09-05"));
    const first = await run((tx) =>
      createPayApplication(tx, ctx, { contractId: contract.id, periodTo: "2026-09-30", retainagePpm: 0 }),
    );
    // Leave 5,000 of the 40,000 unbilled — a disputed bill.
    await run((tx) =>
      updatePayApplication(tx, ctx, first.id, { costLines: [{ costCodeId: conc.id, thisPeriodCents: 35_000_00 }] }),
    );
    const one = await run((tx) => issuePayApplication(tx, ctx, first.id, { issueDate: "2026-10-01" }));
    expect(one.app.costToDateCents).toBe(35_000_00);
    expect(one.app.feeToDateCents).toBe(3_500_00);
    expect(one.app.dueCents).toBe(38_500_00);

    // A bill dated INSIDE September, posted after the first application issued.
    await run((tx) => postCodedCost(tx, entity, project.id, conc.id, 10_000_00, "2026-09-20"));
    await run((tx) => postCodedCost(tx, entity, project.id, conc.id, 20_000_00, "2026-10-15"));
    const second = await run((tx) =>
      createPayApplication(tx, ctx, { contractId: contract.id, periodTo: "2026-10-31" }),
    );
    const [, row] = await run((tx) => listPayApplications(tx, tenantId, contract.id));
    // Books 70,000 to date; 35,000 billed before; the default bills the rest — the
    // late bill AND the disputed 5,000, which the person may leave out again.
    expect(row.costs.map((c) => [c.code, c.ledgerToDateCents, c.previousCents, c.thisPeriodCents])).toEqual([
      ["CP2-03", 70_000_00, 35_000_00, 35_000_00],
    ]);
    await run((tx) =>
      updatePayApplication(tx, ctx, second.id, { costLines: [{ costCodeId: conc.id, thisPeriodCents: 30_000_00 }] }),
    );
    // Saving again refreshes the books' figure and keeps what was typed.
    await run((tx) => postCodedCost(tx, entity, project.id, conc.id, 1_000_00, "2026-10-20"));
    await run((tx) => updatePayApplication(tx, ctx, second.id, { notes: "still disputing the 5,000" }));
    const [, again] = await run((tx) => listPayApplications(tx, tenantId, contract.id));
    expect(again.costs[0]).toMatchObject({ ledgerToDateCents: 71_000_00, previousCents: 35_000_00, thisPeriodCents: 30_000_00 });
    const two = await run((tx) => issuePayApplication(tx, ctx, second.id, { issueDate: "2026-11-01" }));
    expect(two.app.costToDateCents).toBe(65_000_00);
    expect(two.app.feeToDateCents).toBe(6_500_00);
    expect(two.app.previousCertificatesCents).toBe(38_500_00);
    expect(two.app.dueCents).toBe(71_500_00 - 38_500_00);
    // The invoice's cost line is THIS period's cost, the fee line this period's fee.
    const lines = await run(async (tx) => loadInvoiceLines(tx, tenantId, two.invoiceId));
    expect(lines.map((l) => l.amountCents)).toEqual([30_000_00, 3_000_00]);
  });

  it("a fixed fee is billed to date by hand, a guaranteed maximum caps the certificate in one line, and only one cost-plus contract may bill a job", async () => {
    const entity = await newCompany("Cost Plus Co 3");
    const { project, contract } = await run((tx) =>
      costPlusJob(tx, entity, "OPS-CP3", { feeCents: 10_000_00, gmaxCents: 50_000_00 }),
    );
    await run((tx) => postCodedCost(tx, entity, project.id, null, 45_000_00, "2026-09-05"));
    const app = await run((tx) =>
      createPayApplication(tx, ctx, { contractId: contract.id, periodTo: "2026-09-30" }),
    );
    await expect(
      run((tx) => updatePayApplication(tx, ctx, app.id, { feeToDateCents: 12_000_00 })),
    ).rejects.toMatchObject({ code: "INVALID_VALUE" });
    await run((tx) => updatePayApplication(tx, ctx, app.id, { feeToDateCents: 8_000_00 }));
    const [row] = await run((tx) => listPayApplications(tx, tenantId, contract.id));
    // 45,000 + 8,000 = 53,000, held to the 50,000 maximum.
    expect(row.costPlus).toMatchObject({
      costToDateCents: 45_000_00,
      feeToDateCents: 8_000_00,
      completedToDateCents: 50_000_00,
      capped: true,
      balanceToFinishCents: 0,
    });
    const issued = await run((tx) => issuePayApplication(tx, ctx, app.id, { issueDate: "2026-10-01" }));
    expect(issued.app.completedToDateCents).toBe(50_000_00);
    expect(issued.app.scheduledCents).toBe(50_000_00);
    const lines = await run((tx) => loadInvoiceLines(tx, tenantId, issued.invoiceId));
    expect(lines.map((l) => [l.amountCents, l.description])).toEqual([
      [50_000_00, "Application 1 — cost plus fee through 2026-09-30, at the guaranteed maximum"],
    ]);

    // A second cost-plus contract on the SAME job would bill the same dollars.
    const party = await run((tx) => seedVendor(tx, "Second owner"));
    const rival = await run((tx) =>
      createContract(tx, ctx, {
        projectId: project.id,
        kind: "cost_plus",
        counterpartyPartyId: party,
        billingMethod: "cost_plus_fee",
        feePpm: 50_000,
        status: "signed",
      }),
    );
    await expect(
      run((tx) => createPayApplication(tx, ctx, { contractId: rival.id, periodTo: "2026-10-31" })),
    ).rejects.toMatchObject({ code: "ONE_COST_PLUS" });
  });

  it("refuses a cost-plus draft with nothing in the books, a fee outside its range, and a negative maximum; a fixed-price contract is untouched", async () => {
    const entity = await newCompany("Cost Plus Co 4");
    const { contract } = await run((tx) => costPlusJob(tx, entity, "OPS-CP4", { feePpm: 100_000 }));
    const app = await run((tx) =>
      createPayApplication(tx, ctx, { contractId: contract.id, periodTo: "2026-09-30" }),
    );
    await expect(
      run((tx) => issuePayApplication(tx, ctx, app.id, { issueDate: "2026-10-01" })),
    ).rejects.toMatchObject({ code: "NO_LINES" });
    await expect(
      run((tx) => updateContract(tx, ctx, contract.id, { feePpm: 2_000_000 })),
    ).rejects.toMatchObject({ code: "INVALID_VALUE" });
    await expect(
      run((tx) => updateContract(tx, ctx, contract.id, { gmaxCents: -1 })),
    ).rejects.toMatchObject({ code: "INVALID_VALUE" });
    // A fixed-price contract on the same company still wants its schedule first.
    const { contract: fixed } = await run((tx) => billableContract(tx, "OPS-CP4F"));
    await expect(
      run((tx) => createPayApplication(tx, ctx, { contractId: fixed.id, periodTo: "2026-09-30" })),
    ).rejects.toMatchObject({ code: "NO_LINES" });
  });

  it("WORK IN PROGRESS on a cost-plus job earns cost plus fee, capped, with no estimate asked for", async () => {
    const entity = await newCompany("Cost Plus Co 5");
    const { project, contract } = await run((tx) =>
      costPlusJob(tx, entity, "OPS-CP5", { feePpm: 150_000, gmaxCents: 45_000_00 }),
    );
    await run((tx) => postCodedCost(tx, entity, project.id, null, 40_000_00, "2026-09-05"));
    const app = await run((tx) =>
      createPayApplication(tx, ctx, { contractId: contract.id, periodTo: "2026-09-15" }),
    );
    await run((tx) => issuePayApplication(tx, ctx, app.id, { issueDate: "2026-09-16" }));
    const s = await run((tx) => wipSchedule(tx, tenantId, { entityId: entity, periodEnd: "2026-09-30" }));
    const row = s.rows.find((r) => r.projectId === project.id)!;
    expect(row.method).toBe("cost_plus");
    expect(row.reason).toBe("");
    expect(row.figures.percentCompletePpm).toBeNull();
    // 40,000 + 6,000 fee = 46,000, capped at 45,000; billed 45,000 (the application hit the cap too).
    expect(row.figures.earnedCents).toBe(45_000_00);
    expect(row.figures.billedCents).toBe(45_000_00);
    expect(row.figures.overUnderCents).toBe(0);
    expect(s.blockers).toEqual([]);
    // A job carrying a fixed-price contract beside the cost-plus one is not measured this way.
    const party = await run((tx) => seedVendor(tx, "Fixed beside"));
    await run((tx) =>
      createContract(tx, ctx, { projectId: project.id, kind: "extra", counterpartyPartyId: party, valueCents: 10_000_00, status: "signed" }),
    );
    const mixed = await run((tx) => wipSchedule(tx, tenantId, { entityId: entity, periodEnd: "2026-09-30" }));
    expect(mixed.rows.find((r) => r.projectId === project.id)!.method).toBe("cost_to_cost");
  });

  // ---------------------------------------------------------- unit price (5f)

  it("UNIT PRICE: items are worth their estimates at their prices, an application bills quantities at those prices, the invoice reads item by item, and the next application carries quantities forward past the estimate", async () => {
    const { project, contract } = await run(async (tx) => {
      await ensureBilling(tx);
      const p = await createProject(tx, ctx, { entityId, number: "OPS-UP1", name: "Lane drainage" });
      const party = await seedVendor(tx, "Owner OPS-UP1");
      const c = await createContract(tx, ctx, {
        projectId: p.id,
        kind: "site_work",
        counterpartyPartyId: party,
        billingMethod: "unit_price",
        valueCents: 50_000_00,
        status: "signed",
      });
      return { project: p, contract: c };
    });
    expect(project.number).toBe("OPS-UP1");
    const sov = await run((tx) =>
      saveSovLines(tx, ctx, contract.id, [
        { description: "Excavation", scheduledCents: 1, unit: "cy", quantityThousandths: 1_000_000, unitPriceCents: 18_00 },
        { description: "Pipe", scheduledCents: 0, unit: "lf", quantityThousandths: 2_000_000, unitPriceCents: 12_50 },
        { description: "Manholes", scheduledCents: 0, unit: "ea", quantityThousandths: 4_000, unitPriceCents: 1_750_00 },
      ]),
    );
    // The typed value is ignored: an item is worth its estimate at its price.
    expect(sov.map((l) => [l.description, l.unit, l.scheduledCents])).toEqual([
      ["Excavation", "cy", 18_000_00],
      ["Pipe", "lf", 25_000_00],
      ["Manholes", "ea", 7_000_00],
    ]);
    // Both or neither.
    await expect(
      run((tx) =>
        saveSovLines(tx, ctx, contract.id, [
          { description: "Half", scheduledCents: 0, unit: "cy", quantityThousandths: 5_000, unitPriceCents: null },
        ]),
      ),
    ).rejects.toMatchObject({ code: "INVALID_VALUE" });

    const app = await run((tx) =>
      createPayApplication(tx, ctx, { contractId: contract.id, periodTo: "2026-09-30", retainagePpm: 100_000 }),
    );
    await run((tx) =>
      updatePayApplication(tx, ctx, app.id, {
        lines: [
          // Money typed on a unit line is ignored: the quantity at the price is the money.
          { sovLineId: sov[0].id, thisPeriodCents: 999, storedCents: 0, quantityThisPeriodThousandths: 600_000 },
          { sovLineId: sov[1].id, thisPeriodCents: 0, storedCents: 0, quantityThisPeriodThousandths: 800_500 },
          { sovLineId: sov[2].id, thisPeriodCents: 0, storedCents: 0, quantityThisPeriodThousandths: 1_000 },
        ],
      }),
    );
    const [row] = await run((tx) => listPayApplications(tx, tenantId, contract.id));
    expect(row.lines.map((l) => [l.description, l.quantityThisPeriodThousandths, l.thisPeriodCents])).toEqual([
      ["Excavation", 600_000, 10_800_00],
      ["Pipe", 800_500, 10_006_25],
      ["Manholes", 1_000, 1_750_00],
    ]);
    expect(row.totals).toMatchObject({
      completedToDateCents: 22_556_25,
      retainageCents: 2_255_63,
      dueCents: 20_300_62,
    });

    const issued = await run((tx) => issuePayApplication(tx, ctx, app.id, { issueDate: "2026-10-01" }));
    const lines = await run(async (tx) =>
      loadInvoiceLines(tx, tenantId, (await loadInvoice(tx, tenantId, issued.invoiceId)).id),
    );
    // A unit-price invoice reads like one: a line per item with the quantity at its price.
    expect(lines.map((l) => [l.amountCents, l.description])).toEqual([
      [10_800_00, "Application 1 — Excavation, 600 cy at 18.00/cy through 2026-09-30"],
      [10_006_25, "Application 1 — Pipe, 800.5 lf at 12.50/lf through 2026-09-30"],
      [1_750_00, "Application 1 — Manholes, 1 ea at 1750.00/ea through 2026-09-30"],
      [-2_255_63, "Retainage withheld (10%)"],
    ]);

    // October: 500 cy more — past the 1,000 estimated, which unit price expects — and the quantities carry.
    const second = await run((tx) =>
      createPayApplication(tx, ctx, { contractId: contract.id, periodTo: "2026-10-31" }),
    );
    await run((tx) =>
      updatePayApplication(tx, ctx, second.id, {
        lines: [{ sovLineId: sov[0].id, thisPeriodCents: 0, storedCents: 0, quantityThisPeriodThousandths: 500_000 }],
      }),
    );
    const rows = await run((tx) => listPayApplications(tx, tenantId, contract.id));
    const ex = rows[1].lines.find((l) => l.description === "Excavation")!;
    expect([ex.quantityPreviousThousandths, ex.quantityThisPeriodThousandths, ex.previousCents, ex.thisPeriodCents]).toEqual([
      600_000,
      500_000,
      10_800_00,
      9_000_00,
    ]);
    expect(rows[1].totals.completedToDateCents).toBe(31_556_25);
    // A correction below nothing is refused.
    await expect(
      run((tx) =>
        updatePayApplication(tx, ctx, second.id, {
          lines: [{ sovLineId: sov[2].id, thisPeriodCents: 0, storedCents: 0, quantityThisPeriodThousandths: -2_000 }],
        }),
      ),
    ).rejects.toMatchObject({ code: "INVALID_VALUE" });
    // The certificate carries the units.
    const c = await run((tx) => payApplicationCertificate(tx, tenantId, second.id));
    expect(c!.row.lines.map((l) => [l.unit, l.unitPriceCents, l.sovQuantityThousandths])).toEqual([
      ["cy", 18_00, 1_000_000],
      ["lf", 12_50, 2_000_000],
      ["ea", 1_750_00, 4_000],
    ]);
    // And the certificate starts from the ESTIMATE, not from a maximum it does not have —
    // the drive found lines 1, 3 and 9 printing a dash.
    const input = certificateInputFrom(c!, { businessName: "Ops Builder LLC", tagline: "", primaryColor: null, logo: null });
    expect(input.method).toBe("unit_price");
    expect(input.originalCents).toBe(50_000_00);
    expect(input.lines[0]).toMatchObject({ unit: "cy", unitPriceCents: 18_00, quantityThousandths: 1_000_000, quantityPreviousThousandths: 600_000, quantityThisPeriodThousandths: 500_000 });
  }, 120_000);

  // -------------------------------------------------------- the printout (5e)

  it("THE CERTIFICATE READ carries the application with its contract, project, row, last certificate, approved change orders and the party, and null for a stranger", async () => {
    const { project, contract } = await run((tx) => billableContract(tx, "OPS-PR1", 100_000_00));
    expect(project.number).toBe("OPS-PR1");
    const [line] = await run((tx) =>
      saveSovLines(tx, ctx, contract.id, [{ description: "Everything", scheduledCents: 100_000_00 }]),
    );
    await run(async (tx) => {
      await createChangeOrder(tx, ctx, {
        contractId: contract.id,
        number: "CO-1",
        title: "Deck",
        status: "approved",
        approvedOn: "2026-08-15",
        valueCents: 5_000_00,
      });
      await createChangeOrder(tx, ctx, {
        contractId: contract.id,
        number: "CO-2",
        title: "Pool",
        status: "proposed",
        valueCents: 60_000_00,
      });
    });
    const first = await run((tx) =>
      createPayApplication(tx, ctx, { contractId: contract.id, periodTo: "2026-08-31", retainagePpm: 100_000 }),
    );
    await run((tx) =>
      updatePayApplication(tx, ctx, first.id, {
        lines: [{ sovLineId: line.id, thisPeriodCents: 30_000_00, storedCents: 0 }],
      }),
    );
    await run((tx) => issuePayApplication(tx, ctx, first.id, { issueDate: "2026-09-01" }));
    const second = await run((tx) =>
      createPayApplication(tx, ctx, { contractId: contract.id, periodTo: "2026-09-30" }),
    );
    const c = await run((tx) => payApplicationCertificate(tx, tenantId, second.id));
    expect(c).not.toBeNull();
    expect(c!.app.number).toBe(2);
    expect(c!.contract.id).toBe(contract.id);
    expect(c!.project.number).toBe("OPS-PR1");
    expect(c!.previous?.periodTo).toBe("2026-08-31");
    // Approved only, this contract only.
    expect(c!.changeOrders.map((r) => r.changeOrder.title)).toEqual(["Deck"]);
    expect(c!.row.lines.map((l) => [l.description, l.previousCents])).toEqual([["Everything", 30_000_00]]);
    expect(c!.row.totals.previousCertificatesCents).toBe(27_000_00);
    expect(c!.ownerName).toMatch(/^Owner OPS-PR1/);
    // Invoiced once, so a customer exists, with no address: the name alone.
    expect(c!.ownerAddress).toBe("");
    expect(await run((tx) => payApplicationCertificate(tx, tenantId, crypto.randomUUID()))).toBeNull();
  }, 120_000);

  // ------------------------------------------------ time and materials (5d)

  /** A person in Time: a party and a worker row. */
  const worker = async (tx: Tx, name: string): Promise<{ id: string; name: string }> => {
    const [party] = await tx
      .insert(schema.parties)
      .values({ tenantId, displayName: name, kind: "person" })
      .returning({ id: schema.parties.id });
    const [w] = await tx
      .insert(schema.timeWorkers)
      .values({ tenantId, partyId: party.id })
      .returning({ id: schema.timeWorkers.id });
    return { id: w.id, name };
  };

  /** A charged-out rate from a day, on a wage nobody here reads. */
  const billRate = (tx: Tx, workerId: string, billRateCents: number, effectiveOn: string) =>
    tx.insert(schema.timeRates).values({ tenantId, workerId, payRateCents: 20_00, billRateCents, effectiveOn });

  /** Time on a day: a worked entry tagged with the project's cost object, or with nothing when `projectId` is null. */
  const hours = async (
    tx: Tx,
    workerId: string,
    projectId: string | null,
    workDate: string,
    minutes: number,
    payType: "worked" | "paid_leave" = "worked",
  ) => {
    const [e] = await tx
      .insert(schema.timeEntries)
      .values({ tenantId, workerId, minutes, workDate, payType, enteredByClerkUserId: `${STAMP}-owner` })
      .returning({ id: schema.timeEntries.id });
    if (projectId) {
      const [member] = await memberFor(tx, projectId);
      await tx
        .insert(schema.timeEntryDimensions)
        .values({ tenantId, entryId: e.id, dimensionType: PROJECT_DIMENSION, memberId: member.id });
    }
  };

  /** A timesheet for the period, approved unless told otherwise — the gate the accrual and the application share. */
  const sheet = (tx: Tx, workerId: string, start: string, end: string, approved = true) =>
    tx.insert(schema.timeSheets).values({
      tenantId,
      workerId,
      periodStartsOn: start,
      periodEndsOn: end,
      submittedByClerkUserId: `${STAMP}-owner`,
      ...(approved
        ? { approvedAt: new Date(), approvedByClerkUserId: `${STAMP}-owner`, workedMinutes: 0 }
        : {}),
    });

  /** Wages in the books, tagged with the job: Dr 6450 Salaries & Wages / Cr 2300 Payroll Liabilities. */
  const postWages = async (tx: Tx, entity: string, projectId: string, cents: number, date: string) => {
    const [member] = await memberFor(tx, projectId);
    await postEntry(tx, ctx, {
      entityId: entity,
      status: "posted",
      entryDate: date,
      memo: "wages",
      lines: [
        { accountId: await accountByCodeId(tx, "6450"), amountCents: cents, dimensionMemberIds: [member.id] },
        { accountId: await accountByCodeId(tx, "2300"), amountCents: -cents },
      ],
    });
  };

  /** A job on a signed time-and-materials contract to a real party. */
  const tmJob = async (
    tx: Tx,
    entity: string,
    number: string,
    terms: { feePpm?: number | null; gmaxCents?: number | null; laborRateCents?: number | null },
  ) => {
    await ensureBilling(tx);
    const project = await createProject(tx, ctx, { entityId: entity, number, name: `T and M ${number}` });
    const party = await seedVendor(tx, `Owner ${number}`);
    const contract = await createContract(tx, ctx, {
      projectId: project.id,
      kind: "service",
      counterpartyPartyId: party,
      billingMethod: "time_and_materials",
      valueCents: null,
      feePpm: terms.feePpm ?? null,
      gmaxCents: terms.gmaxCents ?? null,
      laborRateCents: terms.laborRateCents ?? null,
      status: "signed",
    });
    return { project, contract };
  };

  it("TIME AND MATERIALS: approved hours at each person's rate, the books' cost without the wages marked up, and the invoice line by line", async () => {
    const entity = await newCompany("T and M Co 1");
    const { project, contract } = await run((tx) => tmJob(tx, entity, "OPS-TM1", { feePpm: 100_000 }));
    expect(contract.billingMethod).toBe("time_and_materials");
    expect(contract.laborRateCents).toBeNull();
    const set = await run((tx) => createCostCodeSet(tx, ctx, { name: "TM1 codes" }));
    const code = await run((tx) =>
      createCostCode(tx, ctx, { setId: set.id, code: "TM1-05", name: "Materials", sortOrder: 10 }),
    );
    const { alice, bob, carol } = await run(async (tx) => ({
      alice: await worker(tx, "Alice Carpenter"),
      bob: await worker(tx, "Bob Labourer"),
      carol: await worker(tx, "Carol Pending"),
    }));
    await run(async (tx) => {
      await billRate(tx, alice.id, 65_00, "2026-01-01");
      // Alice: eight hours and two on the job; one untagged; four of paid
      // leave tagged (a cost, never a charge); five after the period end.
      await hours(tx, alice.id, project.id, "2026-09-01", 480);
      await hours(tx, alice.id, project.id, "2026-09-02", 120);
      await hours(tx, alice.id, null, "2026-09-03", 60);
      await hours(tx, alice.id, project.id, "2026-09-04", 240, "paid_leave");
      await hours(tx, alice.id, project.id, "2026-10-02", 300);
      await sheet(tx, alice.id, "2026-08-31", "2026-09-13");
      await sheet(tx, alice.id, "2026-09-28", "2026-10-11");
      // Bob: three hours, approved, and no charged-out rate yet.
      await hours(tx, bob.id, project.id, "2026-09-01", 180);
      await sheet(tx, bob.id, "2026-08-31", "2026-09-13");
      // Carol: ninety minutes on a sheet nobody has approved.
      await hours(tx, carol.id, project.id, "2026-09-02", 90);
      await sheet(tx, carol.id, "2026-08-31", "2026-09-13", false);
      // Materials, marked up; wages in the books, not marked up — the hours cover them.
      await postCodedCost(tx, entity, project.id, code.id, 2_000_00, "2026-09-05");
      await postWages(tx, entity, project.id, 500_00, "2026-09-13");
    });

    const app = await run((tx) =>
      createPayApplication(tx, ctx, { contractId: contract.id, periodTo: "2026-09-30", retainagePpm: 100_000 }),
    );
    let [row] = await run((tx) => listPayApplications(tx, tenantId, contract.id));
    expect(
      row.labor.map((l) => [l.name, l.rateCents, l.minutesToDate, l.previousMinutes, l.thisPeriodMinutes, l.thisPeriodCents]),
    ).toEqual([
      ["Alice Carpenter", 65_00, 600, 0, 600, 650_00],
      ["Bob Labourer", 0, 180, 0, 180, 0],
    ]);
    expect(row.laborAwaitingMinutes).toBe(90);
    // The wages line is not among the costs.
    expect(row.costs.map((c) => [c.code, c.ledgerToDateCents, c.thisPeriodCents])).toEqual([
      ["TM1-05", 2_000_00, 2_000_00],
    ]);
    expect(row.costPlus).toMatchObject({
      laborToDateCents: 650_00,
      costToDateCents: 2_000_00,
      feeToDateCents: 200_00,
      completedToDateCents: 2_850_00,
      retainageCents: 285_00,
      dueCents: 2_565_00,
      capped: false,
    });

    // Bob's hours have no price: refused by name, never billed at nothing.
    await expect(
      run((tx) => issuePayApplication(tx, ctx, app.id, { issueDate: "2026-10-01" })),
    ).rejects.toMatchObject({ code: "NO_BILL_RATE", message: "Bob Labourer" });
    await run((tx) => billRate(tx, bob.id, 40_00, "2026-01-01"));
    // The draft was opened before the rate existed, so what it types back
    // names Bob at a rate of nothing; the hours follow him to his priced line.
    await run((tx) =>
      updatePayApplication(tx, ctx, app.id, {
        laborLines: [{ workerId: bob.id, rateCents: 0, thisPeriodMinutes: 150 }],
      }),
    );
    [row] = await run((tx) => listPayApplications(tx, tenantId, contract.id));
    expect(row.labor.map((l) => [l.name, l.rateCents, l.thisPeriodMinutes, l.thisPeriodCents])).toEqual([
      ["Alice Carpenter", 65_00, 600, 650_00],
      ["Bob Labourer", 40_00, 150, 100_00],
    ]);

    const issued = await run((tx) => issuePayApplication(tx, ctx, app.id, { issueDate: "2026-10-01" }));
    expect(issued.app).toMatchObject({
      status: "issued",
      laborToDateCents: 750_00,
      costToDateCents: 2_000_00,
      feeToDateCents: 200_00,
      completedToDateCents: 2_950_00,
      retainageCents: 295_00,
      dueCents: 2_655_00,
    });
    const { lines, accounts } = await run(async (tx) => {
      const invoice = await loadInvoice(tx, tenantId, issued.invoiceId);
      return {
        lines: await loadInvoiceLines(tx, tenantId, invoice.id),
        accounts: await tx
          .select({ id: schema.accounts.id, code: schema.accounts.code })
          .from(schema.accounts)
          .where(eq(schema.accounts.tenantId, tenantId)),
      };
    });
    const codeOf = new Map(accounts.map((a) => [a.id, a.code]));
    // A line per person the client can read against the timesheet, then cost, then markup, then retainage.
    expect(lines.map((l) => [codeOf.get(l.incomeAccountId), l.amountCents, l.description])).toEqual([
      ["4030", 650_00, "Application 1 — Alice Carpenter, 10 h at 65.00/h through 2026-09-30"],
      ["4030", 100_00, "Application 1 — Bob Labourer, 2.5 h at 40.00/h through 2026-09-30"],
      ["4030", 2_000_00, "Application 1 — cost incurred through 2026-09-30"],
      ["4030", 200_00, "Markup (10% of cost)"],
      ["1230", -295_00, "Retainage withheld (10%)"],
    ]);
    // The wages sit in the books on the job all the same: the Spent column sees them, the application does not.
    const spent = await run((tx) => jobCostReport(tx, tenantId, project.id));
    expect(spent.actualCents).toBe(2_500_00);
  }, 120_000);

  it("a flat rate bills everybody at it and is fixed once billed; a rate dated in Time starts a second line, the next application carries hours forward, hours typed short stay short, and one contract bills a job's books", async () => {
    const entity = await newCompany("T and M Co 2");
    // One rate for everybody, whatever Time says about Dan.
    const { project: flatJob, contract: flat } = await run((tx) =>
      tmJob(tx, entity, "OPS-TM2A", { laborRateCents: 80_00 }),
    );
    const dan = await run((tx) => worker(tx, "Dan Flat"));
    await run(async (tx) => {
      await billRate(tx, dan.id, 65_00, "2026-01-01");
      await hours(tx, dan.id, flatJob.id, "2026-09-05", 300);
      await sheet(tx, dan.id, "2026-08-31", "2026-09-13");
    });
    const flatApp = await run((tx) =>
      createPayApplication(tx, ctx, { contractId: flat.id, periodTo: "2026-09-30" }),
    );
    const [flatRow] = await run((tx) => listPayApplications(tx, tenantId, flat.id));
    expect(flatRow.labor.map((l) => [l.rateCents, l.thisPeriodMinutes, l.thisPeriodCents])).toEqual([
      [80_00, 300, 400_00],
    ]);
    await run((tx) => issuePayApplication(tx, ctx, flatApp.id, { issueDate: "2026-10-01" }));
    await expect(
      run((tx) => updateContract(tx, ctx, flat.id, { laborRateCents: 90_00 })),
    ).rejects.toMatchObject({ code: "RATE_LOCKED" });
    // Saying the same rate again is not a change.
    await run((tx) => updateContract(tx, ctx, flat.id, { laborRateCents: 80_00, notes: "same rate" }));

    // Each person's own rate, dated: Erin's went up mid-September.
    const { project, contract } = await run((tx) => tmJob(tx, entity, "OPS-TM2B", {}));
    const erin = await run((tx) => worker(tx, "Erin Dated"));
    await run(async (tx) => {
      await billRate(tx, erin.id, 65_00, "2026-01-01");
      await billRate(tx, erin.id, 70_00, "2026-09-16");
      await hours(tx, erin.id, project.id, "2026-09-10", 240);
      await hours(tx, erin.id, project.id, "2026-09-20", 120);
      await sheet(tx, erin.id, "2026-08-31", "2026-09-13");
      await sheet(tx, erin.id, "2026-09-14", "2026-09-27");
    });
    const first = await run((tx) =>
      createPayApplication(tx, ctx, { contractId: contract.id, periodTo: "2026-09-30" }),
    );
    let rows = await run((tx) => listPayApplications(tx, tenantId, contract.id));
    expect(rows[0].labor.map((l) => [l.rateCents, l.minutesToDate, l.thisPeriodCents])).toEqual([
      [65_00, 240, 260_00],
      [70_00, 120, 140_00],
    ]);
    const issuedFirst = await run((tx) => issuePayApplication(tx, ctx, first.id, { issueDate: "2026-10-01" }));
    expect(issuedFirst.app.laborToDateCents).toBe(400_00);

    // October: an hour more, on a sheet approved for it.
    await run(async (tx) => {
      await hours(tx, erin.id, project.id, "2026-10-05", 60);
      await sheet(tx, erin.id, "2026-09-28", "2026-10-11");
    });
    const second = await run((tx) =>
      createPayApplication(tx, ctx, { contractId: contract.id, periodTo: "2026-10-31" }),
    );
    rows = await run((tx) => listPayApplications(tx, tenantId, contract.id));
    expect(
      rows[1].labor.map((l) => [l.rateCents, l.minutesToDate, l.previousMinutes, l.thisPeriodMinutes, l.previousCents, l.thisPeriodCents]),
    ).toEqual([
      [65_00, 240, 240, 0, 260_00, 0],
      [70_00, 180, 120, 60, 140_00, 70_00],
    ]);
    // Half of it left for next time.
    await run((tx) =>
      updatePayApplication(tx, ctx, second.id, {
        laborLines: [{ workerId: erin.id, rateCents: 70_00, thisPeriodMinutes: 30 }],
      }),
    );
    rows = await run((tx) => listPayApplications(tx, tenantId, contract.id));
    expect(rows[1].labor[1]).toMatchObject({ thisPeriodMinutes: 30, thisPeriodCents: 35_00 });
    expect(rows[1].costPlus).toMatchObject({ laborToDateCents: 435_00, dueCents: 35_00 });
    const issuedSecond = await run((tx) => issuePayApplication(tx, ctx, second.id, { issueDate: "2026-11-01" }));
    const lines = await run(async (tx) =>
      loadInvoiceLines(tx, tenantId, (await loadInvoice(tx, tenantId, issuedSecond.invoiceId)).id),
    );
    expect(lines.map((l) => [l.amountCents, l.description])).toEqual([
      [35_00, "Application 2 — Erin Dated, 0.5 h at 70.00/h through 2026-10-31"],
    ]);

    // A second contract billing the same job's books is refused the moment it starts an application.
    const party = await run((tx) => seedVendor(tx, "Rival"));
    const rival = await run((tx) =>
      createContract(tx, ctx, {
        projectId: project.id,
        kind: "extra",
        counterpartyPartyId: party,
        billingMethod: "cost_plus_fee",
        valueCents: null,
        status: "signed",
      }),
    );
    await expect(
      run((tx) => createPayApplication(tx, ctx, { contractId: rival.id, periodTo: "2026-11-30" })),
    ).rejects.toMatchObject({ code: "ONE_COST_PLUS" });
  }, 120_000);

  it("WORK IN PROGRESS on a time-and-materials job earns hours at their rates plus other cost marked up, never the wages twice; an hour with no rate blocks the period", async () => {
    const entity = await newCompany("T and M Co 3");
    const { project } = await run((tx) => tmJob(tx, entity, "OPS-TM3", { feePpm: 100_000 }));
    const fay = await run((tx) => worker(tx, "Fay Rated"));
    await run(async (tx) => {
      await billRate(tx, fay.id, 65_00, "2026-01-01");
      await hours(tx, fay.id, project.id, "2026-09-08", 600);
      await sheet(tx, fay.id, "2026-08-31", "2026-09-13");
      await postCodedCost(tx, entity, project.id, null, 2_000_00, "2026-09-05");
      await postWages(tx, entity, project.id, 500_00, "2026-09-13");
    });
    const s = await run((tx) => wipSchedule(tx, tenantId, { entityId: entity, periodEnd: "2026-09-30" }));
    const row = s.rows.find((r) => r.projectId === project.id)!;
    expect(row.method).toBe("time_and_materials");
    expect(row.reason).toBe("");
    // 650 of hours + 2,000 of cost + 200 of markup; the 500 of wages is cost, not earned a second time.
    expect(row.figures.costToDateCents).toBe(2_500_00);
    expect(row.figures.earnedCents).toBe(2_850_00);
    expect(row.figures.underBilledCents).toBe(2_850_00);
    expect(row.figures.percentCompletePpm).toBeNull();
    expect(s.blockers).toEqual([]);

    // An hour nobody has priced cannot be earned, and the period says so instead of posting.
    const gus = await run((tx) => worker(tx, "Gus Unpriced"));
    await run(async (tx) => {
      await hours(tx, gus.id, project.id, "2026-09-09", 60);
      await sheet(tx, gus.id, "2026-08-31", "2026-09-13");
    });
    const blocked = await run((tx) => wipSchedule(tx, tenantId, { entityId: entity, periodEnd: "2026-09-30" }));
    expect(blocked.rows.find((r) => r.projectId === project.id)!.reason).toBe("no_rate");
    expect(blocked.blockers).toEqual(["OPS-TM3 has hours with no bill rate"]);
    await expect(
      run((tx) => postWip(tx, ctx, { entityId: entity, periodEnd: "2026-09-30" })),
    ).rejects.toMatchObject({ code: "NO_BILL_RATE", message: "OPS-TM3" });
  }, 120_000);

  // ------------------------------------------ subcontractor applications (5c)

  /** A subcontract on its own company: a job, a party to pay, two coded lines. */
  const subcontractJob = async (
    tx: Tx,
    entity: string,
    number: string,
    kind: "subcontract" | "purchase_order" = "subcontract",
  ) => {
    await ensureBilling(tx);
    const project = await createProject(tx, ctx, { entityId: entity, number, name: `Sub ${number}` });
    const set =
      (await getDefaultCostCodeSet(tx, tenantId)) ??
      (await createCostCodeSet(tx, ctx, { name: "Sub codes" }));
    const framing = await createCostCode(tx, ctx, { setId: set.id, code: `S-${number}-06`, name: "Framing", sortOrder: 10 });
    const finish = await createCostCode(tx, ctx, { setId: set.id, code: `S-${number}-09`, name: "Finish carpentry", sortOrder: 20 });
    const party = await seedVendor(tx, `Framer ${number}`);
    const commitment = await createCommitment(tx, ctx, {
      projectId: project.id,
      partyId: party,
      number: `SC-${number}`,
      kind,
      status: "issued",
      lines: [
        { costCodeId: framing.id, description: "Framing labour", amountCents: 60_000_00 },
        { costCodeId: finish.id, description: "Trim", amountCents: 20_000_00 },
      ],
    });
    const lines = await tx
      .select()
      .from(schema.jobCommitmentLines)
      .where(eq(schema.jobCommitmentLines.commitmentId, commitment.id))
      .orderBy(schema.jobCommitmentLines.sortOrder);
    return { project, commitment, lines, framing, finish, party };
  };

  it("A SUBCONTRACTOR'S APPLICATION bills against the subcontract's lines, holds retainage, and becomes an ordinary bill tagged with the job and each line's code", async () => {
    const entity = await newCompany("Sub Co 1");
    const { project, commitment, lines, framing, finish } = await run((tx) => subcontractJob(tx, entity, "OPS-SB1"));
    const app = await run((tx) =>
      createSubApplication(tx, ctx, { commitmentId: commitment.id, periodTo: "2026-09-30", retainagePpm: 100_000, reference: "FR-2041" }),
    );
    expect(app.number).toBe(1);
    // A line per subcontract line, carried from the order.
    const [row] = await run((tx) => listSubApplications(tx, tenantId, commitment.id));
    expect(row.lines.map((l) => [l.description, l.commitmentAmountCents, l.previousCents])).toEqual([
      ["Framing labour", 60_000_00, 0],
      ["Trim", 20_000_00, 0],
    ]);
    await run((tx) =>
      updateSubApplication(tx, ctx, app.id, {
        lines: [
          { commitmentLineId: lines[0].id, thisPeriodCents: 30_000_00, storedCents: 0 },
          { commitmentLineId: lines[1].id, thisPeriodCents: 0, storedCents: 5_000_00 },
        ],
      }),
    );
    await expect(
      run((tx) => approveSubApplication(tx, staffCtx, app.id, { billDate: "2026-10-01" })),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const approved = await run((tx) => approveSubApplication(tx, ctx, app.id, { billDate: "2026-10-01" }));
    // The certificate: 35,000 completed and stored, 10% held, nothing before.
    expect(approved.app).toMatchObject({
      status: "billed",
      scheduledCents: 80_000_00,
      completedToDateCents: 35_000_00,
      retainageCents: 3_500_00,
      previousCertificatesCents: 0,
      dueCents: 31_500_00,
      billedOn: "2026-10-01",
    });
    expect(approved.app.billId).toBe(approved.billId);

    const { bill, billLines, entryLines, accounts, dims, jobMember } = await run(async (tx) => {
      const bill = await loadBill(tx, tenantId, approved.billId);
      const billLines = await loadBillLines(tx, tenantId, bill.id);
      const entryLines = await tx
        .select()
        .from(schema.journalLines)
        .where(eq(schema.journalLines.entryId, bill.journalEntryId!));
      const accounts = await tx
        .select({ id: schema.accounts.id, code: schema.accounts.code })
        .from(schema.accounts)
        .where(eq(schema.accounts.tenantId, tenantId));
      const dims = await tx
        .select({ journalLineId: schema.lineDimensions.journalLineId, memberId: schema.lineDimensions.memberId, dimensionType: schema.lineDimensions.dimensionType })
        .from(schema.lineDimensions)
        .where(and(eq(schema.lineDimensions.tenantId, tenantId), inArray(schema.lineDimensions.journalLineId, entryLines.map((l) => l.id))));
      const [jobMember] = await memberFor(tx, project.id);
      return { bill, billLines, entryLines, accounts, dims, jobMember };
    });
    const codeOf = new Map(accounts.map((a) => [a.id, a.code]));
    expect(bill.status).toBe("approved");
    expect(bill.billNumber).toBe("FR-2041"); // the subcontractor's own reference
    expect(bill.totalCents).toBe(31_500_00); // what is owed now: net of retainage
    expect(bill.entityId).toBe(project.entityId);
    // Three lines a bookkeeper can read: the work on each subcontract line, and what is held.
    expect(billLines.map((l) => [codeOf.get(l.accountId!), l.amountCents])).toEqual([
      ["5100", 30_000_00],
      ["5100", 5_000_00],
      ["2120", -3_500_00],
    ]);
    // The ledger: Dr Subcontractor Expense 35,000 (gross) · Cr Retainage Payable 3,500 · Cr AP 31,500.
    const net = new Map<string | undefined, number>();
    for (const l of entryLines) net.set(codeOf.get(l.accountId), (net.get(codeOf.get(l.accountId)) ?? 0) + l.amountCents);
    expect(net.get("5100")).toBe(35_000_00);
    expect(net.get("2120")).toBe(-3_500_00);
    expect(net.get("2000")).toBe(-31_500_00);
    // Every expense line carries the job AND its cost code, so the Spent column sees it.
    const members = new Set(dims.map((d) => d.memberId));
    expect(members.has(jobMember.id)).toBe(true);
    const report = await run((tx) => jobCostReport(tx, tenantId, project.id));
    expect(report.rows.find((r) => r.costCodeId === framing.id)?.actualCents).toBe(30_000_00);
    expect(report.rows.find((r) => r.costCodeId === finish.id)?.actualCents).toBe(5_000_00);
    expect(report.uncodedActualCents).toBe(0);
    // ...and the commitment's billing summary says what was billed and what is held.
    const summary = (await run((tx) => commitmentBilling(tx, tenantId, project.id))).get(commitment.id);
    expect(summary).toMatchObject({ billedCents: 31_500_00, retainageHeldCents: 3_500_00, billedCount: 1, hasDraft: false });
  });

  it("the NEXT application carries the work forward and certifies against the last; a rate of zero RELEASES what was held through 2120", async () => {
    const entity = await newCompany("Sub Co 2");
    const { commitment, lines } = await run((tx) => subcontractJob(tx, entity, "OPS-SB2"));
    const first = await run((tx) =>
      createSubApplication(tx, ctx, { commitmentId: commitment.id, periodTo: "2026-09-30", retainagePpm: 100_000 }),
    );
    await run((tx) =>
      updateSubApplication(tx, ctx, first.id, {
        lines: [{ commitmentLineId: lines[0].id, thisPeriodCents: 60_000_00, storedCents: 0 }],
      }),
    );
    await run((tx) => approveSubApplication(tx, ctx, first.id, { billDate: "2026-10-01" }));
    // The rate carries forward; the previous figures are carried per line.
    const second = await run((tx) => createSubApplication(tx, ctx, { commitmentId: commitment.id, periodTo: "2026-10-31" }));
    expect(second.retainagePpm).toBe(100_000);
    const [, draft] = await run((tx) => listSubApplications(tx, tenantId, commitment.id));
    expect(draft.lines.map((l) => [l.description, l.previousCents])).toEqual([
      ["Framing labour", 60_000_00],
      ["Trim", 0],
    ]);
    // Finish the trim, final application at 0%: everything held comes back.
    await run((tx) =>
      updateSubApplication(tx, ctx, second.id, {
        retainagePpm: 0,
        lines: [{ commitmentLineId: lines[1].id, thisPeriodCents: 20_000_00, storedCents: 0 }],
      }),
    );
    const final = await run((tx) => approveSubApplication(tx, ctx, second.id, { billDate: "2026-11-01" }));
    expect(final.app).toMatchObject({
      completedToDateCents: 80_000_00,
      retainageCents: 0,
      previousCertificatesCents: 54_000_00, // 60,000 less the 6,000 held
      dueCents: 26_000_00, // 20,000 of trim plus the 6,000 released
    });
    const billLines = await run((tx) => loadBillLines(tx, tenantId, final.billId));
    const accounts = await run((tx) => tx.select({ id: schema.accounts.id, code: schema.accounts.code }).from(schema.accounts).where(eq(schema.accounts.tenantId, tenantId)));
    const codeOf = new Map(accounts.map((a) => [a.id, a.code]));
    expect(billLines.map((l) => [codeOf.get(l.accountId!), l.amountCents, l.description])).toEqual([
      ["5100", 20_000_00, "Application 2 — Trim through 2026-10-31"],
      ["2120", 6_000_00, "Retainage released"],
    ]);
    const summary = (await run((tx) => commitmentBilling(tx, tenantId, commitment.projectId))).get(commitment.id);
    expect(summary).toMatchObject({ billedCents: 80_000_00, retainageHeldCents: 0, billedCount: 2 });
  });

  it("refuses a purchase order, a second draft, nothing due, a chart without 2120, and holds a billed subcontract line; voids only the latest and its bill with it", async () => {
    const entity = await newCompany("Sub Co 3");
    const po = await run((tx) => subcontractJob(tx, entity, "OPS-SB3P", "purchase_order"));
    await expect(
      run((tx) => createSubApplication(tx, ctx, { commitmentId: po.commitment.id, periodTo: "2026-09-30" })),
    ).rejects.toMatchObject({ code: "NOT_SUBCONTRACT" });

    const { commitment, lines } = await run((tx) => subcontractJob(tx, entity, "OPS-SB3"));
    const app = await run((tx) =>
      createSubApplication(tx, ctx, { commitmentId: commitment.id, periodTo: "2026-09-30", retainagePpm: 50_000 }),
    );
    await expect(
      run((tx) => createSubApplication(tx, ctx, { commitmentId: commitment.id, periodTo: "2026-10-31" })),
    ).rejects.toMatchObject({ code: "ONE_DRAFT" });
    await expect(
      run((tx) => approveSubApplication(tx, ctx, app.id, { billDate: "2026-10-01" })),
    ).rejects.toMatchObject({ code: "NOTHING_DUE" });
    await run((tx) =>
      updateSubApplication(tx, ctx, app.id, {
        lines: [{ commitmentLineId: lines[0].id, thisPeriodCents: 10_000_00, storedCents: 0 }],
      }),
    );
    await run((tx) =>
      tx.update(schema.accounts).set({ isActive: false }).where(and(eq(schema.accounts.tenantId, tenantId), eq(schema.accounts.code, "2120"))),
    );
    await expect(
      run((tx) => approveSubApplication(tx, ctx, app.id, { billDate: "2026-10-01" })),
    ).rejects.toMatchObject({ code: "ACCOUNT_MISSING", message: expect.stringContaining("2120") });
    await run((tx) =>
      tx.update(schema.accounts).set({ isActive: true }).where(and(eq(schema.accounts.tenantId, tenantId), eq(schema.accounts.code, "2120"))),
    );
    const approved = await run((tx) => approveSubApplication(tx, ctx, app.id, { billDate: "2026-10-01" }));
    // A billed subcontract line cannot be replaced out from under its certificate — and since 4b the refusal has a name.
    await expect(
      run((tx) =>
        updateCommitment(tx, ctx, commitment.id, {
          lines: [{ costCodeId: lines[0].costCodeId, description: "Framing, rewritten", amountCents: 1 }],
        }),
      ),
    ).rejects.toMatchObject({ code: "LINES_LOCKED" });
    // Void: the latest only, and the bill goes with it.
    const second = await run((tx) => createSubApplication(tx, ctx, { commitmentId: commitment.id, periodTo: "2026-10-31" }));
    await run((tx) =>
      updateSubApplication(tx, ctx, second.id, {
        lines: [{ commitmentLineId: lines[0].id, thisPeriodCents: 5_000_00, storedCents: 0 }],
      }),
    );
    const later = await run((tx) => approveSubApplication(tx, ctx, second.id, { billDate: "2026-11-01" }));
    await expect(run((tx) => voidSubApplication(tx, ctx, approved.app.id))).rejects.toMatchObject({ code: "NOT_LAST" });
    const voided = await run((tx) => voidSubApplication(tx, ctx, later.app.id, { version: later.app.version }));
    expect(voided.status).toBe("void");
    const bill = await run((tx) => loadBill(tx, tenantId, later.billId));
    expect(bill.status).toBe("void");
    // The application before it is the latest again, and what it held stands.
    const summary = (await run((tx) => commitmentBilling(tx, tenantId, commitment.projectId))).get(commitment.id);
    expect(summary).toMatchObject({ billedCents: 9_500_00, retainageHeldCents: 500_00, billedCount: 1 });
    // Two subcontracts, four applications, two bills and a void: slow under a full-suite run.
  }, 120_000);

  // ------------------------------------------ subcontract change orders (4b)

  it("A CHANGE ORDER ON A SUBCONTRACT adds lines the next application bills, counts only once approved, passes a client change down, runs a deduction backwards, and is fixed once billed against", async () => {
    const entity = await newCompany("Sub Co 4");
    const { project, commitment, lines, framing, finish } = await run((tx) => subcontractJob(tx, entity, "OPS-SC4"));
    // Issued: the original lines are locked; the same lines sent back are not an edit, and the header is free.
    await expect(
      run((tx) =>
        updateCommitment(tx, ctx, commitment.id, {
          lines: [{ costCodeId: framing.id, description: "Framing labour", amountCents: 61_000_00 }],
        }),
      ),
    ).rejects.toMatchObject({ code: "LINES_LOCKED" });
    const noted = await run((tx) =>
      updateCommitment(tx, ctx, commitment.id, {
        notes: "sent 2026-09-01",
        lines: [
          { costCodeId: framing.id, description: "Framing labour", amountCents: 60_000_00 },
          { costCodeId: finish.id, description: "Trim", amountCents: 20_000_00 },
        ],
      }),
    );
    expect(noted.notes).toBe("sent 2026-09-01");

    // A client change order on this job, for the change to pass down — and one on another job it may not.
    const { co, elsewhere } = await run(async (tx) => {
      const contract = await createContract(tx, ctx, { projectId: project.id, kind: "new_home", valueCents: 300_000_00, status: "signed" });
      const co = await createChangeOrder(tx, ctx, { contractId: contract.id, number: "CO-3", title: "Stair blocking", status: "approved", approvedOn: "2026-09-10", valueCents: 5_000_00 });
      const other = await createProject(tx, ctx, { entityId: entity, number: "OPS-SC4-B", name: "Other house" });
      const otherContract = await createContract(tx, ctx, { projectId: other.id, kind: "new_home", valueCents: 1_00, status: "signed" });
      const elsewhere = await createChangeOrder(tx, ctx, { contractId: otherContract.id, number: "CO-1", title: "Elsewhere" });
      return { co, elsewhere };
    });
    await expect(
      run((tx) => createCommitmentChangeOrder(tx, ctx, { commitmentId: commitment.id, number: "SCO-0", title: "Wrong job", changeOrderId: elsewhere.id })),
    ).rejects.toMatchObject({ code: "WRONG_PROJECT" });
    await expect(
      run((tx) => createCommitmentChangeOrder(tx, staffCtx, { commitmentId: commitment.id, number: "SCO-1", title: "Staff" })),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    // Proposed: recorded, and counted by nothing — not the order, not the job, not a draft application.
    const sco1 = await run((tx) =>
      createCommitmentChangeOrder(tx, ctx, {
        commitmentId: commitment.id,
        number: "SCO-1",
        title: "Extra blocking at the stair",
        changeOrderId: co.id,
        lines: [{ costCodeId: framing.id, description: "Blocking", amountCents: 4_000_00 }],
      }),
    );
    const rowOf = async () =>
      (await run((tx) => listCommitments(tx, tenantId, project.id))).find((r) => r.commitment.id === commitment.id)!;
    let row = await rowOf();
    expect([row.originalCents, row.changesCents, row.totalCents]).toEqual([80_000_00, 0, 80_000_00]);
    expect(row.lines.map((l) => [l.description, l.change?.number ?? null, l.counted])).toEqual([
      ["Framing labour", null, true],
      ["Trim", null, true],
      ["Blocking", "SCO-1", false],
    ]);
    expect((await run((tx) => committedTotals(tx, tenantId))).byProject.get(project.id)).toBe(80_000_00);
    const app1 = await run((tx) =>
      createSubApplication(tx, ctx, { commitmentId: commitment.id, periodTo: "2026-09-30", retainagePpm: 100_000 }),
    );
    let [a1] = await run((tx) => listSubApplications(tx, tenantId, commitment.id));
    expect(a1.lines).toHaveLength(2);

    // Approved, with a date: the line joins the order, the job's committed cost by code, the report and the draft.
    await expect(
      run((tx) => updateCommitmentChangeOrder(tx, ctx, sco1.id, { status: "approved" })),
    ).rejects.toMatchObject({ code: "APPROVAL_DATE_REQUIRED" });
    await run((tx) =>
      updateCommitmentChangeOrder(tx, ctx, sco1.id, { status: "approved", approvedOn: "2026-09-12", version: sco1.version }),
    );
    row = await rowOf();
    expect([row.originalCents, row.changesCents, row.totalCents]).toEqual([80_000_00, 4_000_00, 84_000_00]);
    const committed = await run((tx) => committedTotals(tx, tenantId));
    expect(committed.byProject.get(project.id)).toBe(84_000_00);
    expect(committed.byCostCode.get(framing.id)).toBe(64_000_00);
    const report = await run((tx) => jobCostRows(tx, tenantId, project.id));
    expect(report.find((r) => r.costCodeId === framing.id)?.committedCents).toBe(64_000_00);
    let listed = await run((tx) => listCommitmentChangeOrders(tx, tenantId, project.id));
    expect(listed.map((c) => [c.changeOrder.number, c.amountCents, c.passesDown?.number ?? null, c.billed])).toEqual([
      ["SCO-1", 4_000_00, "CO-3", false],
    ]);
    // The open draft picks the line up on its next edit, after the original lines, with the change's number.
    await run((tx) => updateSubApplication(tx, ctx, app1.id, { lines: [] }));
    [a1] = await run((tx) => listSubApplications(tx, tenantId, commitment.id));
    expect(a1.lines.map((l) => [l.description, l.changeNumber, l.commitmentAmountCents])).toEqual([
      ["Framing labour", null, 60_000_00],
      ["Trim", null, 20_000_00],
      ["Blocking", "SCO-1", 4_000_00],
    ]);

    // Bill 2,000 of the change: the bill's line names the change, and the certificate froze the revised sum.
    await run((tx) =>
      updateSubApplication(tx, ctx, app1.id, {
        lines: [{ commitmentLineId: a1.lines[2].commitmentLineId, thisPeriodCents: 2_000_00, storedCents: 0 }],
      }),
    );
    const first = await run((tx) => approveSubApplication(tx, ctx, app1.id, { billDate: "2026-10-01" }));
    const firstLines = await run((tx) => loadBillLines(tx, tenantId, first.billId));
    expect(firstLines.map((l) => [l.description, l.amountCents])).toEqual([
      ["Application 1 — SCO-1 · Blocking through 2026-09-30", 2_000_00],
      ["Retainage held (10%)", -200_00],
    ]);
    expect(first.app.scheduledCents).toBe(84_000_00);
    // Billed against: the status and the lines are fixed; the words are not.
    listed = await run((tx) => listCommitmentChangeOrders(tx, tenantId, project.id));
    expect(listed[0].billed).toBe(true);
    await expect(
      run((tx) => updateCommitmentChangeOrder(tx, ctx, sco1.id, { status: "proposed" })),
    ).rejects.toMatchObject({ code: "CHANGE_BILLED" });
    await expect(
      run((tx) => updateCommitmentChangeOrder(tx, ctx, sco1.id, { lines: [] })),
    ).rejects.toMatchObject({ code: "CHANGE_BILLED" });
    const reworded = await run((tx) =>
      updateCommitmentChangeOrder(tx, ctx, sco1.id, {
        title: "Extra blocking, stair and landing",
        lines: [{ costCodeId: framing.id, description: "Blocking", amountCents: 4_000_00 }],
      }),
    );
    expect(reworded.title).toBe("Extra blocking, stair and landing");

    // A DEDUCTIVE change is a negative line, and the application runs it backwards.
    await run((tx) =>
      createCommitmentChangeOrder(tx, ctx, {
        commitmentId: commitment.id,
        number: "SCO-2",
        title: "Garage trim dropped",
        status: "approved",
        approvedOn: "2026-10-05",
        lines: [{ costCodeId: finish.id, description: "Garage trim", amountCents: -2_000_00 }],
      }),
    );
    row = await rowOf();
    expect([row.changesCents, row.totalCents]).toEqual([2_000_00, 82_000_00]);
    const app2 = await run((tx) => createSubApplication(tx, ctx, { commitmentId: commitment.id, periodTo: "2026-10-31" }));
    let [, a2] = await run((tx) => listSubApplications(tx, tenantId, commitment.id));
    const deduction = a2.lines.find((l) => l.changeNumber === "SCO-2")!;
    expect([deduction.commitmentAmountCents, deduction.scheduledCents]).toEqual([-2_000_00, -2_000_00]);
    await expect(
      run((tx) =>
        updateSubApplication(tx, ctx, app2.id, {
          lines: [{ commitmentLineId: deduction.commitmentLineId, thisPeriodCents: 500_00, storedCents: 0 }],
        }),
      ),
    ).rejects.toMatchObject({ code: "INVALID_VALUE", message: expect.stringContaining("more than nothing") });
    await expect(
      run((tx) =>
        updateSubApplication(tx, ctx, app2.id, {
          lines: [{ commitmentLineId: deduction.commitmentLineId, thisPeriodCents: -2_000_00, storedCents: 1_00 }],
        }),
      ),
    ).rejects.toMatchObject({ code: "INVALID_VALUE", message: expect.stringContaining("stored") });
    await run((tx) =>
      updateSubApplication(tx, ctx, app2.id, {
        lines: [
          { commitmentLineId: lines[1].id, thisPeriodCents: 10_000_00, storedCents: 0 },
          { commitmentLineId: deduction.commitmentLineId, thisPeriodCents: -2_000_00, storedCents: 0 },
        ],
      }),
    );
    [, a2] = await run((tx) => listSubApplications(tx, tenantId, commitment.id));
    expect(a2.totals.completedToDateCents).toBe(10_000_00); // 2,000 + 10,000 − 2,000
    const second = await run((tx) => approveSubApplication(tx, ctx, app2.id, { billDate: "2026-11-01" }));
    const secondLines = await run((tx) => loadBillLines(tx, tenantId, second.billId));
    expect(secondLines.map((l) => [l.description, l.amountCents])).toEqual([
      ["Application 2 — Trim through 2026-10-31", 10_000_00],
      ["Application 2 — SCO-2 · Garage trim through 2026-10-31", -2_000_00],
      ["Retainage held (10%)", -800_00],
    ]);
    expect(second.app).toMatchObject({ scheduledCents: 82_000_00, completedToDateCents: 10_000_00, dueCents: 7_200_00 });

    // Numbered per order: SCO-1 on another subcontract is fine; SCO-1 here again is the index speaking.
    const other = await run((tx) => subcontractJob(tx, entity, "OPS-SC4-C"));
    await run((tx) => createCommitmentChangeOrder(tx, ctx, { commitmentId: other.commitment.id, number: "SCO-1", title: "Theirs" }));
    const dup = await run((tx) =>
      createCommitmentChangeOrder(tx, ctx, { commitmentId: commitment.id, number: "SCO-1", title: "Again" }),
    ).catch((e: unknown) => e);
    expect(violatedUniqueIndex(dup)).toBe("job_commitment_change_orders_commitment_number_idx");

    // A purchase order takes a change order too, and a DRAFT order's lines are still free.
    const po = await run((tx) => subcontractJob(tx, entity, "OPS-SC4-P", "purchase_order"));
    await run((tx) =>
      createCommitmentChangeOrder(tx, ctx, {
        commitmentId: po.commitment.id,
        number: "R1",
        title: "More lumber",
        status: "approved",
        approvedOn: "2026-09-20",
        lines: [{ costCodeId: po.framing.id, amountCents: 500_00 }],
      }),
    );
    expect((await run((tx) => committedTotals(tx, tenantId))).byProject.get(po.project.id)).toBe(80_500_00);
    const draftOrder = await run((tx) =>
      createCommitment(tx, ctx, { projectId: project.id, partyId: other.party, number: "PO-SC4-D", lines: [{ amountCents: 1_00 }] }),
    );
    const edited = await run((tx) =>
      updateCommitment(tx, ctx, draftOrder.id, { lines: [{ amountCents: 2_00, description: "Fixed before sending" }] }),
    );
    expect(edited.version).toBe(2);

    // A proposed change taken back: a draft's line on it goes with it, whatever was typed.
    const sco3 = await run((tx) =>
      createCommitmentChangeOrder(tx, ctx, {
        commitmentId: other.commitment.id,
        number: "SCO-2",
        title: "Maybe",
        status: "approved",
        approvedOn: "2026-10-01",
        lines: [{ costCodeId: other.framing.id, amountCents: 1_000_00 }],
      }),
    );
    const app3 = await run((tx) => createSubApplication(tx, ctx, { commitmentId: other.commitment.id, periodTo: "2026-10-31" }));
    let [a3] = await run((tx) => listSubApplications(tx, tenantId, other.commitment.id));
    expect(a3.lines).toHaveLength(3);
    await run((tx) => updateCommitmentChangeOrder(tx, ctx, sco3.id, { status: "declined" }));
    await run((tx) => updateSubApplication(tx, ctx, app3.id, { lines: [] }));
    [a3] = await run((tx) => listSubApplications(tx, tenantId, other.commitment.id));
    expect(a3.lines.map((l) => l.changeNumber)).toEqual([null, null]);
    // Three subcontracts, three applications, two bills: slow under a full-suite run.
  }, 120_000);

  // -------------------------------------------------------- lien waivers (11a)

  it("A LIEN WAIVER is a record on the order: received ones cover applications by naming them or running past their period end, the gap is who was paid without one, and the chase is a Work item on the order", async () => {
    const entity = await newCompany("Sub Co 5");
    const { project, commitment, lines, party } = await run((tx) => subcontractJob(tx, entity, "OPS-LW1"));
    const app1 = await run((tx) =>
      createSubApplication(tx, ctx, { commitmentId: commitment.id, periodTo: "2026-09-30", retainagePpm: 100_000 }),
    );
    await run((tx) =>
      updateSubApplication(tx, ctx, app1.id, {
        lines: [{ commitmentLineId: lines[0].id, thisPeriodCents: 20_000_00, storedCents: 0 }],
      }),
    );
    // A draft cannot be named: a waiver covers a payment.
    await expect(
      run((tx) =>
        createLienWaiver(tx, ctx, {
          projectId: project.id,
          partyId: party,
          commitmentId: commitment.id,
          subApplicationId: app1.id,
          kind: "conditional_progress",
          throughDate: "2026-09-30",
        }),
      ),
    ).rejects.toMatchObject({ code: "INVALID_VALUE", message: expect.stringContaining("not billed") });
    const first = await run((tx) => approveSubApplication(tx, ctx, app1.id, { billDate: "2026-10-01" }));

    // Billed, unpaid, nothing on file: the softer gap.
    let gaps = await run((tx) => waiverGaps(tx, tenantId, project.id));
    expect(gaps.map((g) => [g.applicationNumber, g.paid, g.missing])).toEqual([[1, false, "conditional"]]);
    // A received waiver needs its date; a requested one has none; staff may record one.
    await expect(
      run((tx) =>
        createLienWaiver(tx, ctx, {
          projectId: project.id,
          partyId: party,
          commitmentId: commitment.id,
          kind: "conditional_progress",
          throughDate: "2026-09-30",
          status: "received",
        }),
      ),
    ).rejects.toMatchObject({ code: "RECEIVED_DATE_REQUIRED" });
    const conditional = await run((tx) =>
      createLienWaiver(tx, staffCtx, {
        projectId: project.id,
        partyId: party,
        commitmentId: commitment.id,
        subApplicationId: app1.id,
        kind: "conditional_progress",
        throughDate: "2026-09-30",
        amountCents: 18_000_00,
        status: "requested",
        requestedOn: "2026-10-01",
      }),
    );
    expect(conditional.receivedOn).toBeNull();
    // Requested is not on file.
    gaps = await run((tx) => waiverGaps(tx, tenantId, project.id));
    expect(gaps).toHaveLength(1);
    await run((tx) =>
      updateLienWaiver(tx, ctx, conditional.id, { status: "received", receivedOn: "2026-10-03", version: conditional.version }),
    );
    gaps = await run((tx) => waiverGaps(tx, tenantId, project.id));
    expect(gaps).toEqual([]);
    let coverage = (await run((tx) => waiverCoverage(tx, tenantId, project.id))).get(commitment.id);
    expect(coverage).toMatchObject({ unconditionalThrough: null, conditionalThrough: "2026-09-30", finalOnFile: false });

    // The bill is paid: the conditional waiver no longer answers; an unconditional one is missing.
    await run((tx) =>
      tx.update(schema.bills).set({ status: "paid" }).where(and(eq(schema.bills.tenantId, tenantId), eq(schema.bills.id, first.billId))),
    );
    gaps = await run((tx) => waiverGaps(tx, tenantId, project.id));
    expect(gaps.map((g) => [g.applicationNumber, g.paid, g.missing, g.commitmentNumber])).toEqual([
      [1, true, "unconditional", "SC-OPS-LW1"],
    ]);
    // The chase: a Work item on the ORDER, not on the job's punch list.
    const itemId = await run((tx) =>
      askForWaiver(tx, staffCtx, { commitmentId: commitment.id, missing: "unconditional", throughDate: "2026-09-30" }),
    );
    expect(itemId).toBeTruthy();
    const chasing = await run((tx) => listWaiverWork(tx, tenantId, commitment.id));
    expect(chasing.map((w) => w.title)).toEqual([
      `Lien waiver from Framer OPS-LW1 ${vendorSeq}: unconditional through 2026-09-30 (SC-OPS-LW1)`,
    ]);
    expect((await run((tx) => listPunchItems(tx, tenantId, project.id))).map((p) => p.id)).not.toContain(itemId);

    // An unconditional waiver through a LATER date covers it without naming it; a final one covers everything.
    await run((tx) =>
      createLienWaiver(tx, ctx, {
        projectId: project.id,
        partyId: party,
        commitmentId: commitment.id,
        kind: "unconditional_progress",
        throughDate: "2026-10-31",
        amountCents: 18_000_00,
        status: "received",
        receivedOn: "2026-11-02",
        signedBy: "J. Miller",
      }),
    );
    gaps = await run((tx) => waiverGaps(tx, tenantId, project.id));
    expect(gaps).toEqual([]);
    coverage = (await run((tx) => waiverCoverage(tx, tenantId, project.id))).get(commitment.id);
    expect(coverage).toMatchObject({ unconditionalThrough: "2026-10-31", conditionalThrough: "2026-09-30", finalOnFile: false });
    const listed = await run((tx) => listLienWaivers(tx, tenantId, project.id));
    expect(listed.map((w) => [w.waiver.kind, w.waiver.throughDate, w.applicationNumber, w.attachmentCount, w.partyName])).toEqual([
      ["unconditional_progress", "2026-10-31", null, 0, `Framer OPS-LW1 ${vendorSeq}`],
      ["conditional_progress", "2026-09-30", 1, 0, `Framer OPS-LW1 ${vendorSeq}`],
    ]);
    // A void waiver stops counting; a final one on file ends the asking.
    await run((tx) => updateLienWaiver(tx, ctx, listed[0].waiver.id, { status: "void" }));
    gaps = await run((tx) => waiverGaps(tx, tenantId, project.id));
    expect(gaps).toHaveLength(1);
    await run((tx) =>
      createLienWaiver(tx, ctx, {
        projectId: project.id,
        partyId: party,
        commitmentId: commitment.id,
        kind: "unconditional_final",
        throughDate: "2026-09-01",
        status: "received",
        receivedOn: "2026-12-01",
      }),
    );
    expect(await run((tx) => waiverGaps(tx, tenantId, project.id))).toEqual([]);
    expect((await run((tx) => waiverCoverage(tx, tenantId, project.id))).get(commitment.id)?.finalOnFile).toBe(true);

    // The links are checked: another job's order, another order's application, an unknown kind.
    const other = await run((tx) => subcontractJob(tx, entity, "OPS-LW2"));
    await expect(
      run((tx) =>
        createLienWaiver(tx, ctx, { projectId: project.id, partyId: party, commitmentId: other.commitment.id, kind: "conditional_final", throughDate: "2026-09-30" }),
      ),
    ).rejects.toMatchObject({ code: "WRONG_PROJECT" });
    await expect(
      run((tx) =>
        createLienWaiver(tx, ctx, { projectId: other.project.id, partyId: party, commitmentId: other.commitment.id, subApplicationId: app1.id, kind: "conditional_final", throughDate: "2026-09-30" }),
      ),
    ).rejects.toMatchObject({ code: "INVALID_VALUE", message: expect.stringContaining("not on that order") });
    await expect(
      run((tx) =>
        createLienWaiver(tx, ctx, { projectId: project.id, partyId: party, kind: "partial", throughDate: "2026-09-30" }),
      ),
    ).rejects.toMatchObject({ code: "INVALID_KIND" });
  }, 120_000);

  // ------------------------------------------------------------ selections (8)

  it("A SELECTION carries an allowance and its priced choices; the chosen price less the allowance is the difference; approved, it is raised as a change order on the contract, once, and the money is fixed until that is void; a pending one past its date is overdue and its reminder is Work on the selection", async () => {
    const entity = await newCompany("Sel Co 1");
    const { project, contract, code, party, otherContract } = await run(async (tx) => {
      await ensureBilling(tx);
      const p = await createProject(tx, ctx, { entityId: entity, number: "OPS-SEL1", name: "Selected" });
      const set = (await getDefaultCostCodeSet(tx, tenantId)) ?? (await createCostCodeSet(tx, ctx, { name: "Sel codes" }));
      const code = await createCostCode(tx, ctx, { setId: set.id, code: "SEL-09-30", name: "Tile", sortOrder: 30 });
      const contract = await createContract(tx, ctx, { projectId: p.id, kind: "new_home", valueCents: 300_000_00, status: "signed" });
      const other = await createProject(tx, ctx, { entityId: entity, number: "OPS-SEL1-B", name: "Other" });
      const otherContract = await createContract(tx, ctx, { projectId: other.id, kind: "new_home", valueCents: 1_00, status: "signed" });
      const party = await seedVendor(tx, "Tile Shop");
      return { project: p, contract, code, party, otherContract };
    });
    // A selected selection has a chosen choice; another job's contract is refused.
    await expect(
      run((tx) =>
        createSelection(tx, ctx, { projectId: project.id, name: "x", status: "selected", choices: [{ description: "A", priceCents: 1 }] }),
      ),
    ).rejects.toMatchObject({ code: "INVALID_VALUE", message: expect.stringContaining("mark the choice") });
    await expect(
      run((tx) => createSelection(tx, ctx, { projectId: project.id, contractId: otherContract.id, name: "x" })),
    ).rejects.toMatchObject({ code: "WRONG_PROJECT" });

    // Staff draws it up: an allowance, a date, two choices — one priced by the unit, its typed price ignored.
    const sel = await run((tx) =>
      createSelection(tx, staffCtx, {
        projectId: project.id,
        contractId: contract.id,
        costCodeId: code.id,
        name: "Master bath tile",
        location: "Master bath",
        allowanceCents: 4_000_00,
        neededBy: "2026-09-01",
        choices: [
          { description: "Daltile Rittenhouse 3x6, white", reference: "0100-36", partyId: party, unit: "sf", quantityThousandths: 320_000, unitPriceCents: 4_20, priceCents: 999 },
          { description: "Marble herringbone", priceCents: 6_500_00 },
        ],
      }),
    );
    const rowsOf = () => run((tx) => listSelections(tx, tenantId, project.id, "2026-09-14"));
    let rows = await rowsOf();
    expect(rows[0].choices.map((c) => [c.description, c.priceCents, c.isSelected])).toEqual([
      ["Daltile Rittenhouse 3x6, white", 1_344_00, false],
      ["Marble herringbone", 6_500_00, false],
    ]);
    expect([rows[0].overdue, rows[0].differenceCents, rows[0].codeLabel, rows[0].contract?.kind]).toEqual([true, null, "SEL-09-30 · Tile", "new_home"]);
    expect(summarise(rows)).toMatchObject({ count: 1, pending: 1, overdue: 1, allowancesCents: 4_000_00, chosenCents: 0, differenceCents: 0, toRaiseCents: 0, raisedCents: 0 });
    // The reminder is Work on the SELECTION, not on the job's punch list.
    const itemId = await run((tx) => remindSelection(tx, staffCtx, sel.id));
    expect((await run((tx) => listSelectionWork(tx, tenantId, sel.id))).map((w) => [w.title, w.dueOn])).toEqual([
      ["Selection needed: Master bath tile by 2026-09-01 (OPS-SEL1)", "2026-09-01"],
    ]);
    expect((await run((tx) => listPunchItems(tx, tenantId, project.id))).map((p) => p.id)).not.toContain(itemId);

    // The client picks the marble: two chosen is refused, one keeps its identity.
    const [tile, marble] = rows[0].choices;
    const both = [
      { id: tile.id, description: tile.description, quantityThousandths: 320_000, unitPriceCents: 4_20, priceCents: 0, isSelected: true },
      { id: marble.id, description: marble.description, priceCents: 6_500_00, isSelected: true },
    ];
    await expect(run((tx) => updateSelection(tx, staffCtx, sel.id, { choices: both }))).rejects.toMatchObject({
      code: "INVALID_VALUE",
      message: expect.stringContaining("not two"),
    });
    await run((tx) =>
      updateSelection(tx, staffCtx, sel.id, {
        status: "selected",
        decidedOn: "2026-09-10",
        choices: [both[0] && { ...both[0], isSelected: false }, both[1]],
      }),
    );
    rows = await rowsOf();
    expect([rows[0].chosen?.description, rows[0].chosen?.id, rows[0].differenceCents, rows[0].overdue]).toEqual([
      "Marble herringbone",
      marble.id,
      2_500_00,
      false,
    ]);
    expect(summarise(rows)).toMatchObject({ pending: 0, chosenCents: 6_500_00, differenceCents: 2_500_00, toRaiseCents: 0 });

    // Raising: approved first, then an owner; the change order carries the difference and the code's line.
    await expect(run((tx) => raiseSelectionChangeOrder(tx, ctx, sel.id, { number: "CO-1" }))).rejects.toMatchObject({ code: "INVALID_STATUS" });
    await run((tx) => updateSelection(tx, ctx, sel.id, { status: "approved" }));
    expect(summarise(await rowsOf()).toRaiseCents).toBe(2_500_00);
    await expect(run((tx) => raiseSelectionChangeOrder(tx, staffCtx, sel.id, { number: "CO-1" }))).rejects.toMatchObject({ code: "FORBIDDEN" });
    const co = await run((tx) => raiseSelectionChangeOrder(tx, ctx, sel.id, { number: "CO-1", status: "approved", approvedOn: "2026-09-12" }));
    expect(co).toMatchObject({ contractId: contract.id, number: "CO-1", title: "Master bath tile: allowance overage", valueCents: 2_500_00, status: "approved" });
    expect(co.description).toContain("Marble herringbone at 6,500.00 against a 4,000.00 allowance");
    const cos = await run((tx) => listChangeOrders(tx, tenantId, project.id));
    expect(cos.map((c) => [c.changeOrder.number, c.lines.map((l) => [l.costCodeId, l.amountCents])])).toEqual([["CO-1", [[code.id, 2_500_00]]]]);
    expect((await run((tx) => projectValues(tx, tenantId))).get(project.id)?.valueCents).toBe(302_500_00);
    rows = await rowsOf();
    expect(rows[0].changeOrder?.number).toBe("CO-1");
    expect(summarise(rows)).toMatchObject({ toRaiseCents: 0, raisedCents: 2_500_00 });
    // Raised: twice is refused, the money is fixed, the words still move.
    await expect(run((tx) => raiseSelectionChangeOrder(tx, ctx, sel.id, { number: "CO-2" }))).rejects.toMatchObject({ code: "SELECTION_RAISED" });
    await expect(run((tx) => updateSelection(tx, ctx, sel.id, { allowanceCents: 5_000_00 }))).rejects.toMatchObject({ code: "SELECTION_RAISED" });
    const renamed = await run((tx) => updateSelection(tx, ctx, sel.id, { name: "Master bath floor tile", allowanceCents: 4_000_00, notes: "Grout: warm grey" }));
    expect([renamed.name, renamed.notes]).toEqual(["Master bath floor tile", "Grout: warm grey"]);
    // Void the change order: re-price under the allowance, and a credit is raised.
    await run((tx) => updateChangeOrder(tx, ctx, co.id, { status: "void" }));
    await run((tx) => updateSelection(tx, ctx, sel.id, { allowanceCents: 7_000_00 }));
    rows = await rowsOf();
    expect([rows[0].changeOrder, rows[0].differenceCents]).toEqual([null, -500_00]);
    const credit = await run((tx) => raiseSelectionChangeOrder(tx, ctx, sel.id, { number: "CO-2" }));
    expect(credit).toMatchObject({ valueCents: -500_00, title: "Master bath floor tile: allowance credit", status: "proposed" });

    // On the allowance to the cent: nothing to raise. No contract: nowhere to. Cancelled: out of the sums.
    const exact = await run((tx) =>
      createSelection(tx, ctx, {
        projectId: project.id,
        contractId: contract.id,
        name: "Front door hardware",
        allowanceCents: 600_00,
        status: "approved",
        decidedOn: "2026-09-11",
        choices: [{ description: "Schlage Camelot, matte black", priceCents: 600_00, isSelected: true }],
      }),
    );
    await expect(run((tx) => raiseSelectionChangeOrder(tx, ctx, exact.id, { number: "CO-3" }))).rejects.toMatchObject({
      code: "INVALID_VALUE",
      message: expect.stringContaining("nothing to raise"),
    });
    const loose = await run((tx) =>
      createSelection(tx, ctx, {
        projectId: project.id,
        name: "Mailbox",
        status: "approved",
        choices: [{ description: "Cast aluminium", priceCents: 180_00, isSelected: true }],
      }),
    );
    await expect(run((tx) => raiseSelectionChangeOrder(tx, ctx, loose.id, { number: "CO-3" }))).rejects.toMatchObject({
      code: "INVALID_VALUE",
      message: expect.stringContaining("no contract"),
    });
    await run((tx) => updateSelection(tx, ctx, loose.id, { status: "cancelled" }));
    rows = await rowsOf();
    expect(rows.map((r) => r.selection.name)).toEqual(["Master bath floor tile", "Front door hardware", "Mailbox"]);
    expect(summarise(rows)).toMatchObject({ count: 2, allowancesCents: 7_600_00, chosenCents: 7_100_00, differenceCents: -500_00, raisedCents: -500_00 });
  }, 120_000);
});