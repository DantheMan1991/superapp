import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { withTenant, withSystem, schema, type Tx } from "../src/db";
import {
  editEntry,
  getBooksStartOn,
  getDefaultEntityId,
  postEntry,
  setBooksStartOn,
  setClosedThrough,
  type LedgerCtx,
} from "../src/modules/accounting/core";
import { provisionAccounting } from "../src/modules/accounting/templates/apply";
import { createBankAccount } from "../src/modules/accounting/banking/accounts";
import { importTransactions } from "../src/modules/accounting/banking/import";
import { accountingSetupSource } from "../src/modules/accounting/setup/source";

/**
 * The day the books begin (ADR 0035), against real RLS.
 *
 * What this file certifies: a fresh company has no start and the setup card
 * asks for one first; only an owner sets it; nothing may be dated before it
 * and the day itself is fine, at posting and at a date edit; it cannot be set
 * after money already recorded or after the close, and can always move
 * earlier or be cleared; and an import drops the lines before it and says how
 * many.
 */
const d = process.env.DATABASE_URL ? describe : describe.skip;

d("the day the books begin (ADR 0035)", () => {
  const STAMP = `books-start-${process.pid}`;
  let tenantId: string;
  let entityId: string;
  let owner: LedgerCtx;
  let staff: LedgerCtx;
  let registerId: string;

  const as = <T,>(ctx: LedgerCtx, fn: (tx: Tx) => Promise<T>) =>
    withTenant(tenantId, fn, { role: ctx.role, userId: ctx.userId });

  async function accountId(code: string): Promise<string> {
    const row = await as(owner, (tx) =>
      tx.query.accounts.findFirst({
        where: and(eq(schema.accounts.tenantId, tenantId), eq(schema.accounts.code, code)),
      }),
    );
    if (!row) throw new Error(`account ${code} missing`);
    return row.id;
  }

  const setupKeys = async () =>
    (await as(owner, (tx) => accountingSetupSource.collect(tx, { tenantId }))).map((s) => s.key);

  beforeAll(async () => {
    tenantId = await withSystem(async (tx) => {
      const rows = await tx
        .insert(schema.tenants)
        .values([{ clerkOrgId: STAMP, name: "Books Start Test", slug: STAMP }])
        .returning();
      return rows[0].id;
    });
    owner = { tenantId, userId: `${STAMP}-owner`, role: "owner" };
    staff = { tenantId, userId: `${STAMP}-staff`, role: "staff" };
    await as(owner, (tx) => provisionAccounting(tx, tenantId));
    entityId = await as(owner, (tx) => getDefaultEntityId(tx, tenantId));
    const made = await as(owner, (tx) =>
      createBankAccount(tx, owner, { name: "Farm Checking", kind: "checking" }),
    );
    registerId = made.bankAccount.id;
  });

  afterAll(async () => {
    await withSystem(async (tx) => {
      await tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantId));
    });
  });

  it("is unset on a fresh company, and the setup card asks for it before anything else", async () => {
    expect(await as(owner, (tx) => getBooksStartOn(tx, tenantId, entityId))).toBeNull();
    const keys = await setupKeys();
    expect(keys[0]).toBe("accounting.books-start");
  });

  it("only an owner sets it, and setting it clears the step", async () => {
    await expect(
      as(staff, (tx) => setBooksStartOn(tx, staff, { entityId, date: "2026-01-01" })),
    ).rejects.toThrow();
    const set = await as(owner, (tx) =>
      setBooksStartOn(tx, owner, { entityId, date: "2026-01-01" }),
    );
    expect(set).toEqual({ before: null, after: "2026-01-01" });
    expect(await as(owner, (tx) => getBooksStartOn(tx, tenantId, entityId))).toBe("2026-01-01");
    expect(await setupKeys()).not.toContain("accounting.books-start");
  });

  it("nothing may be dated before it; the day itself is fine, and a date edit is held to it too", async () => {
    const expense = await accountId("6000");
    const funds = await accountId("3100");
    const lines = [
      { accountId: expense, amountCents: 5_000 },
      { accountId: funds, amountCents: -5_000 },
    ];
    await expect(
      as(owner, (tx) =>
        postEntry(tx, owner, {
          entityId,
          status: "posted",
          entryDate: "2025-12-31",
          memo: "before the books",
          lines,
        }),
      ),
    ).rejects.toMatchObject({ code: "BEFORE_BOOKS_START" });

    const onTheDay = await as(owner, (tx) =>
      postEntry(tx, owner, {
        entityId,
        status: "posted",
        entryDate: "2026-01-01",
        memo: "opening",
        lines,
      }),
    );
    expect(onTheDay.entry.entryDate).toBe("2026-01-01");

    await expect(
      as(owner, (tx) =>
        editEntry(tx, owner, {
          entryId: onTheDay.entry.id,
          expectedVersion: onTheDay.entry.version,
          patch: { entryDate: "2025-12-15" },
        }),
      ),
    ).rejects.toMatchObject({ code: "BEFORE_BOOKS_START" });
  });

  it("cannot begin after money already recorded, nor after the close; earlier and clear are always fine", async () => {
    // An entry sits on 2026-01-01, so the books cannot begin in February.
    await expect(
      as(owner, (tx) => setBooksStartOn(tx, owner, { entityId, date: "2026-02-01" })),
    ).rejects.toMatchObject({ code: "BOOKS_START_HAS_ENTRIES" });

    await as(owner, (tx) => setClosedThrough(tx, owner, { entityId, date: "2026-01-31" }));
    await expect(
      as(owner, (tx) => setBooksStartOn(tx, owner, { entityId, date: "2026-03-01" })),
    ).rejects.toMatchObject({ code: "BOOKS_START_AFTER_CLOSE" });
    await as(owner, (tx) => setClosedThrough(tx, owner, { entityId, date: null }));

    expect(
      await as(owner, (tx) => setBooksStartOn(tx, owner, { entityId, date: "2025-12-01" })),
    ).toEqual({ before: "2026-01-01", after: "2025-12-01" });
    expect(
      await as(owner, (tx) => setBooksStartOn(tx, owner, { entityId, date: null })),
    ).toEqual({ before: "2025-12-01", after: null });
    expect(await setupKeys()).toContain("accounting.books-start");
    await as(owner, (tx) => setBooksStartOn(tx, owner, { entityId, date: "2026-01-01" }));
  });

  it("an import drops the lines before it and says how many", async () => {
    const result = await as(owner, (tx) =>
      importTransactions(tx, owner, {
        bankAccountId: registerId,
        txns: [
          { txnDate: "2025-12-30", description: "OLD FEED", amountCents: -4_000, raw: [], dupIndex: 0 },
          { txnDate: "2025-12-31", description: "OLD FUEL", amountCents: -2_000, raw: [], dupIndex: 1 },
          { txnDate: "2026-01-02", description: "NEW FEED", amountCents: -6_000, raw: [], dupIndex: 2 },
        ],
      }),
    );
    expect(result).toMatchObject({
      imported: 1,
      skippedDuplicates: 0,
      skippedBeforeStart: 2,
      booksStartOn: "2026-01-01",
    });
    const rows = await as(owner, (tx) =>
      tx.query.bankTransactions.findMany({
        where: and(
          eq(schema.bankTransactions.tenantId, tenantId),
          eq(schema.bankTransactions.bankAccountId, registerId),
        ),
      }),
    );
    expect(rows.map((r) => r.description)).toEqual(["NEW FEED"]);

    // Re-importing the same file: the two old lines are still dropped, the new
    // one is now a duplicate.
    const again = await as(owner, (tx) =>
      importTransactions(tx, owner, {
        bankAccountId: registerId,
        txns: [
          { txnDate: "2025-12-30", description: "OLD FEED", amountCents: -4_000, raw: [], dupIndex: 0 },
          { txnDate: "2026-01-02", description: "NEW FEED", amountCents: -6_000, raw: [], dupIndex: 2 },
        ],
      }),
    );
    expect(again).toMatchObject({ imported: 0, skippedDuplicates: 1, skippedBeforeStart: 1 });
  });
});
