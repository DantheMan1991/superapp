import "dotenv/config";
import { afterAll, beforeAll, expect, it } from "vitest";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { withSystem, withTenant, schema, type Tx } from "../../src/db";
import { d, seedParty } from "./_shared";
import { addPunchItem } from "../../src/packs/jobs/field-ops";

/**
 * `job_cost_code_sets`, `job_cost_codes` and `job_projects` — RLS.
 *
 * There is nothing special in this file, and that is the point: a capability
 * pack's tables get exactly the treatment a core module's do — tenant_id, FORCE
 * RLS, default-deny with no context, no cross-tenant read, write or enumeration.
 *
 * It also certifies the FOUR composite FKs a project carries that a flat table
 * would not — its company, its division, its client and its cost code list are
 * each always same-tenant — so a project pointing across the wall is
 * unrepresentable even under `withSystem`, where RLS is not watching. That
 * matters more here than on most tables: those four are the coordinates a cost
 * report groups by, and a cross-tenant one would put another business's job in
 * this business's numbers.
 *
 * Fixtures are built under `withSystem` on purpose: this suite certifies what
 * the DATABASE enforces, and routing setup through `src/packs/jobs/ops.ts` would
 * let a bug in that file make these tests agree with it.
 */
d("jobs tables (RLS)", () => {
  const STAMP = `iso-jobs-${process.pid}`;
  const OWNER = `${STAMP}-owner`;
  const MATE = `${STAMP}-mate`; // staff in tenant A
  const OTHER = `${STAMP}-other`; // owner of tenant B

  let tenantA = "";
  let tenantB = "";
  let entityA = "";
  let entityB = "";
  let clientA = "";
  let setA = "";
  let setB = "";
  let projectA = "";
  let projectB = "";
  let contractA = "";
  let commitmentA = "";
  let budgetA = "";
  let codeA = "";
  let contractB = "";
  let changeOrderA = "";
  let sovA = "";
  let payAppA = "";
  let logA = "";
  let periodA = "";

  const asStaff = <T>(fn: (tx: Tx) => Promise<T>) =>
    withTenant(tenantA, fn, { role: "staff", userId: MATE });
  const asOwner = <T>(fn: (tx: Tx) => Promise<T>) =>
    withTenant(tenantA, fn, { role: "owner", userId: OWNER });
  const asOtherTenant = <T>(fn: (tx: Tx) => Promise<T>) =>
    withTenant(tenantB, fn, { role: "owner", userId: OTHER });

  beforeAll(async () => {
    await withSystem(async (tx) => {
      const tenants = await tx
        .insert(schema.tenants)
        .values([
          { clerkOrgId: `${STAMP}-a`, name: "Builder A", slug: `${STAMP}-a` },
          { clerkOrgId: `${STAMP}-b`, name: "Builder B", slug: `${STAMP}-b` },
        ])
        .returning();
      tenantA = tenants[0].id;
      tenantB = tenants[1].id;

      const entities = await tx
        .insert(schema.entities)
        .values([
          { tenantId: tenantA, name: "Builder A LLC", isDefault: true },
          { tenantId: tenantB, name: "Builder B LLC", isDefault: true },
        ])
        .returning();
      entityA = entities[0].id;
      entityB = entities[1].id;

      clientA = await seedParty(tx, tenantA, "Oak Row Owner");

      const sets = await tx
        .insert(schema.jobCostCodeSets)
        .values([
          { tenantId: tenantA, name: "A codes", isDefault: true },
          { tenantId: tenantB, name: "B codes", isDefault: true },
        ])
        .returning();
      setA = sets[0].id;
      setB = sets[1].id;

      const codes = await tx
        .insert(schema.jobCostCodes)
        .values([
          { tenantId: tenantA, setId: setA, code: "1000", name: "Sitework" },
          { tenantId: tenantB, setId: setB, code: "1000", name: "Sitework" },
        ])
        .returning();
      codeA = codes[0].id;

      const projects = await tx
        .insert(schema.jobProjects)
        .values([
          {
            tenantId: tenantA,
            entityId: entityA,
            partyId: clientA,
            costCodeSetId: setA,
            number: "24-001",
            name: "Oak Row residence",
            deliveryMethod: "luxury_custom",
          },
          {
            tenantId: tenantB,
            entityId: entityB,
            number: "B-1",
            name: "Other builder's job",
          },
        ])
        .returning();
      projectA = projects[0].id;
      projectB = projects[1].id;

      const commitments = await tx
        .insert(schema.jobCommitments)
        .values({
          tenantId: tenantA,
          projectId: projectA,
          partyId: clientA,
          number: "PO-ISO-1",
          status: "issued",
        })
        .returning();
      commitmentA = commitments[0].id;
      await tx.insert(schema.jobCommitmentLines).values({
        tenantId: tenantA,
        commitmentId: commitmentA,
        costCodeId: codeA,
        amountCents: 4_200_00,
      });

      const budgets = await tx
        .insert(schema.jobBudgetLines)
        .values({
          tenantId: tenantA,
          projectId: projectA,
          costCodeId: codeA,
          originalCents: 5_000_00,
        })
        .returning();
      budgetA = budgets[0].id;

      const contracts = await tx
        .insert(schema.jobContracts)
        .values([
          {
            tenantId: tenantA,
            projectId: projectA,
            kind: "new_home",
            counterpartyPartyId: clientA,
            valueCents: 18250000,
            status: "signed",
          },
          {
            tenantId: tenantB,
            projectId: projectB,
            kind: "aia",
            valueCents: 99900000,
            status: "signed",
          },
        ])
        .returning();
      contractA = contracts[0].id;
      contractB = contracts[1].id;

      const changeOrders = await tx
        .insert(schema.jobChangeOrders)
        .values({
          tenantId: tenantA,
          contractId: contractA,
          number: "CO-1",
          title: "Covered porch",
          status: "approved",
          approvedOn: "2026-09-01",
          valueCents: 12_500_00,
        })
        .returning();
      changeOrderA = changeOrders[0].id;
      await tx.insert(schema.jobChangeOrderLines).values({
        tenantId: tenantA,
        changeOrderId: changeOrderA,
        costCodeId: codeA,
        amountCents: 5_000_00,
      });

      const sov = await tx
        .insert(schema.jobSovLines)
        .values({
          tenantId: tenantA,
          contractId: contractA,
          description: "Contract sum",
          scheduledCents: 18250000,
          costCodeId: codeA,
        })
        .returning();
      sovA = sov[0].id;
      const apps = await tx
        .insert(schema.jobPayApplications)
        .values({
          tenantId: tenantA,
          contractId: contractA,
          number: 1,
          periodTo: "2026-09-30",
          retainagePpm: 100_000,
        })
        .returning();
      payAppA = apps[0].id;
      await tx.insert(schema.jobPayApplicationLines).values({
        tenantId: tenantA,
        payApplicationId: payAppA,
        sovLineId: sovA,
        scheduledCents: 18250000,
        thisPeriodCents: 1_000_00,
      });

      const logs = await tx
        .insert(schema.jobDailyLogs)
        .values({ tenantId: tenantA, projectId: projectA, logDate: "2026-09-14", notes: "Poured the slab" })
        .returning();
      logA = logs[0].id;
      await tx.insert(schema.jobDailyLogCrews).values({
        tenantId: tenantA,
        logId: logA,
        trade: "Concrete",
        workers: 4,
        hoursTenths: 60,
      });
    });
  });

  afterAll(async () => {
    await withSystem(async (tx) => {
      await tx
        .delete(schema.tenants)
        .where(inArray(schema.tenants.id, [tenantA, tenantB]));
    });
  });

  it("a tenant sees only its own projects", async () => {
    const rows = await asOwner((tx) => tx.select().from(schema.jobProjects));
    expect(rows.map((r) => r.id)).toEqual([projectA]);
  });

  it("a tenant sees only its own cost code sets and codes", async () => {
    const { sets, codes } = await asOwner(async (tx) => ({
      sets: await tx.select().from(schema.jobCostCodeSets),
      codes: await tx.select().from(schema.jobCostCodes),
    }));
    expect(sets.map((s) => s.id)).toEqual([setA]);
    expect(codes.map((c) => c.setId)).toEqual([setA]);
  });

  it("STAFF see the same rows as an owner — RLS is member-wide", async () => {
    // Which VERB needs which role is the action layer's business, not the
    // policy's. See src/lib/packs/authorize.ts.
    const rows = await asStaff((tx) => tx.select().from(schema.jobProjects));
    expect(rows.map((r) => r.id)).toEqual([projectA]);
  });

  it("cannot read another tenant's project by id", async () => {
    const rows = await asOtherTenant((tx) =>
      tx.select().from(schema.jobProjects).where(eq(schema.jobProjects.id, projectA)),
    );
    expect(rows).toEqual([]);
  });

  it("cannot update another tenant's project", async () => {
    const rows = await asOtherTenant((tx) =>
      tx
        .update(schema.jobProjects)
        .set({ name: "stolen" })
        .where(eq(schema.jobProjects.id, projectA))
        .returning(),
    );
    expect(rows).toEqual([]);
    const still = await asOwner((tx) =>
      tx.select().from(schema.jobProjects).where(eq(schema.jobProjects.id, projectA)),
    );
    expect(still[0].name).toBe("Oak Row residence");
  });

  it("cannot delete another tenant's cost code", async () => {
    const rows = await asOtherTenant((tx) =>
      tx
        .delete(schema.jobCostCodes)
        .where(eq(schema.jobCostCodes.setId, setA))
        .returning(),
    );
    expect(rows).toEqual([]);
  });

  it("cannot insert a project into another tenant", async () => {
    await expect(
      asOtherTenant((tx) =>
        tx.insert(schema.jobProjects).values({
          tenantId: tenantA,
          entityId: entityA,
          number: "smuggled",
          name: "smuggled",
        }),
      ),
    ).rejects.toThrow();
  });

  /**
   * THE FOUR COORDINATES, each proved unrepresentable across the wall — under
   * `withSystem`, so it is the KEY refusing and not a policy.
   */
  it("a project cannot name another tenant's COMPANY", async () => {
    await expect(
      withSystem((tx) =>
        tx.insert(schema.jobProjects).values({
          tenantId: tenantA,
          entityId: entityB,
          number: "x-entity",
          name: "x",
        }),
      ),
    ).rejects.toThrow();
  });

  it("a project cannot name another tenant's COST CODE LIST", async () => {
    await expect(
      withSystem((tx) =>
        tx.insert(schema.jobProjects).values({
          tenantId: tenantA,
          entityId: entityA,
          costCodeSetId: setB,
          number: "x-set",
          name: "x",
        }),
      ),
    ).rejects.toThrow();
  });

  it("a cost code cannot belong to another tenant's list", async () => {
    await expect(
      withSystem((tx) =>
        tx.insert(schema.jobCostCodes).values({
          tenantId: tenantA,
          setId: setB,
          code: "9999",
          name: "x",
        }),
      ),
    ).rejects.toThrow();
  });

  it("a tenant sees only its own contracts", async () => {
    const rows = await asOwner((tx) => tx.select().from(schema.jobContracts));
    expect(rows.map((r) => r.id)).toEqual([contractA]);
  });

  it("cannot read another tenant's contract VALUE by id", async () => {
    // The sharpest case in this file: a contract value is what a business is
    // being paid, and it is the one number nobody volunteers.
    const rows = await asOtherTenant((tx) =>
      tx.select().from(schema.jobContracts).where(eq(schema.jobContracts.id, contractA)),
    );
    expect(rows).toEqual([]);
  });

  it("cannot update another tenant's contract", async () => {
    const rows = await asOtherTenant((tx) =>
      tx
        .update(schema.jobContracts)
        .set({ valueCents: 1 })
        .where(eq(schema.jobContracts.id, contractA))
        .returning(),
    );
    expect(rows).toEqual([]);
    const still = await asOwner((tx) =>
      tx.select().from(schema.jobContracts).where(eq(schema.jobContracts.id, contractA)),
    );
    expect(still[0].valueCents).toBe(18250000);
  });

  it("a contract cannot hang off another tenant's PROJECT", async () => {
    await expect(
      withSystem((tx) =>
        tx.insert(schema.jobContracts).values({
          tenantId: tenantA,
          projectId: projectB,
          kind: "smuggled",
        }),
      ),
    ).rejects.toThrow();
  });

  it("a contract cannot name another tenant's COUNTERPARTY", async () => {
    const otherParty = await withSystem((tx) => seedParty(tx, tenantB, "Their GC"));
    await expect(
      withSystem((tx) =>
        tx.insert(schema.jobContracts).values({
          tenantId: tenantA,
          projectId: projectA,
          kind: "sub_work",
          counterpartyPartyId: otherParty,
        }),
      ),
    ).rejects.toThrow();
  });

  it("deleting a project takes its contracts with it, and nothing else", async () => {
    // The cascade is deliberate: a project's agreements are part of it. Proved
    // rather than assumed, because a dangling contract would still be summed by
    // `projectValues` and would report money against a job that is gone.
    const scratch = await withSystem(async (tx) => {
      const p = await tx
        .insert(schema.jobProjects)
        .values({ tenantId: tenantA, entityId: entityA, number: "casc-1", name: "c" })
        .returning();
      await tx.insert(schema.jobContracts).values({
        tenantId: tenantA,
        projectId: p[0].id,
        kind: "x",
      });
      return p[0].id;
    });
    await withSystem((tx) =>
      tx.delete(schema.jobProjects).where(eq(schema.jobProjects.id, scratch)),
    );
    const left = await asOwner((tx) =>
      tx
        .select()
        .from(schema.jobContracts)
        .where(eq(schema.jobContracts.projectId, scratch)),
    );
    expect(left).toEqual([]);
    const mine = await asOwner((tx) => tx.select().from(schema.jobContracts));
    expect(mine.map((r) => r.id)).toEqual([contractA]);
  });

  it("a tenant sees only its own commitments and their lines", async () => {
    const { heads, lines } = await asOwner(async (tx) => ({
      heads: await tx.select().from(schema.jobCommitments),
      lines: await tx.select().from(schema.jobCommitmentLines),
    }));
    expect(heads.map((h) => h.id)).toEqual([commitmentA]);
    expect(lines).toHaveLength(1);
  });

  it("cannot read another tenant's committed AMOUNT", async () => {
    const rows = await asOtherTenant((tx) =>
      tx
        .select()
        .from(schema.jobCommitmentLines)
        .where(eq(schema.jobCommitmentLines.commitmentId, commitmentA)),
    );
    expect(rows).toEqual([]);
  });

  it("a commitment cannot hang off another tenant's PROJECT", async () => {
    await expect(
      withSystem((tx) =>
        tx.insert(schema.jobCommitments).values({
          tenantId: tenantA,
          projectId: projectB,
          partyId: clientA,
          number: "x-proj",
        }),
      ),
    ).rejects.toThrow();
  });

  it("a commitment line cannot name another tenant's COST CODE", async () => {
    const otherCode = await withSystem(async (tx) => {
      const r = await tx
        .select()
        .from(schema.jobCostCodes)
        .where(eq(schema.jobCostCodes.setId, setB));
      return r[0].id;
    });
    await expect(
      withSystem((tx) =>
        tx.insert(schema.jobCommitmentLines).values({
          tenantId: tenantA,
          commitmentId: commitmentA,
          costCodeId: otherCode,
          amountCents: 1,
        }),
      ),
    ).rejects.toThrow();
  });

  it("a cost code with money committed against it CANNOT be deleted", async () => {
    /*
     * The key is the backstop for a rule the app already keeps: `updateCostCode`
     * has no delete verb, codes are retired instead. If a delete ever appeared,
     * this refuses it rather than letting a year of job history lose its code.
     */
    await expect(
      withSystem((tx) =>
        tx.delete(schema.jobCostCodes).where(eq(schema.jobCostCodes.id, codeA)),
      ),
    ).rejects.toThrow();
  });

  it("deleting a project takes its commitments AND their lines", async () => {
    const scratch = await withSystem(async (tx) => {
      const p = await tx
        .insert(schema.jobProjects)
        .values({ tenantId: tenantA, entityId: entityA, number: "casc-2", name: "c2" })
        .returning();
      const c = await tx
        .insert(schema.jobCommitments)
        .values({
          tenantId: tenantA,
          projectId: p[0].id,
          partyId: clientA,
          number: "casc-po",
        })
        .returning();
      await tx.insert(schema.jobCommitmentLines).values({
        tenantId: tenantA,
        commitmentId: c[0].id,
        amountCents: 500,
      });
      return { projectId: p[0].id, commitmentId: c[0].id };
    });
    await withSystem((tx) =>
      tx.delete(schema.jobProjects).where(eq(schema.jobProjects.id, scratch.projectId)),
    );
    const left = await asOwner(async (tx) => ({
      heads: await tx
        .select()
        .from(schema.jobCommitments)
        .where(eq(schema.jobCommitments.id, scratch.commitmentId)),
      lines: await tx
        .select()
        .from(schema.jobCommitmentLines)
        .where(eq(schema.jobCommitmentLines.commitmentId, scratch.commitmentId)),
    }));
    expect(left.heads).toEqual([]);
    expect(left.lines).toEqual([]);
  });

  it("cannot read another tenant's BUDGET", async () => {
    // A budget by cost code is the closest thing in this pack to a margin.
    const rows = await asOtherTenant((tx) =>
      tx
        .select()
        .from(schema.jobBudgetLines)
        .where(eq(schema.jobBudgetLines.id, budgetA)),
    );
    expect(rows).toEqual([]);
  });

  it("cannot change another tenant's budget", async () => {
    const rows = await asOtherTenant((tx) =>
      tx
        .update(schema.jobBudgetLines)
        .set({ originalCents: 1 })
        .where(eq(schema.jobBudgetLines.id, budgetA))
        .returning(),
    );
    expect(rows).toEqual([]);
    const still = await asOwner((tx) =>
      tx
        .select()
        .from(schema.jobBudgetLines)
        .where(eq(schema.jobBudgetLines.id, budgetA)),
    );
    expect(still[0].originalCents).toBe(5_000_00);
  });

  it("a budget line cannot name another tenant's COST CODE", async () => {
    const otherCode = await withSystem(async (tx) => {
      const r = await tx
        .select()
        .from(schema.jobCostCodes)
        .where(eq(schema.jobCostCodes.setId, setB));
      return r[0].id;
    });
    await expect(
      withSystem((tx) =>
        tx.insert(schema.jobBudgetLines).values({
          tenantId: tenantA,
          projectId: projectA,
          costCodeId: otherCode,
          originalCents: 1,
        }),
      ),
    ).rejects.toThrow();
  });

  it("one budget line per code per project, enforced by the database", async () => {
    // Two would make every variance ambiguous and every total quietly wrong.
    await expect(
      withSystem((tx) =>
        tx.insert(schema.jobBudgetLines).values({
          tenantId: tenantA,
          projectId: projectA,
          costCodeId: codeA,
          originalCents: 999,
        }),
      ),
    ).rejects.toThrow();
  });

  it("keeps the two builders' identically-numbered codes apart", async () => {
    // Both tenants seeded a `1000 Sitework`. A leak here would be invisible in
    // any screen that groups by code, which is every job cost report there is.
    const a = await asOwner((tx) => tx.select().from(schema.jobCostCodes));
    const b = await asOtherTenant((tx) => tx.select().from(schema.jobCostCodes));
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
    expect(a[0].id).not.toBe(b[0].id);
    expect(projectB).not.toBe(projectA);
  });

  it("cannot read another tenant's CHANGE ORDERS, or their lines", async () => {
    // The price of a change beside its cost is the margin on that change.
    const { heads, lines } = await asOtherTenant(async (tx) => ({
      heads: await tx
        .select()
        .from(schema.jobChangeOrders)
        .where(eq(schema.jobChangeOrders.id, changeOrderA)),
      lines: await tx
        .select()
        .from(schema.jobChangeOrderLines)
        .where(eq(schema.jobChangeOrderLines.changeOrderId, changeOrderA)),
    }));
    expect(heads).toEqual([]);
    expect(lines).toEqual([]);
  });

  it("cannot approve, re-price or delete another tenant's change order", async () => {
    const touched = await asOtherTenant(async (tx) => ({
      updated: await tx
        .update(schema.jobChangeOrders)
        .set({ valueCents: 1 })
        .where(eq(schema.jobChangeOrders.id, changeOrderA))
        .returning(),
      deleted: await tx
        .delete(schema.jobChangeOrders)
        .where(eq(schema.jobChangeOrders.id, changeOrderA))
        .returning(),
    }));
    expect(touched.updated).toEqual([]);
    expect(touched.deleted).toEqual([]);
    const still = await asOwner((tx) =>
      tx
        .select()
        .from(schema.jobChangeOrders)
        .where(eq(schema.jobChangeOrders.id, changeOrderA)),
    );
    expect(still[0].valueCents).toBe(12_500_00);
  });

  it("a change order cannot hang off another tenant's CONTRACT", async () => {
    // Even under withSystem: the composite FK makes the row unrepresentable.
    await expect(
      withSystem((tx) =>
        tx.insert(schema.jobChangeOrders).values({
          tenantId: tenantA,
          contractId: contractB,
          number: "X-1",
          title: "Across the wall",
        }),
      ),
    ).rejects.toThrow();
  });

  it("a change order line cannot name another tenant's COST CODE", async () => {
    const otherCode = await withSystem(async (tx) => {
      const r = await tx
        .select()
        .from(schema.jobCostCodes)
        .where(eq(schema.jobCostCodes.setId, setB));
      return r[0].id;
    });
    await expect(
      withSystem((tx) =>
        tx.insert(schema.jobChangeOrderLines).values({
          tenantId: tenantA,
          changeOrderId: changeOrderA,
          costCodeId: otherCode,
          amountCents: 1,
        }),
      ),
    ).rejects.toThrow();
  });

  it("an APPROVED change order without a date is unrepresentable, and so is a dated one that is not", async () => {
    await expect(
      withSystem((tx) =>
        tx.insert(schema.jobChangeOrders).values({
          tenantId: tenantA,
          contractId: contractA,
          number: "X-2",
          title: "Approved by nobody on no day",
          status: "approved",
        }),
      ),
    ).rejects.toThrow();
    await expect(
      withSystem((tx) =>
        tx.insert(schema.jobChangeOrders).values({
          tenantId: tenantA,
          contractId: contractA,
          number: "X-3",
          title: "Dated but not approved",
          status: "proposed",
          approvedOn: "2026-09-01",
        }),
      ),
    ).rejects.toThrow();
  });

  it("a change order may be NEGATIVE — the one money here without a floor", async () => {
    // A deduction is a negative number, not a credit concept. Both halves.
    const ids = await withSystem(async (tx) => {
      const co = await tx
        .insert(schema.jobChangeOrders)
        .values({
          tenantId: tenantA,
          contractId: contractA,
          number: "X-4",
          title: "Drop the pool",
          valueCents: -18_500_00,
        })
        .returning();
      const line = await tx
        .insert(schema.jobChangeOrderLines)
        .values({
          tenantId: tenantA,
          changeOrderId: co[0].id,
          costCodeId: codeA,
          amountCents: -9_000_00,
        })
        .returning();
      return { co: co[0].id, line: line[0].id };
    });
    const back = await asOwner((tx) =>
      tx
        .select()
        .from(schema.jobChangeOrderLines)
        .where(eq(schema.jobChangeOrderLines.id, ids.line)),
    );
    expect(back[0].amountCents).toBe(-9_000_00);
    await withSystem((tx) =>
      tx.delete(schema.jobChangeOrders).where(eq(schema.jobChangeOrders.id, ids.co)),
    );
  });

  it("numbers a change order per contract: the same number on two contracts is fine, twice on one is not", async () => {
    const second = await withSystem(async (tx) => {
      const c = await tx
        .insert(schema.jobContracts)
        .values({ tenantId: tenantA, projectId: projectA, kind: "aia", sequence: 9 })
        .returning();
      await tx.insert(schema.jobChangeOrders).values({
        tenantId: tenantA,
        contractId: c[0].id,
        number: "CO-1", // same as changeOrderA's, on a different contract
        title: "Fine",
      });
      return c[0].id;
    });
    await expect(
      withSystem((tx) =>
        tx.insert(schema.jobChangeOrders).values({
          tenantId: tenantA,
          contractId: contractA,
          number: "CO-1",
          title: "Twice on one",
        }),
      ),
    ).rejects.toThrow();
    await withSystem((tx) =>
      tx.delete(schema.jobContracts).where(eq(schema.jobContracts.id, second)),
    );
  });

  it("deleting a contract takes its change orders AND their lines", async () => {
    const scratch = await withSystem(async (tx) => {
      const c = await tx
        .insert(schema.jobContracts)
        .values({ tenantId: tenantA, projectId: projectA, kind: "aia", sequence: 8 })
        .returning();
      const co = await tx
        .insert(schema.jobChangeOrders)
        .values({ tenantId: tenantA, contractId: c[0].id, number: "casc-1", title: "c" })
        .returning();
      await tx.insert(schema.jobChangeOrderLines).values({
        tenantId: tenantA,
        changeOrderId: co[0].id,
        costCodeId: codeA,
        amountCents: 500,
      });
      return { contractId: c[0].id, changeOrderId: co[0].id };
    });
    await withSystem((tx) =>
      tx.delete(schema.jobContracts).where(eq(schema.jobContracts.id, scratch.contractId)),
    );
    const left = await asOwner(async (tx) => ({
      heads: await tx
        .select()
        .from(schema.jobChangeOrders)
        .where(eq(schema.jobChangeOrders.id, scratch.changeOrderId)),
      lines: await tx
        .select()
        .from(schema.jobChangeOrderLines)
        .where(eq(schema.jobChangeOrderLines.changeOrderId, scratch.changeOrderId)),
    }));
    expect(left.heads).toEqual([]);
    expect(left.lines).toEqual([]);
  });

  it("cannot read another tenant's SCHEDULE, APPLICATIONS or their lines", async () => {
    const seen = await asOtherTenant(async (tx) => ({
      sov: await tx.select().from(schema.jobSovLines).where(eq(schema.jobSovLines.id, sovA)),
      apps: await tx
        .select()
        .from(schema.jobPayApplications)
        .where(eq(schema.jobPayApplications.id, payAppA)),
      lines: await tx
        .select()
        .from(schema.jobPayApplicationLines)
        .where(eq(schema.jobPayApplicationLines.payApplicationId, payAppA)),
    }));
    expect(seen.sov).toEqual([]);
    expect(seen.apps).toEqual([]);
    expect(seen.lines).toEqual([]);
  });

  it("cannot change another tenant's application", async () => {
    const rows = await asOtherTenant((tx) =>
      tx
        .update(schema.jobPayApplications)
        .set({ retainagePpm: 1 })
        .where(eq(schema.jobPayApplications.id, payAppA))
        .returning(),
    );
    expect(rows).toEqual([]);
  });

  it("a schedule line and an application cannot hang off another tenant's CONTRACT", async () => {
    await expect(
      withSystem((tx) =>
        tx.insert(schema.jobSovLines).values({
          tenantId: tenantA,
          contractId: contractB,
          description: "Across the wall",
          scheduledCents: 1,
        }),
      ),
    ).rejects.toThrow();
    await expect(
      withSystem((tx) =>
        tx.insert(schema.jobPayApplications).values({
          tenantId: tenantA,
          contractId: contractB,
          number: 9,
          periodTo: "2026-09-30",
        }),
      ),
    ).rejects.toThrow();
  });

  it("an issued application must be an invoice, and a draft must not — both ways", async () => {
    await expect(
      withSystem((tx) =>
        tx.insert(schema.jobPayApplications).values({
          tenantId: tenantA,
          contractId: contractA,
          number: 8,
          periodTo: "2026-09-30",
          status: "issued",
        }),
      ),
    ).rejects.toThrow();
  });

  it("a billed schedule line cannot be deleted, and a voided application's line still holds it", async () => {
    await expect(
      withSystem((tx) => tx.delete(schema.jobSovLines).where(eq(schema.jobSovLines.id, sovA))),
    ).rejects.toThrow();
  });

  it("numbers applications per contract, once each", async () => {
    await expect(
      withSystem((tx) =>
        tx.insert(schema.jobPayApplications).values({
          tenantId: tenantA,
          contractId: contractA,
          number: 1,
          periodTo: "2026-10-31",
        }),
      ),
    ).rejects.toThrow();
  });

  it("deleting a contract takes its schedule, its applications and their lines", async () => {
    const scratch = await withSystem(async (tx) => {
      const c = await tx
        .insert(schema.jobContracts)
        .values({ tenantId: tenantA, projectId: projectA, kind: "aia", sequence: 7 })
        .returning();
      const s = await tx
        .insert(schema.jobSovLines)
        .values({ tenantId: tenantA, contractId: c[0].id, description: "s", scheduledCents: 100 })
        .returning();
      const a = await tx
        .insert(schema.jobPayApplications)
        .values({ tenantId: tenantA, contractId: c[0].id, number: 1, periodTo: "2026-09-30" })
        .returning();
      await tx.insert(schema.jobPayApplicationLines).values({
        tenantId: tenantA,
        payApplicationId: a[0].id,
        sovLineId: s[0].id,
      });
      return { contractId: c[0].id, sovId: s[0].id, appId: a[0].id };
    });
    await withSystem((tx) =>
      tx.delete(schema.jobContracts).where(eq(schema.jobContracts.id, scratch.contractId)),
    );
    const left = await asOwner(async (tx) => ({
      sov: await tx.select().from(schema.jobSovLines).where(eq(schema.jobSovLines.id, scratch.sovId)),
      apps: await tx
        .select()
        .from(schema.jobPayApplications)
        .where(eq(schema.jobPayApplications.id, scratch.appId)),
    }));
    expect(left.sov).toEqual([]);
    expect(left.apps).toEqual([]);
  });

  it("cannot read or change another tenant's DAILY LOG or its crews", async () => {
    const seen = await asOtherTenant(async (tx) => ({
      logs: await tx.select().from(schema.jobDailyLogs).where(eq(schema.jobDailyLogs.id, logA)),
      crews: await tx.select().from(schema.jobDailyLogCrews).where(eq(schema.jobDailyLogCrews.logId, logA)),
      changed: await tx
        .update(schema.jobDailyLogs)
        .set({ notes: "tampered" })
        .where(eq(schema.jobDailyLogs.id, logA))
        .returning(),
    }));
    expect(seen.logs).toEqual([]);
    expect(seen.crews).toEqual([]);
    expect(seen.changed).toEqual([]);
  });

  it("a day cannot hang off another tenant's PROJECT, and a crew cannot name another tenant's SUBCONTRACTOR", async () => {
    await expect(
      withSystem((tx) =>
        tx.insert(schema.jobDailyLogs).values({ tenantId: tenantA, projectId: projectB, logDate: "2026-09-14" }),
      ),
    ).rejects.toThrow();
    const otherParty = await withSystem(async (tx) => {
      const rows = await tx
        .select({ id: schema.parties.id })
        .from(schema.parties)
        .where(eq(schema.parties.tenantId, tenantB))
        .limit(1);
      return rows[0]?.id ?? null;
    });
    if (otherParty) {
      await expect(
        withSystem((tx) =>
          tx.insert(schema.jobDailyLogCrews).values({
            tenantId: tenantA,
            logId: logA,
            partyId: otherParty,
            workers: 1,
          }),
        ),
      ).rejects.toThrow();
    }
  });

  it("one report per job per day, enforced by the database", async () => {
    await expect(
      withSystem((tx) =>
        tx.insert(schema.jobDailyLogs).values({ tenantId: tenantA, projectId: projectA, logDate: "2026-09-14" }),
      ),
    ).rejects.toThrow();
  });

  it("a crew line that names nobody is unrepresentable", async () => {
    await expect(
      withSystem((tx) =>
        tx.insert(schema.jobDailyLogCrews).values({ tenantId: tenantA, logId: logA, workers: 2 }),
      ),
    ).rejects.toThrow();
  });

  it("deleting a project takes its days and their crews", async () => {
    const scratch = await withSystem(async (tx) => {
      const p = await tx
        .insert(schema.jobProjects)
        .values({ tenantId: tenantA, entityId: entityA, number: "casc-3", name: "c3" })
        .returning();
      const l = await tx
        .insert(schema.jobDailyLogs)
        .values({ tenantId: tenantA, projectId: p[0].id, logDate: "2026-09-14" })
        .returning();
      await tx.insert(schema.jobDailyLogCrews).values({ tenantId: tenantA, logId: l[0].id, trade: "x", workers: 1 });
      return { projectId: p[0].id, logId: l[0].id };
    });
    await withSystem((tx) => tx.delete(schema.jobProjects).where(eq(schema.jobProjects.id, scratch.projectId)));
    const left = await asOwner(async (tx) => ({
      logs: await tx.select().from(schema.jobDailyLogs).where(eq(schema.jobDailyLogs.id, scratch.logId)),
      crews: await tx.select().from(schema.jobDailyLogCrews).where(eq(schema.jobDailyLogCrews.logId, scratch.logId)),
    }));
    expect(left.logs).toEqual([]);
    expect(left.crews).toEqual([]);
  });

  // ------------------------------------------------------------------- wip

  it("cannot read or change another tenant's WIP PERIOD or its lines", async () => {
    periodA = await withSystem(async (tx) => {
      const p = await tx
        .insert(schema.jobWipPeriods)
        .values({ tenantId: tenantA, entityId: entityA, periodEnd: "2026-09-30" })
        .returning();
      await tx.insert(schema.jobWipLines).values({
        tenantId: tenantA,
        periodId: p[0].id,
        projectId: projectA,
        estimateCents: 1_300_000_00,
      });
      return p[0].id;
    });
    const seen = await asOtherTenant(async (tx) => ({
      periods: await tx.select().from(schema.jobWipPeriods).where(eq(schema.jobWipPeriods.id, periodA)),
      lines: await tx.select().from(schema.jobWipLines).where(eq(schema.jobWipLines.periodId, periodA)),
      changed: await tx
        .update(schema.jobWipLines)
        .set({ estimateCents: 1 })
        .where(eq(schema.jobWipLines.periodId, periodA))
        .returning(),
    }));
    expect(seen.periods).toEqual([]);
    expect(seen.lines).toEqual([]);
    expect(seen.changed).toEqual([]);
    const mine = await asStaff((tx) =>
      tx.select().from(schema.jobWipLines).where(eq(schema.jobWipLines.periodId, periodA)),
    );
    expect(mine).toHaveLength(1);
  });

  it("a period cannot name another tenant's COMPANY, and a line cannot name another tenant's PROJECT", async () => {
    await expect(
      withSystem((tx) =>
        tx
          .insert(schema.jobWipPeriods)
          .values({ tenantId: tenantA, entityId: entityB, periodEnd: "2026-10-31" }),
      ),
    ).rejects.toThrow();
    await expect(
      withSystem((tx) =>
        tx
          .insert(schema.jobWipLines)
          .values({ tenantId: tenantA, periodId: periodA, projectId: projectB }),
      ),
    ).rejects.toThrow();
  });

  it("one schedule per company per date, and a posted period without an entry is unrepresentable", async () => {
    await expect(
      withSystem((tx) =>
        tx
          .insert(schema.jobWipPeriods)
          .values({ tenantId: tenantA, entityId: entityA, periodEnd: "2026-09-30" }),
      ),
    ).rejects.toThrow();
    await expect(
      withSystem((tx) =>
        tx
          .update(schema.jobWipPeriods)
          .set({ status: "posted" })
          .where(eq(schema.jobWipPeriods.id, periodA)),
      ),
    ).rejects.toThrow();
    await expect(
      withSystem((tx) =>
        tx
          .insert(schema.jobWipLines)
          .values({ tenantId: tenantA, periodId: periodA, projectId: projectA, estimateCents: -1 }),
      ),
    ).rejects.toThrow();
  });

  it("deleting a period takes its lines, and deleting a project takes its lines too", async () => {
    const scratch = await withSystem(async (tx) => {
      const p = await tx
        .insert(schema.jobWipPeriods)
        .values({ tenantId: tenantA, entityId: entityA, periodEnd: "2026-11-30" })
        .returning();
      const proj = await tx
        .insert(schema.jobProjects)
        .values({ tenantId: tenantA, entityId: entityA, number: "casc-wip", name: "cw" })
        .returning();
      await tx.insert(schema.jobWipLines).values([
        { tenantId: tenantA, periodId: p[0].id, projectId: projectA },
        { tenantId: tenantA, periodId: periodA, projectId: proj[0].id },
      ]);
      return { periodId: p[0].id, projectId: proj[0].id };
    });
    await withSystem(async (tx) => {
      await tx.delete(schema.jobWipPeriods).where(eq(schema.jobWipPeriods.id, scratch.periodId));
      await tx.delete(schema.jobProjects).where(eq(schema.jobProjects.id, scratch.projectId));
    });
    const left = await withSystem((tx) =>
      tx
        .select()
        .from(schema.jobWipLines)
        .where(inArray(schema.jobWipLines.periodId, [scratch.periodId, periodA])),
    );
    // periodA's own line (on projectA) survives; the two scratch lines are gone.
    expect(left).toHaveLength(1);
    expect(left[0].projectId).toBe(projectA);
  });

  // ---------------------------------------------------------- cost plus a fee

  it("cannot read or change another tenant's COST LINES, and a line cannot hang off another tenant's APPLICATION or name its CODE", async () => {
    const lineId = await withSystem(async (tx) => {
      const rows = await tx
        .insert(schema.jobPayApplicationCosts)
        .values({
          tenantId: tenantA,
          payApplicationId: payAppA,
          costCodeId: codeA,
          ledgerToDateCents: 40_000_00,
          thisPeriodCents: 40_000_00,
        })
        .returning();
      return rows[0].id;
    });
    const seen = await asOtherTenant(async (tx) => ({
      lines: await tx
        .select()
        .from(schema.jobPayApplicationCosts)
        .where(eq(schema.jobPayApplicationCosts.id, lineId)),
      changed: await tx
        .update(schema.jobPayApplicationCosts)
        .set({ thisPeriodCents: 1 })
        .where(eq(schema.jobPayApplicationCosts.id, lineId))
        .returning(),
    }));
    expect(seen.lines).toEqual([]);
    expect(seen.changed).toEqual([]);
    const mine = await asStaff((tx) =>
      tx.select().from(schema.jobPayApplicationCosts).where(eq(schema.jobPayApplicationCosts.id, lineId)),
    );
    expect(mine).toHaveLength(1);

    // Tenant B's application, tenant A's row: unrepresentable.
    const otherApp = await withSystem(async (tx) => {
      const rows = await tx
        .insert(schema.jobPayApplications)
        .values({ tenantId: tenantB, contractId: contractB, number: 7, periodTo: "2026-09-30" })
        .returning();
      return rows[0].id;
    });
    await expect(
      withSystem((tx) =>
        tx
          .insert(schema.jobPayApplicationCosts)
          .values({ tenantId: tenantA, payApplicationId: otherApp, costCodeId: codeA }),
      ),
    ).rejects.toThrow();
    // One line per code per application.
    await expect(
      withSystem((tx) =>
        tx
          .insert(schema.jobPayApplicationCosts)
          .values({ tenantId: tenantA, payApplicationId: payAppA, costCodeId: codeA }),
      ),
    ).rejects.toThrow();
    // A code that has been billed against cannot be deleted; the line goes with its application.
    await expect(
      withSystem((tx) => tx.delete(schema.jobCostCodes).where(eq(schema.jobCostCodes.id, codeA))),
    ).rejects.toThrow();
    await withSystem((tx) =>
      tx.delete(schema.jobPayApplications).where(eq(schema.jobPayApplications.id, otherApp)),
    );
  });

  it("a contract's cost-plus terms are nullable, floored at nothing, and a fee rate never passes 100%", async () => {
    await expect(
      withSystem((tx) =>
        tx.update(schema.jobContracts).set({ feePpm: 1_000_001 }).where(eq(schema.jobContracts.id, contractA)),
      ),
    ).rejects.toThrow();
    await expect(
      withSystem((tx) =>
        tx.update(schema.jobContracts).set({ gmaxCents: -1 }).where(eq(schema.jobContracts.id, contractA)),
      ),
    ).rejects.toThrow();
    await withSystem((tx) =>
      tx.update(schema.jobContracts).set({ feePpm: 150_000, feeCents: null, gmaxCents: null }).where(eq(schema.jobContracts.id, contractA)),
    );
    const [c] = await asOwner((tx) =>
      tx.select().from(schema.jobContracts).where(eq(schema.jobContracts.id, contractA)),
    );
    expect(c.feePpm).toBe(150_000);
    // A WIP line's method is one of two words.
    await expect(
      withSystem((tx) =>
        tx.update(schema.jobWipLines).set({ method: "guesswork" }).where(eq(schema.jobWipLines.periodId, periodA)),
      ),
    ).rejects.toThrow();
  });


  // ------------------------------------------------ time and materials (5d)

  it("cannot read or change another tenant's LABOUR LINES; a line hangs off this tenant's application and names this tenant's worker, one per person per rate", async () => {
    const workerA = await withSystem(async (tx) => {
      const rows = await tx
        .insert(schema.timeWorkers)
        .values({ tenantId: tenantA, partyId: clientA })
        .returning({ id: schema.timeWorkers.id });
      return rows[0].id;
    });
    const lineId = await withSystem(async (tx) => {
      const rows = await tx
        .insert(schema.jobPayApplicationLabor)
        .values({
          tenantId: tenantA,
          payApplicationId: payAppA,
          workerId: workerA,
          rateCents: 65_00,
          minutesToDate: 600,
          thisPeriodMinutes: 600,
          thisPeriodCents: 650_00,
        })
        .returning();
      return rows[0].id;
    });
    const seen = await asOtherTenant(async (tx) => ({
      lines: await tx.select().from(schema.jobPayApplicationLabor).where(eq(schema.jobPayApplicationLabor.id, lineId)),
      changed: await tx
        .update(schema.jobPayApplicationLabor)
        .set({ thisPeriodMinutes: 1 })
        .where(eq(schema.jobPayApplicationLabor.id, lineId))
        .returning(),
    }));
    expect(seen.lines).toEqual([]);
    expect(seen.changed).toEqual([]);
    const mine = await asStaff((tx) =>
      tx.select().from(schema.jobPayApplicationLabor).where(eq(schema.jobPayApplicationLabor.id, lineId)),
    );
    expect(mine).toHaveLength(1);

    // One line per person per rate; a second rate is a second line.
    await expect(
      withSystem((tx) =>
        tx
          .insert(schema.jobPayApplicationLabor)
          .values({ tenantId: tenantA, payApplicationId: payAppA, workerId: workerA, rateCents: 65_00 }),
      ),
    ).rejects.toThrow();
    await withSystem((tx) =>
      tx
        .insert(schema.jobPayApplicationLabor)
        .values({ tenantId: tenantA, payApplicationId: payAppA, workerId: workerA, rateCents: 70_00 }),
    );
    // Tenant B's worker under tenant A's line: unrepresentable.
    const workerB = await withSystem(async (tx) => {
      const party = (
        await tx.select({ id: schema.parties.id }).from(schema.parties).where(eq(schema.parties.tenantId, tenantB)).limit(1)
      )[0];
      if (!party) return null;
      const rows = await tx
        .insert(schema.timeWorkers)
        .values({ tenantId: tenantB, partyId: party.id })
        .returning({ id: schema.timeWorkers.id });
      return rows[0].id;
    });
    if (workerB) {
      await expect(
        withSystem((tx) =>
          tx
            .insert(schema.jobPayApplicationLabor)
            .values({ tenantId: tenantA, payApplicationId: payAppA, workerId: workerB, rateCents: 1 }),
        ),
      ).rejects.toThrow();
    }
    // A person with billed hours is deactivated in Time, never deleted.
    await expect(
      withSystem((tx) => tx.delete(schema.timeWorkers).where(eq(schema.timeWorkers.id, workerA))),
    ).rejects.toThrow();
    // A negative rate is a typo, not a credit; so is a negative flat rate on the contract.
    await expect(
      withSystem((tx) =>
        tx.update(schema.jobPayApplicationLabor).set({ rateCents: -1 }).where(eq(schema.jobPayApplicationLabor.id, lineId)),
      ),
    ).rejects.toThrow();
    await expect(
      withSystem((tx) =>
        tx.update(schema.jobContracts).set({ laborRateCents: -1 }).where(eq(schema.jobContracts.id, contractA)),
      ),
    ).rejects.toThrow();
  });

  // ---------------------------------------------------------- unit price (5f)

  it("a unit-priced schedule line carries both a quantity and a price, or neither, and neither below nothing", async () => {
    await expect(
      withSystem((tx) =>
        tx.insert(schema.jobSovLines).values({ tenantId: tenantA, contractId: contractA, description: "Half", scheduledCents: 0, quantityThousandths: 5_000 }),
      ),
    ).rejects.toThrow();
    await expect(
      withSystem((tx) =>
        tx.insert(schema.jobSovLines).values({ tenantId: tenantA, contractId: contractA, description: "Negative", scheduledCents: 0, quantityThousandths: -1, unitPriceCents: 100 }),
      ),
    ).rejects.toThrow();
    const [line] = await withSystem((tx) =>
      tx
        .insert(schema.jobSovLines)
        .values({ tenantId: tenantA, contractId: contractA, description: "Excavation", scheduledCents: 18_000_00, unit: "cy", quantityThousandths: 1_000_000, unitPriceCents: 18_00 })
        .returning(),
    );
    expect(line.unit).toBe("cy");
    // A period's quantity may correct, but never past nothing to date.
    await expect(
      withSystem((tx) =>
        tx.insert(schema.jobPayApplicationLines).values({ tenantId: tenantA, payApplicationId: payAppA, sovLineId: line.id, quantityPreviousThousandths: 1_000, quantityThisPeriodThousandths: -2_000 }),
      ),
    ).rejects.toThrow();
    await withSystem((tx) => tx.delete(schema.jobSovLines).where(eq(schema.jobSovLines.id, line.id)));
  });

  // ------------------------------------------ subcontractor applications (5c)

  it("cannot read or change another tenant's SUBCONTRACTOR APPLICATIONS or their lines; they hang off this tenant's commitment and its lines only", async () => {
    const [lineA] = await withSystem((tx) =>
      tx.select().from(schema.jobCommitmentLines).where(eq(schema.jobCommitmentLines.commitmentId, commitmentA)),
    );
    const appId = await withSystem(async (tx) => {
      const rows = await tx
        .insert(schema.jobSubApplications)
        .values({ tenantId: tenantA, commitmentId: commitmentA, number: 1, periodTo: "2026-09-30", retainagePpm: 100_000 })
        .returning();
      await tx.insert(schema.jobSubApplicationLines).values({
        tenantId: tenantA,
        subApplicationId: rows[0].id,
        commitmentLineId: lineA.id,
        scheduledCents: 4_200_00,
        thisPeriodCents: 1_000_00,
      });
      return rows[0].id;
    });
    const seen = await asOtherTenant(async (tx) => ({
      apps: await tx.select().from(schema.jobSubApplications).where(eq(schema.jobSubApplications.id, appId)),
      lines: await tx.select().from(schema.jobSubApplicationLines).where(eq(schema.jobSubApplicationLines.subApplicationId, appId)),
      changed: await tx
        .update(schema.jobSubApplications)
        .set({ retainagePpm: 0 })
        .where(eq(schema.jobSubApplications.id, appId))
        .returning(),
    }));
    expect(seen.apps).toEqual([]);
    expect(seen.lines).toEqual([]);
    expect(seen.changed).toEqual([]);
    const mine = await asStaff((tx) =>
      tx.select().from(schema.jobSubApplications).where(eq(schema.jobSubApplications.id, appId)),
    );
    expect(mine).toHaveLength(1);

    // Tenant B's commitment under tenant A's row: unrepresentable.
    const otherCommitment = await withSystem(async (tx) => {
      const rows = await tx
        .insert(schema.jobCommitments)
        .values({ tenantId: tenantB, projectId: projectB, partyId: (await tx.select({ id: schema.parties.id }).from(schema.parties).where(eq(schema.parties.tenantId, tenantB)).limit(1))[0]?.id ?? clientA, number: "SC-B-1" })
        .returning();
      return rows[0].id;
    }).catch(() => null);
    if (otherCommitment) {
      await expect(
        withSystem((tx) =>
          tx.insert(schema.jobSubApplications).values({ tenantId: tenantA, commitmentId: otherCommitment, number: 9, periodTo: "2026-09-30" }),
        ),
      ).rejects.toThrow();
    }
    // Numbered once per subcontract; billed means a bill, both ways; a billed line holds its subcontract line.
    await expect(
      withSystem((tx) =>
        tx.insert(schema.jobSubApplications).values({ tenantId: tenantA, commitmentId: commitmentA, number: 1, periodTo: "2026-10-31" }),
      ),
    ).rejects.toThrow();
    await expect(
      withSystem((tx) => tx.update(schema.jobSubApplications).set({ status: "billed" }).where(eq(schema.jobSubApplications.id, appId))),
    ).rejects.toThrow();
    await expect(
      withSystem((tx) => tx.delete(schema.jobCommitmentLines).where(eq(schema.jobCommitmentLines.id, lineA.id))),
    ).rejects.toThrow();
    // The lines go with the application.
    await withSystem((tx) => tx.delete(schema.jobSubApplications).where(eq(schema.jobSubApplications.id, appId)));
    const left = await withSystem((tx) =>
      tx.select().from(schema.jobSubApplicationLines).where(eq(schema.jobSubApplicationLines.subApplicationId, appId)),
    );
    expect(left).toEqual([]);
  });

  it("cannot read or change another tenant's SUBCONTRACT CHANGE ORDERS; a change hangs off this tenant's commitment and passes down this tenant's change order; approved needs a date; only a change's line may be negative; a deduction's application line runs backwards; the lines go with the change", async () => {
    const changeId = await withSystem(async (tx) => {
      const rows = await tx
        .insert(schema.jobCommitmentChangeOrders)
        .values({
          tenantId: tenantA,
          commitmentId: commitmentA,
          changeOrderId: changeOrderA,
          number: "SCO-ISO-1",
          title: "Garage trim dropped",
          status: "approved",
          approvedOn: "2026-09-14",
        })
        .returning();
      // A DEDUCTIVE line: the one commitment line that may go below nothing.
      await tx.insert(schema.jobCommitmentLines).values({
        tenantId: tenantA,
        commitmentId: commitmentA,
        changeOrderId: rows[0].id,
        costCodeId: codeA,
        amountCents: -300_00,
      });
      return rows[0].id;
    });
    const seen = await asOtherTenant(async (tx) => ({
      heads: await tx.select().from(schema.jobCommitmentChangeOrders).where(eq(schema.jobCommitmentChangeOrders.id, changeId)),
      lines: await tx.select().from(schema.jobCommitmentLines).where(eq(schema.jobCommitmentLines.changeOrderId, changeId)),
      changed: await tx
        .update(schema.jobCommitmentChangeOrders)
        .set({ title: "Theirs now" })
        .where(eq(schema.jobCommitmentChangeOrders.id, changeId))
        .returning(),
    }));
    expect(seen.heads).toEqual([]);
    expect(seen.lines).toEqual([]);
    expect(seen.changed).toEqual([]);
    const mine = await asStaff((tx) =>
      tx.select().from(schema.jobCommitmentChangeOrders).where(eq(schema.jobCommitmentChangeOrders.id, changeId)),
    );
    expect(mine).toHaveLength(1);

    // Tenant B's commitment under tenant A's change, or tenant B's change order passed down: unrepresentable.
    const other = await withSystem(async (tx) => {
      const party = await seedParty(tx, tenantB, "Builder B's framer");
      const [commitment] = await tx
        .insert(schema.jobCommitments)
        .values({ tenantId: tenantB, projectId: projectB, partyId: party, number: "SC-B-ISO" })
        .returning();
      const [changeOrder] = await tx
        .insert(schema.jobChangeOrders)
        .values({ tenantId: tenantB, contractId: contractB, number: "CO-B-ISO", title: "Theirs" })
        .returning();
      return { commitmentId: commitment.id, changeOrderId: changeOrder.id };
    });
    await expect(
      withSystem((tx) =>
        tx.insert(schema.jobCommitmentChangeOrders).values({
          tenantId: tenantA,
          commitmentId: other.commitmentId,
          number: "x-commitment",
          title: "x",
        }),
      ),
    ).rejects.toThrow();
    await expect(
      withSystem((tx) =>
        tx.insert(schema.jobCommitmentChangeOrders).values({
          tenantId: tenantA,
          commitmentId: commitmentA,
          changeOrderId: other.changeOrderId,
          number: "x-passes",
          title: "x",
        }),
      ),
    ).rejects.toThrow();
    // A line's change is this tenant's, or nothing.
    await expect(
      withSystem((tx) =>
        tx.insert(schema.jobCommitmentLines).values({
          tenantId: tenantB,
          commitmentId: other.commitmentId,
          changeOrderId: changeId,
          amountCents: 1,
        }),
      ),
    ).rejects.toThrow();

    // Approved needs a date and unapproved has none, both ways; numbered per commitment.
    await expect(
      withSystem((tx) =>
        tx.update(schema.jobCommitmentChangeOrders).set({ status: "proposed" }).where(eq(schema.jobCommitmentChangeOrders.id, changeId)),
      ),
    ).rejects.toThrow();
    await expect(
      withSystem((tx) =>
        tx.insert(schema.jobCommitmentChangeOrders).values({ tenantId: tenantA, commitmentId: commitmentA, number: "SCO-ISO-2", title: "x", status: "approved" }),
      ),
    ).rejects.toThrow();
    await expect(
      withSystem((tx) =>
        tx.insert(schema.jobCommitmentChangeOrders).values({ tenantId: tenantA, commitmentId: commitmentA, number: "SCO-ISO-1", title: "again" }),
      ),
    ).rejects.toThrow();
    // Only a change's line may be negative.
    await expect(
      withSystem((tx) => tx.insert(schema.jobCommitmentLines).values({ tenantId: tenantA, commitmentId: commitmentA, amountCents: -1 })),
    ).rejects.toThrow();

    // A deduction's application line: completed to less than nothing and never more; a positive line's, the reverse.
    const [deduction] = await withSystem((tx) =>
      tx.select().from(schema.jobCommitmentLines).where(eq(schema.jobCommitmentLines.changeOrderId, changeId)),
    );
    const [positive] = await withSystem((tx) =>
      tx
        .select()
        .from(schema.jobCommitmentLines)
        .where(and(eq(schema.jobCommitmentLines.commitmentId, commitmentA), isNull(schema.jobCommitmentLines.changeOrderId))),
    );
    const appId = await withSystem(async (tx) => {
      const rows = await tx
        .insert(schema.jobSubApplications)
        .values({ tenantId: tenantA, commitmentId: commitmentA, number: 7, periodTo: "2026-11-30" })
        .returning();
      await tx.insert(schema.jobSubApplicationLines).values({
        tenantId: tenantA,
        subApplicationId: rows[0].id,
        commitmentLineId: deduction.id,
        scheduledCents: -300_00,
        thisPeriodCents: -300_00,
      });
      return rows[0].id;
    });
    await expect(
      withSystem((tx) =>
        tx
          .update(schema.jobSubApplicationLines)
          .set({ thisPeriodCents: 1_00 })
          .where(eq(schema.jobSubApplicationLines.subApplicationId, appId)),
      ),
    ).rejects.toThrow();
    await expect(
      withSystem((tx) =>
        tx.insert(schema.jobSubApplicationLines).values({
          tenantId: tenantA,
          subApplicationId: appId,
          commitmentLineId: positive.id,
          scheduledCents: 4_200_00,
          previousCents: -1_00,
        }),
      ),
    ).rejects.toThrow();
    // Billed against: the deduction's line is held, and so is the change's client change order.
    await expect(
      withSystem((tx) => tx.delete(schema.jobCommitmentLines).where(eq(schema.jobCommitmentLines.id, deduction.id))),
    ).rejects.toThrow();
    await expect(
      withSystem((tx) => tx.delete(schema.jobChangeOrders).where(eq(schema.jobChangeOrders.id, changeOrderA))),
    ).rejects.toThrow();
    // Let the application go, then the change: its lines go with it.
    await withSystem((tx) => tx.delete(schema.jobSubApplications).where(eq(schema.jobSubApplications.id, appId)));
    await withSystem((tx) => tx.delete(schema.jobCommitmentChangeOrders).where(eq(schema.jobCommitmentChangeOrders.id, changeId)));
    const left = await withSystem((tx) =>
      tx.select().from(schema.jobCommitmentLines).where(eq(schema.jobCommitmentLines.changeOrderId, changeId)),
    );
    expect(left).toEqual([]);
  });

  it("cannot read or change another tenant's LIEN WAIVERS; a waiver hangs off this tenant's job, party, order and application; received has its date; the party is held; the job takes its waivers with it", async () => {
    const appId = await withSystem(async (tx) => {
      const rows = await tx
        .insert(schema.jobSubApplications)
        .values({ tenantId: tenantA, commitmentId: commitmentA, number: 8, periodTo: "2026-12-31" })
        .returning();
      return rows[0].id;
    });
    const waiverId = await withSystem(async (tx) => {
      const rows = await tx
        .insert(schema.jobLienWaivers)
        .values({
          tenantId: tenantA,
          projectId: projectA,
          partyId: clientA,
          commitmentId: commitmentA,
          subApplicationId: appId,
          kind: "unconditional_progress",
          throughDate: "2026-12-31",
          amountCents: 4_000_00,
          status: "received",
          receivedOn: "2027-01-05",
        })
        .returning();
      return rows[0].id;
    });
    const seen = await asOtherTenant(async (tx) => ({
      rows: await tx.select().from(schema.jobLienWaivers).where(eq(schema.jobLienWaivers.id, waiverId)),
      changed: await tx
        .update(schema.jobLienWaivers)
        .set({ status: "void" })
        .where(eq(schema.jobLienWaivers.id, waiverId))
        .returning(),
    }));
    expect(seen.rows).toEqual([]);
    expect(seen.changed).toEqual([]);
    const mine = await asStaff((tx) => tx.select().from(schema.jobLienWaivers).where(eq(schema.jobLienWaivers.id, waiverId)));
    expect(mine).toHaveLength(1);

    // Tenant B's job, party, order or application under tenant A's row: unrepresentable.
    const otherParty = await withSystem((tx) => seedParty(tx, tenantB, "Builder B's supplier"));
    const base = { tenantId: tenantA, kind: "conditional_progress", throughDate: "2026-12-31" } as const;
    await expect(
      withSystem((tx) => tx.insert(schema.jobLienWaivers).values({ ...base, projectId: projectB, partyId: clientA })),
    ).rejects.toThrow();
    await expect(
      withSystem((tx) => tx.insert(schema.jobLienWaivers).values({ ...base, projectId: projectA, partyId: otherParty })),
    ).rejects.toThrow();
    const otherCommitment = await withSystem(async (tx) => {
      const rows = await tx
        .insert(schema.jobCommitments)
        .values({ tenantId: tenantB, projectId: projectB, partyId: otherParty, number: "SC-B-LW" })
        .returning();
      return rows[0].id;
    });
    await expect(
      withSystem((tx) =>
        tx.insert(schema.jobLienWaivers).values({ ...base, projectId: projectA, partyId: clientA, commitmentId: otherCommitment }),
      ),
    ).rejects.toThrow();
    // Received has its date and requested has none; the amount has a floor.
    await expect(
      withSystem((tx) =>
        tx.insert(schema.jobLienWaivers).values({ ...base, projectId: projectA, partyId: clientA, status: "received" }),
      ),
    ).rejects.toThrow();
    await expect(
      withSystem((tx) =>
        tx.insert(schema.jobLienWaivers).values({ ...base, projectId: projectA, partyId: clientA, status: "requested", receivedOn: "2026-12-31" }),
      ),
    ).rejects.toThrow();
    await expect(
      withSystem((tx) =>
        tx.insert(schema.jobLienWaivers).values({ ...base, projectId: projectA, partyId: clientA, amountCents: -1 }),
      ),
    ).rejects.toThrow();
    // The party that signed is held; the application named is held; the job takes its waivers with it.
    await expect(withSystem((tx) => tx.delete(schema.parties).where(eq(schema.parties.id, clientA)))).rejects.toThrow();
    await expect(
      withSystem((tx) => tx.delete(schema.jobSubApplications).where(eq(schema.jobSubApplications.id, appId))),
    ).rejects.toThrow();
    const scratch = await withSystem(async (tx) => {
      const p = await tx
        .insert(schema.jobProjects)
        .values({ tenantId: tenantA, entityId: entityA, number: "casc-lw", name: "lw" })
        .returning();
      const w = await tx
        .insert(schema.jobLienWaivers)
        .values({ ...base, projectId: p[0].id, partyId: clientA })
        .returning();
      return { projectId: p[0].id, waiverId: w[0].id };
    });
    await withSystem((tx) => tx.delete(schema.jobProjects).where(eq(schema.jobProjects.id, scratch.projectId)));
    const left = await withSystem((tx) =>
      tx.select().from(schema.jobLienWaivers).where(eq(schema.jobLienWaivers.id, scratch.waiverId)),
    );
    expect(left).toEqual([]);
    // Tidy: the waiver, then the application it named.
    await withSystem((tx) => tx.delete(schema.jobLienWaivers).where(eq(schema.jobLienWaivers.id, waiverId)));
    await withSystem((tx) => tx.delete(schema.jobSubApplications).where(eq(schema.jobSubApplications.id, appId)));
  });

  it("cannot read or change another tenant's SELECTIONS or their choices; a selection hangs off this tenant's job, contract, code and change order, a choice off this tenant's selection and party; one choice is chosen; a choice is priced by the unit or not at all; the choices go with the selection and the selections with the job", async () => {
    const selectionId = await withSystem(async (tx) => {
      const rows = await tx
        .insert(schema.jobSelections)
        .values({
          tenantId: tenantA,
          projectId: projectA,
          contractId: contractA,
          costCodeId: codeA,
          changeOrderId: changeOrderA,
          name: "Master bath tile",
          allowanceCents: 4_000_00,
          neededBy: "2026-09-01",
        })
        .returning();
      await tx.insert(schema.jobSelectionChoices).values([
        { tenantId: tenantA, selectionId: rows[0].id, partyId: clientA, description: "Daltile", priceCents: 1_344_00, isSelected: true, sortOrder: 10 },
        { tenantId: tenantA, selectionId: rows[0].id, description: "Marble", priceCents: 6_500_00, sortOrder: 20 },
      ]);
      return rows[0].id;
    });
    const seen = await asOtherTenant(async (tx) => ({
      rows: await tx.select().from(schema.jobSelections).where(eq(schema.jobSelections.id, selectionId)),
      choices: await tx.select().from(schema.jobSelectionChoices).where(eq(schema.jobSelectionChoices.selectionId, selectionId)),
      changed: await tx
        .update(schema.jobSelections)
        .set({ allowanceCents: 1 })
        .where(eq(schema.jobSelections.id, selectionId))
        .returning(),
    }));
    expect(seen.rows).toEqual([]);
    expect(seen.choices).toEqual([]);
    expect(seen.changed).toEqual([]);
    const mine = await asStaff((tx) => tx.select().from(schema.jobSelectionChoices).where(eq(schema.jobSelectionChoices.selectionId, selectionId)));
    expect(mine).toHaveLength(2);

    // Tenant B's job, contract, code or change order under tenant A's row: unrepresentable.
    const otherCode = await withSystem(async (tx) => {
      const r = await tx.select().from(schema.jobCostCodes).where(eq(schema.jobCostCodes.setId, setB));
      return r[0].id;
    });
    const otherChange = await withSystem(async (tx) => {
      const r = await tx
        .insert(schema.jobChangeOrders)
        .values({ tenantId: tenantB, contractId: contractB, number: "CO-B-SEL", title: "Theirs" })
        .returning();
      return r[0].id;
    });
    const base = { tenantId: tenantA, name: "x" } as const;
    await expect(withSystem((tx) => tx.insert(schema.jobSelections).values({ ...base, projectId: projectB }))).rejects.toThrow();
    await expect(withSystem((tx) => tx.insert(schema.jobSelections).values({ ...base, projectId: projectA, contractId: contractB }))).rejects.toThrow();
    await expect(withSystem((tx) => tx.insert(schema.jobSelections).values({ ...base, projectId: projectA, costCodeId: otherCode }))).rejects.toThrow();
    await expect(withSystem((tx) => tx.insert(schema.jobSelections).values({ ...base, projectId: projectA, changeOrderId: otherChange }))).rejects.toThrow();
    // A choice under tenant B's selection, or naming tenant B's party: unrepresentable.
    const otherParty = await withSystem((tx) => seedParty(tx, tenantB, "Builder B's showroom"));
    const otherSelection = await withSystem(async (tx) => {
      const r = await tx.insert(schema.jobSelections).values({ tenantId: tenantB, projectId: projectB, name: "Theirs" }).returning();
      return r[0].id;
    });
    await expect(
      withSystem((tx) => tx.insert(schema.jobSelectionChoices).values({ tenantId: tenantA, selectionId: otherSelection, description: "x", priceCents: 1 })),
    ).rejects.toThrow();
    await expect(
      withSystem((tx) => tx.insert(schema.jobSelectionChoices).values({ tenantId: tenantA, selectionId, partyId: otherParty, description: "x", priceCents: 1 })),
    ).rejects.toThrow();
    // One chosen per selection; a quantity needs a unit price; the floors.
    await expect(
      withSystem((tx) => tx.insert(schema.jobSelectionChoices).values({ tenantId: tenantA, selectionId, description: "Second pick", priceCents: 1, isSelected: true })),
    ).rejects.toThrow();
    await expect(
      withSystem((tx) => tx.insert(schema.jobSelectionChoices).values({ tenantId: tenantA, selectionId, description: "Half priced", quantityThousandths: 1_000, priceCents: 1 })),
    ).rejects.toThrow();
    await expect(
      withSystem((tx) => tx.insert(schema.jobSelectionChoices).values({ tenantId: tenantA, selectionId, description: "Negative", priceCents: -1 })),
    ).rejects.toThrow();
    await expect(
      withSystem((tx) => tx.update(schema.jobSelections).set({ allowanceCents: -1 }).where(eq(schema.jobSelections.id, selectionId))),
    ).rejects.toThrow();
    // The change order raised, the contract, the code and the party are held; the choices go with the selection; the selections with the job.
    await expect(withSystem((tx) => tx.delete(schema.jobChangeOrders).where(eq(schema.jobChangeOrders.id, changeOrderA)))).rejects.toThrow();
    await expect(withSystem((tx) => tx.delete(schema.jobCostCodes).where(eq(schema.jobCostCodes.id, codeA)))).rejects.toThrow();
    await withSystem((tx) => tx.delete(schema.jobSelections).where(eq(schema.jobSelections.id, selectionId)));
    const left = await withSystem((tx) => tx.select().from(schema.jobSelectionChoices).where(eq(schema.jobSelectionChoices.selectionId, selectionId)));
    expect(left).toEqual([]);
    const scratch = await withSystem(async (tx) => {
      const p = await tx.insert(schema.jobProjects).values({ tenantId: tenantA, entityId: entityA, number: "casc-sel", name: "sel" }).returning();
      const s = await tx.insert(schema.jobSelections).values({ tenantId: tenantA, projectId: p[0].id, name: "Goes with the job" }).returning();
      return { projectId: p[0].id, selectionId: s[0].id };
    });
    await withSystem((tx) => tx.delete(schema.jobProjects).where(eq(schema.jobProjects.id, scratch.projectId)));
    expect(await withSystem((tx) => tx.select().from(schema.jobSelections).where(eq(schema.jobSelections.id, scratch.selectionId)))).toEqual([]);
    await withSystem((tx) => tx.delete(schema.jobSelections).where(eq(schema.jobSelections.id, otherSelection)));
  });

  it("cannot read or change another tenant's ESTIMATES or their lines; an estimate hangs off this tenant's job and contract, a line off this tenant's estimate and code; a number is unique per job; every rate is capped and every amount floored; the lines go with the estimate and the estimates with the job", async () => {
    const estimateId = await withSystem(async (tx) => {
      const rows = await tx
        .insert(schema.jobEstimates)
        .values({ tenantId: tenantA, projectId: projectA, contractId: contractA, number: "EST-ISO-1", title: "As drawn", markupPpm: 150_000, overheadPpm: 100_000, profitPpm: 100_000 })
        .returning();
      await tx.insert(schema.jobEstimateLines).values([
        { tenantId: tenantA, estimateId: rows[0].id, costCodeId: codeA, description: "Slab", unit: "cy", quantityThousandths: 120_000, unitCostCents: 185_00, sortOrder: 10 },
        { tenantId: tenantA, estimateId: rows[0].id, description: "Permit", unitCostCents: 1_500_00, markupPpm: 0, sortOrder: 20 },
      ]);
      return rows[0].id;
    });
    const seen = await asOtherTenant(async (tx) => ({
      rows: await tx.select().from(schema.jobEstimates).where(eq(schema.jobEstimates.id, estimateId)),
      lines: await tx.select().from(schema.jobEstimateLines).where(eq(schema.jobEstimateLines.estimateId, estimateId)),
      changed: await tx.update(schema.jobEstimates).set({ markupPpm: 1 }).where(eq(schema.jobEstimates.id, estimateId)).returning(),
    }));
    expect(seen.rows).toEqual([]);
    expect(seen.lines).toEqual([]);
    expect(seen.changed).toEqual([]);
    const mine = await asStaff((tx) => tx.select().from(schema.jobEstimateLines).where(eq(schema.jobEstimateLines.estimateId, estimateId)));
    expect(mine).toHaveLength(2);

    // Tenant B's job or contract under tenant A's estimate: unrepresentable. So is a second EST-ISO-1 on the job.
    const base = { tenantId: tenantA, number: "EST-ISO-2" } as const;
    await expect(withSystem((tx) => tx.insert(schema.jobEstimates).values({ ...base, projectId: projectB }))).rejects.toThrow();
    await expect(withSystem((tx) => tx.insert(schema.jobEstimates).values({ ...base, projectId: projectA, contractId: contractB }))).rejects.toThrow();
    await expect(withSystem((tx) => tx.insert(schema.jobEstimates).values({ ...base, projectId: projectA, number: "EST-ISO-1" }))).rejects.toThrow();
    // A line under tenant B's estimate, or on tenant B's code: unrepresentable.
    const otherCode = await withSystem(async (tx) => {
      const r = await tx.select().from(schema.jobCostCodes).where(eq(schema.jobCostCodes.setId, setB));
      return r[0].id;
    });
    const otherEstimate = await withSystem(async (tx) => {
      const r = await tx.insert(schema.jobEstimates).values({ tenantId: tenantB, projectId: projectB, number: "EST-B-1" }).returning();
      return r[0].id;
    });
    await expect(
      withSystem((tx) => tx.insert(schema.jobEstimateLines).values({ tenantId: tenantA, estimateId: otherEstimate, description: "x" })),
    ).rejects.toThrow();
    await expect(
      withSystem((tx) => tx.insert(schema.jobEstimateLines).values({ tenantId: tenantA, estimateId, costCodeId: otherCode, description: "x" })),
    ).rejects.toThrow();
    // The CHECKs: a status off the list, a rate past 1,000%, a negative cost, quantity or price, a blank description.
    await expect(withSystem((tx) => tx.update(schema.jobEstimates).set({ status: "won" }).where(eq(schema.jobEstimates.id, estimateId)))).rejects.toThrow();
    await expect(withSystem((tx) => tx.update(schema.jobEstimates).set({ presentation: "poster" }).where(eq(schema.jobEstimates.id, estimateId)))).rejects.toThrow();
    await expect(withSystem((tx) => tx.update(schema.jobEstimates).set({ overheadPpm: 10_000_001 }).where(eq(schema.jobEstimates.id, estimateId)))).rejects.toThrow();
    await expect(withSystem((tx) => tx.update(schema.jobEstimates).set({ profitPpm: -1 }).where(eq(schema.jobEstimates.id, estimateId)))).rejects.toThrow();
    for (const bad of [
      { description: "x", unitCostCents: -1 },
      { description: "x", quantityThousandths: -1 },
      { description: "x", unitPriceCents: -1 },
      { description: "x", markupPpm: 10_000_001 },
      { description: "   " },
    ]) {
      await expect(withSystem((tx) => tx.insert(schema.jobEstimateLines).values({ tenantId: tenantA, estimateId, ...bad }))).rejects.toThrow();
    }
    // The contract it became and the code are held; the lines go with the estimate; the estimates with the job.
    await expect(withSystem((tx) => tx.delete(schema.jobContracts).where(eq(schema.jobContracts.id, contractA)))).rejects.toThrow();
    await expect(withSystem((tx) => tx.delete(schema.jobCostCodes).where(eq(schema.jobCostCodes.id, codeA)))).rejects.toThrow();
    await withSystem((tx) => tx.delete(schema.jobEstimates).where(eq(schema.jobEstimates.id, estimateId)));
    expect(await withSystem((tx) => tx.select().from(schema.jobEstimateLines).where(eq(schema.jobEstimateLines.estimateId, estimateId)))).toEqual([]);
    const scratch = await withSystem(async (tx) => {
      const p = await tx.insert(schema.jobProjects).values({ tenantId: tenantA, entityId: entityA, number: "casc-est", name: "est" }).returning();
      const e = await tx.insert(schema.jobEstimates).values({ tenantId: tenantA, projectId: p[0].id, number: "Goes with the job" }).returning();
      return { projectId: p[0].id, estimateId: e[0].id };
    });
    await withSystem((tx) => tx.delete(schema.jobProjects).where(eq(schema.jobProjects.id, scratch.projectId)));
    expect(await withSystem((tx) => tx.select().from(schema.jobEstimates).where(eq(schema.jobEstimates.id, scratch.estimateId)))).toEqual([]);
    await withSystem((tx) => tx.delete(schema.jobEstimates).where(eq(schema.jobEstimates.id, otherEstimate)));
  });

  it("cannot read or change another tenant's ESTIMATE ITEMS; an item hangs off this tenant's estimate and a line off this tenant's item; the mode and the price say the same thing; an item deleted leaves its lines LOOSE and an estimate deleted takes its items", async () => {
    const seeded = await withSystem(async (tx) => {
      const e = await tx
        .insert(schema.jobEstimates)
        .values({ tenantId: tenantA, projectId: projectA, number: "EST-ITEM-1", markupPpm: 0 })
        .returning();
      const g = await tx
        .insert(schema.jobEstimateGroups)
        .values({ tenantId: tenantA, estimateId: e[0].id, name: "Tile flooring", priceMode: "fixed", fixedPriceCents: 8_400_00, sortOrder: 10 })
        .returning();
      const l = await tx
        .insert(schema.jobEstimateLines)
        .values({ tenantId: tenantA, estimateId: e[0].id, groupId: g[0].id, description: "Tile, material", unitCostCents: 6_950_00, sortOrder: 10 })
        .returning();
      return { estimateId: e[0].id, groupId: g[0].id, lineId: l[0].id };
    });

    // Tenant B sees nothing of it and changes nothing of it.
    const seen = await asOtherTenant(async (tx) => ({
      rows: await tx.select().from(schema.jobEstimateGroups).where(eq(schema.jobEstimateGroups.id, seeded.groupId)),
      changed: await tx
        .update(schema.jobEstimateGroups)
        .set({ name: "theirs" })
        .where(eq(schema.jobEstimateGroups.id, seeded.groupId))
        .returning(),
    }));
    expect(seen.rows).toEqual([]);
    expect(seen.changed).toEqual([]);
    const mine = await asStaff((tx) =>
      tx.select().from(schema.jobEstimateGroups).where(eq(schema.jobEstimateGroups.id, seeded.groupId)),
    );
    expect(mine).toHaveLength(1);
    expect(mine[0].fixedPriceCents).toBe(8_400_00);

    // Tenant B's estimate under tenant A's item, or tenant B's item under tenant A's line: unrepresentable.
    const otherEstimate = await withSystem(async (tx) => {
      const r = await tx.insert(schema.jobEstimates).values({ tenantId: tenantB, projectId: projectB, number: "EST-B-ITEM" }).returning();
      return r[0].id;
    });
    const otherGroup = await withSystem(async (tx) => {
      const r = await tx
        .insert(schema.jobEstimateGroups)
        .values({ tenantId: tenantB, estimateId: otherEstimate, name: "Theirs" })
        .returning();
      return r[0].id;
    });
    await expect(
      withSystem((tx) => tx.insert(schema.jobEstimateGroups).values({ tenantId: tenantA, estimateId: otherEstimate, name: "x" })),
    ).rejects.toThrow();
    await expect(
      withSystem((tx) =>
        tx.insert(schema.jobEstimateLines).values({ tenantId: tenantA, estimateId: seeded.estimateId, groupId: otherGroup, description: "x" }),
      ),
    ).rejects.toThrow();

    // The CHECKs on a LINE's client wording (ADR 0080): the client's words are bounded at
    // 300 like the description they stand in for, and a line kept off the proposal must sit
    // in an item — hidden money needs somewhere to hide.
    await expect(
      withSystem((tx) =>
        tx.insert(schema.jobEstimateLines).values({
          tenantId: tenantA,
          estimateId: seeded.estimateId,
          groupId: seeded.groupId,
          description: "Too much to say",
          clientDescription: "x".repeat(301),
        }),
      ),
    ).rejects.toThrow();
    await expect(
      withSystem((tx) =>
        tx.insert(schema.jobEstimateLines).values({
          tenantId: tenantA,
          estimateId: seeded.estimateId,
          description: "Hidden with nowhere to hide",
          clientVisible: false,
        }),
      ),
    ).rejects.toThrow();
    // Inside the item it is allowed, and it is the only way hiding is allowed.
    const hidden = await withSystem((tx) =>
      tx
        .insert(schema.jobEstimateLines)
        .values({
          tenantId: tenantA,
          estimateId: seeded.estimateId,
          groupId: seeded.groupId,
          description: "Contingency",
          clientVisible: false,
        })
        .returning(),
    );
    expect(hidden[0].clientVisible).toBe(false);
    // And taking its item away would leave it hidden and loose, so the CHECK refuses that too.
    await expect(
      withSystem((tx) =>
        tx
          .update(schema.jobEstimateLines)
          .set({ groupId: null })
          .where(eq(schema.jobEstimateLines.id, hidden[0].id)),
      ),
    ).rejects.toThrow();
    await withSystem((tx) => tx.delete(schema.jobEstimateLines).where(eq(schema.jobEstimateLines.id, hidden[0].id)));

    // The CHECKs: a blank name, a mode off the list, fixed with no price, adding up WITH one, a negative price.
    for (const bad of [
      { name: "   " },
      { name: "x", priceMode: "guess" },
      { name: "x", priceMode: "fixed" },
      { name: "x", priceMode: "rollup", fixedPriceCents: 1 },
      { name: "x", priceMode: "fixed", fixedPriceCents: -1 },
    ]) {
      await expect(
        withSystem((tx) => tx.insert(schema.jobEstimateGroups).values({ tenantId: tenantA, estimateId: seeded.estimateId, ...bad })),
        JSON.stringify(bad),
      ).rejects.toThrow();
    }

    // AN ITEM DELETED LEAVES ITS LINES LOOSE: the column-list SET NULL, which a bare
    // SET NULL could never do on a composite key. The pricing survives its item.
    await withSystem((tx) => tx.delete(schema.jobEstimateGroups).where(eq(schema.jobEstimateGroups.id, seeded.groupId)));
    const orphaned = await withSystem((tx) =>
      tx.select().from(schema.jobEstimateLines).where(eq(schema.jobEstimateLines.id, seeded.lineId)),
    );
    expect(orphaned).toHaveLength(1);
    expect(orphaned[0].groupId).toBeNull();
    expect(orphaned[0].unitCostCents).toBe(6_950_00);

    // The items go with the estimate.
    await withSystem((tx) =>
      tx.insert(schema.jobEstimateGroups).values({ tenantId: tenantA, estimateId: seeded.estimateId, name: "Goes with the estimate" }),
    );
    await withSystem((tx) => tx.delete(schema.jobEstimates).where(eq(schema.jobEstimates.id, seeded.estimateId)));
    expect(
      await withSystem((tx) =>
        tx.select().from(schema.jobEstimateGroups).where(eq(schema.jobEstimateGroups.estimateId, seeded.estimateId)),
      ),
    ).toEqual([]);
    await withSystem((tx) => tx.delete(schema.jobEstimates).where(eq(schema.jobEstimates.id, otherEstimate)));
  });

  it("cannot read or change another tenant's ASSEMBLIES; a line hangs off this tenant's assembly; the name is unique per tenant; a driver of nothing is refused; and the lines go with it", async () => {
    const seeded = await withSystem(async (tx) => {
      const a = await tx
        .insert(schema.jobAssemblies)
        .values({
          tenantId: tenantA,
          name: "Tile flooring",
          drivingQuantityThousandths: 320_000,
          drivingUnit: "sf",
        })
        .returning();
      const l = await tx
        .insert(schema.jobAssemblyLines)
        .values({
          tenantId: tenantA,
          assemblyId: a[0].id,
          description: "Tile, material",
          unit: "sf",
          quantityThousandths: 320_000,
          unitCostCents: 420,
          costCode: "09 30 00",
        })
        .returning();
      return { assemblyId: a[0].id, lineId: l[0].id };
    });

    // Tenant B sees nothing of it and changes nothing of it.
    const seen = await asOtherTenant(async (tx) => ({
      rows: await tx.select().from(schema.jobAssemblies).where(eq(schema.jobAssemblies.id, seeded.assemblyId)),
      changed: await tx
        .update(schema.jobAssemblies)
        .set({ name: "theirs" })
        .where(eq(schema.jobAssemblies.id, seeded.assemblyId))
        .returning(),
      lines: await tx
        .select()
        .from(schema.jobAssemblyLines)
        .where(eq(schema.jobAssemblyLines.id, seeded.lineId)),
    }));
    expect(seen.rows).toEqual([]);
    expect(seen.changed).toEqual([]);
    expect(seen.lines).toEqual([]);
    // Saving one is member work, like writing the estimate it came from.
    const mine = await asStaff((tx) =>
      tx.select().from(schema.jobAssemblies).where(eq(schema.jobAssemblies.id, seeded.assemblyId)),
    );
    expect(mine).toHaveLength(1);
    expect(mine[0].drivingQuantityThousandths).toBe(320_000);

    /**
     * **THE NAME IS UNIQUE PER TENANT, NOT GLOBALLY.** A library with two
     * `Tile flooring` is not a library — but every business gets its own, and
     * two businesses naming the same thing the same way is the normal case.
     */
    await expect(
      withSystem((tx) =>
        tx.insert(schema.jobAssemblies).values({ tenantId: tenantA, name: "Tile flooring" }),
      ),
    ).rejects.toThrow();
    const theirs = await withSystem((tx) =>
      tx.insert(schema.jobAssemblies).values({ tenantId: tenantB, name: "Tile flooring" }).returning(),
    );
    expect(theirs).toHaveLength(1);

    // A line on another tenant's assembly is unrepresentable.
    await expect(
      withSystem((tx) =>
        tx.insert(schema.jobAssemblyLines).values({
          tenantId: tenantA,
          assemblyId: theirs[0].id,
          description: "x",
        }),
      ),
    ).rejects.toThrow();

    // A size of nothing cannot be scaled from, so the table refuses it.
    for (const bad of [0, -1]) {
      await expect(
        withSystem((tx) =>
          tx
            .insert(schema.jobAssemblies)
            .values({ tenantId: tenantA, name: `Bad ${bad}`, drivingQuantityThousandths: bad }),
        ),
        String(bad),
      ).rejects.toThrow();
    }
    // And a blank name is not a name.
    await expect(
      withSystem((tx) => tx.insert(schema.jobAssemblies).values({ tenantId: tenantA, name: "   " })),
    ).rejects.toThrow();
    await expect(
      withSystem((tx) =>
        tx.insert(schema.jobAssemblyLines).values({
          tenantId: tenantA,
          assemblyId: seeded.assemblyId,
          description: "  ",
        }),
      ),
    ).rejects.toThrow();

    // The lines go with the assembly.
    await withSystem((tx) =>
      tx.delete(schema.jobAssemblies).where(eq(schema.jobAssemblies.id, seeded.assemblyId)),
    );
    expect(
      await withSystem((tx) =>
        tx.select().from(schema.jobAssemblyLines).where(eq(schema.jobAssemblyLines.id, seeded.lineId)),
      ),
    ).toEqual([]);
    await withSystem((tx) => tx.delete(schema.jobAssemblies).where(eq(schema.jobAssemblies.id, theirs[0].id)));
  });

  it("cannot read another tenant's ASSEMBLY KEYS; a name means one assembly per tenant; a key on another tenant's assembly is unrepresentable; and the keys go with the assembly", async () => {
    const seeded = await withSystem(async (tx) => {
      const a = await tx
        .insert(schema.jobAssemblies)
        .values({ tenantId: tenantA, name: "Drywall, hang and finish" })
        .returning();
      const k = await tx
        .insert(schema.jobAssemblyKeys)
        .values({ tenantId: tenantA, assemblyId: a[0].id, key: "Gypsum Wall Board", keySlug: "gypsum wall board" })
        .returning();
      const b = await tx
        .insert(schema.jobAssemblies)
        .values({ tenantId: tenantB, name: "Drywall, hang and finish" })
        .returning();
      return { assemblyId: a[0].id, keyId: k[0].id, theirsId: b[0].id };
    });

    // Tenant B sees nothing of it and changes nothing of it.
    const seen = await asOtherTenant(async (tx) => ({
      rows: await tx.select().from(schema.jobAssemblyKeys).where(eq(schema.jobAssemblyKeys.id, seeded.keyId)),
      changed: await tx
        .update(schema.jobAssemblyKeys)
        .set({ key: "theirs" })
        .where(eq(schema.jobAssemblyKeys.id, seeded.keyId))
        .returning(),
    }));
    expect(seen.rows).toEqual([]);
    expect(seen.changed).toEqual([]);
    const mine = await asStaff((tx) =>
      tx.select().from(schema.jobAssemblyKeys).where(eq(schema.jobAssemblyKeys.id, seeded.keyId)),
    );
    expect(mine).toHaveLength(1);

    /**
     * **A NAME MEANS ONE ASSEMBLY PER TENANT.** The model calling a thing
     * `Gypsum Wall Board` cannot mean two assemblies to one business — a
     * re-mapping is a correction, written on the slug. And the same name is
     * free for the next business, which will map it to its own.
     */
    await expect(
      withSystem((tx) =>
        tx.insert(schema.jobAssemblyKeys).values({
          tenantId: tenantA,
          assemblyId: seeded.assemblyId,
          key: "GYPSUM wall-board",
          keySlug: "gypsum wall board",
        }),
      ),
    ).rejects.toThrow();
    const theirs = await withSystem((tx) =>
      tx
        .insert(schema.jobAssemblyKeys)
        .values({ tenantId: tenantB, assemblyId: seeded.theirsId, key: "Gypsum Wall Board", keySlug: "gypsum wall board" })
        .returning(),
    );
    expect(theirs).toHaveLength(1);

    // A key on another tenant's assembly is unrepresentable.
    await expect(
      withSystem((tx) =>
        tx.insert(schema.jobAssemblyKeys).values({
          tenantId: tenantA,
          assemblyId: seeded.theirsId,
          key: "x",
          keySlug: "x",
        }),
      ),
    ).rejects.toThrow();
    // And a blank key is not a key.
    await expect(
      withSystem((tx) =>
        tx.insert(schema.jobAssemblyKeys).values({
          tenantId: tenantA,
          assemblyId: seeded.assemblyId,
          key: "  ",
          keySlug: "  ",
        }),
      ),
    ).rejects.toThrow();

    // The keys go with the assembly.
    await withSystem((tx) =>
      tx.delete(schema.jobAssemblies).where(eq(schema.jobAssemblies.id, seeded.assemblyId)),
    );
    expect(
      await withSystem((tx) =>
        tx.select().from(schema.jobAssemblyKeys).where(eq(schema.jobAssemblyKeys.id, seeded.keyId)),
      ),
    ).toEqual([]);
    await withSystem((tx) => tx.delete(schema.jobAssemblies).where(eq(schema.jobAssemblies.id, seeded.theirsId)));
  });

  it("cannot read or change another tenant's ESTIMATE OUTLINES; a step and a question hang off this tenant's rows; the name is unique per tenant; there is one default or none; a choice's options and its kind cannot disagree; and the whole tree goes together", async () => {
    const seeded = await withSystem(async (tx) => {
      const o = await tx
        .insert(schema.jobEstimateOutlines)
        .values({ tenantId: tenantA, name: "New build", isDefault: true })
        .returning();
      const s = await tx
        .insert(schema.jobEstimateOutlineSteps)
        .values({
          tenantId: tenantA,
          outlineId: o[0].id,
          title: "Foundation",
          costCode: "2000",
          sortOrder: 10,
        })
        .returning();
      const q = await tx
        .insert(schema.jobEstimateOutlineQuestions)
        .values({
          tenantId: tenantA,
          stepId: s[0].id,
          prompt: "Block or poured?",
          kind: "choice",
          choices: ["Block", "Poured"],
        })
        .returning();
      return { outlineId: o[0].id, stepId: s[0].id, questionId: q[0].id };
    });

    // Tenant B sees none of the three and changes none of them.
    const seen = await asOtherTenant(async (tx) => ({
      outlines: await tx
        .select()
        .from(schema.jobEstimateOutlines)
        .where(eq(schema.jobEstimateOutlines.id, seeded.outlineId)),
      changed: await tx
        .update(schema.jobEstimateOutlines)
        .set({ name: "theirs" })
        .where(eq(schema.jobEstimateOutlines.id, seeded.outlineId))
        .returning(),
      steps: await tx
        .select()
        .from(schema.jobEstimateOutlineSteps)
        .where(eq(schema.jobEstimateOutlineSteps.id, seeded.stepId)),
      questions: await tx
        .select()
        .from(schema.jobEstimateOutlineQuestions)
        .where(eq(schema.jobEstimateOutlineQuestions.id, seeded.questionId)),
    }));
    expect(seen.outlines).toEqual([]);
    expect(seen.changed).toEqual([]);
    expect(seen.steps).toEqual([]);
    expect(seen.questions).toEqual([]);

    /**
     * **READABLE BY A MEMBER, although only an owner may write one.** The
     * split is `requireWrite` in the ops, not a policy: an estimator being
     * walked through an outline has to be able to read it, and RLS is
     * row-level rather than verb-level.
     */
    const mine = await asStaff((tx) =>
      tx
        .select()
        .from(schema.jobEstimateOutlineQuestions)
        .where(eq(schema.jobEstimateOutlineQuestions.id, seeded.questionId)),
    );
    expect(mine).toHaveLength(1);
    expect(mine[0].choices).toEqual(["Block", "Poured"]);

    // The name is unique per tenant, and two businesses may both say "New build".
    await expect(
      withSystem((tx) =>
        tx.insert(schema.jobEstimateOutlines).values({ tenantId: tenantA, name: "New build" }),
      ),
    ).rejects.toThrow();
    const theirs = await withSystem((tx) =>
      tx
        .insert(schema.jobEstimateOutlines)
        .values({ tenantId: tenantB, name: "New build", isDefault: true })
        .returning(),
    );
    expect(theirs).toHaveLength(1);

    /**
     * **ONE DEFAULT PER TENANT, OR NONE** — the partial unique index, not the
     * application. Tenant B having its own default at the same time is the
     * proof that the index is partial on the tenant and not global.
     */
    await expect(
      withSystem((tx) =>
        tx
          .insert(schema.jobEstimateOutlines)
          .values({ tenantId: tenantA, name: "Remodel", isDefault: true }),
      ),
    ).rejects.toThrow();
    const second = await withSystem((tx) =>
      tx
        .insert(schema.jobEstimateOutlines)
        .values({ tenantId: tenantA, name: "Remodel" })
        .returning(),
    );
    expect(second[0].isDefault).toBe(false);

    // A step on another tenant's outline, and a question on another tenant's step.
    await expect(
      withSystem((tx) =>
        tx
          .insert(schema.jobEstimateOutlineSteps)
          .values({ tenantId: tenantA, outlineId: theirs[0].id, title: "x" }),
      ),
    ).rejects.toThrow();
    const theirStep = await withSystem((tx) =>
      tx
        .insert(schema.jobEstimateOutlineSteps)
        .values({ tenantId: tenantB, outlineId: theirs[0].id, title: "Theirs" })
        .returning(),
    );
    await expect(
      withSystem((tx) =>
        tx
          .insert(schema.jobEstimateOutlineQuestions)
          .values({ tenantId: tenantA, stepId: theirStep[0].id, prompt: "x" }),
      ),
    ).rejects.toThrow();

    // A blank name, a blank title and a blank prompt are none of them values.
    await expect(
      withSystem((tx) =>
        tx.insert(schema.jobEstimateOutlines).values({ tenantId: tenantA, name: "  " }),
      ),
    ).rejects.toThrow();
    await expect(
      withSystem((tx) =>
        tx
          .insert(schema.jobEstimateOutlineSteps)
          .values({ tenantId: tenantA, outlineId: seeded.outlineId, title: " " }),
      ),
    ).rejects.toThrow();
    await expect(
      withSystem((tx) =>
        tx
          .insert(schema.jobEstimateOutlineQuestions)
          .values({ tenantId: tenantA, stepId: seeded.stepId, prompt: " " }),
      ),
    ).rejects.toThrow();

    /**
     * **OPTIONS BELONG TO A CHOICE AND TO NOTHING ELSE.** Each of these is a
     * question the interview could not draw buttons for: a choice of one is a
     * statement, options on a number are two answers to the same question,
     * and a `choices` that is not an array is not a list of anything.
     */
    const badQuestions: Record<string, unknown>[] = [
      { prompt: "One option", kind: "choice", choices: ["Only"] },
      { prompt: "No options", kind: "choice", choices: [] },
      { prompt: "Options on a number", kind: "number", choices: ["a", "b"] },
      { prompt: "Options on a yes/no", kind: "yes_no", choices: ["Yes", "No"] },
      { prompt: "Not a list", kind: "choice", choices: { a: 1 } },
      { prompt: "A kind nothing knows", kind: "currency" },
    ];
    for (const bad of badQuestions) {
      await expect(
        withSystem((tx) =>
          tx
            .insert(schema.jobEstimateOutlineQuestions)
            .values({
              tenantId: tenantA,
              stepId: seeded.stepId,
              ...bad,
            } as typeof schema.jobEstimateOutlineQuestions.$inferInsert),
        ),
        String(bad.prompt),
      ).rejects.toThrow();
    }
    // And the kinds that carry no options are fine without them.
    const plain = await withSystem((tx) =>
      tx
        .insert(schema.jobEstimateOutlineQuestions)
        .values({ tenantId: tenantA, stepId: seeded.stepId, prompt: "How wide?", kind: "number", unit: "in" })
        .returning(),
    );
    expect(plain[0].choices).toEqual([]);

    // The questions go with the step, and the steps go with the outline.
    await withSystem((tx) =>
      tx
        .delete(schema.jobEstimateOutlineSteps)
        .where(eq(schema.jobEstimateOutlineSteps.id, seeded.stepId)),
    );
    expect(
      await withSystem((tx) =>
        tx
          .select()
          .from(schema.jobEstimateOutlineQuestions)
          .where(eq(schema.jobEstimateOutlineQuestions.id, seeded.questionId)),
      ),
    ).toEqual([]);

    await withSystem((tx) =>
      tx
        .insert(schema.jobEstimateOutlineSteps)
        .values({ tenantId: tenantA, outlineId: seeded.outlineId, title: "Goes with the outline" }),
    );
    await withSystem((tx) =>
      tx
        .delete(schema.jobEstimateOutlines)
        .where(eq(schema.jobEstimateOutlines.id, seeded.outlineId)),
    );
    expect(
      await withSystem((tx) =>
        tx
          .select()
          .from(schema.jobEstimateOutlineSteps)
          .where(eq(schema.jobEstimateOutlineSteps.outlineId, seeded.outlineId)),
      ),
    ).toEqual([]);

    await withSystem((tx) =>
      tx.delete(schema.jobEstimateOutlines).where(eq(schema.jobEstimateOutlines.id, second[0].id)),
    );
    await withSystem((tx) =>
      tx.delete(schema.jobEstimateOutlines).where(eq(schema.jobEstimateOutlines.id, theirs[0].id)),
    );
  });

  it("cannot read or change another tenant's ESTIMATE WALKS; one runs per estimate; a finish carries its date; a skip is whole or absent; an outline in use cannot be deleted; and the answers go with the estimate", async () => {
    const seeded = await withSystem(async (tx) => {
      const e = await tx
        .insert(schema.jobEstimates)
        .values({ tenantId: tenantA, projectId: projectA, number: "EST-WALK-1" })
        .returning();
      const o = await tx
        .insert(schema.jobEstimateOutlines)
        .values({ tenantId: tenantA, name: "Walked outline" })
        .returning();
      const w = await tx
        .insert(schema.jobEstimateInterviews)
        .values({ tenantId: tenantA, estimateId: e[0].id, outlineId: o[0].id })
        .returning();
      const a = await tx
        .insert(schema.jobEstimateInterviewAnswers)
        .values({
          tenantId: tenantA,
          interviewId: w[0].id,
          stepTitle: "Foundation",
          prompt: "Block or poured?",
          answer: "Poured",
        })
        .returning();
      return { estimateId: e[0].id, outlineId: o[0].id, walkId: w[0].id, answerId: a[0].id };
    });

    // Tenant B sees neither and changes neither.
    const seen = await asOtherTenant(async (tx) => ({
      walks: await tx
        .select()
        .from(schema.jobEstimateInterviews)
        .where(eq(schema.jobEstimateInterviews.id, seeded.walkId)),
      changed: await tx
        .update(schema.jobEstimateInterviews)
        .set({ status: "abandoned" })
        .where(eq(schema.jobEstimateInterviews.id, seeded.walkId))
        .returning(),
      answers: await tx
        .select()
        .from(schema.jobEstimateInterviewAnswers)
        .where(eq(schema.jobEstimateInterviewAnswers.id, seeded.answerId)),
    }));
    expect(seen.walks).toEqual([]);
    expect(seen.changed).toEqual([]);
    expect(seen.answers).toEqual([]);

    /**
     * **MEMBER WORK, not owner work.** Walking an estimate IS the estimating,
     * the same as typing the lines. The OUTLINE is owner-only to write; using
     * one is a chore.
     */
    const mine = await asStaff((tx) =>
      tx
        .select()
        .from(schema.jobEstimateInterviewAnswers)
        .where(eq(schema.jobEstimateInterviewAnswers.id, seeded.answerId)),
    );
    expect(mine).toHaveLength(1);
    expect(mine[0].answer).toBe("Poured");

    /**
     * **ONE RUNNING WALK PER ESTIMATE**, by a partial unique index. Two people
     * walking one estimate would each be banking answers the other cannot see.
     */
    await expect(
      withSystem((tx) =>
        tx.insert(schema.jobEstimateInterviews).values({
          tenantId: tenantA,
          estimateId: seeded.estimateId,
          outlineId: seeded.outlineId,
        }),
      ),
    ).rejects.toThrow();
    // Closed, and a second may start -- which is what re-walking an estimate is.
    await withSystem((tx) =>
      tx
        .update(schema.jobEstimateInterviews)
        .set({ status: "abandoned", finishedAt: new Date() })
        .where(eq(schema.jobEstimateInterviews.id, seeded.walkId)),
    );
    const second = await withSystem((tx) =>
      tx
        .insert(schema.jobEstimateInterviews)
        .values({
          tenantId: tenantA,
          estimateId: seeded.estimateId,
          outlineId: seeded.outlineId,
        })
        .returning(),
    );
    expect(second).toHaveLength(1);

    // A finish carries its date, and a running one carries none -- both ways.
    await expect(
      withSystem((tx) =>
        tx
          .update(schema.jobEstimateInterviews)
          .set({ status: "finished", finishedAt: null })
          .where(eq(schema.jobEstimateInterviews.id, second[0].id)),
      ),
    ).rejects.toThrow();
    await expect(
      withSystem((tx) =>
        tx
          .update(schema.jobEstimateInterviews)
          .set({ status: "running", finishedAt: new Date() })
          .where(eq(schema.jobEstimateInterviews.id, second[0].id)),
      ),
    ).rejects.toThrow();
    await expect(
      withSystem((tx) =>
        tx
          .update(schema.jobEstimateInterviews)
          .set({ status: "paused" })
          .where(eq(schema.jobEstimateInterviews.id, second[0].id)),
      ),
    ).rejects.toThrow();
    // And the buttons are a list or nothing.
    await expect(
      withSystem((tx) =>
        tx
          .update(schema.jobEstimateInterviews)
          .set({ pendingQuickReplies: { a: 1 } })
          .where(eq(schema.jobEstimateInterviews.id, second[0].id)),
      ),
    ).rejects.toThrow();

    /**
     * **A SKIP IS A WHOLE FACT OR NONE OF ONE.** Half a skip -- a reason with
     * no skip, a skip with no reason, a skip that also carries an answer -- is
     * a record of nothing, and the finish gate reads these to tell a passed
     * question from one nobody got to.
     */
    const halfSkips: Record<string, unknown>[] = [
      { prompt: "p", skipped: true, skipReason: "" },
      { prompt: "p", skipped: true, skipReason: "moot", answer: "but also this" },
      { prompt: "p", skipped: false, skipReason: "a reason with no skip" },
    ];
    for (const bad of halfSkips) {
      await expect(
        withSystem((tx) =>
          tx.insert(schema.jobEstimateInterviewAnswers).values({
            tenantId: tenantA,
            interviewId: second[0].id,
            ...bad,
          } as typeof schema.jobEstimateInterviewAnswers.$inferInsert),
        ),
        JSON.stringify(bad),
      ).rejects.toThrow();
    }
    // A whole skip is fine.
    const skip = await withSystem((tx) =>
      tx
        .insert(schema.jobEstimateInterviewAnswers)
        .values({
          tenantId: tenantA,
          interviewId: second[0].id,
          prompt: "Any rebar?",
          skipped: true,
          skipReason: "the wall is block",
        })
        .returning(),
    );
    expect(skip[0].answer).toBe("");
    // And a blank prompt is not a question.
    await expect(
      withSystem((tx) =>
        tx
          .insert(schema.jobEstimateInterviewAnswers)
          .values({ tenantId: tenantA, interviewId: second[0].id, prompt: "  " }),
      ),
    ).rejects.toThrow();

    /**
     * **ASKING A QUESTION AGAIN SUPERSEDES; IT DOES NOT DELETE** (X4). The
     * whole way back into a walk rests on this: a superseded row stops
     * counting, which re-opens its step, which is what `currentStep` follows.
     * The old row stays because a transcript is a record of what happened.
     */
    const asked = await withSystem((tx) =>
      tx
        .insert(schema.jobEstimateInterviewAnswers)
        .values({
          tenantId: tenantA,
          interviewId: second[0].id,
          prompt: "How wide is the footing?",
          answer: "24 inches",
        })
        .returning(),
    );
    expect(asked[0].supersededAt).toBeNull();

    await withSystem((tx) =>
      tx
        .update(schema.jobEstimateInterviewAnswers)
        .set({ supersededAt: new Date() })
        .where(eq(schema.jobEstimateInterviewAnswers.id, asked[0].id)),
    );
    const again = await withSystem((tx) =>
      tx
        .insert(schema.jobEstimateInterviewAnswers)
        .values({
          tenantId: tenantA,
          interviewId: second[0].id,
          prompt: "How wide is the footing?",
          answer: "30 inches, it turns out",
        })
        .returning(),
    );

    /** BOTH rows are there: what was said at the time, and what stands now. */
    const both = await asStaff((tx) =>
      tx
        .select()
        .from(schema.jobEstimateInterviewAnswers)
        .where(eq(schema.jobEstimateInterviewAnswers.interviewId, second[0].id)),
    );
    const footings = both.filter((a) => a.prompt === "How wide is the footing?");
    expect(footings).toHaveLength(2);
    expect(footings.filter((a) => a.supersededAt === null)).toHaveLength(1);
    expect(footings.find((a) => a.supersededAt === null)?.answer).toBe(
      "30 inches, it turns out",
    );
    expect(footings.find((a) => a.supersededAt !== null)?.answer).toBe("24 inches");
    expect(again[0].supersededAt).toBeNull();

    /**
     * A superseded row is still a whole record: the skip CHECK keeps holding,
     * so history cannot be rewritten into something that never happened.
     */
    await expect(
      withSystem((tx) =>
        tx
          .update(schema.jobEstimateInterviewAnswers)
          .set({ skipped: true, skipReason: "" })
          .where(eq(schema.jobEstimateInterviewAnswers.id, asked[0].id)),
      ),
    ).rejects.toThrow();

    // A walk on another tenant's estimate is unrepresentable.
    await expect(
      withSystem((tx) =>
        tx.insert(schema.jobEstimateInterviews).values({
          tenantId: tenantB,
          estimateId: seeded.estimateId,
          outlineId: seeded.outlineId,
        }),
      ),
    ).rejects.toThrow();

    /**
     * **AN OUTLINE SOMEBODY HAS WALKED CANNOT BE DELETED** -- NO ACTION, not
     * cascade. A walk keeps pointing at the outline it ran from, and losing
     * that would leave a transcript nobody could place.
     */
    await expect(
      withSystem((tx) =>
        tx
          .delete(schema.jobEstimateOutlines)
          .where(eq(schema.jobEstimateOutlines.id, seeded.outlineId)),
      ),
    ).rejects.toThrow();

    // The answers go with the walk, and the walk goes with the estimate.
    await withSystem((tx) =>
      tx.delete(schema.jobEstimates).where(eq(schema.jobEstimates.id, seeded.estimateId)),
    );
    expect(
      await withSystem((tx) =>
        tx
          .select()
          .from(schema.jobEstimateInterviews)
          .where(eq(schema.jobEstimateInterviews.estimateId, seeded.estimateId)),
      ),
    ).toEqual([]);
    expect(
      await withSystem((tx) =>
        tx
          .select()
          .from(schema.jobEstimateInterviewAnswers)
          .where(eq(schema.jobEstimateInterviewAnswers.id, skip[0].id)),
      ),
    ).toEqual([]);
    await withSystem((tx) =>
      tx
        .delete(schema.jobEstimateOutlines)
        .where(eq(schema.jobEstimateOutlines.id, seeded.outlineId)),
    );
  });

  it("cannot read or change another tenant's PROPOSED LINES; a derived quantity shows its working; applied is whole or absent; and they go with the walk", async () => {
    const seeded = await withSystem(async (tx) => {
      const e = await tx
        .insert(schema.jobEstimates)
        .values({ tenantId: tenantA, projectId: projectA, number: "EST-PROP-1" })
        .returning();
      const o = await tx
        .insert(schema.jobEstimateOutlines)
        .values({ tenantId: tenantA, name: "Proposed outline" })
        .returning();
      const w = await tx
        .insert(schema.jobEstimateInterviews)
        .values({ tenantId: tenantA, estimateId: e[0].id, outlineId: o[0].id })
        .returning();
      const l = await tx
        .insert(schema.jobEstimateProposedLines)
        .values({
          tenantId: tenantA,
          interviewId: w[0].id,
          stepTitle: "Foundation",
          description: "Footing concrete",
          unit: "lf",
          quantityThousandths: 176_000,
          unitCostCents: 2_375,
          basis: "memory",
          basisDetail: "last charged on 24-108",
          quantityBasis: "said",
        })
        .returning();
      return { estimateId: e[0].id, outlineId: o[0].id, walkId: w[0].id, lineId: l[0].id };
    });

    // Tenant B sees none of it and changes none of it.
    const seen = await asOtherTenant(async (tx) => ({
      rows: await tx
        .select()
        .from(schema.jobEstimateProposedLines)
        .where(eq(schema.jobEstimateProposedLines.id, seeded.lineId)),
      changed: await tx
        .update(schema.jobEstimateProposedLines)
        .set({ unitCostCents: 1 })
        .where(eq(schema.jobEstimateProposedLines.id, seeded.lineId))
        .returning(),
    }));
    expect(seen.rows).toEqual([]);
    expect(seen.changed).toEqual([]);

    // Member work, like the walk that made it.
    const mine = await asStaff((tx) =>
      tx
        .select()
        .from(schema.jobEstimateProposedLines)
        .where(eq(schema.jobEstimateProposedLines.id, seeded.lineId)),
    );
    expect(mine).toHaveLength(1);
    expect(mine[0].basis).toBe("memory");

    /**
     * **A DERIVED QUANTITY SHOWS ITS WORKING, OR IT IS NOT DERIVED.** The
     * founder asked for arithmetic on the condition it is visible; a row
     * claiming `derived` with nothing to show would be the unexplained
     * number this whole slice refuses.
     */
    await expect(
      withSystem((tx) =>
        tx.insert(schema.jobEstimateProposedLines).values({
          tenantId: tenantA,
          interviewId: seeded.walkId,
          description: "Fixtures",
          quantityBasis: "derived",
          quantityNote: "",
        }),
      ),
    ).rejects.toThrow();
    // And working with no derivation is equally half a fact.
    await expect(
      withSystem((tx) =>
        tx.insert(schema.jobEstimateProposedLines).values({
          tenantId: tenantA,
          interviewId: seeded.walkId,
          description: "Fixtures",
          quantityBasis: "said",
          quantityNote: "2 baths at 3 each",
        }),
      ),
    ).rejects.toThrow();
    const derived = await withSystem((tx) =>
      tx
        .insert(schema.jobEstimateProposedLines)
        .values({
          tenantId: tenantA,
          interviewId: seeded.walkId,
          description: "Fixtures",
          quantityThousandths: 6_000,
          quantityBasis: "derived",
          quantityNote: "2 baths at 3 fixtures each",
        })
        .returning(),
    );
    expect(derived[0].quantityNote).toBe("2 baths at 3 fixtures each");

    // A basis nothing understands, and money that is less than nothing.
    for (const bad of [
      { basis: "vibes" },
      { quantityBasis: "guessed" },
      { unitCostCents: -1 },
      { quantityThousandths: -1 },
      { description: "  " },
    ]) {
      await expect(
        withSystem((tx) =>
          tx.insert(schema.jobEstimateProposedLines).values({
            tenantId: tenantA,
            interviewId: seeded.walkId,
            description: "x",
            ...bad,
          } as typeof schema.jobEstimateProposedLines.$inferInsert),
        ),
        JSON.stringify(bad),
      ).rejects.toThrow();
    }

    /** Applied is both halves or neither: half a record is not one. */
    await expect(
      withSystem((tx) =>
        tx
          .update(schema.jobEstimateProposedLines)
          .set({ appliedAt: new Date() })
          .where(eq(schema.jobEstimateProposedLines.id, seeded.lineId)),
      ),
    ).rejects.toThrow();

    // A proposal on another tenant's walk is unrepresentable.
    await expect(
      withSystem((tx) =>
        tx.insert(schema.jobEstimateProposedLines).values({
          tenantId: tenantB,
          interviewId: seeded.walkId,
          description: "theirs",
        }),
      ),
    ).rejects.toThrow();

    // They go with the walk, which goes with the estimate.
    await withSystem((tx) =>
      tx.delete(schema.jobEstimates).where(eq(schema.jobEstimates.id, seeded.estimateId)),
    );
    expect(
      await withSystem((tx) =>
        tx
          .select()
          .from(schema.jobEstimateProposedLines)
          .where(eq(schema.jobEstimateProposedLines.id, seeded.lineId)),
      ),
    ).toEqual([]);
    await withSystem((tx) =>
      tx
        .delete(schema.jobEstimateOutlines)
        .where(eq(schema.jobEstimateOutlines.id, seeded.outlineId)),
    );
  });

  it("cannot read or change another tenant's BID REQUESTS; a token_hash is globally unique; one ask per sub and one award per package; a reply is whole; an award needs a number; and they go with the job", async () => {
    const seeded = await withSystem(async (tx) => {
      const party = await tx
        .insert(schema.parties)
        .values({ tenantId: tenantA, kind: "organization", displayName: "A sparky" })
        .returning();
      const pkg = await tx
        .insert(schema.jobBidPackages)
        .values({ tenantId: tenantA, projectId: projectA, title: "Electrical", costCode: "5200" })
        .returning();
      const inv = await tx
        .insert(schema.jobBidInvitations)
        .values({
          tenantId: tenantA,
          packageId: pkg[0].id,
          partyId: party[0].id,
          tokenHash: `hash-${process.pid}-a`,
          tokenCiphertext: "cipher",
          expiresAt: new Date(Date.now() + 86_400_000),
        })
        .returning();
      return { partyId: party[0].id, packageId: pkg[0].id, invitationId: inv[0].id };
    });

    // Tenant B sees neither and changes neither.
    const seen = await asOtherTenant(async (tx) => ({
      packages: await tx
        .select()
        .from(schema.jobBidPackages)
        .where(eq(schema.jobBidPackages.id, seeded.packageId)),
      invitations: await tx
        .select()
        .from(schema.jobBidInvitations)
        .where(eq(schema.jobBidInvitations.id, seeded.invitationId)),
      changed: await tx
        .update(schema.jobBidInvitations)
        .set({ amountCents: 1 })
        .where(eq(schema.jobBidInvitations.id, seeded.invitationId))
        .returning(),
    }));
    expect(seen.packages).toEqual([]);
    expect(seen.invitations).toEqual([]);
    expect(seen.changed).toEqual([]);

    // Member work: asking for a number is estimating.
    const mine = await asStaff((tx) =>
      tx
        .select()
        .from(schema.jobBidPackages)
        .where(eq(schema.jobBidPackages.id, seeded.packageId)),
    );
    expect(mine).toHaveLength(1);

    /**
     * **`token_hash` IS GLOBALLY UNIQUE, WITH NO TENANT PREFIX** — the public
     * lookup has no tenant to scope by, so two businesses cannot hold the
     * same hash and have the resolver pick one.
     */
    await expect(
      withSystem(async (tx) => {
        const party = await tx
          .insert(schema.parties)
          .values({ tenantId: tenantB, kind: "organization", displayName: "Their sparky" })
          .returning();
        const pkg = await tx
          .insert(schema.jobBidPackages)
          .values({ tenantId: tenantB, projectId: projectB, title: "Electrical" })
          .returning();
        return tx.insert(schema.jobBidInvitations).values({
          tenantId: tenantB,
          packageId: pkg[0].id,
          partyId: party[0].id,
          tokenHash: `hash-${process.pid}-a`,
          tokenCiphertext: "cipher",
          expiresAt: new Date(Date.now() + 86_400_000),
        });
      }),
    ).rejects.toThrow();

    // One ask per subcontractor per package: asking twice is one ask.
    await expect(
      withSystem((tx) =>
        tx.insert(schema.jobBidInvitations).values({
          tenantId: tenantA,
          packageId: seeded.packageId,
          partyId: seeded.partyId,
          tokenHash: `hash-${process.pid}-dup`,
          tokenCiphertext: "cipher",
          expiresAt: new Date(Date.now() + 86_400_000),
        }),
      ),
    ).rejects.toThrow();

    /**
     * **A REPLY IS A WHOLE FACT OR NONE OF ONE** (ADR 0085's shape). A number
     * with no date cannot be placed; a date with neither a number nor a
     * decline says only that something happened.
     */
    const halves: Record<string, unknown>[] = [
      { amountCents: 1_000 },
      { repliedAt: new Date() },
      { repliedAt: new Date(), repliedName: "Bo", amountCents: 1_000, declined: true },
      { repliedAt: new Date(), amountCents: 1_000 },
      { repliedAt: new Date(), repliedName: "Bo" },
    ];
    for (const bad of halves) {
      await expect(
        withSystem((tx) =>
          tx
            .update(schema.jobBidInvitations)
            .set(bad as Partial<typeof schema.jobBidInvitations.$inferInsert>)
            .where(eq(schema.jobBidInvitations.id, seeded.invitationId)),
        ),
        JSON.stringify(bad),
      ).rejects.toThrow();
    }
    // A whole one is fine, either way round.
    await withSystem((tx) =>
      tx
        .update(schema.jobBidInvitations)
        .set({ repliedAt: new Date(), repliedName: "Bo", amountCents: 1_250_000 })
        .where(eq(schema.jobBidInvitations.id, seeded.invitationId)),
    );

    /**
     * **YOU CANNOT AWARD A NUMBER NOBODY GAVE.** Awarding a silence would put
     * a price on an estimate with nothing behind it.
     */
    const silent = await withSystem(async (tx) => {
      const party = await tx
        .insert(schema.parties)
        .values({ tenantId: tenantA, kind: "organization", displayName: "A quiet one" })
        .returning();
      return tx
        .insert(schema.jobBidInvitations)
        .values({
          tenantId: tenantA,
          packageId: seeded.packageId,
          partyId: party[0].id,
          tokenHash: `hash-${process.pid}-b`,
          tokenCiphertext: "cipher",
          expiresAt: new Date(Date.now() + 86_400_000),
        })
        .returning();
    });
    await expect(
      withSystem((tx) =>
        tx
          .update(schema.jobBidInvitations)
          .set({ isAwarded: true })
          .where(eq(schema.jobBidInvitations.id, silent[0].id)),
      ),
    ).rejects.toThrow();

    // ONE AWARD PER PACKAGE, by the partial unique index.
    await withSystem((tx) =>
      tx
        .update(schema.jobBidInvitations)
        .set({ isAwarded: true })
        .where(eq(schema.jobBidInvitations.id, seeded.invitationId)),
    );
    await expect(
      withSystem((tx) =>
        tx
          .update(schema.jobBidInvitations)
          .set({ repliedAt: new Date(), repliedName: "Q", amountCents: 9, isAwarded: true })
          .where(eq(schema.jobBidInvitations.id, silent[0].id)),
      ),
    ).rejects.toThrow();

    // A blank title, and a status nothing understands.
    for (const bad of [{ title: "  " }, { status: "maybe" }]) {
      await expect(
        withSystem((tx) =>
          tx
            .insert(schema.jobBidPackages)
            .values({
              tenantId: tenantA,
              projectId: projectA,
              title: "x",
              ...bad,
            } as typeof schema.jobBidPackages.$inferInsert),
        ),
        JSON.stringify(bad),
      ).rejects.toThrow();
    }

    // The invitations go with the package, and the package goes with the job.
    await withSystem((tx) =>
      tx.delete(schema.jobBidPackages).where(eq(schema.jobBidPackages.id, seeded.packageId)),
    );
    expect(
      await withSystem((tx) =>
        tx
          .select()
          .from(schema.jobBidInvitations)
          .where(eq(schema.jobBidInvitations.id, seeded.invitationId)),
      ),
    ).toEqual([]);
  });

  it("cannot read or change another tenant's CLIENT LINKS; a link hangs off this tenant's estimate; a token_hash is globally unique; a signature is whole or absent; and the link goes with the estimate", async () => {
    const seeded = await withSystem(async (tx) => {
      const e = await tx
        .insert(schema.jobEstimates)
        .values({ tenantId: tenantA, projectId: projectA, number: "EST-SHARE-1" })
        .returning();
      const s = await tx
        .insert(schema.jobEstimateShares)
        .values({
          tenantId: tenantA,
          estimateId: e[0].id,
          tokenHash: "hash-a-iso",
          tokenCiphertext: "cipher-a",
          expiresAt: new Date("2030-01-01T00:00:00Z"),
          createdByClerkUserId: "user_a",
        })
        .returning();
      return { estimateId: e[0].id, shareId: s[0].id };
    });

    // Tenant B sees nothing of it and changes nothing of it — which is the
    // whole point: a link is anonymous to the WORLD, never to another tenant.
    const seen = await asOtherTenant(async (tx) => ({
      rows: await tx.select().from(schema.jobEstimateShares).where(eq(schema.jobEstimateShares.id, seeded.shareId)),
      changed: await tx
        .update(schema.jobEstimateShares)
        .set({ signedName: "theirs" })
        .where(eq(schema.jobEstimateShares.id, seeded.shareId))
        .returning(),
    }));
    expect(seen.rows).toEqual([]);
    expect(seen.changed).toEqual([]);
    // A staff member of the owning tenant reads it: minting and revoking a
    // link is member work, like writing the estimate it belongs to.
    const mine = await asStaff((tx) =>
      tx.select().from(schema.jobEstimateShares).where(eq(schema.jobEstimateShares.id, seeded.shareId)),
    );
    expect(mine).toHaveLength(1);
    expect(mine[0].viewCount).toBe(0);

    // A link on another tenant's estimate is unrepresentable.
    const otherEstimate = await withSystem(async (tx) => {
      const r = await tx
        .insert(schema.jobEstimates)
        .values({ tenantId: tenantB, projectId: projectB, number: "EST-B-SHARE" })
        .returning();
      return r[0].id;
    });
    await expect(
      withSystem((tx) =>
        tx.insert(schema.jobEstimateShares).values({
          tenantId: tenantA,
          estimateId: otherEstimate,
          tokenHash: "hash-cross",
          tokenCiphertext: "c",
          expiresAt: new Date("2030-01-01T00:00:00Z"),
          createdByClerkUserId: "u",
        }),
      ),
    ).rejects.toThrow();

    /**
     * THE TOKEN HASH IS UNIQUE ACROSS EVERY TENANT, not per tenant. The public
     * lookup has no tenant context to scope by — it has 43 characters and
     * nothing else — so two tenants holding one hash would make that lookup
     * ambiguous, which is the one thing it may never be.
     */
    await expect(
      withSystem((tx) =>
        tx.insert(schema.jobEstimateShares).values({
          tenantId: tenantB,
          estimateId: otherEstimate,
          tokenHash: "hash-a-iso",
          tokenCiphertext: "c",
          expiresAt: new Date("2030-01-01T00:00:00Z"),
          createdByClerkUserId: "u",
        }),
      ),
    ).rejects.toThrow();

    // A SIGNATURE IS A WHOLE FACT OR NOTHING: half of one is not evidence.
    for (const half of [
      { signedAt: new Date() },
      { signedName: "A Client" },
      { signedAt: new Date(), signedName: "A Client" },
      { signedAt: new Date(), signedName: "A Client", signedIpHash: "ip" },
      { signedAt: new Date(), signedName: "A Client", signedIpHash: "ip", signedEstimateVersion: 1 },
    ]) {
      await expect(
        withSystem((tx) =>
          tx
            .update(schema.jobEstimateShares)
            .set(half)
            .where(eq(schema.jobEstimateShares.id, seeded.shareId)),
        ),
        JSON.stringify(Object.keys(half)),
      ).rejects.toThrow();
    }
    // All five together is the only shape that lands.
    const whole = await withSystem((tx) =>
      tx
        .update(schema.jobEstimateShares)
        .set({
          signedAt: new Date("2026-10-14T12:00:00Z"),
          signedName: "A Client",
          signedIpHash: "iphash",
          signedEstimateVersion: 1,
          signedTotalCents: 190_537_53,
        })
        .where(eq(schema.jobEstimateShares.id, seeded.shareId))
        .returning(),
    );
    expect(whole[0].signedName).toBe("A Client");
    expect(whole[0].signedTotalCents).toBe(190_537_53);

    // A blank name is not a signature either.
    await expect(
      withSystem((tx) =>
        tx
          .update(schema.jobEstimateShares)
          .set({ signedName: "   " })
          .where(eq(schema.jobEstimateShares.id, seeded.shareId)),
      ),
    ).rejects.toThrow();

    // The link goes with the estimate: nothing outlives the document it served.
    await withSystem((tx) => tx.delete(schema.jobEstimates).where(eq(schema.jobEstimates.id, seeded.estimateId)));
    expect(
      await withSystem((tx) =>
        tx.select().from(schema.jobEstimateShares).where(eq(schema.jobEstimateShares.id, seeded.shareId)),
      ),
    ).toEqual([]);
    await withSystem((tx) => tx.delete(schema.jobEstimates).where(eq(schema.jobEstimates.id, otherEstimate)));
  });

  it("cannot read or change another tenant's PARTY DOCUMENTS; a document hangs off this tenant's party; the kind is a slug, received has its date, the limit has a floor, and the party is held", async () => {
    const docId = await withSystem(async (tx) => {
      const rows = await tx
        .insert(schema.jobPartyDocuments)
        .values({ tenantId: tenantA, partyId: clientA, kind: "insurance_certificate", expiresOn: "2027-01-01", receivedOn: "2026-09-15" })
        .returning();
      return rows[0].id;
    });
    const seen = await asOtherTenant(async (tx) => ({
      rows: await tx.select().from(schema.jobPartyDocuments).where(eq(schema.jobPartyDocuments.id, docId)),
      changed: await tx.update(schema.jobPartyDocuments).set({ status: "void" }).where(eq(schema.jobPartyDocuments.id, docId)).returning(),
    }));
    expect(seen.rows).toEqual([]);
    expect(seen.changed).toEqual([]);
    expect(await asStaff((tx) => tx.select().from(schema.jobPartyDocuments).where(eq(schema.jobPartyDocuments.id, docId)))).toHaveLength(1);
    const otherParty = await withSystem((tx) => seedParty(tx, tenantB, "Builder B's framer"));
    await expect(
      withSystem((tx) => tx.insert(schema.jobPartyDocuments).values({ tenantId: tenantA, partyId: otherParty, kind: "w9", receivedOn: "2026-09-15" })),
    ).rejects.toThrow();
    await expect(
      withSystem((tx) => tx.insert(schema.jobPartyDocuments).values({ tenantId: tenantA, partyId: clientA, kind: "W-9", receivedOn: "2026-09-15" })),
    ).rejects.toThrow();
    await expect(
      withSystem((tx) => tx.insert(schema.jobPartyDocuments).values({ tenantId: tenantA, partyId: clientA, kind: "w9", status: "received" })),
    ).rejects.toThrow();
    await expect(
      withSystem((tx) => tx.insert(schema.jobPartyDocuments).values({ tenantId: tenantA, partyId: clientA, kind: "w9", status: "requested", receivedOn: "2026-09-15" })),
    ).rejects.toThrow();
    await expect(
      withSystem((tx) => tx.insert(schema.jobPartyDocuments).values({ tenantId: tenantA, partyId: clientA, kind: "license", limitCents: -1, receivedOn: "2026-09-15" })),
    ).rejects.toThrow();
    await expect(withSystem((tx) => tx.delete(schema.parties).where(eq(schema.parties.id, clientA)))).rejects.toThrow();
    await withSystem((tx) => tx.delete(schema.jobPartyDocuments).where(eq(schema.jobPartyDocuments.id, docId)));
  });

  it("cannot read or change another tenant's PHASES; a phase hangs off this tenant's job, item, party and code and follows this tenant's phase; the item is one phase's; the kind, the status and the lag are checked; the phases go with the job and with the item", async () => {
    const calendarId = await withSystem(async (tx) => {
      const r = await tx.insert(schema.scheduleCalendars).values({ tenantId: tenantA, ownerClerkUserId: null, name: "Job schedule", kind: "job_schedule", extensionSlug: "jobs", extensionKey: "schedule" }).returning();
      return r[0].id;
    });
    const itemFor = async (tenant: string, calendar: string, title: string) =>
      withSystem(async (tx) => {
        const r = await tx
          .insert(schema.scheduleItems)
          .values({ tenantId: tenant, calendarId: calendar, title, startsAt: new Date("2026-09-14T04:00:00Z"), endsAt: new Date("2026-09-19T04:00:00Z"), allDay: true, timeZone: "America/New_York", kind: "job_phase", createdByClerkUserId: "" })
          .returning();
        return r[0].id;
      });
    const itemA = await itemFor(tenantA, calendarId, "casc · Site work");
    const phaseId = await withSystem(async (tx) => {
      const r = await tx.insert(schema.jobPhases).values({ tenantId: tenantA, projectId: projectA, itemId: itemA, name: "Site work", partyId: clientA, costCodeId: codeA }).returning();
      return r[0].id;
    });
    const seen = await asOtherTenant(async (tx) => ({
      rows: await tx.select().from(schema.jobPhases).where(eq(schema.jobPhases.id, phaseId)),
      changed: await tx.update(schema.jobPhases).set({ name: "Theirs" }).where(eq(schema.jobPhases.id, phaseId)).returning(),
    }));
    expect(seen.rows).toEqual([]);
    expect(seen.changed).toEqual([]);
    expect(await asStaff((tx) => tx.select().from(schema.jobPhases).where(eq(schema.jobPhases.id, phaseId)))).toHaveLength(1);

    // Tenant B's job, item, party, code or phase under tenant A's row: unrepresentable.
    const calendarB = await withSystem(async (tx) => {
      const r = await tx.insert(schema.scheduleCalendars).values({ tenantId: tenantB, ownerClerkUserId: null, name: "Job schedule", kind: "job_schedule", extensionSlug: "jobs", extensionKey: "schedule" }).returning();
      return r[0].id;
    });
    const itemB = await itemFor(tenantB, calendarB, "theirs");
    const itemA2 = await itemFor(tenantA, calendarId, "casc · Slab");
    const otherCode = await withSystem(async (tx) => (await tx.select().from(schema.jobCostCodes).where(eq(schema.jobCostCodes.setId, setB)))[0].id);
    const otherParty = await withSystem((tx) => seedParty(tx, tenantB, "Builder B's framer"));
    const base = { tenantId: tenantA, name: "x" } as const;
    await expect(withSystem((tx) => tx.insert(schema.jobPhases).values({ ...base, projectId: projectB, itemId: itemA2 }))).rejects.toThrow();
    await expect(withSystem((tx) => tx.insert(schema.jobPhases).values({ ...base, projectId: projectA, itemId: itemB }))).rejects.toThrow();
    await expect(withSystem((tx) => tx.insert(schema.jobPhases).values({ ...base, projectId: projectA, itemId: itemA2, partyId: otherParty }))).rejects.toThrow();
    await expect(withSystem((tx) => tx.insert(schema.jobPhases).values({ ...base, projectId: projectA, itemId: itemA2, costCodeId: otherCode }))).rejects.toThrow();
    const phaseB = await withSystem(async (tx) => {
      const r = await tx.insert(schema.jobPhases).values({ tenantId: tenantB, projectId: projectB, itemId: itemB, name: "Theirs" }).returning();
      return r[0].id;
    });
    await expect(withSystem((tx) => tx.insert(schema.jobPhases).values({ ...base, projectId: projectA, itemId: itemA2, predecessorId: phaseB }))).rejects.toThrow();
    // One phase per item; the CHECKs.
    await expect(withSystem((tx) => tx.insert(schema.jobPhases).values({ ...base, projectId: projectA, itemId: itemA }))).rejects.toThrow();
    await expect(withSystem((tx) => tx.update(schema.jobPhases).set({ kind: "task" }).where(eq(schema.jobPhases.id, phaseId)))).rejects.toThrow();
    await expect(withSystem((tx) => tx.update(schema.jobPhases).set({ status: "late" }).where(eq(schema.jobPhases.id, phaseId)))).rejects.toThrow();
    await expect(withSystem((tx) => tx.update(schema.jobPhases).set({ lagDays: 366 }).where(eq(schema.jobPhases.id, phaseId)))).rejects.toThrow();
    await expect(withSystem((tx) => tx.update(schema.jobPhases).set({ predecessorId: phaseId }).where(eq(schema.jobPhases.id, phaseId)))).rejects.toThrow();
    await expect(withSystem((tx) => tx.update(schema.jobPhases).set({ name: "  " }).where(eq(schema.jobPhases.id, phaseId)))).rejects.toThrow();
    // A predecessor, the party and the code are held; the phase goes with its item and with its job.
    const slabId = await withSystem(async (tx) => {
      const r = await tx.insert(schema.jobPhases).values({ ...base, name: "Slab", projectId: projectA, itemId: itemA2, predecessorId: phaseId }).returning();
      return r[0].id;
    });
    await expect(withSystem((tx) => tx.delete(schema.jobPhases).where(eq(schema.jobPhases.id, phaseId)))).rejects.toThrow();
    await expect(withSystem((tx) => tx.delete(schema.jobCostCodes).where(eq(schema.jobCostCodes.id, codeA)))).rejects.toThrow();
    await withSystem((tx) => tx.delete(schema.scheduleItems).where(eq(schema.scheduleItems.id, itemA2)));
    expect(await withSystem((tx) => tx.select().from(schema.jobPhases).where(eq(schema.jobPhases.id, slabId)))).toEqual([]);
    const scratch = await withSystem(async (tx) => {
      const p = await tx.insert(schema.jobProjects).values({ tenantId: tenantA, entityId: entityA, number: "casc-ph", name: "ph" }).returning();
      const item = await tx
        .insert(schema.scheduleItems)
        .values({ tenantId: tenantA, calendarId, title: "casc-ph · x", startsAt: new Date("2026-09-14T04:00:00Z"), endsAt: new Date("2026-09-15T04:00:00Z"), allDay: true, timeZone: "America/New_York", createdByClerkUserId: "" })
        .returning();
      const ph = await tx.insert(schema.jobPhases).values({ tenantId: tenantA, projectId: p[0].id, itemId: item[0].id, name: "Goes with the job" }).returning();
      return { projectId: p[0].id, phaseId: ph[0].id, itemId: item[0].id };
    });
    await withSystem((tx) => tx.delete(schema.jobProjects).where(eq(schema.jobProjects.id, scratch.projectId)));
    expect(await withSystem((tx) => tx.select().from(schema.jobPhases).where(eq(schema.jobPhases.id, scratch.phaseId)))).toEqual([]);
    await withSystem(async (tx) => {
      await tx.delete(schema.scheduleItems).where(inArray(schema.scheduleItems.id, [itemA, itemB, scratch.itemId]));
      await tx.delete(schema.scheduleCalendars).where(inArray(schema.scheduleCalendars.id, [calendarId, calendarB]));
    });
  });
  it("cannot read or change another tenant's DRAWINGS; a set hangs off this tenant's job and party; a sheet hangs off this tenant's job, set and FILE; a number is once per set and a page once per set's file; the CHECKs; the sheets go with the set, with the file and with the job", async () => {
    const docFor = (tenant: string, name: string) =>
      withSystem(async (tx) => {
        const r = await tx
          .insert(schema.documents)
          .values({
            tenantId: tenant,
            origin: "dms",
            blobPathname: `docs/${tenant}/files/${STAMP}-${name}`,
            fileName: name,
            mimeType: "application/pdf",
            sizeBytes: 10,
            sha256: `${STAMP}-${tenant}-${name}`,
            effectiveVisibility: "members",
          })
          .returning();
        return r[0].id;
      });
    const docA = await docFor(tenantA, "set-a.pdf");
    const docB = await docFor(tenantB, "set-b.pdf");
    const setId = await withSystem(async (tx) => {
      const r = await tx.insert(schema.jobDrawingSets).values({ tenantId: tenantA, projectId: projectA, name: "Permit set", issuedOn: "2026-06-01", fromPartyId: clientA }).returning();
      return r[0].id;
    });
    const sheetId = await withSystem(async (tx) => {
      const r = await tx.insert(schema.jobSheets).values({ tenantId: tenantA, projectId: projectA, setId, documentId: docA, pageNumber: 2, sheetNumber: "A-101", title: "First floor plan" }).returning();
      return r[0].id;
    });
    const seen = await asOtherTenant(async (tx) => ({
      sets: await tx.select().from(schema.jobDrawingSets).where(eq(schema.jobDrawingSets.id, setId)),
      sheets: await tx.select().from(schema.jobSheets).where(eq(schema.jobSheets.id, sheetId)),
      changed: await tx.update(schema.jobSheets).set({ sheetNumber: "THEIRS" }).where(eq(schema.jobSheets.id, sheetId)).returning(),
      renamed: await tx.update(schema.jobDrawingSets).set({ name: "Theirs" }).where(eq(schema.jobDrawingSets.id, setId)).returning(),
    }));
    expect([seen.sets, seen.sheets, seen.changed, seen.renamed]).toEqual([[], [], [], []]);
    expect(await asStaff((tx) => tx.select().from(schema.jobSheets).where(eq(schema.jobSheets.id, sheetId)))).toHaveLength(1);
    expect(await asStaff((tx) => tx.select().from(schema.jobDrawingSets).where(eq(schema.jobDrawingSets.id, setId)))).toHaveLength(1);

    // Tenant B's job, party, set or file under tenant A's row: unrepresentable.
    const setB = await withSystem(async (tx) => {
      const r = await tx.insert(schema.jobDrawingSets).values({ tenantId: tenantB, projectId: projectB, name: "Theirs", issuedOn: "2026-06-01" }).returning();
      return r[0].id;
    });
    const otherParty = await withSystem((tx) => seedParty(tx, tenantB, "Builder B's architect"));
    await expect(withSystem((tx) => tx.insert(schema.jobDrawingSets).values({ tenantId: tenantA, projectId: projectB, name: "x", issuedOn: "2026-06-01" }))).rejects.toThrow();
    await expect(withSystem((tx) => tx.insert(schema.jobDrawingSets).values({ tenantId: tenantA, projectId: projectA, name: "x", issuedOn: "2026-06-01", fromPartyId: otherParty }))).rejects.toThrow();
    const base = { tenantId: tenantA, projectId: projectA, setId, documentId: docA, sheetNumber: "X-1" } as const;
    await expect(withSystem((tx) => tx.insert(schema.jobSheets).values({ ...base, pageNumber: 9, setId: setB }))).rejects.toThrow();
    await expect(withSystem((tx) => tx.insert(schema.jobSheets).values({ ...base, pageNumber: 9, documentId: docB }))).rejects.toThrow();
    await expect(withSystem((tx) => tx.insert(schema.jobSheets).values({ ...base, pageNumber: 9, projectId: projectB }))).rejects.toThrow();
    // One number per set; one page per set's file; the CHECKs.
    await expect(withSystem((tx) => tx.insert(schema.jobSheets).values({ ...base, pageNumber: 3, sheetNumber: "A-101" }))).rejects.toThrow();
    await expect(withSystem((tx) => tx.insert(schema.jobSheets).values({ ...base, pageNumber: 2, sheetNumber: "A-102" }))).rejects.toThrow();
    await expect(withSystem((tx) => tx.update(schema.jobSheets).set({ pageNumber: 0 }).where(eq(schema.jobSheets.id, sheetId)))).rejects.toThrow();
    await expect(withSystem((tx) => tx.update(schema.jobSheets).set({ sheetNumber: "  " }).where(eq(schema.jobSheets.id, sheetId)))).rejects.toThrow();
    await expect(withSystem((tx) => tx.update(schema.jobDrawingSets).set({ name: "  " }).where(eq(schema.jobDrawingSets.id, setId)))).rejects.toThrow();
    // The party is held: a set names it, so it cannot go.
    await expect(withSystem((tx) => tx.delete(schema.parties).where(eq(schema.parties.id, clientA)))).rejects.toThrow();

    // A file taken out of the cabinet takes its pages; a set removed takes its sheets; a job removed takes both.
    const docA2 = await docFor(tenantA, "set-a-2.pdf");
    const onDoc = await withSystem(async (tx) => {
      const r = await tx.insert(schema.jobSheets).values({ ...base, documentId: docA2, pageNumber: 1, sheetNumber: "S-201" }).returning();
      return r[0].id;
    });
    await withSystem((tx) => tx.delete(schema.documents).where(eq(schema.documents.id, docA2)));
    expect(await withSystem((tx) => tx.select().from(schema.jobSheets).where(eq(schema.jobSheets.id, onDoc)))).toEqual([]);
    expect(await withSystem((tx) => tx.select().from(schema.jobSheets).where(eq(schema.jobSheets.id, sheetId)))).toHaveLength(1);
    const scratch = await withSystem(async (tx) => {
      const p = await tx.insert(schema.jobProjects).values({ tenantId: tenantA, entityId: entityA, number: `${STAMP}-DRW`, name: "Goes with the job" }).returning();
      const set = await tx.insert(schema.jobDrawingSets).values({ tenantId: tenantA, projectId: p[0].id, name: "Scratch set", issuedOn: "2026-06-01" }).returning();
      const sh = await tx.insert(schema.jobSheets).values({ tenantId: tenantA, projectId: p[0].id, setId: set[0].id, documentId: docA, pageNumber: 1, sheetNumber: "G-001" }).returning();
      return { projectId: p[0].id, setId: set[0].id, sheetId: sh[0].id };
    });
    await withSystem((tx) => tx.delete(schema.jobProjects).where(eq(schema.jobProjects.id, scratch.projectId)));
    expect(await withSystem((tx) => tx.select().from(schema.jobDrawingSets).where(eq(schema.jobDrawingSets.id, scratch.setId)))).toEqual([]);
    expect(await withSystem((tx) => tx.select().from(schema.jobSheets).where(eq(schema.jobSheets.id, scratch.sheetId)))).toEqual([]);
    await withSystem((tx) => tx.delete(schema.jobDrawingSets).where(eq(schema.jobDrawingSets.id, setId)));
    expect(await withSystem((tx) => tx.select().from(schema.jobSheets).where(eq(schema.jobSheets.id, sheetId)))).toEqual([]);
    await withSystem(async (tx) => {
      await tx.delete(schema.jobDrawingSets).where(eq(schema.jobDrawingSets.id, setB));
      await tx.delete(schema.documents).where(inArray(schema.documents.id, [docA, docB]));
    });
  });
  it("cannot read or change another tenant's MARKUPS; a markup hangs off this tenant's job, sheet and punch item; the kind, the colour, the words and the shape are checked; a punch item cleared sets the pin's key null and nothing else; the markups go with the sheet and with the job", async () => {
    const docA = await withSystem(async (tx) => {
      const r = await tx
        .insert(schema.documents)
        .values({
          tenantId: tenantA,
          origin: "dms",
          blobPathname: `docs/${tenantA}/files/${STAMP}-markups.pdf`,
          fileName: "markups.pdf",
          mimeType: "application/pdf",
          sizeBytes: 10,
          sha256: `${STAMP}-${tenantA}-markups`,
          effectiveVisibility: "members",
        })
        .returning();
      return r[0].id;
    });
    const setId = await withSystem(async (tx) => {
      const r = await tx.insert(schema.jobDrawingSets).values({ tenantId: tenantA, projectId: projectA, name: "Markup set", issuedOn: "2026-06-01" }).returning();
      return r[0].id;
    });
    const sheetId = await withSystem(async (tx) => {
      const r = await tx.insert(schema.jobSheets).values({ tenantId: tenantA, projectId: projectA, setId, documentId: docA, pageNumber: 1, sheetNumber: "M-101" }).returning();
      return r[0].id;
    });
    // A punch item of each tenant, through the pack's own verb so the list is provisioned as it would be.
    const punchA = await asOwner((tx) => addPunchItem(tx, { tenantId: tenantA, userId: OWNER, role: "owner" }, projectA, { title: "Tenant A's pin" }));
    const punchB = await asOtherTenant((tx) => addPunchItem(tx, { tenantId: tenantB, userId: OTHER, role: "owner" }, projectB, { title: "Tenant B's pin" }));
    const base = { tenantId: tenantA, projectId: projectA, sheetId, kind: "pin", geometry: { x: 0.5, y: 0.5 }, text: "Fix it" } as const;
    const markupId = await withSystem(async (tx) => {
      const r = await tx.insert(schema.jobSheetMarkups).values({ ...base, workItemId: punchA }).returning();
      return r[0].id;
    });
    const seen = await asOtherTenant(async (tx) => ({
      rows: await tx.select().from(schema.jobSheetMarkups).where(eq(schema.jobSheetMarkups.id, markupId)),
      changed: await tx.update(schema.jobSheetMarkups).set({ text: "Theirs" }).where(eq(schema.jobSheetMarkups.id, markupId)).returning(),
    }));
    expect([seen.rows, seen.changed]).toEqual([[], []]);
    expect(await asStaff((tx) => tx.select().from(schema.jobSheetMarkups).where(eq(schema.jobSheetMarkups.id, markupId)))).toHaveLength(1);

    // Tenant B's job, sheet or punch item under tenant A's row: unrepresentable.
    const setB = await withSystem(async (tx) => {
      const r = await tx.insert(schema.jobDrawingSets).values({ tenantId: tenantB, projectId: projectB, name: "Theirs", issuedOn: "2026-06-01" }).returning();
      return r[0].id;
    });
    const docB = await withSystem(async (tx) => {
      const r = await tx
        .insert(schema.documents)
        .values({
          tenantId: tenantB,
          origin: "dms",
          blobPathname: `docs/${tenantB}/files/${STAMP}-markups-b.pdf`,
          fileName: "markups-b.pdf",
          mimeType: "application/pdf",
          sizeBytes: 10,
          sha256: `${STAMP}-${tenantB}-markups`,
          effectiveVisibility: "members",
        })
        .returning();
      return r[0].id;
    });
    const sheetB = await withSystem(async (tx) => {
      const r = await tx.insert(schema.jobSheets).values({ tenantId: tenantB, projectId: projectB, setId: setB, documentId: docB, pageNumber: 1, sheetNumber: "M-101" }).returning();
      return r[0].id;
    });
    await expect(withSystem((tx) => tx.insert(schema.jobSheetMarkups).values({ ...base, projectId: projectB }))).rejects.toThrow();
    await expect(withSystem((tx) => tx.insert(schema.jobSheetMarkups).values({ ...base, sheetId: sheetB }))).rejects.toThrow();
    await expect(withSystem((tx) => tx.insert(schema.jobSheetMarkups).values({ ...base, workItemId: punchB }))).rejects.toThrow();
    // The CHECKs.
    await expect(withSystem((tx) => tx.insert(schema.jobSheetMarkups).values({ ...base, kind: "scribble" }))).rejects.toThrow();
    await expect(withSystem((tx) => tx.insert(schema.jobSheetMarkups).values({ ...base, color: "pink" }))).rejects.toThrow();
    await expect(withSystem((tx) => tx.insert(schema.jobSheetMarkups).values({ ...base, text: "  " }))).rejects.toThrow();
    await expect(withSystem((tx) => tx.insert(schema.jobSheetMarkups).values({ ...base, kind: "text", text: "" }))).rejects.toThrow();
    await expect(withSystem((tx) => tx.insert(schema.jobSheetMarkups).values({ ...base, geometry: [0.5, 0.5] }))).rejects.toThrow();
    await expect(withSystem((tx) => tx.insert(schema.jobSheetMarkups).values({ ...base, text: "x".repeat(2001) }))).rejects.toThrow();
    // A cloud carries no words and is fine without them.
    const cloudId = await withSystem(async (tx) => {
      const r = await tx.insert(schema.jobSheetMarkups).values({ ...base, kind: "cloud", geometry: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 }, text: "" }).returning();
      return r[0].id;
    });

    // The punch item cleared: the pin's key is null and the pin is still there.
    await withSystem((tx) => tx.delete(schema.workItems).where(eq(schema.workItems.id, punchA)));
    const after = await withSystem((tx) => tx.select().from(schema.jobSheetMarkups).where(eq(schema.jobSheetMarkups.id, markupId)));
    expect(after).toHaveLength(1);
    expect([after[0].workItemId, after[0].tenantId, after[0].text]).toEqual([null, tenantA, "Fix it"]);
    // The sheet gone takes its markups; the job gone takes both.
    await withSystem((tx) => tx.delete(schema.jobSheets).where(eq(schema.jobSheets.id, sheetId)));
    expect(await withSystem((tx) => tx.select().from(schema.jobSheetMarkups).where(inArray(schema.jobSheetMarkups.id, [markupId, cloudId])))).toEqual([]);
    const scratch = await withSystem(async (tx) => {
      const p = await tx.insert(schema.jobProjects).values({ tenantId: tenantA, entityId: entityA, number: `${STAMP}-MK`, name: "Goes with the job" }).returning();
      const set = await tx.insert(schema.jobDrawingSets).values({ tenantId: tenantA, projectId: p[0].id, name: "Scratch set", issuedOn: "2026-06-01" }).returning();
      const sh = await tx.insert(schema.jobSheets).values({ tenantId: tenantA, projectId: p[0].id, setId: set[0].id, documentId: docA, pageNumber: 1, sheetNumber: "G-001" }).returning();
      const mk = await tx.insert(schema.jobSheetMarkups).values({ tenantId: tenantA, projectId: p[0].id, sheetId: sh[0].id, kind: "arrow", geometry: { x1: 0.1, y1: 0.1, x2: 0.2, y2: 0.2 } }).returning();
      return { projectId: p[0].id, markupId: mk[0].id };
    });
    await withSystem((tx) => tx.delete(schema.jobProjects).where(eq(schema.jobProjects.id, scratch.projectId)));
    expect(await withSystem((tx) => tx.select().from(schema.jobSheetMarkups).where(eq(schema.jobSheetMarkups.id, scratch.markupId)))).toEqual([]);
    await withSystem(async (tx) => {
      await tx.delete(schema.workItems).where(eq(schema.workItems.id, punchB));
      await tx.delete(schema.jobDrawingSets).where(inArray(schema.jobDrawingSets.id, [setId, setB]));
      await tx.delete(schema.documents).where(inArray(schema.documents.id, [docA, docB]));
    });
  });
  it("cannot point a MEASUREMENT at another tenant's estimate line; the sheet's scale is positive, in feet or metres and whole; a measuring kind is a kind; a line taken off sets the key null and nothing else", async () => {
    const docA = await withSystem(async (tx) => {
      const r = await tx
        .insert(schema.documents)
        .values({
          tenantId: tenantA,
          origin: "dms",
          blobPathname: `docs/${tenantA}/files/${STAMP}-takeoff.pdf`,
          fileName: "takeoff.pdf",
          mimeType: "application/pdf",
          sizeBytes: 10,
          sha256: `${STAMP}-${tenantA}-takeoff`,
          effectiveVisibility: "members",
        })
        .returning();
      return r[0].id;
    });
    const setId = await withSystem(async (tx) => {
      const r = await tx.insert(schema.jobDrawingSets).values({ tenantId: tenantA, projectId: projectA, name: "Takeoff set", issuedOn: "2026-06-01" }).returning();
      return r[0].id;
    });
    const sheetId = await withSystem(async (tx) => {
      const r = await tx.insert(schema.jobSheets).values({ tenantId: tenantA, projectId: projectA, setId, documentId: docA, pageNumber: 1, sheetNumber: "T-101" }).returning();
      return r[0].id;
    });
    // The scale: positive, in feet or metres, and whole — a scale without a page size or a unit is not a scale.
    const whole = { scalePointsPerUnit: 18, scaleUnit: "ft", pageWidthPt: 792, pageHeightPt: 612 };
    await expect(withSystem((tx) => tx.update(schema.jobSheets).set({ ...whole, scalePointsPerUnit: 0 }).where(eq(schema.jobSheets.id, sheetId)))).rejects.toThrow();
    await expect(withSystem((tx) => tx.update(schema.jobSheets).set({ ...whole, scaleUnit: "yd" }).where(eq(schema.jobSheets.id, sheetId)))).rejects.toThrow();
    await expect(withSystem((tx) => tx.update(schema.jobSheets).set({ ...whole, scaleUnit: "" }).where(eq(schema.jobSheets.id, sheetId)))).rejects.toThrow();
    await expect(withSystem((tx) => tx.update(schema.jobSheets).set({ ...whole, pageWidthPt: null }).where(eq(schema.jobSheets.id, sheetId)))).rejects.toThrow();
    await expect(withSystem((tx) => tx.update(schema.jobSheets).set({ scalePointsPerUnit: null, scaleUnit: "ft" }).where(eq(schema.jobSheets.id, sheetId)))).rejects.toThrow();
    await withSystem((tx) => tx.update(schema.jobSheets).set(whole).where(eq(schema.jobSheets.id, sheetId)));
    expect((await asStaff((tx) => tx.select().from(schema.jobSheets).where(eq(schema.jobSheets.id, sheetId))))[0].scaleUnit).toBe("ft");
    expect(await asOtherTenant((tx) => tx.select().from(schema.jobSheets).where(eq(schema.jobSheets.id, sheetId)))).toEqual([]);

    // An estimate line of each tenant.
    const lineFor = async (tenant: string, project: string, number: string) =>
      withSystem(async (tx) => {
        const est = await tx.insert(schema.jobEstimates).values({ tenantId: tenant, projectId: project, number }).returning();
        const line = await tx.insert(schema.jobEstimateLines).values({ tenantId: tenant, estimateId: est[0].id, description: "Flooring" }).returning();
        return { estimateId: est[0].id, lineId: line[0].id };
      });
    const mine = await lineFor(tenantA, projectA, `${STAMP}-EST-A`);
    const theirs = await lineFor(tenantB, projectB, `${STAMP}-EST-B`);
    const base = { tenantId: tenantA, projectId: projectA, sheetId, kind: "area", geometry: { points: [{ x: 0.1, y: 0.1 }, { x: 0.5, y: 0.1 }, { x: 0.5, y: 0.5 }] } } as const;
    await expect(withSystem((tx) => tx.insert(schema.jobSheetMarkups).values({ ...base, estimateLineId: theirs.lineId }))).rejects.toThrow();
    const markupId = await withSystem(async (tx) => {
      const r = await tx.insert(schema.jobSheetMarkups).values({ ...base, estimateLineId: mine.lineId, pushedQuantityThousandths: 93_500 }).returning();
      return r[0].id;
    });
    expect(await asOtherTenant((tx) => tx.select().from(schema.jobSheetMarkups).where(eq(schema.jobSheetMarkups.id, markupId)))).toEqual([]);
    // The measuring kinds are kinds; a made-up one is not.
    await expect(withSystem((tx) => tx.update(schema.jobSheetMarkups).set({ kind: "volume" }).where(eq(schema.jobSheetMarkups.id, markupId)))).rejects.toThrow();
    await withSystem((tx) => tx.update(schema.jobSheetMarkups).set({ kind: "length" }).where(eq(schema.jobSheetMarkups.id, markupId)));
    await withSystem((tx) => tx.update(schema.jobSheetMarkups).set({ kind: "count" }).where(eq(schema.jobSheetMarkups.id, markupId)));
    // The line taken off the estimate: the key is null, the pushed quantity and the measurement remain.
    await withSystem((tx) => tx.delete(schema.jobEstimateLines).where(eq(schema.jobEstimateLines.id, mine.lineId)));
    const after = await withSystem((tx) => tx.select().from(schema.jobSheetMarkups).where(eq(schema.jobSheetMarkups.id, markupId)));
    expect(after).toHaveLength(1);
    expect([after[0].estimateLineId, after[0].pushedQuantityThousandths, after[0].tenantId]).toEqual([null, 93_500, tenantA]);
    await withSystem(async (tx) => {
      await tx.delete(schema.jobEstimates).where(inArray(schema.jobEstimates.id, [mine.estimateId, theirs.estimateId]));
      await tx.delete(schema.jobDrawingSets).where(eq(schema.jobDrawingSets.id, setId));
      await tx.delete(schema.documents).where(eq(schema.documents.id, docA));
    });
  });

  it("cannot read or change another tenant's WARRANTY CLAIMS; a claim hangs off this tenant's job, party, code and work item; a number is once per job and positive, the words present, the decision checked and dated; a work item cleared or a code removed sets the key null and nothing else; the claims go with the job; the job's months are whole", async () => {
    // A work item of each tenant, through the pack's own verb so the list is provisioned as it would be.
    const workA = await asOwner((tx) => addPunchItem(tx, { tenantId: tenantA, userId: OWNER, role: "owner" }, projectA, { title: "Tenant A's claim work" }));
    const workB = await asOtherTenant((tx) => addPunchItem(tx, { tenantId: tenantB, userId: OTHER, role: "owner" }, projectB, { title: "Tenant B's claim work" }));
    const { partyB, codeB, codeX, jobX } = await withSystem(async (tx) => {
      const partyB = await seedParty(tx, tenantB, "Their owner");
      const codes = await tx
        .insert(schema.jobCostCodes)
        .values([
          { tenantId: tenantB, setId: setB, code: "9999", name: "Theirs" },
          { tenantId: tenantA, setId: setA, code: "9998", name: "Warranty work" },
        ])
        .returning();
      const jobs = await tx
        .insert(schema.jobProjects)
        .values({ tenantId: tenantA, entityId: entityA, number: `${STAMP}-WAR`, name: "Warranty job" })
        .returning();
      return { partyB, codeB: codes[0].id, codeX: codes[1].id, jobX: jobs[0].id };
    });
    const base = { tenantId: tenantA, projectId: jobX, number: 1, title: "Drip", reportedOn: "2026-09-10" } as const;
    const claimId = await withSystem(async (tx) => {
      const r = await tx.insert(schema.jobWarrantyClaims).values({ ...base, partyId: clientA, costCodeId: codeX, workItemId: workA }).returning();
      return r[0].id;
    });
    const seen = await asOtherTenant(async (tx) => ({
      rows: await tx.select().from(schema.jobWarrantyClaims).where(eq(schema.jobWarrantyClaims.id, claimId)),
      changed: await tx.update(schema.jobWarrantyClaims).set({ title: "Theirs" }).where(eq(schema.jobWarrantyClaims.id, claimId)).returning(),
    }));
    expect([seen.rows, seen.changed]).toEqual([[], []]);
    expect(await asStaff((tx) => tx.select().from(schema.jobWarrantyClaims).where(eq(schema.jobWarrantyClaims.id, claimId)))).toHaveLength(1);

    // Tenant B's job, party, code or work item under tenant A's row: unrepresentable.
    const insert = (values: Partial<typeof schema.jobWarrantyClaims.$inferInsert>) =>
      withSystem((tx) => tx.insert(schema.jobWarrantyClaims).values({ ...base, number: 7, ...values }));
    await expect(insert({ projectId: projectB })).rejects.toThrow();
    await expect(insert({ partyId: partyB })).rejects.toThrow();
    await expect(insert({ costCodeId: codeB })).rejects.toThrow();
    await expect(insert({ workItemId: workB })).rejects.toThrow();

    // The CHECKs and the unique number.
    await expect(insert({ number: 0 })).rejects.toThrow();
    await expect(insert({ number: 1 })).rejects.toThrow();
    await expect(insert({ title: "   " })).rejects.toThrow();
    await expect(insert({ title: "x".repeat(301) })).rejects.toThrow();
    await expect(insert({ decision: "maybe", decidedOn: "2026-09-11" })).rejects.toThrow();
    await expect(insert({ decision: "covered", decidedOn: null })).rejects.toThrow();
    await expect(insert({ decision: "pending", decidedOn: "2026-09-11" })).rejects.toThrow();
    await expect(insert({ decisionNote: "n".repeat(2001), decision: "covered", decidedOn: "2026-09-11" })).rejects.toThrow();
    await withSystem((tx) => tx.insert(schema.jobWarrantyClaims).values({ ...base, number: 2, decision: "not_covered", decidedOn: "2026-09-11" }));

    // The job's months: whole, from 1 to 1,200, and null passes.
    const setMonths = (months: number | null) => withSystem((tx) => tx.update(schema.jobProjects).set({ warrantyMonths: months }).where(eq(schema.jobProjects.id, jobX)));
    await expect(setMonths(0)).rejects.toThrow();
    await expect(setMonths(1201)).rejects.toThrow();
    await setMonths(12);
    await setMonths(null);

    // A work item cleared, a code removed: each key null, the row and its tenant untouched.
    await withSystem(async (tx) => {
      await tx.delete(schema.workItems).where(eq(schema.workItems.id, workA));
      await tx.delete(schema.jobCostCodes).where(eq(schema.jobCostCodes.id, codeX));
    });
    const after = await withSystem((tx) => tx.select().from(schema.jobWarrantyClaims).where(eq(schema.jobWarrantyClaims.id, claimId)));
    expect(after).toHaveLength(1);
    expect([after[0].workItemId, after[0].costCodeId, after[0].partyId, after[0].title, after[0].tenantId]).toEqual([null, null, clientA, "Drip", tenantA]);

    // The claims go with the job.
    await withSystem((tx) => tx.delete(schema.jobProjects).where(eq(schema.jobProjects.id, jobX)));
    expect(await withSystem((tx) => tx.select().from(schema.jobWarrantyClaims).where(eq(schema.jobWarrantyClaims.projectId, jobX)))).toEqual([]);
    await withSystem(async (tx) => {
      await tx.delete(schema.workItems).where(eq(schema.workItems.id, workB));
      await tx.delete(schema.jobCostCodes).where(eq(schema.jobCostCodes.id, codeB));
    });
  });

  it("cannot read or change another tenant's BACK-CHARGES; one hangs off this tenant's order, code, warranty claim and application; a number is once per order and positive, the money more than nothing, the words present, a dropped one off every application; a code, a claim or a DRAFT application gone sets that key null and nothing else; the back-charges go with the order", async () => {
    const { mine, theirs, codeX, claimX, appX, claimB, codeB } = await withSystem(async (tx) => {
      const partyB = await seedParty(tx, tenantB, "Their sub");
      const commitments = await tx
        .insert(schema.jobCommitments)
        .values([
          { tenantId: tenantA, projectId: projectA, partyId: clientA, number: `${STAMP}-BC-A`, kind: "subcontract", status: "issued" },
          { tenantId: tenantB, projectId: projectB, partyId: partyB, number: `${STAMP}-BC-B`, kind: "subcontract", status: "issued" },
        ])
        .returning();
      const codes = await tx
        .insert(schema.jobCostCodes)
        .values([
          { tenantId: tenantA, setId: setA, code: "8880", name: "Cleaning" },
          { tenantId: tenantB, setId: setB, code: "8881", name: "Theirs" },
        ])
        .returning();
      const claims = await tx
        .insert(schema.jobWarrantyClaims)
        .values([
          { tenantId: tenantA, projectId: projectA, number: 90, title: "Mine", reportedOn: "2026-09-10" },
          { tenantId: tenantB, projectId: projectB, number: 91, title: "Theirs", reportedOn: "2026-09-10" },
        ])
        .returning();
      const apps = await tx
        .insert(schema.jobSubApplications)
        .values([
          { tenantId: tenantA, commitmentId: commitments[0].id, number: 1, periodTo: "2026-09-30" },
          { tenantId: tenantB, commitmentId: commitments[1].id, number: 1, periodTo: "2026-09-30" },
        ])
        .returning();
      return {
        mine: commitments[0].id,
        theirs: commitments[1].id,
        codeX: codes[0].id,
        codeB: codes[1].id,
        claimX: claims[0].id,
        claimB: claims[1].id,
        appX: apps[0].id,
        appB: apps[1].id,
        partyB,
      };
    });
    const base = { tenantId: tenantA, commitmentId: mine, number: 1, description: "Cleaned up", amountCents: 80_000, incurredOn: "2026-09-20" } as const;
    const id = await withSystem(async (tx) => {
      const r = await tx.insert(schema.jobBackCharges).values({ ...base, costCodeId: codeX, warrantyClaimId: claimX, subApplicationId: appX }).returning();
      return r[0].id;
    });
    const seen = await asOtherTenant(async (tx) => ({
      rows: await tx.select().from(schema.jobBackCharges).where(eq(schema.jobBackCharges.id, id)),
      changed: await tx.update(schema.jobBackCharges).set({ amountCents: 1 }).where(eq(schema.jobBackCharges.id, id)).returning(),
    }));
    expect([seen.rows, seen.changed]).toEqual([[], []]);
    expect(await asStaff((tx) => tx.select().from(schema.jobBackCharges).where(eq(schema.jobBackCharges.id, id)))).toHaveLength(1);

    // Tenant B's order, code, claim or application under tenant A's row: unrepresentable.
    const insert = (values: Partial<typeof schema.jobBackCharges.$inferInsert>) =>
      withSystem((tx) => tx.insert(schema.jobBackCharges).values({ ...base, number: 7, ...values }));
    await expect(insert({ commitmentId: theirs })).rejects.toThrow();
    await expect(insert({ costCodeId: codeB })).rejects.toThrow();
    await expect(insert({ warrantyClaimId: claimB })).rejects.toThrow();

    // The CHECKs and the unique number.
    await expect(insert({ number: 0 })).rejects.toThrow();
    await expect(insert({ number: 1 })).rejects.toThrow();
    await expect(insert({ amountCents: 0 })).rejects.toThrow();
    await expect(insert({ amountCents: -1 })).rejects.toThrow();
    await expect(insert({ description: "   " })).rejects.toThrow();
    await expect(insert({ description: "x".repeat(301) })).rejects.toThrow();
    await expect(insert({ status: "deducted" })).rejects.toThrow();
    // A dropped back-charge riding an application is the one state the table refuses outright.
    await expect(insert({ status: "void", subApplicationId: appX })).rejects.toThrow();
    await withSystem((tx) => tx.insert(schema.jobBackCharges).values({ ...base, number: 2, status: "void" }));

    // The code, the claim and the DRAFT application gone: each key null, the money and the tenant untouched.
    await withSystem(async (tx) => {
      await tx.delete(schema.jobCostCodes).where(eq(schema.jobCostCodes.id, codeX));
      await tx.delete(schema.jobWarrantyClaims).where(eq(schema.jobWarrantyClaims.id, claimX));
      await tx.delete(schema.jobSubApplications).where(eq(schema.jobSubApplications.id, appX));
    });
    const after = await withSystem((tx) => tx.select().from(schema.jobBackCharges).where(eq(schema.jobBackCharges.id, id)));
    expect(after).toHaveLength(1);
    expect([after[0].costCodeId, after[0].warrantyClaimId, after[0].subApplicationId, after[0].amountCents, after[0].tenantId]).toEqual([
      null,
      null,
      null,
      80_000,
      tenantA,
    ]);

    // The back-charges go with the order.
    await withSystem((tx) => tx.delete(schema.jobCommitments).where(eq(schema.jobCommitments.id, mine)));
    expect(await withSystem((tx) => tx.select().from(schema.jobBackCharges).where(eq(schema.jobBackCharges.commitmentId, mine)))).toEqual([]);
    await withSystem(async (tx) => {
      await tx.delete(schema.jobCommitments).where(eq(schema.jobCommitments.id, theirs));
      await tx.delete(schema.jobWarrantyClaims).where(eq(schema.jobWarrantyClaims.id, claimB));
      await tx.delete(schema.jobCostCodes).where(eq(schema.jobCostCodes.id, codeB));
    });
  }, 120_000);

  it("cannot read or change another tenant's BONDS or BONDING LINE; a bond hangs off this tenant's job, contract, surety and code and a line off this tenant's company; the kind's format, the money, the dates and the limits are checked; one line per company; a contract or a code gone sets that key null and nothing else; the bonds go with the job", async () => {
    const { mine, theirs, contractX, codeX, suretyB, contractB, codeB } = await withSystem(async (tx) => {
      const suretyB = await seedParty(tx, tenantB, "Their surety");
      const codes = await tx
        .insert(schema.jobCostCodes)
        .values([
          { tenantId: tenantA, setId: setA, code: "7770", name: "Bonds" },
          { tenantId: tenantB, setId: setB, code: "7771", name: "Theirs" },
        ])
        .returning();
      const jobs = await tx
        .insert(schema.jobProjects)
        .values({ tenantId: tenantA, entityId: entityA, number: `${STAMP}-BOND`, name: "Bonded" })
        .returning();
      const contracts = await tx
        .insert(schema.jobContracts)
        .values([
          { tenantId: tenantA, projectId: jobs[0].id, kind: "new_home", valueCents: 100_000 },
          { tenantId: tenantB, projectId: projectB, kind: "new_home", valueCents: 100_000 },
        ])
        .returning();
      return { mine: jobs[0].id, theirs: projectB, contractX: contracts[0].id, contractB: contracts[1].id, codeX: codes[0].id, codeB: codes[1].id, suretyB };
    });
    const base = { tenantId: tenantA, projectId: mine, kind: "performance", penalSumCents: 100_000, status: "issued", effectiveOn: "2026-03-01" } as const;
    const id = await withSystem(async (tx) => {
      const r = await tx.insert(schema.jobBonds).values({ ...base, contractId: contractX, costCodeId: codeX, suretyPartyId: clientA }).returning();
      return r[0].id;
    });
    const seen = await asOtherTenant(async (tx) => ({
      rows: await tx.select().from(schema.jobBonds).where(eq(schema.jobBonds.id, id)),
      changed: await tx.update(schema.jobBonds).set({ penalSumCents: 1 }).where(eq(schema.jobBonds.id, id)).returning(),
    }));
    expect([seen.rows, seen.changed]).toEqual([[], []]);
    expect(await asStaff((tx) => tx.select().from(schema.jobBonds).where(eq(schema.jobBonds.id, id)))).toHaveLength(1);

    // Tenant B's job, contract, code or surety under tenant A's row: unrepresentable.
    const insert = (values: Partial<typeof schema.jobBonds.$inferInsert>) =>
      withSystem((tx) => tx.insert(schema.jobBonds).values({ ...base, ...values }));
    await expect(insert({ projectId: theirs })).rejects.toThrow();
    await expect(insert({ contractId: contractB })).rejects.toThrow();
    await expect(insert({ costCodeId: codeB })).rejects.toThrow();
    await expect(insert({ suretyPartyId: suretyB })).rejects.toThrow();

    // The CHECKs.
    await expect(insert({ kind: "Performance" })).rejects.toThrow();
    await expect(insert({ kind: "" })).rejects.toThrow();
    await expect(insert({ penalSumCents: 0 })).rejects.toThrow();
    await expect(insert({ premiumCents: -1 })).rejects.toThrow();
    await expect(insert({ status: "active" })).rejects.toThrow();
    // In force with no day it took effect, released with no release, and an expiry before the start.
    await expect(insert({ status: "issued", effectiveOn: null })).rejects.toThrow();
    await expect(insert({ status: "released", releasedOn: null })).rejects.toThrow();
    await expect(insert({ status: "issued", releasedOn: "2026-04-01" })).rejects.toThrow();
    await expect(insert({ expiresOn: "2026-02-01" })).rejects.toThrow();
    // Asked for, with no dates at all: the ordinary start.
    await withSystem((tx) => tx.insert(schema.jobBonds).values({ ...base, status: "requested", effectiveOn: null }));

    // THE LINE: one per company, the limits positive, and single inside aggregate.
    const lineInsert = (values: Partial<typeof schema.jobBondingLines.$inferInsert>) =>
      withSystem((tx) => tx.insert(schema.jobBondingLines).values({ tenantId: tenantA, entityId: entityA, ...values }));
    await expect(lineInsert({ singleJobLimitCents: 0 })).rejects.toThrow();
    await expect(lineInsert({ aggregateLimitCents: 0 })).rejects.toThrow();
    await expect(lineInsert({ singleJobLimitCents: 600_000, aggregateLimitCents: 500_000 })).rejects.toThrow();
    await lineInsert({ singleJobLimitCents: 100_000, aggregateLimitCents: 500_000 });
    await expect(lineInsert({ aggregateLimitCents: 900_000 })).rejects.toThrow();
    // Tenant B's company under tenant A's line: unrepresentable, and their line is theirs.
    await expect(withSystem((tx) => tx.insert(schema.jobBondingLines).values({ tenantId: tenantA, entityId: entityB }))).rejects.toThrow();
    const theirLine = await withSystem(async (tx) => {
      const r = await tx.insert(schema.jobBondingLines).values({ tenantId: tenantB, entityId: entityB, aggregateLimitCents: 1 }).returning();
      return r[0].id;
    });
    expect(await asStaff((tx) => tx.select().from(schema.jobBondingLines).where(eq(schema.jobBondingLines.id, theirLine)))).toEqual([]);

    // The contract and the code gone: each key null, the money and the tenant untouched.
    await withSystem(async (tx) => {
      await tx.delete(schema.jobContracts).where(eq(schema.jobContracts.id, contractX));
      await tx.delete(schema.jobCostCodes).where(eq(schema.jobCostCodes.id, codeX));
    });
    const after = await withSystem((tx) => tx.select().from(schema.jobBonds).where(eq(schema.jobBonds.id, id)));
    expect(after).toHaveLength(1);
    expect([after[0].contractId, after[0].costCodeId, after[0].penalSumCents, after[0].tenantId]).toEqual([null, null, 100_000, tenantA]);

    // The bonds go with the job.
    await withSystem((tx) => tx.delete(schema.jobProjects).where(eq(schema.jobProjects.id, mine)));
    expect(await withSystem((tx) => tx.select().from(schema.jobBonds).where(eq(schema.jobBonds.projectId, mine)))).toEqual([]);
    await withSystem(async (tx) => {
      await tx.delete(schema.jobBondingLines).where(eq(schema.jobBondingLines.tenantId, tenantA));
      await tx.delete(schema.jobBondingLines).where(eq(schema.jobBondingLines.id, theirLine));
      await tx.delete(schema.jobContracts).where(eq(schema.jobContracts.id, contractB));
      await tx.delete(schema.jobCostCodes).where(eq(schema.jobCostCodes.id, codeB));
    });
  }, 120_000);

  it("cannot read or change another tenant's MEASUREMENTS or another outline's MEASURE LIST; one number per name per building; a row carries a value or a pass; and a deleted sheet does not take the number with it", async () => {
    // ── the outline's list ────────────────────────────────────────────────
    const outline = await withSystem(async (tx) => {
      const rows = await tx
        .insert(schema.jobEstimateOutlines)
        .values({ tenantId: tenantA, name: `Measured ${STAMP}` })
        .returning();
      return rows[0].id;
    });
    const declared = await withSystem(async (tx) => {
      const rows = await tx
        .insert(schema.jobEstimateOutlineMeasures)
        .values({ tenantId: tenantA, outlineId: outline, name: "Perimeter", unit: "lf", kind: "length" })
        .returning();
      return rows[0].id;
    });
    expect(
      await asOtherTenant((tx) =>
        tx.select().from(schema.jobEstimateOutlineMeasures).where(eq(schema.jobEstimateOutlineMeasures.id, declared)),
      ),
    ).toEqual([]);

    // A kind the pack does not have, and a nameless one: both refused.
    await expect(
      withSystem((tx) =>
        tx.insert(schema.jobEstimateOutlineMeasures).values({ tenantId: tenantA, outlineId: outline, name: "Volume", kind: "volume" }),
      ),
    ).rejects.toThrow();
    await expect(
      withSystem((tx) =>
        tx.insert(schema.jobEstimateOutlineMeasures).values({ tenantId: tenantA, outlineId: outline, name: "   " }),
      ),
    ).rejects.toThrow();
    // Tenant B's outline under tenant A's measure: unrepresentable.
    const theirOutline = await withSystem(async (tx) => {
      const rows = await tx
        .insert(schema.jobEstimateOutlines)
        .values({ tenantId: tenantB, name: `Theirs ${STAMP}` })
        .returning();
      return rows[0].id;
    });
    await expect(
      withSystem((tx) =>
        tx.insert(schema.jobEstimateOutlineMeasures).values({ tenantId: tenantA, outlineId: theirOutline, name: "Perimeter" }),
      ),
    ).rejects.toThrow();

    // ── the building's numbers ────────────────────────────────────────────
    const taken = await withSystem(async (tx) => {
      const rows = await tx
        .insert(schema.jobMeasurements)
        .values({
          tenantId: tenantA,
          projectId: projectA,
          name: "Perimeter",
          slug: "perimeter",
          unit: "lf",
          valueThousandths: 248_000,
        })
        .returning();
      return rows[0].id;
    });
    const seen = await asOtherTenant(async (tx) => ({
      rows: await tx.select().from(schema.jobMeasurements).where(eq(schema.jobMeasurements.id, taken)),
      changed: await tx
        .update(schema.jobMeasurements)
        .set({ valueThousandths: 1 })
        .where(eq(schema.jobMeasurements.id, taken))
        .returning(),
    }));
    expect(seen.rows).toEqual([]);
    expect(seen.changed).toEqual([]);
    expect(
      await withSystem((tx) => tx.select().from(schema.jobMeasurements).where(eq(schema.jobMeasurements.id, taken))),
    ).toHaveLength(1);

    // ONE NUMBER PER NAME PER BUILDING, refused by the database.
    await expect(
      withSystem((tx) =>
        tx.insert(schema.jobMeasurements).values({
          tenantId: tenantA,
          projectId: projectA,
          name: "Perimeter",
          slug: "perimeter",
          valueThousandths: 1,
        }),
      ),
    ).rejects.toThrow();
    // The same name on ANOTHER building is a different fact and is allowed.
    const second = await withSystem(async (tx) => {
      const rows = await tx
        .insert(schema.jobProjects)
        .values({ tenantId: tenantA, entityId: entityA, number: `${STAMP}-M2`, name: "Second house" })
        .returning();
      return rows[0].id;
    });
    const elsewhere = await withSystem(async (tx) => {
      const rows = await tx
        .insert(schema.jobMeasurements)
        .values({ tenantId: tenantA, projectId: second, name: "Perimeter", slug: "perimeter", valueThousandths: 2 })
        .returning();
      return rows[0].id;
    });
    expect(elsewhere).toBeTruthy();
    // Tenant B's job under tenant A's measurement: unrepresentable.
    await expect(
      withSystem((tx) =>
        tx.insert(schema.jobMeasurements).values({
          tenantId: tenantA,
          projectId: projectB,
          name: "Perimeter",
          slug: "perimeter",
          valueThousandths: 1,
        }),
      ),
    ).rejects.toThrow();

    // A VALUE OR A PASS, NEVER NEITHER: a row that answers nothing is a question.
    await expect(
      withSystem((tx) =>
        tx.insert(schema.jobMeasurements).values({ tenantId: tenantA, projectId: projectA, name: "Roof", slug: "roof" }),
      ),
    ).rejects.toThrow();
    const passed = await withSystem(async (tx) => {
      const rows = await tx
        .insert(schema.jobMeasurements)
        .values({ tenantId: tenantA, projectId: projectA, name: "Roof", slug: "roof", passedAt: new Date() })
        .returning();
      return rows[0];
    });
    expect([passed.valueThousandths, passed.passedAt === null]).toEqual([null, false]);
    // An unknown source is refused.
    await expect(
      withSystem((tx) =>
        tx.insert(schema.jobMeasurements).values({
          tenantId: tenantA,
          projectId: projectA,
          name: "Deck",
          slug: "deck",
          valueThousandths: 1,
          source: "guessed",
        }),
      ),
    ).rejects.toThrow();

    // ── the trace can go; the number cannot ───────────────────────────────
    const sheet = await withSystem(async (tx) => {
      const doc = await tx
        .insert(schema.documents)
        .values({
          tenantId: tenantA,
          origin: "dms",
          blobPathname: `docs/${tenantA}/files/${STAMP}-measured.pdf`,
          fileName: "measured.pdf",
          mimeType: "application/pdf",
          sizeBytes: 10,
          sha256: `${STAMP}-measured`,
          effectiveVisibility: "members",
        })
        .returning();
      const set = await tx
        .insert(schema.jobDrawingSets)
        .values({ tenantId: tenantA, projectId: projectA, name: `Measured ${STAMP}`, issuedOn: "2026-06-01" })
        .returning();
      const rows = await tx
        .insert(schema.jobSheets)
        .values({
          tenantId: tenantA,
          projectId: projectA,
          setId: set[0].id,
          documentId: doc[0].id,
          pageNumber: 1,
          sheetNumber: `M-${STAMP}`,
        })
        .returning();
      return rows[0].id;
    });
    await withSystem((tx) =>
      tx.update(schema.jobMeasurements).set({ sheetId: sheet, source: "measured" }).where(eq(schema.jobMeasurements.id, taken)),
    );
    await withSystem((tx) => tx.delete(schema.jobSheets).where(eq(schema.jobSheets.id, sheet)));
    const after = await withSystem((tx) =>
      tx.select().from(schema.jobMeasurements).where(eq(schema.jobMeasurements.id, taken)),
    );
    /**
     * **SET NULL ON A COMPOSITE FK IS THE COLUMN-LIST FORM OR IT NEVER
     * RUNS.** A bare one would try to null `tenant_id` too and the delete
     * above would have thrown. The number was true when it was taken;
     * losing the trace loses the provenance, not the fact.
     */
    expect([after[0].sheetId, after[0].valueThousandths, after[0].tenantId]).toEqual([
      null,
      248_000,
      tenantA,
    ]);

    // The numbers go with the job, and the list goes with the outline.
    await withSystem((tx) => tx.delete(schema.jobEstimateOutlines).where(eq(schema.jobEstimateOutlines.id, outline)));
    expect(
      await withSystem((tx) =>
        tx.select().from(schema.jobEstimateOutlineMeasures).where(eq(schema.jobEstimateOutlineMeasures.id, declared)),
      ),
    ).toEqual([]);
    await withSystem(async (tx) => {
      await tx.delete(schema.jobEstimateOutlines).where(eq(schema.jobEstimateOutlines.id, theirOutline));
      await tx.delete(schema.jobMeasurements).where(eq(schema.jobMeasurements.projectId, projectA));
      await tx.delete(schema.jobProjects).where(eq(schema.jobProjects.id, second));
    });
  }, 120_000);

  it("cannot read or change another tenant's ROOMS; a room is unique per FLOOR not per building; a room's area is a measurement scoped to it; and the area goes when the room does", async () => {
    const mine = await withSystem(async (tx) => {
      const rows = await tx
        .insert(schema.jobRooms)
        .values({
          tenantId: tenantA,
          projectId: projectA,
          name: "Master bath",
          slug: "master-bath",
          level: "Upstairs",
        })
        .returning();
      return rows[0].id;
    });

    // Tenant B sees none of it and changes none of it.
    const seen = await asOtherTenant(async (tx) => ({
      rows: await tx.select().from(schema.jobRooms).where(eq(schema.jobRooms.id, mine)),
      changed: await tx
        .update(schema.jobRooms)
        .set({ name: "theirs" })
        .where(eq(schema.jobRooms.id, mine))
        .returning(),
    }));
    expect([seen.rows, seen.changed]).toEqual([[], []]);

    /**
     * **THE SAME NAME ON TWO FLOORS IS TWO ROOMS**, which is what a house
     * is. Keying a room on (tenant, project, slug) refused the second one.
     */
    const downstairs = await withSystem(async (tx) => {
      const rows = await tx
        .insert(schema.jobRooms)
        .values({
          tenantId: tenantA,
          projectId: projectA,
          name: "Master bath",
          slug: "master-bath",
          level: "Main floor",
        })
        .returning();
      return rows[0].id;
    });
    expect(downstairs).toBeTruthy();
    // But twice on ONE floor is refused.
    await expect(
      withSystem((tx) =>
        tx.insert(schema.jobRooms).values({
          tenantId: tenantA,
          projectId: projectA,
          name: "Master bath",
          slug: "master-bath",
          level: "Upstairs",
        }),
      ),
    ).rejects.toThrow();
    await expect(
      withSystem((tx) =>
        tx.insert(schema.jobRooms).values({
          tenantId: tenantA,
          projectId: projectA,
          name: "   ",
          slug: "x",
        }),
      ),
    ).rejects.toThrow();
    // Tenant B's job under tenant A's room: unrepresentable.
    await expect(
      withSystem((tx) =>
        tx.insert(schema.jobRooms).values({
          tenantId: tenantA,
          projectId: projectB,
          name: "Theirs",
          slug: "theirs",
        }),
      ),
    ).rejects.toThrow();

    /**
     * **A ROOM'S AREA IS AN ORDINARY MEASUREMENT SCOPED TO IT** (X8), which
     * is what lets it be parsed, traced and passed by the machinery X7
     * already has. The unique index is PARTIAL — one per room, one per
     * building — because a plain unique over a nullable `room_id` would
     * treat every building-level NULL as distinct and let them duplicate.
     */
    const area = await withSystem(async (tx) => {
      const rows = await tx
        .insert(schema.jobMeasurements)
        .values({
          tenantId: tenantA,
          projectId: projectA,
          roomId: mine,
          name: "Floor area",
          slug: "floor-area",
          unit: "sf",
          valueThousandths: 62_000,
        })
        .returning();
      return rows[0].id;
    });
    // The same measurement twice on ONE room is refused...
    await expect(
      withSystem((tx) =>
        tx.insert(schema.jobMeasurements).values({
          tenantId: tenantA,
          projectId: projectA,
          roomId: mine,
          name: "Floor area",
          slug: "floor-area",
          valueThousandths: 1,
        }),
      ),
    ).rejects.toThrow();
    // ...and so is the same one twice on the BUILDING, which is the half a
    // plain unique index over a nullable column would have let through.
    await withSystem((tx) =>
      tx.insert(schema.jobMeasurements).values({
        tenantId: tenantA,
        projectId: projectA,
        name: "Floor area",
        slug: "floor-area",
        valueThousandths: 2_400_000,
      }),
    );
    await expect(
      withSystem((tx) =>
        tx.insert(schema.jobMeasurements).values({
          tenantId: tenantA,
          projectId: projectA,
          name: "Floor area",
          slug: "floor-area",
          valueThousandths: 9,
        }),
      ),
    ).rejects.toThrow();
    // But the same name on ANOTHER room is a different fact.
    await withSystem((tx) =>
      tx.insert(schema.jobMeasurements).values({
        tenantId: tenantA,
        projectId: projectA,
        roomId: downstairs,
        name: "Floor area",
        slug: "floor-area",
        valueThousandths: 24_000,
      }),
    );

    // The area belonged to the room: it goes when the room does.
    await withSystem((tx) => tx.delete(schema.jobRooms).where(eq(schema.jobRooms.id, mine)));
    expect(
      await withSystem((tx) =>
        tx.select().from(schema.jobMeasurements).where(eq(schema.jobMeasurements.id, area)),
      ),
    ).toEqual([]);

    // And the rooms go with the job.
    await withSystem(async (tx) => {
      await tx.delete(schema.jobRooms).where(eq(schema.jobRooms.id, downstairs));
      await tx.delete(schema.jobMeasurements).where(eq(schema.jobMeasurements.projectId, projectA));
    });
  }, 120_000);
});
