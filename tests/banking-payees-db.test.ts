import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { schema, withSystem, withTenant, type Tx } from "../src/db";
import { provisionAccounting } from "../src/modules/accounting/templates/apply";
import { createBankAccount } from "../src/modules/accounting/banking/accounts";
import {
  listRegisterPayees,
  nameRegisterPayees,
} from "../src/modules/accounting/banking/payees";
import { createVendor, listVendors } from "../src/modules/accounting/payables/vendors";

/**
 * Vendors from a register's payees (onboarding slice 2b), as an owner through
 * real RLS.
 *
 * What this file certifies: the payees a statement names, with the rows each
 * covers and the vendor it already matches; that set-aside and already-named
 * rows are left out of the question; that naming one creates the vendor
 * through the module's own verb and labels exactly the rows it was counted
 * from; that a stale phrase is skipped rather than guessed at; and that only
 * an owner may do it.
 */
const RUN = !!process.env.DATABASE_URL;
const d = RUN ? describe : describe.skip;

d("vendors from a register's payees", () => {
  const STAMP = `payees-${process.pid}`;
  const OWNER = `${STAMP}-owner`;
  const STAFF = `${STAMP}-staff`;

  let tenantId: string;
  let registerId: string;

  const ctx = (role: "owner" | "staff" = "owner") => ({
    tenantId,
    userId: role === "owner" ? OWNER : STAFF,
    role,
  });
  const asOwner = <T,>(fn: (tx: Tx) => Promise<T>) =>
    withTenant(tenantId, fn, { role: "owner", userId: OWNER });

  /** One staged row, as an import would leave it. */
  const stage = (
    description: string,
    amountCents: number,
    over: { status?: "unreviewed" | "excluded"; vendorId?: string } = {},
  ) =>
    asOwner((tx) =>
      tx.insert(schema.bankTransactions).values({
        tenantId,
        bankAccountId: registerId,
        txnDate: "2026-02-10",
        description,
        amountCents,
        externalHash: `${description}-${amountCents}-${Math.random()}`,
        status: over.status ?? "unreviewed",
        vendorId: over.vendorId ?? null,
      }),
    );

  const payees = () => asOwner((tx) => listRegisterPayees(tx, tenantId, registerId));

  beforeAll(async () => {
    await withSystem(async (tx) => {
      const [tenant] = await tx
        .insert(schema.tenants)
        .values({ clerkOrgId: STAMP, name: "Payee Farm", slug: STAMP })
        .returning();
      tenantId = tenant.id;
      await tx
        .insert(schema.tenantModules)
        .values([{ tenantId, moduleId: "accounting", enabled: true }])
        .onConflictDoNothing();
    });
    await asOwner(async (tx) => {
      await provisionAccounting(tx, tenantId);
      const created = await createBankAccount(tx, ctx(), {
        name: "Farm Checking",
        kind: "checking",
      });
      registerId = created.bankAccount.id;
    });
  });

  afterAll(async () => {
    await withSystem(async (tx) => {
      await tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantId));
    });
  });

  it("names the payees a statement holds, and leaves out what is not a question", async () => {
    await stage("TRACTOR SUPPLY 8821", -6_420);
    await stage("TRACTOR SUPPLY 0412", -3_875);
    await stage("RURAL KING FEED", -11_240);
    // Money in is a customer, not a payee.
    await stage("FARMERS MARKET DEPOSIT", 14_500);
    // Set aside as personal (ADR 0034): deliberately not the business's.
    await stage("KROGER 0412", -3_875, { status: "excluded" });

    const found = await payees();
    expect(found.map((p) => [p.label, p.count, p.totalCents])).toEqual([
      ["Rural King Feed", 1, 11_240],
      ["Tractor Supply", 2, 10_295],
    ]);
    expect(found.every((p) => p.existingVendorId === null)).toBe(true);
  });

  it("says when a payee is somebody already on file", async () => {
    const existing = await asOwner((tx) =>
      createVendor(tx, ctx(), { name: "Rural King" }),
    );
    const found = await payees();
    const rural = found.find((p) => p.phrase === "rural king feed")!;
    expect(rural).toMatchObject({
      existingVendorId: existing.id,
      existingVendorName: "Rural King",
    });
    // The other one is still nobody's.
    expect(found.find((p) => p.phrase === "tractor supply")!.existingVendorId).toBeNull();
  });

  it("creates the vendor through the module's verb and names exactly the rows it counted", async () => {
    const result = await asOwner((tx) =>
      nameRegisterPayees(tx, ctx(), {
        bankAccountId: registerId,
        picks: [{ phrase: "tractor supply", name: "Tractor Supply Co." }],
      }),
    );
    expect(result).toMatchObject({ vendorsCreated: 1, rowsNamed: 2 });

    const vendor = (await asOwner((tx) => listVendors(tx, tenantId, {}))).find(
      (v) => v.name === "Tractor Supply Co.",
    )!;
    // A party is born with it, exactly as a typed or pasted vendor's is.
    expect(
      await asOwner((tx) =>
        tx.query.parties.findFirst({ where: eq(schema.parties.id, vendor.partyId) }),
      ),
    ).toBeTruthy();

    const rows = await asOwner((tx) =>
      tx.query.bankTransactions.findMany({
        where: and(
          eq(schema.bankTransactions.tenantId, tenantId),
          eq(schema.bankTransactions.bankAccountId, registerId),
        ),
      }),
    );
    const named = rows.filter((r) => r.vendorId === vendor.id);
    expect(named.map((r) => r.description).sort()).toEqual([
      "TRACTOR SUPPLY 0412",
      "TRACTOR SUPPLY 8821",
    ]);
    // The deposit, the set-aside row and the feed store are untouched.
    expect(rows.filter((r) => r.vendorId === null)).toHaveLength(3);

    // And it is no longer a question.
    expect((await payees()).map((p) => p.phrase)).toEqual(["rural king feed"]);
  });

  it("links to a vendor already on file when asked, rather than making a second one", async () => {
    const before = (await asOwner((tx) => listVendors(tx, tenantId, {}))).length;
    const rural = (await payees()).find((p) => p.phrase === "rural king feed")!;
    const result = await asOwner((tx) =>
      nameRegisterPayees(tx, ctx(), {
        bankAccountId: registerId,
        picks: [{ phrase: rural.phrase, vendorId: rural.existingVendorId! }],
      }),
    );
    expect(result).toMatchObject({ vendorsCreated: 0, rowsNamed: 1, names: ["Rural King"] });
    expect(await asOwner((tx) => listVendors(tx, tenantId, {}))).toHaveLength(before);
    expect(await payees()).toEqual([]);
  });

  it("skips a phrase the register no longer names, and refuses staff", async () => {
    await stage("DOC REYNOLDS VETERINARY", -22_000);
    // A phrase from a list that has gone stale: nothing matches it now.
    const stale = await asOwner((tx) =>
      nameRegisterPayees(tx, ctx(), {
        bankAccountId: registerId,
        picks: [
          { phrase: "orscheln farm", name: "Orscheln" },
          { phrase: "doc reynolds veterinary", name: "Doc Reynolds" },
        ],
      }),
    );
    expect(stale).toMatchObject({ vendorsCreated: 1, rowsNamed: 1, names: ["Doc Reynolds"] });

    await stage("BOONE COUNTY CO-OP", -8_000);
    await expect(
      withTenant(
        tenantId,
        (tx) =>
          nameRegisterPayees(tx, ctx("staff"), {
            bankAccountId: registerId,
            picks: [{ phrase: "boone county", name: "Boone County Co-op" }],
          }),
        { role: "staff", userId: STAFF },
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
