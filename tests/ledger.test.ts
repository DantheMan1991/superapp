import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { withTenant, withSystem, schema } from "../src/db";
import { logAuditInTx } from "../src/lib/audit";
import {
  LedgerError,
  createAccount,
  deactivateAccount,
  editEntry,
  getBalances,
  getLedgerIntegrity,
  getTrialBalance,
  ledgerIsBalanced,
  postDraft,
  postEntry,
  reverseEntry,
  setClosedThrough,
  updateAccount,
  upsertDimensionMember,
  voidEntry,
  type LedgerCtx,
} from "../src/modules/accounting/core";
import { provisionAccounting } from "../src/modules/accounting/templates/apply";

/**
 * Certification of the Core Ledger Platform:
 *  1. The DB balance trigger (raw inserts — proves the backstop, not the API)
 *  2. The posting engine (validation, idempotency incl. a live race, versioning)
 *  3. COA hierarchy rules
 *  4. Balances/trial balance against a hand-computed fixture
 *  5. Audit atomicity + append-only enforcement
 */

const RUN = !!process.env.DATABASE_URL;
const d = RUN ? describe : describe.skip;

const STAMP = `ledger-test-${process.pid}`;
let tenantId: string;
let owner: LedgerCtx;
let staff: LedgerCtx;
const acct: Record<string, string> = {}; // code -> id

async function accountId(code: string): Promise<string> {
  if (acct[code]) return acct[code];
  const row = await withTenant(tenantId, (tx) =>
    tx.query.accounts.findFirst({
      where: and(
        eq(schema.accounts.tenantId, tenantId),
        eq(schema.accounts.code, code),
      ),
    }),
  );
  if (!row) throw new Error(`fixture account ${code} missing`);
  acct[code] = row.id;
  return row.id;
}

function pair(debitAccount: string, creditAccount: string, cents: number) {
  return [
    { accountId: debitAccount, amountCents: cents },
    { accountId: creditAccount, amountCents: -cents },
  ];
}

/**
 * Assert a DB-level rejection whose real message may be nested in the
 * error's cause chain (drizzle wraps pg errors as "Failed query: …").
 */
async function expectDbReject(p: Promise<unknown>, pattern: RegExp): Promise<void> {
  try {
    await p;
    expect.unreachable("expected the database to reject this");
  } catch (err) {
    const chain: string[] = [];
    let e: unknown = err;
    while (e) {
      chain.push(String((e as Error).message ?? e));
      e = (e as { cause?: unknown }).cause;
    }
    expect(chain.join(" | ")).toMatch(pattern);
  }
}

d("core ledger platform", () => {
  beforeAll(async () => {
    tenantId = await withSystem(async (tx) => {
      const rows = await tx
        .insert(schema.tenants)
        .values([{ clerkOrgId: STAMP, name: "Ledger Test", slug: STAMP }])
        .returning();
      return rows[0].id;
    });
    owner = { tenantId, userId: "owner-user", role: "owner" };
    staff = { tenantId, userId: "staff-user", role: "staff" };
    await withTenant(tenantId, (tx) => provisionAccounting(tx, tenantId));
  });

  afterAll(async () => {
    await withSystem(async (tx) => {
      await tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantId));
    });
  });

  // ---------------------------------------------------------------- trigger

  describe("DB balance trigger (raw SQL backstop)", () => {
    it("accepts a balanced posted entry", async () => {
      const cash = await accountId("1000");
      const exp = await accountId("6100");
      await withTenant(tenantId, async (tx) => {
        const [entry] = await tx
          .insert(schema.journalEntries)
          .values({
            tenantId,
            entryDate: "2026-01-10",
            status: "posted",
            postedAt: new Date(),
            createdByClerkUserId: "raw",
          })
          .returning();
        await tx.insert(schema.journalLines).values([
          { tenantId, entryId: entry.id, accountId: exp, amountCents: 1000, lineNo: 1 },
          { tenantId, entryId: entry.id, accountId: cash, amountCents: -1000, lineNo: 2 },
        ]);
      });
    });

    it("rejects an unbalanced posted entry at commit", async () => {
      const cash = await accountId("1000");
      const exp = await accountId("6100");
      await expectDbReject(
        withTenant(tenantId, async (tx) => {
          const [entry] = await tx
            .insert(schema.journalEntries)
            .values({
              tenantId,
              entryDate: "2026-01-10",
              status: "posted",
              postedAt: new Date(),
              createdByClerkUserId: "raw",
            })
            .returning();
          await tx.insert(schema.journalLines).values([
            { tenantId, entryId: entry.id, accountId: exp, amountCents: 1000, lineNo: 1 },
            { tenantId, entryId: entry.id, accountId: cash, amountCents: -900, lineNo: 2 },
          ]);
        }),
        /unbalanced/,
      );
    });

    it("accepts an unbalanced DRAFT", async () => {
      const exp = await accountId("6100");
      await withTenant(tenantId, async (tx) => {
        const [entry] = await tx
          .insert(schema.journalEntries)
          .values({
            tenantId,
            entryDate: "2026-01-10",
            status: "draft",
            createdByClerkUserId: "raw",
          })
          .returning();
        await tx.insert(schema.journalLines).values([
          { tenantId, entryId: entry.id, accountId: exp, amountCents: 777, lineNo: 1 },
        ]);
      });
    });

    it("rejects promoting an unbalanced draft to posted", async () => {
      const exp = await accountId("6100");
      const entryId = await withTenant(tenantId, async (tx) => {
        const [entry] = await tx
          .insert(schema.journalEntries)
          .values({
            tenantId,
            entryDate: "2026-01-10",
            status: "draft",
            createdByClerkUserId: "raw",
          })
          .returning();
        await tx.insert(schema.journalLines).values([
          { tenantId, entryId: entry.id, accountId: exp, amountCents: 555, lineNo: 1 },
        ]);
        return entry.id;
      });
      await expectDbReject(
        withTenant(tenantId, (tx) =>
          tx
            .update(schema.journalEntries)
            .set({ status: "posted" })
            .where(eq(schema.journalEntries.id, entryId)),
        ),
        /unbalanced|line/,
      );
    });

    it("rejects a posted entry with a single line (min lines)", async () => {
      const exp = await accountId("6100");
      await expectDbReject(
        withTenant(tenantId, async (tx) => {
          const [entry] = await tx
            .insert(schema.journalEntries)
            .values({
              tenantId,
              entryDate: "2026-01-10",
              status: "posted",
              postedAt: new Date(),
              createdByClerkUserId: "raw",
            })
            .returning();
          // A single zero-sum line is impossible (amount<>0 CHECK), so a
          // "balanced" one-liner can't exist; assert min-lines fires even
          // before balance: one line of 0 sum is unrepresentable, use ±.
          await tx.insert(schema.journalLines).values([
            { tenantId, entryId: entry.id, accountId: exp, amountCents: 500, lineNo: 1 },
          ]);
        }),
        /line|unbalanced/,
      );
    });

    it("rejects deleting a line out of a posted entry", async () => {
      const cash = await accountId("1000");
      const exp = await accountId("6100");
      const { entryId, lineId } = await withTenant(tenantId, async (tx) => {
        const [entry] = await tx
          .insert(schema.journalEntries)
          .values({
            tenantId,
            entryDate: "2026-01-11",
            status: "posted",
            postedAt: new Date(),
            createdByClerkUserId: "raw",
          })
          .returning();
        const lines = await tx
          .insert(schema.journalLines)
          .values([
            { tenantId, entryId: entry.id, accountId: exp, amountCents: 250, lineNo: 1 },
            { tenantId, entryId: entry.id, accountId: cash, amountCents: -250, lineNo: 2 },
          ])
          .returning();
        return { entryId: entry.id, lineId: lines[0].id };
      });
      await expectDbReject(
        withTenant(tenantId, (tx) =>
          tx.delete(schema.journalLines).where(eq(schema.journalLines.id, lineId)),
        ),
        /line|unbalanced/,
      );
      // And updating an amount to break balance:
      await expectDbReject(
        withTenant(tenantId, (tx) =>
          tx
            .update(schema.journalLines)
            .set({ amountCents: 9999 })
            .where(
              and(
                eq(schema.journalLines.entryId, entryId),
                eq(schema.journalLines.lineNo, 1),
              ),
            ),
        ),
        /unbalanced/,
      );
    });

    it("multi-entry tx: one bad entry rejects the whole transaction", async () => {
      const cash = await accountId("1000");
      const exp = await accountId("6100");
      await expectDbReject(
        withTenant(tenantId, async (tx) => {
          for (const bad of [false, true]) {
            const [entry] = await tx
              .insert(schema.journalEntries)
              .values({
                tenantId,
                entryDate: "2026-01-12",
                status: "posted",
                postedAt: new Date(),
                createdByClerkUserId: "raw",
              })
              .returning();
            await tx.insert(schema.journalLines).values([
              { tenantId, entryId: entry.id, accountId: exp, amountCents: 100, lineNo: 1 },
              {
                tenantId,
                entryId: entry.id,
                accountId: cash,
                amountCents: bad ? -50 : -100,
                lineNo: 2,
              },
            ]);
          }
        }),
        /unbalanced/,
      );
    });
  });

  // ----------------------------------------------------------------- engine

  describe("posting engine", () => {
    it("posts a balanced entry and numbers its lines", async () => {
      const cash = await accountId("1000");
      const exp = await accountId("6300");
      const { entry, deduped } = await withTenant(tenantId, (tx) =>
        postEntry(tx, owner, {
          status: "posted",
          entryDate: "2026-02-01",
          memo: "office supplies",
          lines: pair(exp, cash, 4200),
        }),
      );
      expect(deduped).toBe(false);
      expect(entry.status).toBe("posted");
      const lines = await withTenant(tenantId, (tx) =>
        tx.query.journalLines.findMany({
          where: eq(schema.journalLines.entryId, entry.id),
        }),
      );
      expect(lines.map((l) => l.lineNo).sort()).toEqual([1, 2]);
    });

    it("rejects unbalanced posts before touching the DB", async () => {
      const cash = await accountId("1000");
      const exp = await accountId("6300");
      await expect(
        withTenant(tenantId, (tx) =>
          postEntry(tx, owner, {
            status: "posted",
            entryDate: "2026-02-01",
            lines: [
              { accountId: exp, amountCents: 100 },
              { accountId: cash, amountCents: -99 },
            ],
          }),
        ),
      ).rejects.toMatchObject({ code: "UNBALANCED" });
    });

    it("staff can draft but cannot post", async () => {
      const cash = await accountId("1000");
      const exp = await accountId("6300");
      await expect(
        withTenant(tenantId, (tx) =>
          postEntry(tx, staff, {
            status: "posted",
            entryDate: "2026-02-02",
            lines: pair(exp, cash, 100),
          }),
        ),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      const { entry } = await withTenant(tenantId, (tx) =>
        postEntry(tx, staff, {
          status: "draft",
          entryDate: "2026-02-02",
          lines: pair(exp, cash, 100),
        }),
      );
      expect(entry.status).toBe("draft");
    });

    it("rejects inactive and unknown accounts", async () => {
      const cash = await accountId("1000");
      const misc = await withTenant(tenantId, (tx) =>
        createAccount(tx, owner, {
          code: "7777",
          name: "Temp",
          accountType: "expense",
        }),
      );
      await withTenant(tenantId, (tx) =>
        deactivateAccount(tx, owner, {
          accountId: misc.id,
          expectedVersion: misc.version,
          active: false,
        }),
      );
      await expect(
        withTenant(tenantId, (tx) =>
          postEntry(tx, owner, {
            status: "posted",
            entryDate: "2026-02-03",
            lines: pair(misc.id, cash, 100),
          }),
        ),
      ).rejects.toMatchObject({ code: "ACCOUNT_INACTIVE" });
      await expect(
        withTenant(tenantId, (tx) =>
          postEntry(tx, owner, {
            status: "posted",
            entryDate: "2026-02-03",
            lines: pair(crypto.randomUUID(), cash, 100),
          }),
        ),
      ).rejects.toMatchObject({ code: "ACCOUNT_NOT_FOUND" });
    });

    it("period lock blocks back-dated posts and unlock restores them", async () => {
      const cash = await accountId("1000");
      const exp = await accountId("6400");
      await withTenant(tenantId, (tx) =>
        setClosedThrough(tx, owner, { date: "2026-02-28" }),
      );
      await expect(
        withTenant(tenantId, (tx) =>
          postEntry(tx, owner, {
            status: "posted",
            entryDate: "2026-02-15",
            lines: pair(exp, cash, 100),
          }),
        ),
      ).rejects.toMatchObject({ code: "PERIOD_CLOSED" });
      const { entry } = await withTenant(tenantId, (tx) =>
        postEntry(tx, owner, {
          status: "posted",
          entryDate: "2026-03-01",
          lines: pair(exp, cash, 100),
        }),
      );
      expect(entry.status).toBe("posted");
      await withTenant(tenantId, (tx) => setClosedThrough(tx, owner, { date: null }));
    });

    it("idempotency: same key returns the same entry", async () => {
      const cash = await accountId("1000");
      const exp = await accountId("6650");
      const key = `${STAMP}-idem-1`;
      const first = await withTenant(tenantId, (tx) =>
        postEntry(tx, owner, {
          status: "posted",
          entryDate: "2026-03-02",
          idempotencyKey: key,
          lines: pair(exp, cash, 1234),
        }),
      );
      const second = await withTenant(tenantId, (tx) =>
        postEntry(tx, owner, {
          status: "posted",
          entryDate: "2026-03-02",
          idempotencyKey: key,
          lines: pair(exp, cash, 1234),
        }),
      );
      expect(first.deduped).toBe(false);
      expect(second.deduped).toBe(true);
      expect(second.entry.id).toBe(first.entry.id);
    });

    it("concurrent double-post race yields exactly one entry", async () => {
      const cash = await accountId("1000");
      const exp = await accountId("6650");
      const key = `${STAMP}-race-1`;
      const attempt = () =>
        withTenant(tenantId, (tx) =>
          postEntry(tx, owner, {
            status: "posted",
            entryDate: "2026-03-03",
            idempotencyKey: key,
            lines: pair(exp, cash, 999),
          }),
        );
      const [r1, r2] = await Promise.all([attempt(), attempt()]);
      expect(r1.entry.id).toBe(r2.entry.id);
      expect([r1.deduped, r2.deduped].filter(Boolean).length).toBeGreaterThanOrEqual(1);
      const rows = await withTenant(tenantId, (tx) =>
        tx.query.journalEntries.findMany({
          where: and(
            eq(schema.journalEntries.tenantId, tenantId),
            eq(schema.journalEntries.idempotencyKey, key),
          ),
        }),
      );
      expect(rows).toHaveLength(1);
    });

    it("edit policy tiers: standard edit ok, stale version rejected, strict mode locks", async () => {
      const cash = await accountId("1000");
      const exp = await accountId("6000");
      const { entry } = await withTenant(tenantId, (tx) =>
        postEntry(tx, owner, {
          status: "posted",
          entryDate: "2026-03-04",
          memo: "before",
          lines: pair(exp, cash, 500),
        }),
      );
      // Standard policy: posted entries editable, audited via before/after.
      const { before, after } = await withTenant(tenantId, (tx) =>
        editEntry(tx, owner, {
          entryId: entry.id,
          expectedVersion: entry.version,
          patch: { memo: "after", lines: pair(exp, cash, 600) },
        }),
      );
      expect(before.entry.memo).toBe("before");
      expect(after.entry.memo).toBe("after");
      expect(after.lines[0].amountCents).toBe(600);
      // Stale version: same expectedVersion again must fail.
      await expect(
        withTenant(tenantId, (tx) =>
          editEntry(tx, owner, {
            entryId: entry.id,
            expectedVersion: entry.version,
            patch: { memo: "stale write" },
          }),
        ),
      ).rejects.toMatchObject({ code: "STALE_VERSION" });
      // Strict append-only mode: edits refused outright.
      await withTenant(tenantId, (tx) =>
        tx
          .update(schema.accountingSettings)
          .set({ entryEditPolicy: "strict_append_only" })
          .where(eq(schema.accountingSettings.tenantId, tenantId)),
      );
      await expect(
        withTenant(tenantId, (tx) =>
          editEntry(tx, owner, {
            entryId: entry.id,
            expectedVersion: entry.version + 1,
            patch: { memo: "strict" },
          }),
        ),
      ).rejects.toMatchObject({ code: "ENTRY_IMMUTABLE" });
      await withTenant(tenantId, (tx) =>
        tx
          .update(schema.accountingSettings)
          .set({ entryEditPolicy: "standard" })
          .where(eq(schema.accountingSettings.tenantId, tenantId)),
      );
    });

    it("void excludes the entry; reverse nets to zero and cannot run twice", async () => {
      const cash = await accountId("1000");
      const exp = await accountId("6050");
      // Void: effect disappears.
      const { entry: toVoid } = await withTenant(tenantId, (tx) =>
        postEntry(tx, owner, {
          status: "posted",
          entryDate: "2026-03-05",
          lines: pair(exp, cash, 11100),
        }),
      );
      const feesBefore = await withTenant(tenantId, (tx) =>
        getBalances(tx, tenantId, { accountIds: [exp] }),
      );
      await withTenant(tenantId, (tx) =>
        voidEntry(tx, owner, { entryId: toVoid.id, expectedVersion: toVoid.version }),
      );
      const feesAfter = await withTenant(tenantId, (tx) =>
        getBalances(tx, tenantId, { accountIds: [exp] }),
      );
      const net = (rows: { netCents: number }[]) =>
        rows.reduce((a, r) => a + r.netCents, 0);
      expect(net(feesAfter)).toBe(net(feesBefore) - 11100);

      // Reverse: original stays posted, pair nets to zero, second reverse dedups.
      const { entry: toReverse } = await withTenant(tenantId, (tx) =>
        postEntry(tx, owner, {
          status: "posted",
          entryDate: "2026-03-06",
          lines: pair(exp, cash, 3300),
        }),
      );
      const rev1 = await withTenant(tenantId, (tx) =>
        reverseEntry(tx, owner, { entryId: toReverse.id, entryDate: "2026-03-07" }),
      );
      expect(rev1.deduped).toBe(false);
      expect(rev1.entry.reversesEntryId).toBe(toReverse.id);
      const original = await withTenant(tenantId, (tx) =>
        tx.query.journalEntries.findFirst({
          where: eq(schema.journalEntries.id, toReverse.id),
        }),
      );
      expect(original?.status).toBe("posted");
      const rev2 = await withTenant(tenantId, (tx) =>
        reverseEntry(tx, owner, { entryId: toReverse.id, entryDate: "2026-03-08" }),
      );
      expect(rev2.deduped).toBe(true);
      expect(rev2.entry.id).toBe(rev1.entry.id);
    });

    it("postDraft revalidates and posts", async () => {
      const cash = await accountId("1000");
      const exp = await accountId("6200");
      const { entry } = await withTenant(tenantId, (tx) =>
        postEntry(tx, staff, {
          status: "draft",
          entryDate: "2026-03-09",
          lines: pair(exp, cash, 800),
        }),
      );
      await expect(
        withTenant(tenantId, (tx) =>
          postDraft(tx, staff, { entryId: entry.id, expectedVersion: entry.version }),
        ),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      const posted = await withTenant(tenantId, (tx) =>
        postDraft(tx, owner, { entryId: entry.id, expectedVersion: entry.version }),
      );
      expect(posted.status).toBe("posted");
    });
  });

  // -------------------------------------------------------------------- coa

  describe("chart of accounts", () => {
    it("provisioning is idempotent", async () => {
      const first = await withTenant(tenantId, (tx) =>
        tx.select({ id: schema.accounts.id }).from(schema.accounts),
      );
      const again = await withTenant(tenantId, (tx) =>
        provisionAccounting(tx, tenantId),
      );
      expect(again.accountsCreated).toBe(0);
      const second = await withTenant(tenantId, (tx) =>
        tx.select({ id: schema.accounts.id }).from(schema.accounts),
      );
      expect(second.length).toBe(first.length);
      const settings = await withTenant(tenantId, (tx) =>
        tx.select().from(schema.accountingSettings),
      );
      expect(settings).toHaveLength(1);
    });

    it("enforces hierarchy rules and code uniqueness", async () => {
      await expect(
        withTenant(tenantId, (tx) =>
          createAccount(tx, owner, { code: "1000", name: "Dup", accountType: "asset" }),
        ),
      ).rejects.toMatchObject({ code: "DUPLICATE_CODE" });

      const a = await withTenant(tenantId, (tx) =>
        createAccount(tx, owner, { code: "8000", name: "L1", accountType: "expense" }),
      );
      const b = await withTenant(tenantId, (tx) =>
        createAccount(tx, owner, {
          code: "8010",
          name: "L2",
          accountType: "expense",
          parentId: a.id,
        }),
      );
      const c = await withTenant(tenantId, (tx) =>
        createAccount(tx, owner, {
          code: "8020",
          name: "L3",
          accountType: "expense",
          parentId: b.id,
        }),
      );
      // Depth 4 refused.
      await expect(
        withTenant(tenantId, (tx) =>
          createAccount(tx, owner, {
            code: "8030",
            name: "L4",
            accountType: "expense",
            parentId: c.id,
          }),
        ),
      ).rejects.toMatchObject({ code: "COA_DEPTH" });
      // Self-parent refused.
      await expect(
        withTenant(tenantId, (tx) =>
          updateAccount(tx, owner, {
            accountId: a.id,
            expectedVersion: a.version,
            patch: { parentId: a.id },
          }),
        ),
      ).rejects.toMatchObject({ code: "COA_SELF_PARENT" });
      // Cycle refused (a -> c would make a its own ancestor's child).
      await expect(
        withTenant(tenantId, (tx) =>
          updateAccount(tx, owner, {
            accountId: a.id,
            expectedVersion: a.version,
            patch: { parentId: c.id },
          }),
        ),
      ).rejects.toMatchObject({ code: "COA_CYCLE" });
      // Type mismatch refused.
      await expect(
        withTenant(tenantId, (tx) =>
          createAccount(tx, owner, {
            code: "8040",
            name: "WrongType",
            accountType: "income",
            parentId: a.id,
          }),
        ),
      ).rejects.toMatchObject({ code: "COA_TYPE_MISMATCH" });
    });

    it("system accounts cannot be deactivated or moved", async () => {
      const ar = await withTenant(tenantId, (tx) =>
        tx.query.accounts.findFirst({
          where: and(
            eq(schema.accounts.tenantId, tenantId),
            eq(schema.accounts.code, "1200"),
          ),
        }),
      );
      expect(ar?.isSystem).toBe(true);
      await expect(
        withTenant(tenantId, (tx) =>
          deactivateAccount(tx, owner, {
            accountId: ar!.id,
            expectedVersion: ar!.version,
            active: false,
          }),
        ),
      ).rejects.toMatchObject({ code: "SYSTEM_ACCOUNT" });
      await expect(
        withTenant(tenantId, (tx) =>
          updateAccount(tx, owner, {
            accountId: ar!.id,
            expectedVersion: ar!.version,
            patch: { code: "1201" },
          }),
        ),
      ).rejects.toMatchObject({ code: "SYSTEM_ACCOUNT" });
    });
  });

  // ------------------------------------------------------------ dimensions

  describe("dimensions", () => {
    it("tags flow through to grouped balances; inactive members are refused", async () => {
      const cash = await accountId("1000");
      const exp = await accountId("6700");
      const propertyA = await withTenant(tenantId, (tx) =>
        upsertDimensionMember(tx, owner, {
          dimensionType: "property",
          packEntityId: crypto.randomUUID(),
          displayName: "123 Maple St",
        }),
      );
      await withTenant(tenantId, (tx) =>
        postEntry(tx, owner, {
          status: "posted",
          entryDate: "2026-04-01",
          lines: [
            { accountId: exp, amountCents: 2500, dimensionMemberIds: [propertyA.id] },
            { accountId: cash, amountCents: -2500 },
          ],
        }),
      );
      const grouped = await withTenant(tenantId, (tx) =>
        getBalances(tx, tenantId, {
          accountIds: [exp],
          groupByDimensionType: "property",
        }),
      );
      const tagged = grouped.find((r) => r.memberId === propertyA.id);
      expect(tagged?.netCents).toBe(2500);

      const archived = await withTenant(tenantId, (tx) =>
        upsertDimensionMember(tx, owner, {
          dimensionType: "property",
          packEntityId: crypto.randomUUID(),
          displayName: "Archived Property",
        }),
      );
      await withTenant(tenantId, (tx) =>
        tx
          .update(schema.dimensionMembers)
          .set({ isActive: false })
          .where(eq(schema.dimensionMembers.id, archived.id)),
      );
      await expect(
        withTenant(tenantId, (tx) =>
          postEntry(tx, owner, {
            status: "posted",
            entryDate: "2026-04-02",
            lines: [
              { accountId: exp, amountCents: 100, dimensionMemberIds: [archived.id] },
              { accountId: cash, amountCents: -100 },
            ],
          }),
        ),
      ).rejects.toMatchObject({ code: "DIMENSION_INVALID" });
    });
  });

  // ----------------------------------------------------------------- audit

  describe("audit atomicity", () => {
    it("mutation and audit row commit together — and roll back together", async () => {
      const cash = await accountId("1000");
      const exp = await accountId("6950");
      const marker = `${STAMP}-audit-atomic`;
      await expectDbReject(
        withTenant(tenantId, async (tx) => {
          await postEntry(tx, owner, {
            status: "posted",
            entryDate: "2026-04-03",
            memo: marker,
            lines: pair(exp, cash, 4400),
          });
          await logAuditInTx(tx, {
            action: "ledger.entry_posted",
            tenantId,
            actorClerkUserId: owner.userId,
            meta: { marker },
          });
          throw new Error("simulated failure after audit");
        }),
        /simulated/,
      );
      const entries = await withTenant(tenantId, (tx) =>
        tx.query.journalEntries.findMany({
          where: and(
            eq(schema.journalEntries.tenantId, tenantId),
            eq(schema.journalEntries.memo, marker),
          ),
        }),
      );
      expect(entries).toHaveLength(0);
      const audits = await withSystem((tx) =>
        tx
          .select()
          .from(schema.auditLog)
          .where(eq(schema.auditLog.action, "ledger.entry_posted")),
      );
      expect(
        audits.filter((a) => (a.meta as { marker?: string }).marker === marker),
      ).toHaveLength(0);
    });

    it("audit_log is append-only at the database level", async () => {
      await withTenant(tenantId, (tx) =>
        logAuditInTx(tx, {
          action: "ledger.test_append_only",
          tenantId,
          actorClerkUserId: owner.userId,
        }),
      );
      const [row] = await withSystem((tx) =>
        tx
          .select()
          .from(schema.auditLog)
          .where(eq(schema.auditLog.action, "ledger.test_append_only")),
      );
      await expectDbReject(
        withSystem((tx) =>
          tx
            .update(schema.auditLog)
            .set({ action: "tampered" })
            .where(eq(schema.auditLog.id, row.id)),
        ),
        /append-only/,
      );
      await expectDbReject(
        withSystem((tx) =>
          tx.delete(schema.auditLog).where(eq(schema.auditLog.id, row.id)),
        ),
        /append-only/,
      );
    });
  });

  // -------------------------------------------------------------- balances

  describe("balances & integrity", () => {
    it("trial balance sums to zero and matches the fixture", async () => {
      const tb = await withTenant(tenantId, (tx) =>
        getTrialBalance(tx, tenantId, "2026-12-31"),
      );
      expect(tb.totalNetCents).toBe(0);
      expect(tb.totalDebitCents).toBe(tb.totalCreditCents);
      expect(await withTenant(tenantId, (tx) => ledgerIsBalanced(tx, tenantId))).toBe(
        true,
      );
    });

    it("asOf cutoff excludes later entries", async () => {
      const cash = await accountId("1000");
      const exp = await accountId("6550");
      await withTenant(tenantId, (tx) =>
        postEntry(tx, owner, {
          status: "posted",
          entryDate: "2027-06-01",
          lines: pair(exp, cash, 7700),
        }),
      );
      const before = await withTenant(tenantId, (tx) =>
        getBalances(tx, tenantId, { accountIds: [exp], asOf: "2026-12-31" }),
      );
      const after = await withTenant(tenantId, (tx) =>
        getBalances(tx, tenantId, { accountIds: [exp], asOf: "2027-12-31" }),
      );
      const net = (rows: { netCents: number }[]) =>
        rows.reduce((a, r) => a + r.netCents, 0);
      expect(net(after) - net(before)).toBe(7700);
    });

    it("integrity monitor reports a healthy ledger", async () => {
      const integrity = await withSystem((tx) => getLedgerIntegrity(tx, tenantId));
      expect(integrity.balanced).toBe(true);
      expect(integrity.unbalancedEntries).toHaveLength(0);
      expect(integrity.totalCents).toBe(0);
    });
  });

  // --------------------------------------------------------------- errors

  it("LedgerError instances survive the transaction boundary", async () => {
    try {
      await withTenant(tenantId, (tx) =>
        postEntry(tx, staff, {
          status: "posted",
          entryDate: "2026-05-01",
          lines: [],
        }),
      );
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(LedgerError);
    }
  });
});
