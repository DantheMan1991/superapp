import "dotenv/config";
import { afterAll, beforeAll, expect, it } from "vitest";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { withSystem, withTenant, schema, type Tx } from "../../src/db";
import { d, seedParty } from "./_shared";

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
});
