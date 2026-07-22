import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { withTenant, withSystem, schema } from "../src/db";
import { decryptSecret, encryptSecret } from "../src/lib/crypto";
import {
  completeReconciliation,
  editEntry,
  getReconciliationView,
  reopenReconciliation,
  reverseEntry,
  startReconciliation,
  toggleReconciliationLine,
  voidEntry,
  postEntry,
  type LedgerCtx,
} from "../src/modules/accounting/core";
import { provisionAccounting } from "../src/modules/accounting/templates/apply";
import {
  createBankAccount,
  suggestBankAccountCode,
} from "../src/modules/accounting/banking/accounts";
import {
  detectColumns,
  detectDateFormat,
  normalizeRows,
  parseCsv,
  parseSignedAmount,
  type ColumnMapping,
} from "../src/modules/accounting/banking/csv-parse";
import {
  externalHashFor,
  importTransactions,
} from "../src/modules/accounting/banking/import";
import { plaidTxnToStaging } from "../src/modules/accounting/banking/plaid";
import {
  categorizeTransaction,
  setTransactionExcluded,
} from "../src/modules/accounting/banking/review";
import {
  persistSuggestions,
  suggestCategoriesForBankAccount,
} from "../src/modules/accounting/ai/suggest";
import { validateSuggestions } from "../src/modules/accounting/ai/validate";

/**
 * Session 3 certification: CSV parsing (pure), AI validation (pure),
 * crypto (pure), Plaid mapping (pure), and the DB-backed banking flows —
 * import dedup, categorization, void coordination, the full
 * reconciliation lifecycle, and reconciled immutability incl. the
 * database FK backstop.
 */

// =====================================================================
// Pure suite
// =====================================================================

describe("csv parser", () => {
  it("handles quotes, escapes, embedded newlines, CRLF, BOM", () => {
    const csv = '﻿a,b,c\r\n"x, y","he said ""hi""","line\nbreak"\r\nplain,2,3\n';
    expect(parseCsv(csv)).toEqual([
      ["a", "b", "c"],
      ["x, y", 'he said "hi"', "line\nbreak"],
      ["plain", "2", "3"],
    ]);
  });
  it("throws on an unterminated quote", () => {
    expect(() => parseCsv('a,"broken')).toThrow(/unterminated/);
  });
  it("keeps ragged rows as-is", () => {
    expect(parseCsv("a,b\n1\n1,2,3")).toEqual([["a", "b"], ["1"], ["1", "2", "3"]]);
  });
});

describe("column & date detection", () => {
  it("detects standard headers", () => {
    const d = detectColumns(["Date", "Description", "Amount"]);
    expect(d).toMatchObject({ hasHeader: true, dateCol: 0, descCol: 1, amountCol: 2 });
  });
  it("detects debit/credit variants", () => {
    const d = detectColumns(["Posted Date", "Payee", "Withdrawal", "Deposit"]);
    expect(d).toMatchObject({ hasHeader: true, dateCol: 0, descCol: 1, debitCol: 2, creditCol: 3 });
  });
  it("no header → hasHeader false", () => {
    expect(detectColumns(["01/02/2026", "COFFEE", "-4.50"]).hasHeader).toBe(false);
  });
  it("date format detection incl. ambiguity", () => {
    expect(detectDateFormat(["2026-01-15", "2026-02-01"])).toEqual({
      format: "YYYY-MM-DD",
      ambiguous: false,
    });
    expect(detectDateFormat(["01/13/2026"])).toEqual({
      format: "MM/DD/YYYY",
      ambiguous: false,
    });
    expect(detectDateFormat(["13/01/2026"])).toEqual({
      format: "DD/MM/YYYY",
      ambiguous: false,
    });
    expect(detectDateFormat(["01/02/2026", "03/04/2026"])).toEqual({
      format: "MM/DD/YYYY",
      ambiguous: true,
    });
    expect(detectDateFormat(["garbage"])).toBeNull();
  });
});

describe("amount parsing & row normalization", () => {
  it("parseSignedAmount matrix", () => {
    expect(parseSignedAmount("1,234.56")).toBe(123456);
    expect(parseSignedAmount("$1,234.56")).toBe(123456);
    expect(parseSignedAmount("(1,234.56)")).toBe(-123456);
    expect(parseSignedAmount("-123.45")).toBe(-12345);
    expect(parseSignedAmount("0.5")).toBe(50);
    expect(parseSignedAmount("1.234")).toBeNull();
    expect(parseSignedAmount("")).toBeNull();
    expect(parseSignedAmount("abc")).toBeNull();
  });

  const mapping: ColumnMapping = {
    dateCol: 0,
    descCol: 1,
    amountCol: 2,
    dateFormat: "MM/DD/YYYY",
    negate: false,
  };

  it("normalizes rows, skips empties, collects errors, indexes dups", () => {
    const rows = [
      ["01/05/2026", "COFFEE  SHOP", "-4.50"],
      ["", "", ""],
      ["01/05/2026", "COFFEE SHOP", "-4.50"], // identical after whitespace collapse
      ["bad-date", "X", "1.00"],
      ["01/06/2026", "PAYCHECK", "1,000.00"],
    ];
    const { txns, errors } = normalizeRows(rows, mapping);
    expect(errors).toEqual([{ rowIndex: 3, problem: "bad date" }]);
    expect(txns).toHaveLength(3);
    expect(txns[0]).toMatchObject({
      txnDate: "2026-01-05",
      description: "COFFEE SHOP",
      amountCents: -450,
      dupIndex: 0,
    });
    expect(txns[1].dupIndex).toBe(1);
    expect(txns[2]).toMatchObject({ amountCents: 100000 });
  });

  it("debit/credit split and negate flag", () => {
    const dc: ColumnMapping = {
      dateCol: 0,
      descCol: 1,
      debitCol: 2,
      creditCol: 3,
      dateFormat: "YYYY-MM-DD",
      negate: false,
    };
    const { txns } = normalizeRows(
      [
        ["2026-01-05", "RENT", "1200.00", ""],
        ["2026-01-06", "DEPOSIT", "", "500.00"],
      ],
      dc,
    );
    expect(txns[0].amountCents).toBe(-120000);
    expect(txns[1].amountCents).toBe(50000);
    const negated = normalizeRows([["2026-01-05", "X", "10.00"]], {
      ...mapping,
      dateFormat: "YYYY-MM-DD",
      negate: true,
    });
    expect(negated.txns[0].amountCents).toBe(-1000);
  });

  it("hash stability + dupIndex/account sensitivity", () => {
    const t = { txnDate: "2026-01-05", description: "X", amountCents: -450, raw: [], dupIndex: 0 };
    expect(externalHashFor("acct-1", t)).toBe(externalHashFor("acct-1", { ...t }));
    expect(externalHashFor("acct-1", t)).not.toBe(externalHashFor("acct-1", { ...t, dupIndex: 1 }));
    expect(externalHashFor("acct-1", t)).not.toBe(externalHashFor("acct-2", t));
  });
});

describe("ai suggestion validation", () => {
  const accounts = new Map([
    ["6100", { id: "id-6100", isActive: true }],
    ["6400", { id: "id-6400", isActive: false }],
  ]);
  const batch = new Set(["t1", "t2"]);

  it("maps codes, drops unknowns/inactive, clamps confidence, first wins", () => {
    const out = validateSuggestions(
      {
        suggestions: [
          { transactionId: "t1", accountCode: "6100", confidence: 7, reason: "x".repeat(300) },
          { transactionId: "t1", accountCode: "6100", confidence: 0.2 }, // dup — ignored
          { transactionId: "t2", accountCode: "6400", confidence: 0.9 }, // inactive
          { transactionId: "tX", accountCode: "6100", confidence: 0.9 }, // unknown id
          { transactionId: "t2", accountCode: "9999", confidence: 0.9 }, // unknown code
        ],
      },
      batch,
      accounts,
      "model-x",
      "2026-07-21T00:00:00Z",
    );
    expect(out.size).toBe(1);
    const s = out.get("t1")!;
    expect(s).toMatchObject({ accountId: "id-6100", confidence: 1 });
    expect(s.reason).toHaveLength(200);
  });

  it("degrades to empty on garbage", () => {
    expect(validateSuggestions(null, batch, accounts, "m", "t").size).toBe(0);
    expect(validateSuggestions({ nope: 1 }, batch, accounts, "m", "t").size).toBe(0);
    expect(
      validateSuggestions({ suggestions: [{ confidence: NaN }] }, batch, accounts, "m", "t").size,
    ).toBe(0);
  });
});

describe("crypto", () => {
  beforeAll(() => {
    process.env.APP_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  });
  it("round-trips and produces distinct IVs", () => {
    const a = encryptSecret("access-token-123");
    const b = encryptSecret("access-token-123");
    expect(a).not.toBe(b);
    expect(decryptSecret(a)).toBe("access-token-123");
    expect(decryptSecret(b)).toBe("access-token-123");
  });
  it("detects tampering via the GCM auth tag", () => {
    const enc = encryptSecret("secret");
    const [iv, tag, data] = enc.split(".");
    const tampered = `${iv}.${tag}.${Buffer.from("XX" + Buffer.from(data, "base64").toString("binary").slice(2), "binary").toString("base64")}`;
    expect(() => decryptSecret(tampered)).toThrow();
  });
});

describe("plaid mapping", () => {
  const base = {
    account_id: "plaid-acct",
    transaction_id: "plaid-txn-1",
    date: "2026-07-01",
    name: "STARBUCKS  #123",
    merchant_name: "Starbucks",
    amount: 4.5, // Plaid: positive = money OUT
    pending: false,
    personal_finance_category: { primary: "FOOD_AND_DRINK" },
  };
  it("negates once, uses merchant name, keeps id as hash", () => {
    const s = plaidTxnToStaging(base as never)!;
    expect(s).toMatchObject({
      plaidAccountId: "plaid-acct",
      transactionId: "plaid-txn-1",
      txnDate: "2026-07-01",
      description: "Starbucks",
      amountCents: -450,
    });
  });
  it("skips pending; falls back to name; drops zero", () => {
    expect(plaidTxnToStaging({ ...base, pending: true } as never)).toBeNull();
    const s = plaidTxnToStaging({ ...base, merchant_name: null } as never)!;
    expect(s.description).toBe("STARBUCKS #123");
    expect(plaidTxnToStaging({ ...base, amount: 0 } as never)).toBeNull();
  });
});

describe("bank account codes", () => {
  it("suggests 1000-range for cash, 2100-range for cards", () => {
    expect(suggestBankAccountCode([], "checking")).toBe("1000");
    expect(suggestBankAccountCode(["1000"], "checking")).toBe("1010");
    expect(suggestBankAccountCode(["1000", "1010"], "savings")).toBe("1020");
    expect(suggestBankAccountCode([], "credit_card")).toBe("2100");
    const dense = Array.from({ length: 10 }, (_, i) => String(1000 + i * 10));
    expect(suggestBankAccountCode(dense, "checking")).toBe("1001");
  });
});

// =====================================================================
// DB suite
// =====================================================================

const RUN = !!process.env.DATABASE_URL;
const d = RUN ? describe : describe.skip;

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

d("banking (DB)", () => {
  const STAMP = `banking-test-${process.pid}`;
  let tenantId: string;
  let owner: LedgerCtx;
  let staff: LedgerCtx;
  const acct: Record<string, string> = {};

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
    if (!row) throw new Error(`account ${code} missing`);
    acct[code] = row.id;
    return row.id;
  }

  beforeAll(async () => {
    tenantId = await withSystem(async (tx) => {
      const rows = await tx
        .insert(schema.tenants)
        .values([{ clerkOrgId: STAMP, name: "Banking Test", slug: STAMP }])
        .returning();
      return rows[0].id;
    });
    owner = { tenantId, userId: "owner", role: "owner" };
    staff = { tenantId, userId: "staff", role: "staff" };
    await withTenant(tenantId, (tx) => provisionAccounting(tx, tenantId));
  });

  afterAll(async () => {
    await withSystem(async (tx) => {
      await tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantId));
    });
  });

  it("creates a bank account with its ledger account and idempotent opening balance", async () => {
    const { bankAccount, ledgerAccount } = await withTenant(tenantId, (tx) =>
      createBankAccount(tx, owner, {
        name: "Test Checking",
        kind: "checking",
        institution: "Test Bank",
        last4: "4321",
        openingBalanceCents: 10_000,
        openingBalanceDate: "2026-01-01",
      }),
    );
    expect(ledgerAccount.subtype).toBe("bank");
    expect(ledgerAccount.accountType).toBe("asset");
    // Idempotency: replaying the opening-balance post dedupes.
    const obe = await accountId("3000");
    await withTenant(tenantId, (tx) =>
      postEntry(tx, owner, {
        status: "posted",
        entryDate: "2026-01-01",
        source: "opening_balance",
        idempotencyKey: `obal:${bankAccount.id}`,
        lines: [
          { accountId: ledgerAccount.id, amountCents: 10_000 },
          { accountId: obe, amountCents: -10_000 },
        ],
      }),
    ).then((r) => expect(r.deduped).toBe(true));
    // One register per ledger account:
    await expectDbReject(
      withTenant(tenantId, (tx) =>
        tx.insert(schema.bankAccounts).values({
          tenantId,
          accountId: ledgerAccount.id,
          name: "Duplicate register",
          kind: "checking",
        }),
      ),
      /bank_accounts_tenant_account_idx|duplicate/,
    );
    acct["__bank"] = ledgerAccount.id;
    acct["__bankAccount"] = bankAccount.id;
  });

  it("credit-card opening balance posts owed-positive orientation", async () => {
    const { bankAccount, ledgerAccount } = await withTenant(tenantId, (tx) =>
      createBankAccount(tx, owner, {
        name: "Test Card",
        kind: "credit_card",
        openingBalanceCents: 5_000, // owed
        openingBalanceDate: "2026-01-01",
      }),
    );
    expect(ledgerAccount.accountType).toBe("liability");
    const lines = await withTenant(tenantId, (tx) =>
      tx.query.journalLines.findMany({
        where: and(
          eq(schema.journalLines.tenantId, tenantId),
          eq(schema.journalLines.accountId, ledgerAccount.id),
        ),
      }),
    );
    expect(lines).toHaveLength(1);
    expect(lines[0].amountCents).toBe(-5_000); // credit balance = owed
    acct["__cardAccount"] = bankAccount.id;
  });

  it("imports with dedup; same-file twins both land; re-import skips all", async () => {
    const bankAccountId = acct["__bankAccount"];
    const txns = [
      { txnDate: "2026-02-01", description: "HARDWARE STORE", amountCents: -3_000, raw: [], dupIndex: 0 },
      { txnDate: "2026-02-01", description: "HARDWARE STORE", amountCents: -3_000, raw: [], dupIndex: 1 },
      { txnDate: "2026-02-03", description: "CLIENT PAYMENT", amountCents: 1_000, raw: [], dupIndex: 0 },
    ];
    const first = await withTenant(tenantId, (tx) =>
      importTransactions(tx, owner, { bankAccountId, txns }),
    );
    expect(first).toEqual({ imported: 3, skippedDuplicates: 0 });
    const again = await withTenant(tenantId, (tx) =>
      importTransactions(tx, owner, { bankAccountId, txns }),
    );
    expect(again).toEqual({ imported: 0, skippedDuplicates: 3 });
  });

  it("categorizes: balanced entry, staging linked, replay-safe, staff forbidden", async () => {
    const bankAccountId = acct["__bankAccount"];
    const repairs = await accountId("6400");
    const [txn] = await withTenant(tenantId, (tx) =>
      tx.query.bankTransactions.findMany({
        where: and(
          eq(schema.bankTransactions.tenantId, tenantId),
          eq(schema.bankTransactions.bankAccountId, bankAccountId),
          eq(schema.bankTransactions.status, "unreviewed"),
        ),
        orderBy: (t, { asc }) => [asc(t.createdAt)],
        limit: 1,
      }),
    );
    await expect(
      withTenant(tenantId, (tx) =>
        categorizeTransaction(tx, staff, { transactionId: txn.id, accountId: repairs }),
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const { entry } = await withTenant(tenantId, (tx) =>
      categorizeTransaction(tx, owner, { transactionId: txn.id, accountId: repairs }),
    );
    expect(entry.source).toBe("bank_import");
    const linked = await withTenant(tenantId, (tx) =>
      tx.query.bankTransactions.findFirst({
        where: eq(schema.bankTransactions.id, txn.id),
      }),
    );
    expect(linked).toMatchObject({ status: "posted", journalEntryId: entry.id });
    // Replay: already handled.
    await expect(
      withTenant(tenantId, (tx) =>
        categorizeTransaction(tx, owner, { transactionId: txn.id, accountId: repairs }),
      ),
    ).rejects.toMatchObject({ code: "TXN_NOT_UNREVIEWED" });
    acct["__categorizedEntry"] = entry.id;
    acct["__categorizedTxn"] = txn.id;
  });

  it("voidEntry via staging reset flow returns the txn to review", async () => {
    // Simulate the action-layer coordination inline (same statements).
    const entryId = acct["__categorizedEntry"];
    await withTenant(tenantId, async (tx) => {
      const entry = await tx.query.journalEntries.findFirst({
        where: eq(schema.journalEntries.id, entryId),
      });
      await voidEntry(tx, owner, { entryId, expectedVersion: entry!.version });
      await tx
        .update(schema.bankTransactions)
        .set({ status: "unreviewed", journalEntryId: null, updatedAt: new Date() })
        .where(
          and(
            eq(schema.bankTransactions.tenantId, tenantId),
            eq(schema.bankTransactions.journalEntryId, entryId),
          ),
        );
    });
    const txn = await withTenant(tenantId, (tx) =>
      tx.query.bankTransactions.findFirst({
        where: eq(schema.bankTransactions.id, acct["__categorizedTxn"]),
      }),
    );
    expect(txn).toMatchObject({ status: "unreviewed", journalEntryId: null });
    // Re-categorize: the void entry must NOT be resurrected — a fresh
    // posted entry is created (per-attempt idempotency key).
    const repairs = await accountId("6400");
    const res = await withTenant(tenantId, (tx) =>
      categorizeTransaction(tx, owner, {
        transactionId: acct["__categorizedTxn"],
        accountId: repairs,
      }),
    );
    expect(res.entry.id).not.toBe(entryId);
    expect(res.entry.status).toBe("posted");
    const relinked = await withTenant(tenantId, (tx) =>
      tx.query.bankTransactions.findFirst({
        where: eq(schema.bankTransactions.id, acct["__categorizedTxn"]),
      }),
    );
    expect(relinked).toMatchObject({ status: "posted", journalEntryId: res.entry.id });
  });

  it("exclude/restore round-trip; excluded cannot be categorized", async () => {
    const bankAccountId = acct["__bankAccount"];
    const [txn] = await withTenant(tenantId, (tx) =>
      tx.query.bankTransactions.findMany({
        where: and(
          eq(schema.bankTransactions.tenantId, tenantId),
          eq(schema.bankTransactions.bankAccountId, bankAccountId),
          eq(schema.bankTransactions.status, "unreviewed"),
        ),
        limit: 1,
      }),
    );
    await withTenant(tenantId, (tx) =>
      setTransactionExcluded(tx, owner, { transactionId: txn.id, excluded: true }),
    );
    await expect(
      withTenant(tenantId, (tx) =>
        categorizeTransaction(tx, owner, {
          transactionId: txn.id,
          accountId: acct["6400"],
        }),
      ),
    ).rejects.toMatchObject({ code: "TXN_NOT_UNREVIEWED" });
    await withTenant(tenantId, (tx) =>
      setTransactionExcluded(tx, owner, { transactionId: txn.id, excluded: false }),
    );
  });

  it("AI: persistence + cooldown via injected model, no network", async () => {
    const bankAccountId = acct["__bankAccount"];
    const insurance = await accountId("6100");
    const fakeModel = async (g: { batch: Array<{ id: string }> }) => ({
      suggestions: g.batch.map((t) => ({
        transactionId: t.id,
        accountCode: "6100",
        confidence: 0.85,
        reason: "test",
      })),
    });
    const result = await suggestCategoriesForBankAccount(
      owner,
      bankAccountId,
      fakeModel as never,
    );
    expect(result.returned).toBeGreaterThan(0);
    const suggested = await withTenant(tenantId, (tx) =>
      tx.query.bankTransactions.findMany({
        where: and(
          eq(schema.bankTransactions.tenantId, tenantId),
          eq(schema.bankTransactions.bankAccountId, bankAccountId),
          eq(schema.bankTransactions.status, "unreviewed"),
        ),
      }),
    );
    const withSuggestion = suggested.filter((t) => t.aiSuggestion !== null);
    expect(withSuggestion.length).toBe(result.returned);
    expect(
      (withSuggestion[0].aiSuggestion as { accountId: string }).accountId,
    ).toBe(insurance);
    // Cooldown fires on an immediate second run.
    await expect(
      suggestCategoriesForBankAccount(owner, bankAccountId, fakeModel as never),
    ).rejects.toMatchObject({ code: "AI_COOLDOWN" });
  });

  it("reconciliation: full cycle, server-verified balance, immutability, reopen", async () => {
    const bankAccountId = acct["__bankAccount"];
    const bankLedger = acct["__bank"];
    // Categorize the remaining unreviewed txns so ledger activity exists.
    const unreviewed = await withTenant(tenantId, (tx) =>
      tx.query.bankTransactions.findMany({
        where: and(
          eq(schema.bankTransactions.tenantId, tenantId),
          eq(schema.bankTransactions.bankAccountId, bankAccountId),
          eq(schema.bankTransactions.status, "unreviewed"),
        ),
      }),
    );
    for (const txn of unreviewed) {
      await withTenant(tenantId, (tx) =>
        categorizeTransaction(tx, owner, {
          transactionId: txn.id,
          accountId: acct["6400"],
        }),
      );
    }
    // Ledger on the bank account: +10000 (opening) −3000 −3000 +1000 = 5000.
    const recon = await withTenant(tenantId, (tx) =>
      startReconciliation(tx, owner, {
        bankAccountId,
        statementEndDate: "2026-03-01",
        statementEndBalanceCents: 5_000,
      }),
    );
    // Second start blocked by the partial unique.
    await expect(
      withTenant(tenantId, (tx) =>
        startReconciliation(tx, owner, {
          bankAccountId,
          statementEndDate: "2026-03-31",
          statementEndBalanceCents: 0,
        }),
      ),
    ).rejects.toMatchObject({ code: "RECON_ACTIVE_EXISTS" });

    let view = await withTenant(tenantId, (tx) =>
      getReconciliationView(tx, tenantId, recon.id),
    );
    expect(view.candidates.length).toBeGreaterThanOrEqual(4);
    // Complete with nothing checked → not balanced (server recompute).
    await expect(
      withTenant(tenantId, (tx) =>
        completeReconciliation(tx, owner, {
          reconciliationId: recon.id,
          expectedVersion: recon.version,
        }),
      ),
    ).rejects.toMatchObject({ code: "RECON_NOT_BALANCED" });
    // Check every candidate line on the bank ledger account.
    for (const c of view.candidates) {
      await withTenant(tenantId, (tx) =>
        toggleReconciliationLine(tx, owner, {
          reconciliationId: recon.id,
          journalLineId: c.journalLineId,
          checked: true,
        }),
      );
    }
    view = await withTenant(tenantId, (tx) =>
      getReconciliationView(tx, tenantId, recon.id),
    );
    expect(view.checkedCents).toBe(5_000);
    expect(view.differenceCents).toBe(0);

    // Reconciled (in-progress membership) already locks entries:
    const someEntryId = view.candidates[0].entryId;
    const someEntry = await withTenant(tenantId, (tx) =>
      tx.query.journalEntries.findFirst({
        where: eq(schema.journalEntries.id, someEntryId),
      }),
    );
    await expect(
      withTenant(tenantId, (tx) =>
        editEntry(tx, owner, {
          entryId: someEntryId,
          expectedVersion: someEntry!.version,
          patch: { memo: "should be locked" },
        }),
      ),
    ).rejects.toMatchObject({ code: "ENTRY_IMMUTABLE" });
    await expect(
      withTenant(tenantId, (tx) =>
        voidEntry(tx, owner, {
          entryId: someEntryId,
          expectedVersion: someEntry!.version,
        }),
      ),
    ).rejects.toMatchObject({ code: "ENTRY_IMMUTABLE" });
    // DB backstop: raw deletes rejected by the FK.
    await expectDbReject(
      withTenant(tenantId, (tx) =>
        tx
          .delete(schema.journalLines)
          .where(eq(schema.journalLines.id, view.candidates[0].journalLineId)),
      ),
      /reconciliation_lines|violates/,
    );
    await expectDbReject(
      withTenant(tenantId, (tx) =>
        tx
          .delete(schema.journalEntries)
          .where(eq(schema.journalEntries.id, someEntryId)),
      ),
      /reconciliation_lines|violates/,
    );
    // Reverse remains allowed on a reconciled entry.
    const rev = await withTenant(tenantId, (tx) =>
      reverseEntry(tx, owner, { entryId: someEntryId, entryDate: "2026-03-05" }),
    );
    expect(rev.entry.reversesEntryId).toBe(someEntryId);
    // The reversal's bank line lands OUTSIDE the statement window (03-05 >
    // 03-01), so the workbench math is untouched; complete now succeeds.
    const done = await withTenant(tenantId, (tx) =>
      completeReconciliation(tx, owner, {
        reconciliationId: recon.id,
        expectedVersion: recon.version,
      }),
    );
    expect(done.status).toBe("completed");

    // Reopen (latest only), uncheck a line, and the entry unlocks.
    const reopened = await withTenant(tenantId, (tx) =>
      reopenReconciliation(tx, owner, {
        reconciliationId: recon.id,
        expectedVersion: done.version,
      }),
    );
    expect(reopened.status).toBe("in_progress");
    const lineToFree = view.candidates.find((c) => c.entryId !== someEntryId)!;
    await withTenant(tenantId, (tx) =>
      toggleReconciliationLine(tx, owner, {
        reconciliationId: recon.id,
        journalLineId: lineToFree.journalLineId,
        checked: false,
      }),
    );
    const freedEntry = await withTenant(tenantId, (tx) =>
      tx.query.journalEntries.findFirst({
        where: eq(schema.journalEntries.id, lineToFree.entryId),
      }),
    );
    await withTenant(tenantId, (tx) =>
      editEntry(tx, owner, {
        entryId: lineToFree.entryId,
        expectedVersion: freedEntry!.version,
        patch: { memo: "unlocked after uncheck" },
      }),
    );
    // Line-clears-once: re-check it, complete again for cleanliness.
    await withTenant(tenantId, (tx) =>
      toggleReconciliationLine(tx, owner, {
        reconciliationId: recon.id,
        journalLineId: lineToFree.journalLineId,
        checked: true,
      }),
    );
    await withTenant(tenantId, (tx) =>
      completeReconciliation(tx, owner, {
        reconciliationId: recon.id,
        expectedVersion: reopened.version,
      }),
    );
  });

  it("quick add: owner posts to bank + category", async () => {
    const bankLedger = acct["__bank"];
    const utilities = await accountId("6650");
    const { entry } = await withTenant(tenantId, (tx) =>
      postEntry(tx, owner, {
        status: "posted",
        entryDate: "2026-04-01",
        source: "manual",
        lines: [
          { accountId: utilities, amountCents: 2_200 },
          { accountId: bankLedger, amountCents: -2_200 },
        ],
      }),
    );
    expect(entry.status).toBe("posted");
  });
});
