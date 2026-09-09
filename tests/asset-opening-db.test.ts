import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { schema, withSystem, withTenant, type Tx } from "../src/db";
import { getBalances, getDefaultEntityId, setBooksStartOn } from "../src/modules/accounting/core";
import { provisionAccounting } from "../src/modules/accounting/templates/apply";
import { createAsset, getAsset, updateAsset, type AssetCtx } from "../src/packs/assets/ops";
import {
  getAssetOpeningState,
  getDepreciationStatus,
  postDepreciation,
  postedToDateCents,
  recordAssetOpening,
} from "../src/packs/assets/depreciation-ops";

/**
 * Equipment owned before the books began (ADR 0038), as an owner through real
 * RLS.
 *
 * What this file certifies: the four things that must be true before an
 * opening balance can be recorded, each named; the two entries it writes,
 * dated on the day, with the cost under `opening_balance` and the depreciation
 * under `depreciation` so `postedToDateCents` reads the second and not the
 * first; that the months the old books covered are then treated as posted, so
 * the next run posts only what the new books own; that a second recording is
 * refused; and that something never depreciated still gets its cost onto the
 * balance sheet.
 */
const RUN = !!process.env.DATABASE_URL;
const d = RUN ? describe : describe.skip;

const START = "2026-01-01";

d("an asset owned before the books began", () => {
  const STAMP = `assetopen-${process.pid}`;
  const OWNER = `${STAMP}-owner`;

  let tenantId: string;
  let entityId: string;
  let equipmentAccountId: string;
  let obe: string;
  let accumulatedAccountId: string;
  let expenseAccountId: string;

  const ctx = (): AssetCtx => ({ tenantId, userId: OWNER, role: "owner" });
  const asOwner = <T,>(fn: (tx: Tx) => Promise<T>) =>
    withTenant(tenantId, fn, { role: "owner", userId: OWNER });
  const scope = () => ({ kind: "one" as const, entityId });
  const net = (rows: Array<{ accountId: string; netCents: number }>, id: string) =>
    rows.find((r) => r.accountId === id)?.netCents ?? 0;

  /** A tractor: bought and in service well before the books begin. */
  const tractor = async (over: Partial<Parameters<typeof createAsset>[2]> = {}) =>
    asOwner((tx) =>
      createAsset(tx, ctx(), {
        kind: "equipment",
        name: `Tractor ${Math.random().toString(36).slice(2, 8)}`,
        acquiredOn: "2024-01-10",
        acquisitionCostCents: 1_200_000,
        assetAccountId: equipmentAccountId,
        inServiceOn: "2024-01-01",
        depreciationMethod: "straight_line",
        usefulLifeMonths: 120,
        salvageValueCents: 0,
        ...over,
      }),
    );

  beforeAll(async () => {
    await withSystem(async (tx) => {
      const [tenant] = await tx
        .insert(schema.tenants)
        .values({ clerkOrgId: STAMP, name: "Opening Assets", slug: STAMP })
        .returning();
      tenantId = tenant.id;
      await tx
        .insert(schema.tenantModules)
        .values([
          { tenantId, moduleId: "accounting", enabled: true },
          { tenantId, moduleId: "assets", enabled: true },
        ])
        .onConflictDoNothing();
    });
    await asOwner(async (tx) => {
      await provisionAccounting(tx, tenantId);
      entityId = await getDefaultEntityId(tx, tenantId);
      const accounts = await tx.query.accounts.findMany({
        where: eq(schema.accounts.tenantId, tenantId),
      });
      const by = (pred: (a: (typeof accounts)[number]) => boolean) => accounts.find(pred)!.id;
      equipmentAccountId = by((a) => a.subtype === "fixed_asset");
      obe = by((a) => a.subtype === "opening_balance" && a.isSystem);
      accumulatedAccountId = by((a) => a.subtype === "accumulated_depreciation");
      expenseAccountId = by((a) => a.code === "6900");
    });
  });

  afterAll(async () => {
    await withSystem(async (tx) => {
      await tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantId));
    });
  });

  it("names what is missing, one thing at a time, before anything can be recorded", async () => {
    /**
     * Undepreciated to begin with, because `assets_depreciable_is_complete`
     * refuses a method without a cost — which is also the order a person
     * fills this in: the thing, then what it cost, then where that sits.
     */
    const asset = await asOwner((tx) =>
      createAsset(tx, ctx(), {
        kind: "equipment",
        name: "Tractor (staged)",
        acquiredOn: "2024-01-10",
        depreciationMethod: "none",
      }),
    );
    const state = () =>
      asOwner(async (tx) => {
        const fresh = (await getAsset(tx, tenantId, asset.id))!;
        return getAssetOpeningState(tx, tenantId, fresh);
      });

    // No day for it to land on.
    expect((await state()).blocked).toBe("no_books_start");
    await asOwner((tx) => setBooksStartOn(tx, ctx(), { entityId, date: START }));

    // Nothing to put on the books.
    expect((await state()).blocked).toBe("no_cost");
    await asOwner((tx) =>
      updateAsset(tx, ctx(), asset.id, { acquisitionCostCents: 1_200_000 }),
    );

    // Nowhere for the cost to sit.
    expect((await state()).blocked).toBe("no_asset_account");
    await asOwner((tx) =>
      updateAsset(tx, ctx(), asset.id, { assetAccountId: equipmentAccountId }),
    );

    // Ready, and with no schedule there is nothing it says was taken.
    const bare = await state();
    expect(bare).toMatchObject({
      blocked: null,
      booksStartOn: START,
      throughPeriod: null,
      scheduleAccumulatedCents: 0,
    });

    await asOwner((tx) =>
      updateAsset(tx, ctx(), asset.id, {
        depreciationMethod: "straight_line",
        inServiceOn: "2024-01-01",
        usefulLifeMonths: 120,
        salvageValueCents: 0,
      }),
    );
    // 24 months of a 120-month life, at 10,000.00 a month.
    expect(await state()).toMatchObject({
      blocked: null,
      throughPeriod: "2025-12",
      scheduleAccumulatedCents: 240_000,
    });
  });

  it("refuses something bought after the day, which arrives through its bill instead", async () => {
    const asset = await tractor({ acquiredOn: "2026-03-04", inServiceOn: "2026-03-04" });
    const state = await asOwner((tx) => getAssetOpeningState(tx, tenantId, asset));
    expect(state.blocked).toBe("not_before_start");
    await expect(
      asOwner((tx) => recordAssetOpening(tx, ctx(), asset, { accumulatedCents: 0 })),
    ).rejects.toMatchObject({ code: "ASSET_OPENING_BLOCKED" });
  });

  it("writes the cost and the depreciation as two entries dated on the day", async () => {
    const asset = await tractor();
    const posted = await asOwner((tx) =>
      recordAssetOpening(tx, ctx(), asset, { accumulatedCents: 250_000 }),
    );
    expect(posted).toEqual({
      entryDate: START,
      costCents: 1_200_000,
      accumulatedCents: 250_000,
      throughPeriod: "2025-12",
    });

    const entries = await asOwner((tx) =>
      tx.query.journalEntries.findMany({
        where: and(
          eq(schema.journalEntries.tenantId, tenantId),
          eq(schema.journalEntries.sourceId, asset.id),
        ),
      }),
    );
    expect(entries).toHaveLength(2);
    expect(entries.every((e) => e.entryDate === START && e.status === "posted")).toBe(true);
    const cost = entries.find((e) => e.source === "opening_balance")!;
    const depreciation = entries.find((e) => e.source === "depreciation")!;
    expect(depreciation.idempotencyKey).toBe(`depreciation:${asset.id}:through:2025-12`);

    const linesOf = (entryId: string) =>
      asOwner((tx) =>
        tx.query.journalLines.findMany({ where: eq(schema.journalLines.entryId, entryId) }),
      );
    expect((await linesOf(cost.id)).map((l) => [l.accountId, l.amountCents]).sort()).toEqual(
      [
        [equipmentAccountId, 1_200_000],
        [obe, -1_200_000],
      ].sort(),
    );
    expect(
      (await linesOf(depreciation.id)).map((l) => [l.accountId, l.amountCents]).sort(),
    ).toEqual(
      [
        [obe, 250_000],
        [accumulatedAccountId, -250_000],
      ].sort(),
    );

    // The balance sheet on day one: cost, what has been written off, and the
    // plug that is the net of the two.
    const onTheDay = await asOwner((tx) =>
      getBalances(tx, tenantId, { scope: scope(), asOf: START }),
    );
    expect(net(onTheDay, equipmentAccountId)).toBe(1_200_000);
    expect(net(onTheDay, accumulatedAccountId)).toBe(-250_000);
    expect(net(onTheDay, obe)).toBe(-950_000);
    // Not a penny of it is this year's expense.
    expect(net(onTheDay, expenseAccountId)).toBe(0);

    // Read back as depreciation taken — the cost debit is under another
    // source precisely so it is not counted here.
    expect(await asOwner((tx) => postedToDateCents(tx, tenantId, asset.id))).toBe(250_000);
  });

  it("treats the old books' months as posted, so only the new books' months are due", async () => {
    const asset = await tractor();
    await asOwner((tx) => recordAssetOpening(tx, ctx(), asset, { accumulatedCents: 240_000 }));

    const status = await asOwner((tx) =>
      getDepreciationStatus(tx, tenantId, asset, "2026-03"),
    );
    // Every month of 2024 and 2025 is covered by the opening entry's key.
    expect(status!.postedPeriods).toHaveLength(24);
    expect(status!.due.map((r) => r.period)).toEqual(["2026-01", "2026-02", "2026-03"]);
    expect(status!.bookValueCents).toBe(960_000);

    const run = await asOwner((tx) =>
      postDepreciation(tx, ctx(), asset, "2026-03"),
    );
    expect(run.postedPeriods).toEqual(["2026-01", "2026-02", "2026-03"]);
    expect(run.totalCents).toBe(30_000);
    expect(await asOwner((tx) => postedToDateCents(tx, tenantId, asset.id))).toBe(270_000);
    // Three months of expense, and only three.
    const thisYear = await asOwner((tx) =>
      getBalances(tx, tenantId, { scope: scope(), from: "2026-01-01", to: "2026-03-31" }),
    );
    expect(net(thisYear, expenseAccountId)).toBe(30_000);
  });

  it("refuses a second recording, and a figure larger than the cost", async () => {
    const asset = await tractor();
    await asOwner((tx) => recordAssetOpening(tx, ctx(), asset, { accumulatedCents: 100_000 }));
    const state = await asOwner((tx) => getAssetOpeningState(tx, tenantId, asset));
    expect(state.blocked).toBe("already_recorded");
    await expect(
      asOwner((tx) => recordAssetOpening(tx, ctx(), asset, { accumulatedCents: 1 })),
    ).rejects.toMatchObject({ code: "ASSET_OPENING_BLOCKED" });

    const other = await tractor();
    await expect(
      asOwner((tx) => recordAssetOpening(tx, ctx(), other, { accumulatedCents: 1_200_001 })),
    ).rejects.toMatchObject({ code: "ASSET_OPENING_AMOUNT" });
    // Nothing written by the refusal.
    expect(await asOwner((tx) => getAssetOpeningState(tx, tenantId, other))).toMatchObject({
      blocked: null,
    });
  });

  it("puts a barn that is never depreciated on the books, cost only", async () => {
    const barn = await tractor({
      name: "North barn",
      kind: "building",
      depreciationMethod: "none",
      usefulLifeMonths: null,
      salvageValueCents: null,
      inServiceOn: null,
    });
    const state = await asOwner((tx) => getAssetOpeningState(tx, tenantId, barn));
    expect(state).toMatchObject({ blocked: null, throughPeriod: null, scheduleAccumulatedCents: 0 });

    const posted = await asOwner((tx) =>
      recordAssetOpening(tx, ctx(), barn, { accumulatedCents: 0 }),
    );
    expect(posted.throughPeriod).toBeNull();
    const entries = await asOwner((tx) =>
      tx.query.journalEntries.findMany({
        where: and(
          eq(schema.journalEntries.tenantId, tenantId),
          eq(schema.journalEntries.sourceId, barn.id),
        ),
      }),
    );
    expect(entries.map((e) => e.source)).toEqual(["opening_balance"]);

    // A figure with no schedule to hang it on is refused rather than guessed.
    const other = await tractor({
      name: "South barn",
      depreciationMethod: "none",
      usefulLifeMonths: null,
      salvageValueCents: null,
      inServiceOn: null,
    });
    await expect(
      asOwner((tx) => recordAssetOpening(tx, ctx(), other, { accumulatedCents: 5_000 })),
    ).rejects.toMatchObject({ code: "ASSET_OPENING_AMOUNT" });
  });
});
