import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { withSystem, withTenant, schema, type Tx } from "../src/db";
import { provisionAccounting } from "../src/modules/accounting/templates/apply";
import { getBalances } from "../src/modules/accounting/core";
import { createAsset, updateAsset, type AssetCtx } from "../src/packs/assets/ops";
import {
  getDepreciationStatus,
  listPostedPeriods,
  postAllDepreciation,
  postDepreciation,
  postDisposal,
  postedToDateCents,
  resolveDepreciationAccounts,
  scheduleInputFor,
} from "../src/packs/assets/depreciation-ops";
import { buildSchedule } from "../src/packs/assets/core/depreciation";


/**
 * Slice 1 fixtures have one legal entity per tenant, so combined IS that
 * entity's books (ADR 0010). `tests/entities-db.test.ts` is the one that runs
 * two and proves each balances on its own.
 */
const COMBINED = { kind: "combined" } as const;

const RUN = !!process.env.DATABASE_URL;
const d = RUN ? describe : describe.skip;

/**
 * Depreciation, posted into the real ledger.
 *
 * The schedule maths is covered purely in `assets-depreciation.test.ts`. What
 * can only be tested against a database is the part that matters to the books:
 * that posting produces a BALANCED entry, tagged with the asset, idempotent per
 * period, and that "posted to date" is read back out of the ledger rather than
 * from a column the pack maintains.
 */
d("depreciation posting", () => {
  const STAMP = `depr-${process.pid}`;
  const OWNER = `${STAMP}-owner`;

  let tenantId: string;
  let assetId: string;

  const asOwner = <T>(fn: (tx: Tx) => Promise<T>) =>
    withTenant(tenantId, fn, { role: "owner", userId: OWNER });
  const ctx = (): AssetCtx => ({ tenantId, userId: OWNER, role: "owner" });

  beforeAll(async () => {
    await withSystem(async (tx) => {
      const rows = await tx
        .insert(schema.tenants)
        .values({
          clerkOrgId: `${STAMP}-org`,
          name: "Depreciation",
          slug: `${STAMP}-slug`,
        })
        .returning();
      tenantId = rows[0].id;
    });
    // The pack posts into a real chart of accounts, so provision one.
    await withTenant(tenantId, (tx) => provisionAccounting(tx, tenantId), {
      role: "owner",
      userId: OWNER,
    });

    const asset = await asOwner((tx) =>
      createAsset(tx, ctx(), {
        kind: "equipment",
        name: "Baler",
        // 1,200.00 over 12 months = 100.00 a month, so the arithmetic is
        // checkable by eye in the assertions below.
        acquisitionCostCents: 120_000,
        acquiredOn: "2026-01-05",
        inServiceOn: "2026-01-20",
        depreciationMethod: "straight_line",
        usefulLifeMonths: 12,
        salvageValueCents: 0,
      }),
    );
    assetId = asset.id;
  });

  afterAll(async () => {
    await withSystem(async (tx) => {
      await tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantId));
    });
  });

  it("resolves the two accounts from a standard chart", async () => {
    const accounts = await asOwner((tx) =>
      resolveDepreciationAccounts(tx, tenantId),
    );
    expect(accounts.expenseAccountId).toBeTruthy();
    expect(accounts.accumulatedAccountId).toBeTruthy();
    expect(accounts.expenseAccountId).not.toBe(accounts.accumulatedAccountId);
  });

  it("posts one balanced entry per period, dated to month end", async () => {
    const result = await asOwner((tx) =>
      withAsset(tx, (asset) => postDepreciation(tx, ctx(), asset, "2026-03")),
    );
    expect(result.postedPeriods).toEqual(["2026-01", "2026-02", "2026-03"]);
    expect(result.totalCents).toBe(30_000);

    const entries = await asOwner((tx) =>
      tx
        .select()
        .from(schema.journalEntries)
        .where(
          and(
            eq(schema.journalEntries.tenantId, tenantId),
            eq(schema.journalEntries.source, "depreciation"),
          ),
        ),
    );
    expect(entries).toHaveLength(3);
    // ONE ENTRY PER PERIOD, month-end dated — not one lump for the catch-up.
    // A combined entry would put three months of expense in March and misstate
    // every P&L in between.
    expect(entries.map((e) => e.entryDate).sort()).toEqual([
      "2026-01-31",
      "2026-02-28",
      "2026-03-31",
    ]);
    expect(entries.every((e) => e.sourceId === assetId)).toBe(true);
  });

  it("balances — debits equal credits on every entry", async () => {
    const lines = await asOwner((tx) =>
      tx
        .select()
        .from(schema.journalLines)
        .where(eq(schema.journalLines.tenantId, tenantId)),
    );
    const sum = lines.reduce((s, l) => s + l.amountCents, 0);
    expect(sum).toBe(0);
  });

  it("tags every line with the asset, which is what makes it reportable", async () => {
    const members = await asOwner((tx) =>
      tx
        .select()
        .from(schema.dimensionMembers)
        .where(eq(schema.dimensionMembers.packEntityId, assetId)),
    );
    expect(members).toHaveLength(1);

    const tagged = await asOwner((tx) =>
      tx
        .select()
        .from(schema.lineDimensions)
        .where(eq(schema.lineDimensions.memberId, members[0].id)),
    );
    // Two lines per entry, three entries.
    expect(tagged).toHaveLength(6);
  });

  it("is idempotent per period — posting again posts nothing", async () => {
    const again = await asOwner((tx) =>
      withAsset(tx, (asset) => postDepreciation(tx, ctx(), asset, "2026-03")),
    );
    expect(again.postedPeriods).toEqual([]);
    expect(again.totalCents).toBe(0);

    const entries = await asOwner((tx) =>
      tx
        .select()
        .from(schema.journalEntries)
        .where(
          and(
            eq(schema.journalEntries.tenantId, tenantId),
            eq(schema.journalEntries.source, "depreciation"),
          ),
        ),
    );
    expect(entries).toHaveLength(3);
  });

  it("catches up only the periods that are still due", async () => {
    const more = await asOwner((tx) =>
      withAsset(tx, (asset) => postDepreciation(tx, ctx(), asset, "2026-05")),
    );
    expect(more.postedPeriods).toEqual(["2026-04", "2026-05"]);
  });

  it("reads accumulated depreciation back out of the LEDGER, not a column", async () => {
    const status = await asOwner((tx) =>
      withAsset(tx, (asset) =>
        getDepreciationStatus(tx, tenantId, asset, "2026-05"),
      ),
    );
    expect(status).not.toBeNull();
    expect(status!.postedToDateCents).toBe(50_000);
    // Cost 1,200.00 less 500.00 posted.
    expect(status!.bookValueCents).toBe(70_000);
    expect(status!.due).toEqual([]);

    const periods = await asOwner((tx) =>
      withAsset(tx, async (asset) =>
        listPostedPeriods(
          tx,
          tenantId,
          assetId,
          buildSchedule(scheduleInputFor(asset)!),
        ),
      ),
    );
    expect(periods.sort()).toEqual([
      "2026-01",
      "2026-02",
      "2026-03",
      "2026-04",
      "2026-05",
    ]);
  });

  it("shows up on the P&L, attributed to the asset — the whole point", async () => {
    const accounts = await asOwner((tx) =>
      resolveDepreciationAccounts(tx, tenantId),
    );

    const balances = await asOwner((tx) =>
      getBalances(tx, tenantId, { scope: COMBINED, from: "2026-01-01", to: "2026-05-31" }),
    );
    const expense = balances.find(
      (b) => b.accountId === accounts.expenseAccountId,
    );
    expect(expense?.netCents).toBe(50_000);
    const accumulated = balances.find(
      (b) => b.accountId === accounts.accumulatedAccountId,
    );
    // Contra-asset: a credit balance, negative in the ledger's signed convention.
    expect(accumulated?.netCents).toBe(-50_000);

    // And the part no other farm software can do: the SAME query, split by the
    // asset dimension, attributes the expense to this specific machine.
    const byAsset = await asOwner((tx) =>
      getBalances(tx, tenantId, {
        scope: COMBINED,
        from: "2026-01-01",
        to: "2026-05-31",
        groupByDimensionType: "asset",
        accountIds: [accounts.expenseAccountId],
      }),
    );
    const members = await asOwner((tx) =>
      tx
        .select()
        .from(schema.dimensionMembers)
        .where(eq(schema.dimensionMembers.packEntityId, assetId)),
    );
    const mine = byAsset.find((b) => b.memberId === members[0].id);
    expect(mine?.netCents).toBe(50_000);
    // Nothing landed untagged.
    expect(byAsset.find((b) => b.memberId === null)).toBeUndefined();
  });

  it("never posts past the end of the life", async () => {
    const all = await asOwner((tx) =>
      withAsset(tx, (asset) => postDepreciation(tx, ctx(), asset, "2099-12")),
    );
    // Twelve months total, five already posted.
    expect(all.postedPeriods).toHaveLength(7);

    const status = await asOwner((tx) =>
      withAsset(tx, (asset) =>
        getDepreciationStatus(tx, tenantId, asset, "2099-12"),
      ),
    );
    expect(status!.postedToDateCents).toBe(120_000);
    expect(status!.bookValueCents).toBe(0);
  });

  it("refuses to post for a staff member", async () => {
    await expect(
      asOwner((tx) =>
        withAsset(tx, (asset) =>
          postDepreciation(
            tx,
            { tenantId, userId: OWNER, role: "staff" },
            asset,
            "2026-06",
          ),
        ),
      ),
    ).rejects.toThrow();
  });

  it("refuses an asset with no schedule", async () => {
    const land = await asOwner((tx) =>
      createAsset(tx, ctx(), {
        kind: "land",
        name: "Home place",
        acquisitionCostCents: 5_000_000,
      }),
    );
    await expect(
      asOwner((tx) => postDepreciation(tx, ctx(), land, "2026-06")),
    ).rejects.toThrow();
  });

  it("collapses periods stranded behind a close into ONE catch-up entry", async () => {
    // The production bug, 2026-08-15: an asset whose schedule starts before the
    // last close could never be depreciated at all, because the run is atomic
    // and one closed month refused everything behind it.
    await withSystem((tx) =>
      tx
        .update(schema.accountingSettings)
        .set({ closedThrough: "2026-06-30" })
        .where(eq(schema.accountingSettings.tenantId, tenantId)),
    );

    const backdated = await asOwner((tx) =>
      createAsset(tx, ctx(), {
        kind: "building",
        name: "Old barn",
        acquisitionCostCents: 240_000,
        inServiceOn: "2026-01-01",
        depreciationMethod: "straight_line",
        usefulLifeMonths: 24,
        salvageValueCents: 0,
      }),
    );

    const result = await asOwner((tx) =>
      postDepreciation(tx, ctx(), backdated, "2026-08"),
    );
    // Jan–Jun are stranded (6), Jul and Aug are open (2).
    expect(result.caughtUpCount).toBe(6);
    expect(result.postedPeriods).toHaveLength(8);
    // 240,000 / 24 = 10,000 a month. Eight months.
    expect(result.totalCents).toBe(80_000);

    const entries = await asOwner((tx) =>
      tx
        .select()
        .from(schema.journalEntries)
        .where(
          and(
            eq(schema.journalEntries.tenantId, tenantId),
            eq(schema.journalEntries.sourceId, backdated.id),
          ),
        ),
    );
    // Three entries, not eight: one catch-up plus July plus August.
    expect(entries).toHaveLength(3);

    const catchUp = entries.find((e) => e.memo.includes("catch-up"));
    expect(catchUp).toBeDefined();
    // Dated in the FIRST OPEN period, never inside the closed one.
    expect(catchUp!.entryDate).toBe("2026-07-31");
    expect(catchUp!.memo).toContain("2026-01 to 2026-06");
  });

  it("does not re-post a caught-up period, because the key carries the range", async () => {
    const backdated = await asOwner((tx) =>
      tx.query.assets.findFirst({
        where: and(
          eq(schema.assets.tenantId, tenantId),
          eq(schema.assets.name, "Old barn"),
        ),
      }),
    );
    // The catch-up entry's date says only "2026-07". Reading dates would make
    // January through June look unposted forever and re-post them every run.
    const again = await asOwner((tx) =>
      postDepreciation(tx, ctx(), backdated!, "2026-08"),
    );
    expect(again.postedPeriods).toEqual([]);

    const status = await asOwner((tx) =>
      getDepreciationStatus(tx, tenantId, backdated!, "2026-08"),
    );
    expect(status!.postedToDateCents).toBe(80_000);
    expect(status!.due).toEqual([]);
  });

  it("reports posted-to-date from the LEDGER even after the schedule changes", async () => {
    // Found on the live tenant 2026-08-15. Editing an in-service date reshuffles
    // which periods carry the remainder cent, so a posted-to-date recomputed
    // from the schedule reports a number the books do not contain. The panel
    // said 6,706.76 while the ledger held 6,706.78.
    const barn = await asOwner((tx) =>
      tx.query.assets.findFirst({
        where: and(
          eq(schema.assets.tenantId, tenantId),
          eq(schema.assets.name, "Old barn"),
        ),
      }),
    );

    const ledgerTotal = await asOwner((tx) =>
      postedToDateCents(tx, tenantId, barn!.id),
    );
    const status = await asOwner((tx) =>
      getDepreciationStatus(tx, tenantId, barn!, "2026-08"),
    );
    expect(status!.postedToDateCents).toBe(ledgerTotal);

    // Now move the in-service date, which reshuffles the remainder, and confirm
    // posted-to-date still matches the ledger rather than the new schedule.
    await asOwner((tx) =>
      updateAsset(tx, ctx(), barn!.id, { inServiceOn: "2025-01-01" }),
    );
    const moved = await asOwner((tx) =>
      tx.query.assets.findFirst({ where: eq(schema.assets.id, barn!.id) }),
    );
    const after = await asOwner((tx) =>
      getDepreciationStatus(tx, tenantId, moved!, "2026-08"),
    );
    expect(after!.postedToDateCents).toBe(ledgerTotal);
    expect(after!.bookValueCents).toBe(
      (moved!.acquisitionCostCents ?? 0) - ledgerTotal,
    );
  });

  it("posts every depreciable asset in one run, skipping the ones that are not", async () => {
    const land = await asOwner((tx) =>
      tx.query.assets.findFirst({
        where: and(
          eq(schema.assets.tenantId, tenantId),
          eq(schema.assets.name, "Home place"),
        ),
      }),
    );
    expect(land?.depreciationMethod).toBe("none");

    const before = await asOwner((tx) =>
      tx
        .select()
        .from(schema.journalEntries)
        .where(
          and(
            eq(schema.journalEntries.tenantId, tenantId),
            eq(schema.journalEntries.source, "depreciation"),
          ),
        ),
    );

    // Everything is already up to date through 2026-08, so a bulk run for the
    // same month must be a no-op rather than a second helping.
    const noop = await asOwner((tx) => postAllDepreciation(tx, ctx(), "2026-08"));
    expect(noop.assetsPosted).toBe(0);

    // A later month has something to do for the one asset still in its life.
    const next = await asOwner((tx) => postAllDepreciation(tx, ctx(), "2026-09"));
    expect(next.assetsPosted).toBeGreaterThan(0);

    const after = await asOwner((tx) =>
      tx
        .select()
        .from(schema.journalEntries)
        .where(
          and(
            eq(schema.journalEntries.tenantId, tenantId),
            eq(schema.journalEntries.source, "depreciation"),
          ),
        ),
    );
    expect(after.length).toBe(before.length + next.periodsPosted);
    // Land was never touched.
    expect(
      after.every((e) => e.sourceId !== land!.id),
    ).toBe(true);
  });

  /** Re-read the asset inside the caller's transaction. */
  async function withAsset<T>(
    tx: Tx,
    fn: (asset: typeof schema.assets.$inferSelect) => Promise<T>,
  ): Promise<T> {
    const asset = await tx.query.assets.findFirst({
      where: and(
        eq(schema.assets.tenantId, tenantId),
        eq(schema.assets.id, assetId),
      ),
    });
    return fn(asset!);
  }
});

/**
 * Disposal settling the books.
 *
 * Before this, marking an asset sold stopped it being taggable and posted
 * nothing — the cost and its accumulated depreciation stayed on the balance
 * sheet forever. These certify that the four legs come off and the difference
 * lands as a gain or a loss.
 */
d("disposal settles the books", () => {
  const STAMP = `disp-${process.pid}`;
  const OWNER = `${STAMP}-owner`;

  let tenantId: string;
  let equipmentAccountId: string;
  let bankAccountId: string;

  const asOwner = <T>(fn: (tx: Tx) => Promise<T>) =>
    withTenant(tenantId, fn, { role: "owner", userId: OWNER });
  const ctx = (): AssetCtx => ({ tenantId, userId: OWNER, role: "owner" });

  beforeAll(async () => {
    await withSystem(async (tx) => {
      const rows = await tx
        .insert(schema.tenants)
        .values({
          clerkOrgId: `${STAMP}-org`,
          name: "Disposal",
          slug: `${STAMP}-slug`,
        })
        .returning();
      tenantId = rows[0].id;
    });
    await withTenant(tenantId, (tx) => provisionAccounting(tx, tenantId), {
      role: "owner",
      userId: OWNER,
    });
    const accounts = await asOwner((tx) =>
      tx.select().from(schema.accounts).where(eq(schema.accounts.tenantId, tenantId)),
    );
    equipmentAccountId = accounts.find((a) => a.code === "1600")!.id;
    bankAccountId = accounts.find((a) => a.code === "1000")!.id;
  });

  afterAll(async () => {
    await withSystem(async (tx) => {
      await tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantId));
    });
  });

  async function makeAsset(name: string, costCents: number) {
    return asOwner((tx) =>
      createAsset(tx, ctx(), {
        kind: "equipment",
        name,
        acquisitionCostCents: costCents,
        assetAccountId: equipmentAccountId,
        inServiceOn: "2026-01-01",
        depreciationMethod: "straight_line",
        usefulLifeMonths: 10,
        salvageValueCents: 0,
      }),
    );
  }

  it("provisioning adds the gain/loss account", async () => {
    const acct = await asOwner((tx) =>
      tx.query.accounts.findFirst({
        where: and(
          eq(schema.accounts.tenantId, tenantId),
          eq(schema.accounts.code, "4950"),
        ),
      }),
    );
    expect(acct?.name).toContain("Disposal");
  });

  it("posts a balanced entry that clears cost and accumulated", async () => {
    const asset = await makeAsset("Sold mower", 100_000);
    await asOwner((tx) => postDepreciation(tx, ctx(), asset, "2026-04"));
    const accumulated = await asOwner((tx) =>
      postedToDateCents(tx, tenantId, asset.id),
    );
    expect(accumulated).toBe(40_000); // 4 of 10 months at 10,000

    const posting = await asOwner((tx) =>
      postDisposal(tx, ctx(), asset, {
        disposedOn: "2026-04-30",
        proceedsCents: 75_000,
        proceedsAccountId: bankAccountId,
      }),
    );
    expect(posting.posted).toBe(true);
    // Book value 60,000; sold for 75,000 → 15,000 gain.
    expect(posting.bookValueCents).toBe(60_000);
    expect(posting.gainCents).toBe(15_000);

    const lines = await asOwner((tx) =>
      tx
        .select({
          accountId: schema.journalLines.accountId,
          amountCents: schema.journalLines.amountCents,
        })
        .from(schema.journalLines)
        .innerJoin(
          schema.journalEntries,
          eq(schema.journalEntries.id, schema.journalLines.entryId),
        )
        .where(eq(schema.journalEntries.idempotencyKey, `disposal:${asset.id}`)),
    );
    expect(lines.reduce((s, l) => s + l.amountCents, 0)).toBe(0);
    const byAccount = new Map(lines.map((l) => [l.accountId, l.amountCents]));
    // The cost comes OFF the fixed-asset account.
    expect(byAccount.get(equipmentAccountId)).toBe(-100_000);
    // The proceeds land in the bank.
    expect(byAccount.get(bankAccountId)).toBe(75_000);
  });

  it("records a loss when it sells for less than book value", async () => {
    const asset = await makeAsset("Cheap trailer", 100_000);
    const posting = await asOwner((tx) =>
      postDisposal(tx, ctx(), asset, {
        disposedOn: "2026-02-28",
        proceedsCents: 10_000,
        proceedsAccountId: bankAccountId,
      }),
    );
    // Nothing depreciated, so book value is the full cost.
    expect(posting.gainCents).toBe(-90_000);
  });

  it("scrapping something with book value left is a loss of exactly that", async () => {
    const asset = await makeAsset("Scrapped tiller", 50_000);
    const posting = await asOwner((tx) =>
      postDisposal(tx, ctx(), asset, {
        disposedOn: "2026-02-28",
        proceedsCents: 0,
      }),
    );
    expect(posting.gainCents).toBe(-50_000);

    const lines = await asOwner((tx) =>
      tx
        .select()
        .from(schema.journalLines)
        .innerJoin(
          schema.journalEntries,
          eq(schema.journalEntries.id, schema.journalLines.entryId),
        )
        .where(eq(schema.journalEntries.idempotencyKey, `disposal:${asset.id}`)),
    );
    // No proceeds line and no accumulated line — the ledger rejects zero
    // amounts, so an entry simply has fewer legs.
    expect(lines).toHaveLength(2);
  });

  it("posts nothing, and says why, when the cost is on no account", async () => {
    const orphan = await asOwner((tx) =>
      createAsset(tx, ctx(), {
        kind: "equipment",
        name: "Unlinked",
        acquisitionCostCents: 10_000,
      }),
    );
    const posting = await asOwner((tx) =>
      postDisposal(tx, ctx(), orphan, {
        disposedOn: "2026-02-28",
        proceedsCents: 0,
      }),
    );
    // Guessing an account would put a real number in the wrong place.
    expect(posting.posted).toBe(false);
    expect(posting.reason).toBe("no_asset_account");
  });

  it("posts nothing when there is no cost to remove", async () => {
    const free = await asOwner((tx) =>
      createAsset(tx, ctx(), {
        kind: "fixture",
        name: "Inherited bench",
        assetAccountId: equipmentAccountId,
      }),
    );
    const posting = await asOwner((tx) =>
      postDisposal(tx, ctx(), free, {
        disposedOn: "2026-02-28",
        proceedsCents: 0,
      }),
    );
    expect(posting.posted).toBe(false);
    expect(posting.reason).toBe("no_cost");
  });

  it("is idempotent — disposing twice posts one entry", async () => {
    const asset = await makeAsset("Twice", 20_000);
    await asOwner((tx) =>
      postDisposal(tx, ctx(), asset, {
        disposedOn: "2026-02-28",
        proceedsCents: 0,
      }),
    );
    await asOwner((tx) =>
      postDisposal(tx, ctx(), asset, {
        disposedOn: "2026-02-28",
        proceedsCents: 0,
      }),
    );
    const entries = await asOwner((tx) =>
      tx
        .select()
        .from(schema.journalEntries)
        .where(
          and(
            eq(schema.journalEntries.tenantId, tenantId),
            eq(schema.journalEntries.idempotencyKey, `disposal:${asset.id}`),
          ),
        ),
    );
    expect(entries).toHaveLength(1);
  });

  it("refuses a staff member", async () => {
    const asset = await makeAsset("Not yours", 5_000);
    await expect(
      asOwner((tx) =>
        postDisposal(
          tx,
          { tenantId, userId: OWNER, role: "staff" },
          asset,
          { disposedOn: "2026-02-28", proceedsCents: 0 },
        ),
      ),
    ).rejects.toThrow();
  });
});
