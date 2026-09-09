import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { schema, withSystem, withTenant, type Tx } from "../src/db";
import { collectSetup, enabledSetupSources } from "../src/lib/setup-sources/resolve";
import { provisionAccounting } from "../src/modules/accounting/templates/apply";
import { getDefaultEntityId, setBooksStartOn } from "../src/modules/accounting/core";
import { createBankAccount } from "../src/modules/accounting/banking/accounts";
import { createParty } from "../src/lib/parties";
import { createAsset } from "../src/packs/assets/ops";
import { createItem } from "../src/packs/inventory/ops";
import { createLivestockLot } from "../src/packs/livestock/ops";
import { createParcel } from "../src/packs/land/ops";
import { createChannel, setPrice } from "../src/packs/retail/ops";

/**
 * The real sources, run as an owner through real RLS, the way the Overview
 * runs them.
 *
 * What this file certifies: a fresh business is asked for exactly one thing
 * per tool, in the order the card shows them; every step clears the moment the
 * thing exists and never comes back; the second-order steps (transactions
 * after an account, a place after an asset, prices after a channel) appear
 * only once their prerequisite is met; a switched-off tool contributes
 * nothing; and every guide slug a source names is a file in docs/help — the
 * card links to it blind, so this is the only place that link is checked.
 */
const RUN = !!process.env.DATABASE_URL;
const d = RUN ? describe : describe.skip;

const MODULES = [
  "accounting",
  "crm",
  "email",
  "assets",
  "inventory",
  "livestock",
  "land",
  "retail",
];

d("setup sources", () => {
  const STAMP = `setup-${process.pid}`;
  const OWNER = `${STAMP}-owner`;

  let tenantId: string;

  const ctx = () => ({ tenantId, userId: OWNER, role: "owner" as const });
  const asOwner = <T,>(fn: (tx: Tx) => Promise<T>) =>
    withTenant(tenantId, fn, { role: "owner", userId: OWNER });
  const collect = () => asOwner((tx) => collectSetup(tx, { tenantId }));
  const keys = async () => (await collect()).steps.map((s) => s.key);

  beforeAll(async () => {
    await withSystem(async (tx) => {
      const [tenant] = await tx
        .insert(schema.tenants)
        .values({ clerkOrgId: STAMP, name: "Setup Farm", slug: STAMP })
        .returning();
      tenantId = tenant.id;
      // The ops layer does not require a module to be on — only the actions
      // do — but `enabledSetupSources` does, and that gate is under test.
      await tx
        .insert(schema.tenantModules)
        .values(MODULES.map((moduleId) => ({ tenantId, moduleId, enabled: true })))
        .onConflictDoNothing();
    });
    // The chart and the default company, so a register can be created.
    await asOwner((tx) => provisionAccounting(tx, tenantId));
  });

  afterAll(async () => {
    await withSystem(async (tx) => {
      await tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantId));
    });
  });

  it("a fresh business is asked for one thing per tool, in card order, and every guide named exists", async () => {
    const result = await collect();
    expect(result.complete).toBe(true);
    expect(result.failed).toEqual([]);
    expect(result.steps.map((s) => s.key)).toEqual([
      // The first decision of a conversion comes first (ADR 0035).
      "accounting.books-start",
      "accounting.bank-account",
      "assets.first",
      "inventory.items",
      // Not `inventory.place`: nothing to keep stock in exists yet, and the
      // assets step is already asking for the first one.
      "livestock.animals",
      "land.parcels",
      "retail.channel",
      "crm.people",
      "email.mailbox",
    ]);
    expect(result.steps.map((s) => s.section)).toEqual([
      "Accounting",
      "Accounting",
      "Assets",
      "Inventory",
      "Livestock",
      "Land",
      "Retail",
      "CRM",
      "Mail",
    ]);
    for (const step of result.steps) {
      expect(step.href.startsWith("/dashboard/")).toBe(true);
      if (step.guide) {
        const file = path.resolve(__dirname, "..", "docs", "help", `${step.guide}.md`);
        await expect(fs.access(file)).resolves.toBeUndefined();
      }
    }
  });

  it("money: the register clears the first step and raises the second, which points at that account's import page", async () => {
    await asOwner((tx) =>
      createBankAccount(tx, ctx(), { name: "Farm Checking", kind: "checking" }),
    );
    let result = await collect();
    expect(result.steps.map((s) => s.key)).not.toContain("accounting.bank-account");
    const next = result.steps.find((s) => s.key === "accounting.transactions");
    expect(next).toBeDefined();

    const [account] = await asOwner((tx) =>
      tx
        .select({ id: schema.bankAccounts.id })
        .from(schema.bankAccounts)
        .where(eq(schema.bankAccounts.tenantId, tenantId)),
    );
    // One account: straight to its import page, not to the list.
    expect(next?.href).toBe(`/dashboard/m/accounting/banking/${account.id}/import`);
    expect(next?.guide).toBe("accounting/import-statement");
    await expect(
      fs.access(path.resolve(__dirname, "..", "docs", "help", "accounting", "import-statement.md")),
    ).resolves.toBeUndefined();

    // The first transaction, however it arrives, clears it for good.
    await withSystem((tx) =>
      tx.insert(schema.bankTransactions).values({
        tenantId,
        bankAccountId: account.id,
        txnDate: "2026-01-02",
        amountCents: -4_200,
        description: "RURAL KING",
        externalHash: `${STAMP}-h1`,
      }),
    );
    result = await collect();
    expect(result.steps.map((s) => s.key)).not.toContain("accounting.transactions");
    // The one accounting step left is the day the books begin (ADR 0035);
    // saying it clears the section.
    expect(result.steps.filter((s) => s.section === "Accounting").map((s) => s.key)).toEqual([
      "accounting.books-start",
    ]);
    const entityId = await asOwner((tx) => getDefaultEntityId(tx, tenantId));
    await asOwner((tx) => setBooksStartOn(tx, ctx(), { entityId, date: "2026-01-01" }));
    result = await collect();
    expect(result.steps.filter((s) => s.section === "Accounting")).toEqual([]);
  });

  it("the physical world: a place is asked for only once an asset exists, and clears when one holds stock", async () => {
    await asOwner((tx) => createAsset(tx, ctx(), { kind: "equipment", name: "Tractor" }));
    let now = await keys();
    expect(now).not.toContain("assets.first");
    expect(now).toContain("inventory.place");

    await asOwner((tx) =>
      createAsset(tx, ctx(), {
        kind: "equipment",
        name: "Garage freezer",
        isStorageLocation: true,
      }),
    );
    now = await keys();
    expect(now).not.toContain("inventory.place");
    // Still waiting for kinds of thing — the two inventory steps are independent.
    expect(now).toContain("inventory.items");

    await asOwner((tx) =>
      createItem(tx, ctx(), { name: "Broiler feed", stockingUnit: "lb", itemKind: "feed" }),
    );
    expect(await keys()).not.toContain("inventory.items");
  });

  it("animals and ground each clear on the first record", async () => {
    const head = await asOwner((tx) =>
      createItem(tx, ctx(), { name: "Feeder pigs", stockingUnit: "head", itemKind: "livestock" }),
    );
    await asOwner((tx) =>
      createLivestockLot(tx, ctx(), { itemId: head.id, code: "PIGS-1", species: "swine" }),
    );
    expect(await keys()).not.toContain("livestock.animals");

    await asOwner((tx) => createParcel(tx, ctx(), { name: "Home place" }));
    expect(await keys()).not.toContain("land.parcels");
  });

  it("selling: prices are asked for only once there is somewhere to sell, and the step points at that place", async () => {
    const channel = await asOwner((tx) => createChannel(tx, ctx(), { name: "Saturday market" }));
    let result = await collect();
    expect(result.steps.map((s) => s.key)).not.toContain("retail.channel");
    const prices = result.steps.find((s) => s.key === "retail.prices");
    expect(prices?.href).toBe(`/dashboard/m/retail/${channel.id}`);
    expect(prices?.guide).toBe("retail/channel");

    const bird = await asOwner((tx) =>
      createItem(tx, ctx(), { name: "Whole broiler", stockingUnit: "each", itemKind: "meat" }),
    );
    await asOwner((tx) =>
      setPrice(tx, ctx(), {
        channelId: channel.id,
        itemId: bird.id,
        priceCents: 2_200,
        effectiveFrom: "2026-01-01",
      }),
    );
    result = await collect();
    expect(result.steps.filter((s) => s.section === "Retail")).toEqual([]);
  });

  it("people and mail clear on the first party and the first mailbox, and then the card has nothing left", async () => {
    await asOwner((tx) =>
      createParty(tx, tenantId, { kind: "organization", displayName: "Rural King" }),
    );
    expect(await keys()).not.toContain("crm.people");

    await withSystem(async (tx) => {
      const [domain] = await tx
        .insert(schema.mailboxDomains)
        .values({ tenantId, domain: `${STAMP}.example` })
        .returning();
      await tx.insert(schema.mailboxes).values({
        tenantId,
        mailboxDomainId: domain.id,
        localPart: "info",
        address: `info@${STAMP}.example`,
      });
    });

    const result = await collect();
    expect(result.steps).toEqual([]);
    // Nothing failed, so an empty list means set up — and the card may go.
    expect(result.complete).toBe(true);
  });

  it("a switched-off tool contributes nothing, and is not reported as a failure", async () => {
    await withSystem((tx) =>
      tx
        .update(schema.tenantModules)
        .set({ enabled: false })
        .where(
          and(
            eq(schema.tenantModules.tenantId, tenantId),
            eq(schema.tenantModules.moduleId, "retail"),
          ),
        ),
    );
    const sources = await enabledSetupSources(tenantId);
    expect(sources.map((s) => s.moduleSlug)).not.toContain("retail");
    expect(sources.map((s) => s.moduleSlug)).toContain("accounting");
    const result = await collect();
    expect(result.complete).toBe(true);
  });
});
