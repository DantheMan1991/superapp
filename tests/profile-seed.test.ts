import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { withSystem, withTenant, schema } from "../src/db";
import { applyProfileSeed, seedSummary } from "../src/app/admin/profile-seed";
import { getIndustryProfile } from "../src/industries";
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
    });
  });

  it("waits for a module that is off, and loses nothing", async () => {
    const report = await applyProfileSeed(tenantId, agency, []);
    expect(report).toEqual({
      accountsCreated: 0,
      foldersCreated: 0,
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

    const first = await applyProfileSeed(tenantId, agency, ["accounting"]);
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
    const again = await applyProfileSeed(tenantId, agency, ["accounting"]);
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
    const report = await applyProfileSeed(tenantId, agency, ["accounting"]);
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
    const first = await applyProfileSeed(tenantId, agency, ["accounting", "documents"]);
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

    const again = await applyProfileSeed(tenantId, agency, ["documents"]);
    expect(again.foldersCreated).toBe(0);
  });
});
