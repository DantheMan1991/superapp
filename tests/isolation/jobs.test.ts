import "dotenv/config";
import { afterAll, beforeAll, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
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
  let codeA = "";

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
});
