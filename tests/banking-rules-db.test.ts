import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { withTenant, withSystem, schema } from "../src/db";
import {
  getDefaultEntityId,
  setClosedThrough,
  type LedgerCtx,
} from "../src/modules/accounting/core";
import { provisionAccounting } from "../src/modules/accounting/templates/apply";
import {
  createBankAccount,
  setBankAccountActive,
} from "../src/modules/accounting/banking/accounts";
import { createVendor } from "../src/modules/accounting/payables/vendors";
import { importTransactions } from "../src/modules/accounting/banking/import";
import { categorizeTransaction } from "../src/modules/accounting/banking/review";
import {
  applyRulesToUnreviewed,
  createRule,
  dismissSuggestedRule,
  listRules,
  proposeRuleFromHistory,
  readRuleSuggestion,
} from "../src/modules/accounting/banking/rules";

/**
 * Bank rules against the database: matching on import, auto-post through the
 * real posting engine, the period-lock yield, and learning a rule from
 * hand-categorized history.
 *
 * The pure matching matrix lives in tests/banking-rules.test.ts — this file
 * only covers what needs rows.
 */

const d = process.env.DATABASE_URL ? describe : describe.skip;

d("bank rules (DB)", () => {
  const STAMP = `bank-rules-test-${process.pid}`;
  let tenantId: string;
  let owner: LedgerCtx;
  let registerId: string;
  let registerAccountId: string;

  async function accountId(code: string): Promise<string> {
    const row = await withTenant(tenantId, (tx) =>
      tx.query.accounts.findFirst({
        where: and(
          eq(schema.accounts.tenantId, tenantId),
          eq(schema.accounts.code, code),
        ),
      }),
    );
    if (!row) throw new Error(`account ${code} missing`);
    return row.id;
  }

  async function importRows(
    rows: Array<{ date: string; description: string; cents: number }>,
  ) {
    return withTenant(tenantId, (tx) =>
      importTransactions(tx, owner, {
        bankAccountId: registerId,
        txns: rows.map((r, i) => ({
          txnDate: r.date,
          description: r.description,
          amountCents: r.cents,
          raw: [],
          dupIndex: i,
        })),
      }),
    );
  }

  async function txnsFor(description: string) {
    return withTenant(tenantId, (tx) =>
      tx.query.bankTransactions.findMany({
        where: and(
          eq(schema.bankTransactions.tenantId, tenantId),
          eq(schema.bankTransactions.description, description),
        ),
      }),
    );
  }

  beforeAll(async () => {
    tenantId = await withSystem(async (tx) => {
      const rows = await tx
        .insert(schema.tenants)
        .values([{ clerkOrgId: STAMP, name: "Bank Rules Test", slug: STAMP }])
        .returning();
      return rows[0].id;
    });
    owner = { tenantId, userId: "owner", role: "owner" };
    await withTenant(tenantId, (tx) => provisionAccounting(tx, tenantId));
    const created = await withTenant(tenantId, (tx) =>
      createBankAccount(tx, owner, { name: "Rules Checking", kind: "checking" }),
    );
    registerId = created.bankAccount.id;
    registerAccountId = created.ledgerAccount.id;
  });

  afterAll(async () => {
    await withSystem(async (tx) => {
      await tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantId));
    });
  });

  it("a rule suggests a category on import, without posting", async () => {
    const insurance = await accountId("6100");
    await withTenant(tenantId, (tx) =>
      createRule(tx, owner, {
        name: "Westfield as Insurance",
        appliesTo: "both",
        bankAccountId: null,
        matchMode: "all",
        conditions: [
          { field: "description", op: "contains", value: "westfield" },
        ],
        setAccountId: insurance,
        setVendorId: null,
        setMemo: null,
        autoPost: false,
      }),
    );

    const result = await importRows([
      { date: "2026-03-01", description: "OH WESTFIELD INS", cents: -64_067 },
      { date: "2026-03-02", description: "KROGER", cents: -5_000 },
    ]);
    expect(result.imported).toBe(2);
    expect(result.rules.matched).toBe(1);
    expect(result.rules.autoPosted).toBe(0);

    const [matched] = await txnsFor("OH WESTFIELD INS");
    const suggestion = readRuleSuggestion(matched);
    expect(suggestion?.accountId).toBe(insurance);
    expect(suggestion?.accountCode).toBe("6100");
    expect(suggestion?.ruleName).toBe("Westfield as Insurance");
    // Suggesting is not posting.
    expect(matched.status).toBe("unreviewed");
    expect(matched.journalEntryId).toBeNull();

    const [unmatched] = await txnsFor("KROGER");
    expect(readRuleSuggestion(unmatched)).toBeNull();
  });

  it("an auto-post rule posts a balanced entry through the engine", async () => {
    const utilities = await accountId("6650");
    await withTenant(tenantId, (tx) =>
      createRule(tx, owner, {
        name: "Water as Utilities",
        appliesTo: "money_out",
        bankAccountId: registerId,
        matchMode: "all",
        conditions: [
          { field: "description", op: "contains", value: "division of water" },
        ],
        setAccountId: utilities,
        setVendorId: null,
        setMemo: "Monthly water",
        autoPost: true,
      }),
    );

    const result = await importRows([
      { date: "2026-03-05", description: "CITY DIVISION OF WATER", cents: -600 },
    ]);
    expect(result.rules.autoPosted).toBe(1);

    const [posted] = await txnsFor("CITY DIVISION OF WATER");
    expect(posted.status).toBe("posted");
    expect(posted.journalEntryId).not.toBeNull();

    const lines = await withTenant(tenantId, (tx) =>
      tx.query.journalLines.findMany({
        where: and(
          eq(schema.journalLines.tenantId, tenantId),
          eq(schema.journalLines.entryId, posted.journalEntryId!),
        ),
      }),
    );
    expect(lines).toHaveLength(2);
    expect(lines.reduce((sum, l) => sum + l.amountCents, 0)).toBe(0);
    expect(lines.find((l) => l.accountId === utilities)?.amountCents).toBe(600);
    expect(lines.find((l) => l.accountId === registerAccountId)?.amountCents).toBe(
      -600,
    );

    const entry = await withTenant(tenantId, (tx) =>
      tx.query.journalEntries.findFirst({
        where: eq(schema.journalEntries.id, posted.journalEntryId!),
      }),
    );
    expect(entry?.memo).toBe("Monthly water");
    expect(entry?.source).toBe("bank_import");
  });

  it("re-applying rules is idempotent — a posted row is left alone", async () => {
    const before = await txnsFor("CITY DIVISION OF WATER");
    const result = await withTenant(tenantId, (tx) =>
      applyRulesToUnreviewed(tx, owner, { bankAccountId: registerId }),
    );
    // Already posted, so it is not in the unreviewed queue any more.
    expect(result.autoPosted).toBe(0);
    const after = await txnsFor("CITY DIVISION OF WATER");
    expect(after[0].journalEntryId).toBe(before[0].journalEntryId);
    expect(after).toHaveLength(1);
  });

  it("auto-post yields to a closed period, and the import still succeeds", async () => {
    await withTenant(tenantId, async (tx) =>
      setClosedThrough(tx, owner, { entityId: await getDefaultEntityId(tx, tenantId), date: "2026-04-30" }),
    );

    const result = await importRows([
      // Inside the closed period — must not post.
      { date: "2026-04-15", description: "CITY DIVISION OF WATER", cents: -600 },
      // After it — must post.
      { date: "2026-05-15", description: "CITY DIVISION OF WATER", cents: -600 },
    ]);
    expect(result.imported).toBe(2);
    expect(result.rules.skippedLocked).toBe(1);
    expect(result.rules.autoPosted).toBe(1);

    const rows = await txnsFor("CITY DIVISION OF WATER");
    const locked = rows.find((r) => r.txnDate === "2026-04-15");
    expect(locked?.status).toBe("unreviewed");
    // Still suggested, so the owner can post it once the period reopens.
    expect(readRuleSuggestion(locked!)?.accountCode).toBe("6650");
    expect(rows.find((r) => r.txnDate === "2026-05-15")?.status).toBe("posted");

    await withTenant(tenantId, async (tx) =>
      setClosedThrough(tx, owner, { entityId: await getDefaultEntityId(tx, tenantId), date: null }),
    );
  });

  it("A CLOSED REGISTER SKIPS ITS ROWS RATHER THAN FAILING THE WHOLE RUN", async () => {
    /**
     * **A BULK APPLY SPANS EVERY REGISTER, and it runs in ONE transaction.**
     * `categorizeTransaction` refuses a closed register — that is what
     * `loadWritableBankAccount` is for — so an unguarded call here would throw
     * and roll back every suggestion already written for every OTHER account.
     * The row keeps its suggestion and waits for a person, which is what
     * "closed" is supposed to mean: no NEW financial effect, not "this run
     * fails".
     *
     * Found by merging the closed-register guard into a rules engine written
     * five days after it. The guard was right; the caller had grown since.
     *
     * **The sequence is the realistic one, and the first attempt was not.**
     * Importing a row that a rule already covers auto-posts it on the way in,
     * so there is nothing left unreviewed to skip. Rows go in first, the rule
     * is written afterwards, and the bulk apply is what would have posted them.
     */
    await importRows([
      { date: "2026-07-11", description: "TRACTOR SUPPLY 4417", cents: -8_200 },
    ]);
    const supplies = await accountId("6650");
    await withTenant(tenantId, (tx) =>
      createRule(tx, owner, {
        name: "Tractor Supply as Utilities",
        appliesTo: "money_out",
        bankAccountId: registerId,
        matchMode: "all",
        conditions: [
          { field: "description", op: "contains", value: "tractor supply" },
        ],
        setAccountId: supplies,
        setVendorId: null,
        setMemo: null,
        autoPost: true,
      }),
    );

    const register = await withTenant(tenantId, (tx) =>
      tx.query.bankAccounts.findFirst({
        where: eq(schema.bankAccounts.id, registerId),
      }),
    );
    await withTenant(tenantId, (tx) =>
      setBankAccountActive(tx, owner, {
        bankAccountId: registerId,
        expectedVersion: register!.version,
        active: false,
      }),
    );

    // The run COMPLETES. Before the fix this threw BANK_ACCOUNT_INACTIVE and
    // took every suggestion in the same transaction down with it.
    const result = await withTenant(tenantId, (tx) =>
      applyRulesToUnreviewed(tx, owner, { bankAccountId: registerId }),
    );
    expect(result.skippedClosed).toBe(1);
    expect(result.autoPosted).toBe(0);

    // Still suggested, so it can be posted once the register reopens.
    const row = (await txnsFor("TRACTOR SUPPLY 4417"))[0];
    expect(row.status).toBe("unreviewed");
    expect(readRuleSuggestion(row)?.accountCode).toBe("6650");

    const closed = await withTenant(tenantId, (tx) =>
      tx.query.bankAccounts.findFirst({
        where: eq(schema.bankAccounts.id, registerId),
      }),
    );
    await withTenant(tenantId, (tx) =>
      setBankAccountActive(tx, owner, {
        bankAccountId: registerId,
        expectedVersion: closed!.version,
        active: true,
      }),
    );

    // And reopening lets it post, so skipping lost nothing.
    const after = await withTenant(tenantId, (tx) =>
      applyRulesToUnreviewed(tx, owner, { bankAccountId: registerId }),
    );
    expect(after.autoPosted).toBe(1);
    expect(after.skippedClosed).toBe(0);
  });

  it("proposes a rule once the same coding is chosen by hand often enough", async () => {
    const office = await accountId("6300");
    await importRows([
      { date: "2026-06-01", description: "INTUIT *QBOOKS 001", cents: -4_076 },
      { date: "2026-06-02", description: "INTUIT *QBOOKS 002", cents: -4_076 },
      { date: "2026-06-03", description: "INTUIT *QBOOKS 003", cents: -4_076 },
    ]);
    const rows = (await withTenant(tenantId, (tx) =>
      tx.query.bankTransactions.findMany({
        where: and(
          eq(schema.bankTransactions.tenantId, tenantId),
          eq(schema.bankTransactions.status, "unreviewed"),
        ),
      }),
    )).filter((r) => r.description.startsWith("INTUIT"));
    expect(rows).toHaveLength(3);

    // Two hand-codings is not yet a pattern.
    for (const row of rows.slice(0, 2)) {
      await withTenant(tenantId, (tx) =>
        categorizeTransaction(tx, owner, {
          transactionId: row.id,
          accountId: office,
        }),
      );
    }
    const early = await withTenant(tenantId, (tx) =>
      proposeRuleFromHistory(tx, owner, {
        bankAccountId: registerId,
        accountId: office,
      }),
    );
    expect(early).toBeNull();

    // The third crosses the threshold.
    await withTenant(tenantId, (tx) =>
      categorizeTransaction(tx, owner, {
        transactionId: rows[2].id,
        accountId: office,
      }),
    );
    const proposed = await withTenant(tenantId, (tx) =>
      proposeRuleFromHistory(tx, owner, {
        bankAccountId: registerId,
        accountId: office,
      }),
    );
    expect(proposed).not.toBeNull();
    expect(proposed!.isSuggested).toBe(true);
    expect(proposed!.autoPost).toBe(false);
    expect(proposed!.name).toBe("(Suggested) Intuit Qbooks as Office Supplies & Software");
    expect(proposed!.conditions).toEqual([
      { field: "description", op: "contains", value: "intuit qbooks" },
    ]);

    // And never twice for the same phrase.
    const again = await withTenant(tenantId, (tx) =>
      proposeRuleFromHistory(tx, owner, {
        bankAccountId: registerId,
        accountId: office,
      }),
    );
    expect(again).toBeNull();
  });

  it("a dismissed suggestion stays dismissed and stops matching", async () => {
    const suggested = (await withTenant(tenantId, (tx) => listRules(tx, tenantId))).find(
      (r) => r.isSuggested,
    );
    expect(suggested).toBeDefined();

    await withTenant(tenantId, (tx) =>
      dismissSuggestedRule(tx, owner, { ruleId: suggested!.id }),
    );
    const after = await withTenant(tenantId, (tx) =>
      tx.query.bankRules.findFirst({ where: eq(schema.bankRules.id, suggested!.id) }),
    );
    // Deactivated, NOT deleted — deletion would let it be re-proposed.
    expect(after?.isActive).toBe(false);
    expect(after?.isSuggested).toBe(true);

    await importRows([
      { date: "2026-06-10", description: "INTUIT *QBOOKS 004", cents: -4_076 },
    ]);
    const [row] = await txnsFor("INTUIT *QBOOKS 004");
    expect(readRuleSuggestion(row)).toBeNull();

    const office = await accountId("6300");
    const reproposed = await withTenant(tenantId, (tx) =>
      proposeRuleFromHistory(tx, owner, {
        bankAccountId: registerId,
        accountId: office,
      }),
    );
    expect(reproposed).toBeNull();
  });

  it("a rule sets the payee onto the row, and never overwrites one already there", async () => {
    const insurance = await accountId("6100");
    const vendor = await withTenant(tenantId, (tx) =>
      createVendor(tx, owner, { name: "Westfield Insurance Co" }),
    );
    await withTenant(tenantId, (tx) =>
      createRule(tx, owner, {
        name: "Signatures as Insurance",
        appliesTo: "both",
        bankAccountId: null,
        matchMode: "all",
        conditions: [{ field: "description", op: "contains", value: "signatures" }],
        setAccountId: insurance,
        setVendorId: vendor.id,
        setMemo: null,
        autoPost: false,
      }),
    );

    await importRows([
      { date: "2026-07-20", description: "OH SIGNATURES INS", cents: -12_345 },
    ]);
    const [row] = await txnsFor("OH SIGNATURES INS");
    // The payee is applied to the row itself, not merely suggested: it posts
    // nothing, so there is nothing to accept.
    expect(row.vendorId).toBe(vendor.id);
    const suggestion = readRuleSuggestion(row);
    expect(suggestion?.vendorId).toBe(vendor.id);
    expect(suggestion?.vendorName).toBe("Westfield Insurance Co");

    // A payee chosen by hand outranks the rule on a re-run.
    const other = await withTenant(tenantId, (tx) =>
      createVendor(tx, owner, { name: "Someone Else Ltd" }),
    );
    await withTenant(tenantId, (tx) =>
      tx
        .update(schema.bankTransactions)
        .set({ vendorId: other.id })
        .where(eq(schema.bankTransactions.id, row.id)),
    );
    await withTenant(tenantId, (tx) =>
      applyRulesToUnreviewed(tx, owner, { bankAccountId: registerId }),
    );
    const [after] = await txnsFor("OH SIGNATURES INS");
    expect(after.vendorId).toBe(other.id);
  });

  it("refuses a payee that is not an active vendor", async () => {
    const insurance = await accountId("6100");
    const vendor = await withTenant(tenantId, (tx) =>
      createVendor(tx, owner, { name: "Deactivated Vendor" }),
    );
    await withTenant(tenantId, (tx) =>
      tx
        .update(schema.vendors)
        .set({ isActive: false })
        .where(eq(schema.vendors.id, vendor.id)),
    );
    await expect(
      withTenant(tenantId, (tx) =>
        createRule(tx, owner, {
          name: "Dead payee",
          appliesTo: "both",
          bankAccountId: null,
          matchMode: "all",
          conditions: [{ field: "description", op: "contains", value: "zzz" }],
          setAccountId: insurance,
          setVendorId: vendor.id,
          setMemo: null,
          autoPost: false,
        }),
      ),
    ).rejects.toThrow();
  });

  it("a rule may not code to the register's own account", async () => {
    await expect(
      withTenant(tenantId, (tx) =>
        createRule(tx, owner, {
          name: "Self-referential",
          appliesTo: "both",
          bankAccountId: null,
          matchMode: "all",
          conditions: [{ field: "description", op: "contains", value: "x" }],
          setAccountId: registerAccountId,
          setVendorId: null,
          setMemo: null,
          autoPost: false,
        }),
      ),
    ).rejects.toThrow();
  });

  it("staff cannot write rules", async () => {
    const staff: LedgerCtx = { tenantId, userId: "staff", role: "staff" };
    const insurance = await accountId("6100");
    await expect(
      withTenant(tenantId, (tx) =>
        createRule(tx, staff, {
          name: "Staff rule",
          appliesTo: "both",
          bankAccountId: null,
          matchMode: "all",
          conditions: [{ field: "description", op: "contains", value: "x" }],
          setAccountId: insurance,
          setVendorId: null,
          setMemo: null,
          autoPost: false,
        }),
      ),
    ).rejects.toThrow();
  });
});
