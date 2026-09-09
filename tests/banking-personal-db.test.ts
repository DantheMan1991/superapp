import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { withTenant, withSystem, schema, type Tx } from "../src/db";
import {
  bsGroupFor,
  isCodableAccount,
  startReconciliation,
  type LedgerCtx,
} from "../src/modules/accounting/core";
import { provisionAccounting } from "../src/modules/accounting/templates/apply";
import {
  createBankAccount,
  suggestBankAccountCode,
} from "../src/modules/accounting/banking/accounts";
import { importTransactions } from "../src/modules/accounting/banking/import";
import {
  categorizeTransaction,
  readAiSuggestion,
  setTransactionExcluded,
} from "../src/modules/accounting/banking/review";
import {
  applyRulesToUnreviewed,
  createRule,
  listRules,
  proposeExcludeRulesFromHistory,
  readRuleSuggestion,
} from "../src/modules/accounting/banking/rules";
import {
  suggestCategoriesForBankAccount,
  type SuggestGathered,
} from "../src/modules/accounting/ai/suggest";
import { PERSONAL_CODE } from "../src/modules/accounting/ai/prompt";

/**
 * The personal register (ADR 0034), run against real RLS.
 *
 * What this file certifies: the register's ledger leg is equity and opens with
 * nothing; an exclude rule sets rows aside on arrival and posts nothing; a
 * business line paid from the account credits the owner's funds and a receipt
 * landing in it debits them; setting aside teaches the register a rule, once;
 * the sweep is told which account it is looking at and what was already set
 * aside; and staff see neither the register, its rows nor its rules, while the
 * owner and the accountant see all three.
 */
const d = process.env.DATABASE_URL ? describe : describe.skip;

d("the personal register (ADR 0034)", () => {
  const STAMP = `bank-personal-${process.pid}`;
  let tenantId: string;
  let owner: LedgerCtx;
  let staff: LedgerCtx;
  let expert: LedgerCtx;
  let registerId: string;
  let fundsAccountId: string;
  let checkingId: string;

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

  async function importRows(
    target: string,
    rows: Array<{ date: string; description: string; cents: number }>,
  ) {
    return as(owner, (tx) =>
      importTransactions(tx, owner, {
        bankAccountId: target,
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

  async function rowsOn(target: string, ctx: LedgerCtx = owner) {
    return as(ctx, (tx) =>
      tx.query.bankTransactions.findMany({
        where: and(
          eq(schema.bankTransactions.tenantId, tenantId),
          eq(schema.bankTransactions.bankAccountId, target),
        ),
        orderBy: (t, { asc }) => [asc(t.txnDate), asc(t.description)],
      }),
    );
  }

  const byDescription = (rows: Awaited<ReturnType<typeof rowsOn>>, description: string) =>
    rows.filter((r) => r.description === description);

  beforeAll(async () => {
    tenantId = await withSystem(async (tx) => {
      const rows = await tx
        .insert(schema.tenants)
        .values([{ clerkOrgId: STAMP, name: "Personal Register Test", slug: STAMP }])
        .returning();
      return rows[0].id;
    });
    owner = { tenantId, userId: `${STAMP}-owner`, role: "owner" };
    staff = { tenantId, userId: `${STAMP}-staff`, role: "staff" };
    expert = { tenantId, userId: `${STAMP}-expert`, role: "expert" };
    await as(owner, (tx) => provisionAccounting(tx, tenantId));
    const personal = await as(owner, (tx) =>
      createBankAccount(tx, owner, { name: "Chase personal", kind: "personal" }),
    );
    registerId = personal.bankAccount.id;
    fundsAccountId = personal.ledgerAccount.id;
    const checking = await as(owner, (tx) =>
      createBankAccount(tx, owner, { name: "Farm Checking", kind: "checking" }),
    );
    checkingId = checking.bankAccount.id;
  });

  afterAll(async () => {
    await withSystem(async (tx) => {
      await tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantId));
    });
  });

  it("opens as an equity account in the 3300s, with no opening balance and no reconciliation", async () => {
    const funds = await as(owner, (tx) =>
      tx.query.accounts.findFirst({
        where: and(eq(schema.accounts.tenantId, tenantId), eq(schema.accounts.id, fundsAccountId)),
      }),
    );
    expect(funds).toMatchObject({ accountType: "equity", subtype: "owner_funds", code: "3300" });
    expect(suggestBankAccountCode(["3300"], "personal")).toBe("3310");
    // Nobody may code a bill or invoice line to it, whether or not they can
    // see the register that owns it — the subtype alone refuses.
    expect(isCodableAccount(funds!, new Set())).toBe(false);
    expect(bsGroupFor(funds!)).toBe("equity");

    await expect(
      as(owner, (tx) =>
        createBankAccount(tx, owner, {
          name: "With a balance",
          kind: "personal",
          openingBalanceCents: 50_000,
          openingBalanceDate: "2026-01-01",
        }),
      ),
    ).rejects.toMatchObject({ code: "PERSONAL_REGISTER" });

    await expect(
      as(owner, (tx) =>
        startReconciliation(tx, owner, {
          bankAccountId: registerId,
          statementEndDate: "2026-01-31",
          statementEndBalanceCents: 123_456,
        }),
      ),
    ).rejects.toMatchObject({ code: "PERSONAL_REGISTER" });
  });

  it("an exclude rule sets rows aside on arrival, posts nothing, and the rest wait", async () => {
    // An exclude rule names no category, and is refused when it tries to.
    const expense = await accountId("6000");
    await expect(
      as(owner, (tx) =>
        createRule(tx, owner, {
          name: "Wrong shape",
          appliesTo: "both",
          bankAccountId: registerId,
          matchMode: "all",
          conditions: [{ field: "description", op: "contains", value: "KROGER" }],
          action: "exclude",
          setAccountId: expense,
          setVendorId: null,
          setMemo: null,
          autoPost: false,
        }),
      ),
    ).rejects.toMatchObject({ code: "ACCOUNT_NOT_FOUND" });

    const rule = await as(owner, (tx) =>
      createRule(tx, owner, {
        name: "Kroger is personal",
        appliesTo: "both",
        bankAccountId: registerId,
        matchMode: "all",
        conditions: [{ field: "description", op: "contains", value: "KROGER" }],
        action: "exclude",
        setAccountId: null,
        setVendorId: null,
        setMemo: null,
        autoPost: false,
      }),
    );
    expect(rule).toMatchObject({ action: "exclude", setAccountId: null, autoPost: false });

    const result = await importRows(registerId, [
      { date: "2026-01-05", description: "KROGER #412", cents: -4_200 },
      { date: "2026-01-12", description: "KROGER FUEL 9", cents: -6_000 },
      { date: "2026-01-19", description: "KROGER #412", cents: -3_100 },
      { date: "2026-01-20", description: "RURAL KING", cents: -14_200 },
      { date: "2026-01-21", description: "NETFLIX.COM", cents: -1_599 },
      { date: "2026-01-22", description: "FARM MARKET CASH", cents: 8_600 },
    ]);
    expect(result.imported).toBe(6);
    expect(result.rules).toMatchObject({ matched: 3, excluded: 3, autoPosted: 0 });

    const rows = await rowsOn(registerId);
    const kroger = rows.filter((r) => r.description.startsWith("KROGER"));
    expect(kroger).toHaveLength(3);
    for (const row of kroger) {
      expect(row.status).toBe("excluded");
      expect(row.journalEntryId).toBeNull();
      expect(readRuleSuggestion(row)).toMatchObject({
        ruleId: rule.id,
        action: "exclude",
        accountId: null,
      });
    }
    expect(rows.filter((r) => r.status === "unreviewed")).toHaveLength(3);

    // Re-applying is idempotent: the set-aside rows are not unreviewed, so
    // nothing matches twice.
    const again = await as(owner, (tx) =>
      applyRulesToUnreviewed(tx, owner, { bankAccountId: registerId }),
    );
    expect(again).toMatchObject({ matched: 0, excluded: 0 });
  });

  it("posting a business line credits the owner's funds, and a receipt debits them", async () => {
    const rows = await rowsOn(registerId);
    const feed = byDescription(rows, "RURAL KING")[0];
    const sale = byDescription(rows, "FARM MARKET CASH")[0];
    const expense = await accountId("6000");
    const income = await accountId("4000");

    const paid = await as(owner, (tx) =>
      categorizeTransaction(tx, owner, { transactionId: feed.id, accountId: expense }),
    );
    const received = await as(owner, (tx) =>
      categorizeTransaction(tx, owner, { transactionId: sale.id, accountId: income }),
    );

    const lines = await as(owner, (tx) =>
      tx.query.journalLines.findMany({
        where: and(
          eq(schema.journalLines.tenantId, tenantId),
          eq(schema.journalLines.accountId, fundsAccountId),
        ),
      }),
    );
    const byEntry = new Map(lines.map((l) => [l.entryId, l.amountCents]));
    // Money the owner put in: the register's leg is a CREDIT to equity.
    expect(byEntry.get(paid.entry.id)).toBe(-14_200);
    // Money the owner took out: a DEBIT to equity.
    expect(byEntry.get(received.entry.id)).toBe(8_600);
    // Net, what the card and the page show as "put in by you, net" is 5,600.
    expect(lines.reduce((s, l) => s + l.amountCents, 0)).toBe(-5_600);
  });

  it("setting aside teaches the register: three of a kind propose an exclude rule, once", async () => {
    const rows = await rowsOn(registerId);
    const netflix = byDescription(rows, "NETFLIX.COM")[0];
    await as(owner, (tx) =>
      setTransactionExcluded(tx, owner, { transactionId: netflix.id, excluded: true }),
    );
    // Kroger has three set aside but a rule already covers it; Netflix has one.
    expect(
      await as(owner, (tx) => proposeExcludeRulesFromHistory(tx, owner, { bankAccountId: registerId })),
    ).toEqual([]);

    await importRows(registerId, [
      { date: "2026-02-21", description: "NETFLIX.COM", cents: -1_599 },
      { date: "2026-03-21", description: "NETFLIX.COM", cents: -1_599 },
    ]);
    for (const row of byDescription(await rowsOn(registerId), "NETFLIX.COM")) {
      if (row.status === "unreviewed") {
        await as(owner, (tx) =>
          setTransactionExcluded(tx, owner, { transactionId: row.id, excluded: true }),
        );
      }
    }
    const proposed = await as(owner, (tx) =>
      proposeExcludeRulesFromHistory(tx, owner, { bankAccountId: registerId }),
    );
    expect(proposed).toHaveLength(1);
    expect(proposed[0]).toMatchObject({
      name: "(Suggested) Netflix Com as personal",
      action: "exclude",
      setAccountId: null,
      isSuggested: true,
      isActive: true,
      bankAccountId: registerId,
      autoPost: false,
    });
    // Once. The phrase is covered now, and stays covered if it is dismissed.
    expect(
      await as(owner, (tx) => proposeExcludeRulesFromHistory(tx, owner, { bankAccountId: registerId })),
    ).toEqual([]);

    // A business register never proposes one: an excluded row there is a
    // duplicate or a non-movement, not a payee to stop watching.
    await importRows(checkingId, [
      { date: "2026-01-03", description: "DUPLICATE FEE", cents: -500 },
      { date: "2026-01-04", description: "DUPLICATE FEE", cents: -500 },
      { date: "2026-01-05", description: "DUPLICATE FEE", cents: -500 },
    ]);
    for (const row of await rowsOn(checkingId)) {
      await as(owner, (tx) =>
        setTransactionExcluded(tx, owner, { transactionId: row.id, excluded: true }),
      );
    }
    expect(
      await as(owner, (tx) => proposeExcludeRulesFromHistory(tx, owner, { bankAccountId: checkingId })),
    ).toEqual([]);
  });

  it("the sweep is told whose account it is, remembers what was set aside, and may answer PERSONAL", async () => {
    await importRows(registerId, [
      { date: "2026-04-01", description: "CVS PHARMACY", cents: -2_500 },
      { date: "2026-04-02", description: "TRACTOR SUPPLY", cents: -9_900 },
    ]);
    const rows = await rowsOn(registerId);
    const cvs = byDescription(rows, "CVS PHARMACY")[0];
    const tractor = byDescription(rows, "TRACTOR SUPPLY")[0];

    let gathered: SuggestGathered | null = null;
    const result = await suggestCategoriesForBankAccount(owner, registerId, async (g) => {
      gathered = g;
      return {
        suggestions: [
          { transactionId: cvs.id, accountCode: PERSONAL_CODE, confidence: 0.93, reason: "pharmacy" },
          { transactionId: tractor.id, accountCode: "6000", confidence: 0.8 },
        ],
      };
    });
    expect(result).toEqual({ requested: 2, returned: 2 });
    expect(gathered!.personal).toBe(true);
    // The rows set aside earlier travel as history under the one code that
    // means "not the business's".
    expect(gathered!.history).toContainEqual({ description: "KROGER #412", code: PERSONAL_CODE });
    expect(gathered!.history).toContainEqual({ description: "NETFLIX.COM", code: PERSONAL_CODE });

    const after = await rowsOn(registerId);
    expect(readAiSuggestion(byDescription(after, "CVS PHARMACY")[0])).toMatchObject({
      personal: true,
      accountId: null,
      accountCode: PERSONAL_CODE,
      confidence: 0.93,
    });
    expect(readAiSuggestion(byDescription(after, "TRACTOR SUPPLY")[0])).toMatchObject({
      accountId: await accountId("6000"),
      accountCode: "6000",
    });

    // On a business register the same answer is dropped: PERSONAL is not in
    // the chart, and it was never offered.
    await withSystem((tx) =>
      tx
        .update(schema.accountingSettings)
        .set({ aiLastSuggestedAt: null })
        .where(eq(schema.accountingSettings.tenantId, tenantId)),
    );
    await importRows(checkingId, [{ date: "2026-04-03", description: "CVS PHARMACY", cents: -1_200 }]);
    const checkingCvs = byDescription(await rowsOn(checkingId), "CVS PHARMACY")[0];
    const business = await suggestCategoriesForBankAccount(owner, checkingId, async (g) => {
      expect(g.personal).toBe(false);
      return {
        suggestions: [
          { transactionId: checkingCvs.id, accountCode: PERSONAL_CODE, confidence: 0.9 },
        ],
      };
    });
    expect(business).toEqual({ requested: 1, returned: 0 });
  });

  it("staff see neither the register, its rows nor its rules; the owner and the accountant see all three", async () => {
    const seenBy = async (ctx: LedgerCtx) => {
      const registers = await as(ctx, (tx) =>
        tx.query.bankAccounts.findMany({ where: eq(schema.bankAccounts.tenantId, tenantId) }),
      );
      const rows = await rowsOn(registerId, ctx);
      const rules = await as(ctx, (tx) => listRules(tx, tenantId));
      return {
        registers: registers.map((b) => b.id).sort(),
        rows: rows.length,
        scopedRules: rules.filter((r) => r.bankAccountId === registerId).length,
      };
    };

    const asStaff = await seenBy(staff);
    expect(asStaff.registers).toEqual([checkingId]);
    expect(asStaff.rows).toBe(0);
    expect(asStaff.scopedRules).toBe(0);

    const asExpert = await seenBy(expert);
    expect(asExpert.registers).toEqual([checkingId, registerId].sort());
    expect(asExpert.rows).toBeGreaterThan(0);
    expect(asExpert.scopedRules).toBe(2);

    const asOwner = await seenBy(owner);
    expect(asOwner).toEqual(asExpert);

    // And staff cannot put a row INTO it either: the policy's WITH CHECK
    // inherits from the register they cannot see.
    await expect(
      as(staff, (tx) =>
        tx.insert(schema.bankTransactions).values({
          tenantId,
          bankAccountId: registerId,
          txnDate: "2026-05-01",
          description: "SMUGGLED",
          amountCents: -100,
          externalHash: `${STAMP}-smuggled`,
        }),
      ),
    ).rejects.toThrow();
  });
});
