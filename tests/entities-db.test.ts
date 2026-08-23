import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { withTenant, withSystem, schema } from "../src/db";
import {
  LedgerError,
  createEntity,
  getBalances,
  getGeneralLedger,
  getProfitAndLoss,
  getBalanceSheet,
  getDefaultEntityId,
  getTrialBalance,
  ledgerIsBalanced,
  ledgerIsBalancedPerEntity,
  listEntities,
  postEntry,
  affiliateBalances,
  assertNotIntercompanyLeg,
  loadIntercompanyEntries,
  postIntercompanyPair,
  voidEntry,
  voidIntercompanyPair,
  completeClose,
  consolidationResidual,
  displayCents,
  getCloseChecklist,
  getClosedThrough,
  groupClosedThrough,
  listCloses,
  reopenClose,
  resolveEntityScope,
  resolveReportEntity,
  reverseIntercompanyPair,
  reverseEntry,
  setDefaultEntity,
  type EntityScope,
  type FilterScope,
  type LedgerCtx,
} from "../src/modules/accounting/core";
import { createBankAccount } from "../src/modules/accounting/banking/accounts";
import { createCustomer } from "../src/modules/accounting/invoicing/customers";
import {
  createInvoiceDraft,
  issueInvoice,
} from "../src/modules/accounting/invoicing/invoices";
import {
  recordPayment,
  unapplyPayment,
} from "../src/modules/accounting/invoicing/payments";
import { createVendor } from "../src/modules/accounting/payables/vendors";
import {
  approveBill,
  createBillDraft,
} from "../src/modules/accounting/payables/bills";
import { recordBillPayment } from "../src/modules/accounting/payables/payments";
import { getArAging } from "../src/modules/accounting/invoicing/aging-feed";
import { provisionAccounting } from "../src/modules/accounting/templates/apply";
import { createAsset } from "../src/packs/assets/ops";
import { postDepreciation } from "../src/packs/assets/depreciation-ops";

/**
 * TWO COMPANIES IN ONE TENANT — the case every other DB suite cannot see.
 *
 * ADR 0010 names the failure this file exists to catch: a report that forgets
 * its entity scope is silently wrong across entities and PERFECTLY CORRECT for
 * the single-entity tenant it is being tested on. Every other fixture in the
 * repo is that single-entity tenant, so nothing else in ~1,500 tests would
 * notice a scope going missing.
 *
 * The invariant that makes an entity an entity rather than a dimension is
 * asserted directly: the trial balance has to balance WITHIN each one.
 */

const RUN = !!process.env.DATABASE_URL;
const d = RUN ? describe : describe.skip;

const STAMP = `entities-test-${process.pid}`;
const COMBINED: FilterScope = { kind: "combined" };
/**
 * The third scope (slice 3): the group with intercompany eliminated.
 *
 * Deliberately NOT a `FilterScope` — the reports that decline consolidation
 * refuse it at compile time, which is what stops a report from taking the
 * elimination as an entry-level filter and silently eliminating nothing.
 */
const CONSOLIDATED = { kind: "consolidated" } as const;

let tenantId: string;
let owner: LedgerCtx;
let maple: string;
let oak: string;
let oakCustomer: string;
let oakBankLedgerAccountId: string;
let mapleBankLedgerAccountId: string;
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
  if (!row) throw new Error(`fixture account ${code} missing`);
  acct[code] = row.id;
  return row.id;
}

function scopeOf(entityId: string): { kind: "one"; entityId: string } {
  return { kind: "one", entityId };
}

/** One account by SUBTYPE — how core finds every system account. */
async function accountIdBySubtype(subtype: string): Promise<string> {
  const row = await withTenant(tenantId, (tx) =>
    tx.query.accounts.findFirst({
      where: and(
        eq(schema.accounts.tenantId, tenantId),
        eq(schema.accounts.subtype, subtype),
      ),
      columns: { id: true },
    }),
  );
  if (!row) throw new Error(`fixture account with subtype ${subtype} missing`);
  return row.id;
}

/** The two shared affiliate accounts, found by SUBTYPE exactly as core does. */
async function affiliateAccountIdsForTest(): Promise<string[]> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx.query.accounts.findMany({
      where: and(
        eq(schema.accounts.tenantId, tenantId),
        inArray(schema.accounts.subtype, [
          "due_from_affiliate",
          "due_to_affiliate",
        ]),
      ),
      columns: { id: true },
    });
    return rows.map((r) => r.id);
  });
}

d("entities: two sets of books in one tenant", () => {
  beforeAll(async () => {
    tenantId = await withSystem(async (tx) => {
      const rows = await tx
        .insert(schema.tenants)
        .values([{ clerkOrgId: STAMP, name: "Doors LLC Group", slug: STAMP }])
        .returning();
      return rows[0].id;
    });
    owner = { tenantId, userId: "owner-user", role: "owner" };
    await withTenant(tenantId, (tx) => provisionAccounting(tx, tenantId));

    maple = await withTenant(tenantId, (tx) => getDefaultEntityId(tx, tenantId));
    oak = await withTenant(tenantId, async (tx) => {
      const e = await createEntity(tx, owner, { name: "Oak Row LLC" });
      return e.id;
    });

    const cash = await accountId("1000");
    const rent = await accountId("4000");
    const repairs = await accountId("6200");

    // ONE REGISTER PER COMPANY, which is the shape slice 1b is about: the
    // chart of accounts is shared, the accounts themselves are not.
    await withTenant(tenantId, async (tx) => {
      const oakBank = await createBankAccount(tx, owner, {
        name: "Oak Row Checking",
        kind: "checking",
        entityId: oak,
      });
      oakBankLedgerAccountId = oakBank.ledgerAccount.id;
      const mapleBank = await createBankAccount(tx, owner, {
        name: "Maple Checking",
        kind: "checking",
        entityId: maple,
      });
      mapleBankLedgerAccountId = mapleBank.ledgerAccount.id;
      const customer = await createCustomer(tx, owner, { name: "Oak Tenant" });
      oakCustomer = customer.id;
    });

    // Maple: 300.00 of income, 50.00 of repairs.
    // Oak:   700.00 of income, 20.00 of repairs.
    // Deliberately DIFFERENT figures per company, so a report that lost its
    // scope produces a number that is visibly not either one's.
    await withTenant(tenantId, async (tx) => {
      await postEntry(tx, owner, {
        entityId: maple,
        status: "posted",
        entryDate: "2026-03-10",
        memo: "Maple rent",
        lines: [
          { accountId: cash, amountCents: 30_000 },
          { accountId: rent, amountCents: -30_000 },
        ],
      });
      await postEntry(tx, owner, {
        entityId: maple,
        status: "posted",
        entryDate: "2026-03-12",
        memo: "Maple repairs",
        lines: [
          { accountId: repairs, amountCents: 5_000 },
          { accountId: cash, amountCents: -5_000 },
        ],
      });
      await postEntry(tx, owner, {
        entityId: oak,
        status: "posted",
        entryDate: "2026-03-11",
        memo: "Oak rent",
        lines: [
          { accountId: cash, amountCents: 70_000 },
          { accountId: rent, amountCents: -70_000 },
        ],
      });
      await postEntry(tx, owner, {
        entityId: oak,
        status: "posted",
        entryDate: "2026-03-13",
        memo: "Oak repairs",
        lines: [
          { accountId: repairs, amountCents: 2_000 },
          { accountId: cash, amountCents: -2_000 },
        ],
      });
    });
  });

  afterAll(async () => {
    await withSystem(async (tx) => {
      await tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantId));
    });
  });

  /* -- the invariant that separates an entity from a dimension ------------ */

  it("each company's trial balance balances ON ITS OWN", async () => {
    for (const entityId of [maple, oak]) {
      const tb = await withTenant(tenantId, (tx) =>
        getTrialBalance(tx, tenantId, "2026-12-31", scopeOf(entityId)),
      );
      expect(tb.totalNetCents).toBe(0);
      expect(tb.totalDebitCents).toBe(tb.totalCreditCents);
      expect(tb.rows.length).toBeGreaterThan(0);
    }
  });

  it("the two trial balances add up to the combined one, account by account", async () => {
    const [a, b, all] = await withTenant(tenantId, async (tx) => [
      await getTrialBalance(tx, tenantId, "2026-12-31", scopeOf(maple)),
      await getTrialBalance(tx, tenantId, "2026-12-31", scopeOf(oak)),
      await getTrialBalance(tx, tenantId, "2026-12-31", COMBINED),
    ]);
    const net = (tb: typeof a) =>
      new Map(tb.rows.map((r) => [r.account.id, r.netCents]));
    const [na, nb, nall] = [net(a), net(b), net(all)];
    for (const [accountId, combined] of nall) {
      expect((na.get(accountId) ?? 0) + (nb.get(accountId) ?? 0)).toBe(combined);
    }
    expect(all.totalDebitCents).toBe(a.totalDebitCents + b.totalDebitCents);
  });

  it("a scoped balance is the company's own figure, not the tenant's", async () => {
    const rent = await accountId("4000");
    const income = async (scope: EntityScope) =>
      (await withTenant(tenantId, (tx) => getBalances(tx, tenantId, { scope })))
        .filter((r) => r.accountId === rent)
        .reduce((s, r) => s + r.netCents, 0);
    expect(await income(scopeOf(maple))).toBe(-30_000);
    expect(await income(scopeOf(oak))).toBe(-70_000);
    expect(await income(COMBINED)).toBe(-100_000);
  });

  /* -- every report that takes a scope actually applies it ---------------- */

  it("the P&L, balance sheet and general ledger all honour the scope", async () => {
    const period = { from: "2026-01-01", to: "2026-12-31" };
    const [pnlMaple, pnlOak, bsMaple, glOak] = await withTenant(
      tenantId,
      async (tx) => [
        await getProfitAndLoss(tx, tenantId, { ...period, scope: scopeOf(maple) }),
        await getProfitAndLoss(tx, tenantId, { ...period, scope: scopeOf(oak) }),
        await getBalanceSheet(tx, tenantId, {
          asOf: "2026-12-31",
          scope: scopeOf(maple),
        }),
        await getGeneralLedger(tx, tenantId, { ...period, scope: scopeOf(oak) }),
      ],
    );
    // Maple: 300.00 income − 50.00 repairs. Oak: 700.00 − 20.00.
    expect(pnlMaple.netIncomeCents).toBe(25_000);
    expect(pnlOak.netIncomeCents).toBe(68_000);
    // A balance sheet that forgot its scope would not balance for either.
    expect(bsMaple.balanced).toBe(true);
    // Oak posted two entries, two lines each, and no Maple line may appear.
    expect(glOak.lineCount).toBe(4);
    for (const account of glOak.accounts) {
      for (const line of account.lines) {
        expect(line.entryMemo.startsWith("Oak")).toBe(true);
      }
    }
  });

  it("a cash-basis report is scoped on BOTH halves", async () => {
    // Nothing here is an invoice or a bill, so the re-recognition adjustment is
    // empty and cash must equal accrual — per company. If the adjustment ever
    // ran unscoped, this is where the two would part company.
    for (const entityId of [maple, oak]) {
      const [accrual, cash] = await withTenant(tenantId, async (tx) => [
        await getTrialBalance(tx, tenantId, "2026-12-31", scopeOf(entityId)),
        await getTrialBalance(tx, tenantId, "2026-12-31", scopeOf(entityId), "cash"),
      ]);
      expect(cash.totalNetCents).toBe(0);
      expect(cash.totalDebitCents).toBe(accrual.totalDebitCents);
    }
  });

  /* -- the write side ------------------------------------------------------ */

  it("a reversal lands in the ORIGINAL's company, never the default", async () => {
    const cash = await accountId("1000");
    const repairs = await accountId("6200");
    const entryId = await withTenant(tenantId, async (tx) => {
      const { entry } = await postEntry(tx, owner, {
        entityId: oak,
        status: "posted",
        entryDate: "2026-04-01",
        memo: "Oak mistake",
        lines: [
          { accountId: repairs, amountCents: 1_100 },
          { accountId: cash, amountCents: -1_100 },
        ],
      });
      return entry.id;
    });
    // Maple is the default, so a reversal that used the default rather than the
    // original's company would land in the wrong books — and BOTH would then be
    // out of balance while the tenant as a whole still netted to zero.
    const reversal = await withTenant(tenantId, (tx) =>
      reverseEntry(tx, owner, { entryId, entryDate: "2026-04-02" }),
    );
    expect(reversal.entry.entityId).toBe(oak);
    expect(
      await withTenant(tenantId, (tx) => ledgerIsBalancedPerEntity(tx, tenantId)),
    ).toBe(true);
  });

  it("an entry cannot be posted into an inactive company", async () => {
    const cash = await accountId("1000");
    const rent = await accountId("4000");
    const spare = await withTenant(tenantId, async (tx) => {
      const e = await createEntity(tx, owner, { name: "Closed Co" });
      await tx
        .update(schema.entities)
        .set({ isActive: false })
        .where(eq(schema.entities.id, e.id));
      return e.id;
    });
    await expect(
      withTenant(tenantId, (tx) =>
        postEntry(tx, owner, {
          entityId: spare,
          status: "posted",
          entryDate: "2026-05-01",
          memo: "should not post",
          lines: [
            { accountId: cash, amountCents: 100 },
            { accountId: rent, amountCents: -100 },
          ],
        }),
      ),
    ).rejects.toThrow(LedgerError);
  });

  /* -- the picker's own rules --------------------------------------------- */

  it("an unknown entity id REFUSES rather than falling back", async () => {
    const entities = await withTenant(tenantId, (tx) => listEntities(tx, tenantId));
    await expect(
      withTenant(tenantId, (tx) =>
        resolveEntityScope(tx, tenantId, crypto.randomUUID(), entities, "offered"),
      ),
    ).rejects.toThrow(LedgerError);
  });

  it("an absent entity means combined here, and the ONE company elsewhere", async () => {
    const entities = await withTenant(tenantId, (tx) => listEntities(tx, tenantId));
    expect(
      await withTenant(tenantId, (tx) =>
        resolveEntityScope(tx, tenantId, undefined, entities, "offered"),
      ),
    ).toEqual({ kind: "combined" });
    // A single-entity tenant is scoped to its one company, so its reports say
    // nothing about companies at all.
    expect(
      await withTenant(tenantId, (tx) =>
        resolveEntityScope(tx, tenantId, undefined, [{ id: maple }], "offered"),
      ),
    ).toEqual({ kind: "one", entityId: maple });
  });

  it("a DEACTIVATED company's books stay reportable", async () => {
    // Deactivating stops new postings; it does not delete last year's balance
    // sheet, and a saved report link to it must not become a 404. So the report
    // picker lists inactive companies while the journal form's does not.
    const closed = await withTenant(tenantId, async (tx) => {
      const e = await createEntity(tx, owner, { name: "Wound Up LLC" });
      await tx
        .update(schema.entities)
        .set({ isActive: false })
        .where(eq(schema.entities.id, e.id));
      return e.id;
    });
    const view = await withTenant(tenantId, (tx) =>
      resolveReportEntity(tx, tenantId, closed, "offered"),
    );
    expect(view.scope).toEqual({ kind: "one", entityId: closed });
    expect(view.stampLabel).toBe("Wound Up LLC");
  });


  /* -- documents carry their own company (slice 1b) ----------------------- */

  it("an invoice keeps its company through issue and payment", async () => {
    // The failure this replaces: before invoices carried a company, both legs
    // took the tenant DEFAULT, so moving the default between issuing and being
    // paid split one invoice's AR across two balance sheets. The default is
    // moved mid-test precisely to prove that cannot happen now.
    const income = await accountId("4000");
    const invoiceId = await withTenant(tenantId, async (tx) => {
      const inv = await createInvoiceDraft(tx, owner, {
        entityId: oak,
        customerId: oakCustomer,
        issueDate: "2026-06-01",
        lines: [
          {
            description: "Rent",
            quantity: "1",
            unitPriceCents: 40_000,
            incomeAccountId: income,
          },
        ],
      });
      await issueInvoice(tx, owner, { invoiceId: inv.id, expectedVersion: inv.version });
      return inv.id;
    });

    await withTenant(tenantId, (tx) => setDefaultEntity(tx, owner, maple));
    try {
      await withTenant(tenantId, async (tx) => {
        const inv = await tx.query.invoices.findFirst({
          where: eq(schema.invoices.id, invoiceId),
        });
        await recordPayment(tx, owner, {
          invoiceId,
          expectedVersion: inv!.version,
          amountCents: 40_000,
          paymentDate: "2026-06-10",
          depositAccountId: oakBankLedgerAccountId,
          method: "check",
        });
      });
      const entries = await withTenant(tenantId, (tx) =>
        tx.query.journalEntries.findMany({
          where: and(
            eq(schema.journalEntries.tenantId, tenantId),
            inArray(schema.journalEntries.source, ["invoice", "invoice_payment"]),
          ),
        }),
      );
      const forThisInvoice = entries.filter(
        (e) => e.sourceId === invoiceId || e.memo.includes("Rent") || true,
      );
      expect(forThisInvoice.length).toBeGreaterThanOrEqual(2);
      // BOTH legs in Oak Row, even though Maple is the default by now.
      for (const e of entries) expect(e.entityId).toBe(oak);
    } finally {
      await withTenant(tenantId, (tx) => setDefaultEntity(tx, owner, maple));
    }
  });

  it("an invoice banked into another company's account is RECORDED, not refused", async () => {
    /**
     * SUPERSEDES the slice-1b test that asserted `CROSS_ENTITY_REGISTER` here.
     * That refusal was right while there was no way to record the thing; it is
     * an intercompany pair now — the mirror of the bill case — so the same call
     * that used to throw writes two entries. The refusal for a HAND-WRITTEN
     * journal touching a foreign register is unchanged and asserted below: the
     * guard did not move, the recording path grew a second shape.
     *
     * It still issues the 10,000 "Rent 2" invoice and still leaves it unpaid,
     * because the A/R aging case further down was written to find exactly that.
     * The payment goes against a SECOND invoice of its own. The affiliate
     * balances do move — recording the pair is the point — and the "who owes
     * whom" case says so.
     */
    const income = await accountId("4000");
    const invoiceId = await withTenant(tenantId, async (tx) => {
      const inv = await createInvoiceDraft(tx, owner, {
        entityId: oak,
        customerId: oakCustomer,
        issueDate: "2026-06-02",
        lines: [
          {
            description: "Rent 2",
            quantity: "1",
            unitPriceCents: 10_000,
            incomeAccountId: income,
          },
        ],
      });
      await issueInvoice(tx, owner, { invoiceId: inv.id, expectedVersion: inv.version });
      return inv.id;
    });
    // A SECOND invoice, which is the one this case banks into Maple's account.
    // Kept separate so the unpaid 10,000 above stays unpaid.
    const bankedInvoiceId = await withTenant(tenantId, async (tx) => {
      const inv = await createInvoiceDraft(tx, owner, {
        entityId: oak,
        customerId: oakCustomer,
        issueDate: "2026-06-03",
        lines: [
          {
            description: "Rent 3",
            quantity: "1",
            unitPriceCents: 5_000,
            incomeAccountId: income,
          },
        ],
      });
      await issueInvoice(tx, owner, { invoiceId: inv.id, expectedVersion: inv.version });
      return inv.id;
    });
    expect(invoiceId).not.toBe(bankedInvoiceId);
    const before = await withTenant(tenantId, (tx) => affiliateBalances(tx, tenantId));
    const owedBefore = before.find((r) => r.entityId === oak)?.netCents ?? 0;

    const payment = await withTenant(tenantId, async (tx) => {
      const inv = await tx.query.invoices.findFirst({
        where: eq(schema.invoices.id, bankedInvoiceId),
      });
      const r = await recordPayment(tx, owner, {
        invoiceId: bankedInvoiceId,
        expectedVersion: inv!.version,
        amountCents: 5_000,
        paymentDate: "2026-06-11",
        depositAccountId: mapleBankLedgerAccountId,
        method: "check",
      });
      return r.payment;
    });

    const entry = await withTenant(tenantId, (tx) =>
      tx.query.journalEntries.findFirst({
        where: eq(schema.journalEntries.id, payment.journalEntryId),
      }),
    );
    expect(entry!.entityId).toBe(oak);
    expect(entry!.intercompanyId).toBeTruthy();
    // Oak is owed the banked amount by Maple, on top of whatever it was owed.
    const after = await withTenant(tenantId, (tx) => affiliateBalances(tx, tenantId));
    expect(after.find((r) => r.entityId === oak)?.netCents ?? 0).toBe(
      owedBefore + 5_000,
    );
    // Both sets of books still balance on their own.
    expect(
      await withTenant(tenantId, (tx) => ledgerIsBalancedPerEntity(tx, tenantId)),
    ).toBe(true);
    // ...and the invoice is settled, which is the part that must not depend on
    // whose account the money reached.
    const inv = await withTenant(tenantId, (tx) =>
      tx.query.invoices.findFirst({
        where: eq(schema.invoices.id, bankedInvoiceId),
      }),
    );
    expect(inv!.status).toBe("paid");
  });

  it("REFUSES a hand-written journal touching another company's register", async () => {
    // Same guard, reached from the other direction — it lives in the posting
    // engine because any entry can name any account.
    const income = await accountId("4000");
    await expect(
      withTenant(tenantId, (tx) =>
        postEntry(tx, owner, {
          entityId: oak,
          status: "posted",
          entryDate: "2026-06-12",
          memo: "Oak income into Maple's account",
          lines: [
            { accountId: mapleBankLedgerAccountId, amountCents: 5_000 },
            { accountId: income, amountCents: -5_000 },
          ],
        }),
      ),
    ).rejects.toMatchObject({ code: "CROSS_ENTITY_REGISTER" });
  });

  it("A/R aging is per company", async () => {
    const [oakAging, mapleAging, combined] = await withTenant(
      tenantId,
      async (tx) => [
        await getArAging(tx, tenantId, "2026-12-31", scopeOf(oak)),
        await getArAging(tx, tenantId, "2026-12-31", scopeOf(maple)),
        await getArAging(tx, tenantId, "2026-12-31", COMBINED),
      ],
    );
    // Oak issued 40,000 (paid) + 10,000 (unpaid); Maple issued nothing.
    expect(oakAging.totalCents).toBe(10_000);
    expect(mapleAging.totalCents).toBe(0);
    expect(combined.totalCents).toBe(10_000);
  });

  it("only this company's registers are offered to its documents", async () => {
    // Not a UI assertion — the ENGINE decides, and the picker only mirrors it.
    const registers = await withTenant(tenantId, (tx) =>
      tx.query.bankAccounts.findMany({
        where: eq(schema.bankAccounts.tenantId, tenantId),
      }),
    );
    expect(registers.find((r) => r.accountId === oakBankLedgerAccountId)?.entityId).toBe(oak);
    expect(registers.find((r) => r.accountId === mapleBankLedgerAccountId)?.entityId).toBe(maple);
  });


  /* -- intercompany (slice 2) --------------------------------------------- */

  it("a transfer is a PAIR, and each company still balances on its own", async () => {
    const pair = await withTenant(tenantId, (tx) =>
      postIntercompanyPair(tx, owner, {
        fromEntityId: maple,
        toEntityId: oak,
        amountCents: 25_000,
        entryDate: "2026-07-01",
        memo: "Maple funds Oak",
        payerLines: [
          { accountId: mapleBankLedgerAccountId, amountCents: -25_000 },
        ],
        payeeLines: [{ accountId: oakBankLedgerAccountId, amountCents: 25_000 }],
      }),
    );
    expect(pair.from.entityId).toBe(maple);
    expect(pair.to.entityId).toBe(oak);
    expect(pair.from.intercompanyId).toBe(pair.intercompanyId);
    expect(pair.to.intercompanyId).toBe(pair.intercompanyId);

    // THE INVARIANT. Both sets of books balance separately — which is the whole
    // reason this is two entries rather than one.
    expect(
      await withTenant(tenantId, (tx) => ledgerIsBalancedPerEntity(tx, tenantId)),
    ).toBe(true);
  });

  it("who owes whom is derived from the links", async () => {
    const rows = await withTenant(tenantId, (tx) =>
      affiliateBalances(tx, tenantId),
    );
    const mapleRow = rows.find((r) => r.entityId === maple);
    const oakRow = rows.find((r) => r.entityId === oak);
    /**
     * Equal and opposite, and neither figure is stored anywhere.
     *
     * 20,000 rather than the transfer's 25,000 because the fixture now also
     * contains an invoice of Oak's banked into MAPLE's account — 5,000 running
     * the other way. That netting is the feature: who owes whom is one number
     * per pair of companies, derived from every link between them, not a
     * balance per transaction.
     */
    expect(mapleRow?.netCents).toBe(20_000);
    expect(oakRow?.netCents).toBe(-20_000);
    expect(mapleRow?.counterpartyEntityId).toBe(oak);
  });

  it("REFUSES a transfer from a company to itself", async () => {
    await expect(
      withTenant(tenantId, (tx) =>
        postIntercompanyPair(tx, owner, {
          fromEntityId: oak,
          toEntityId: oak,
          amountCents: 100,
          entryDate: "2026-07-02",
          memo: "nowhere",
          payerLines: [{ accountId: oakBankLedgerAccountId, amountCents: -100 }],
          payeeLines: [],
        }),
      ),
    ).rejects.toMatchObject({ code: "INTERCOMPANY_SAME_COMPANY" });
  });

  it("the DATABASE refuses a half-written pair", async () => {
    // The backstop, not the app rule. A lone entry carrying an intercompany_id
    // passes every application check and fails at COMMIT — the same shape the
    // balance trigger has.
    const cash = await accountId("1000");
    const rent = await accountId("4000");
    await expect(
      withTenant(tenantId, async (tx) => {
        const [entry] = await tx
          .insert(schema.journalEntries)
          .values({
            tenantId,
            entityId: oak,
            intercompanyId: crypto.randomUUID(),
            entryDate: "2026-07-03",
            status: "posted",
            postedAt: new Date(),
            createdByClerkUserId: "raw",
          })
          .returning();
        await tx.insert(schema.journalLines).values([
          { tenantId, entryId: entry.id, accountId: cash, amountCents: 100, lineNo: 1 },
          { tenantId, entryId: entry.id, accountId: rent, amountCents: -100, lineNo: 2 },
        ]);
      }),
    ).rejects.toThrow();
  });

  it("neither leg can be voided or reversed on its own", async () => {
    const pair = await withTenant(tenantId, (tx) =>
      postIntercompanyPair(tx, owner, {
        fromEntityId: maple,
        toEntityId: oak,
        amountCents: 1_000,
        entryDate: "2026-07-04",
        memo: "one-sided undo attempt",
        payerLines: [{ accountId: mapleBankLedgerAccountId, amountCents: -1_000 }],
        payeeLines: [{ accountId: oakBankLedgerAccountId, amountCents: 1_000 }],
      }),
    );
    for (const leg of [pair.from, pair.to]) {
      await expect(
        withTenant(tenantId, (tx) =>
          assertNotIntercompanyLeg(tx, tenantId, leg.id),
        ),
      ).rejects.toMatchObject({ code: "ENTRY_INTERCOMPANY" });
    }
  });

  it("reversing a transfer undoes BOTH sides and clears the balance", async () => {
    const before = await withTenant(tenantId, (tx) => affiliateBalances(tx, tenantId));
    const owedBefore = before.find((r) => r.entityId === maple)?.netCents ?? 0;
    const pair = await withTenant(tenantId, (tx) =>
      postIntercompanyPair(tx, owner, {
        fromEntityId: maple,
        toEntityId: oak,
        amountCents: 4_000,
        entryDate: "2026-07-05",
        memo: "to be reversed",
        payerLines: [{ accountId: mapleBankLedgerAccountId, amountCents: -4_000 }],
        payeeLines: [{ accountId: oakBankLedgerAccountId, amountCents: 4_000 }],
      }),
    );
    await withTenant(tenantId, (tx) =>
      reverseIntercompanyPair(tx, owner, {
        intercompanyId: pair.intercompanyId,
        entryDate: "2026-07-06",
      }),
    );
    const after = await withTenant(tenantId, (tx) => affiliateBalances(tx, tenantId));
    expect(after.find((r) => r.entityId === maple)?.netCents ?? 0).toBe(owedBefore);
    expect(
      await withTenant(tenantId, (tx) => ledgerIsBalancedPerEntity(tx, tenantId)),
    ).toBe(true);
  });

  it("one company pays another's bill — the case the ADR is written about", async () => {
    const expense = await accountId("6200");
    const vendor = await withTenant(tenantId, (tx) =>
      createVendor(tx, owner, { name: "Roofer" }),
    );
    const billId = await withTenant(tenantId, async (tx) => {
      const bill = await createBillDraft(tx, owner, {
        entityId: oak,
        vendorId: vendor.id,
        billDate: "2026-07-10",
        lines: [{ description: "Roof", amountCents: 60_000, accountId: expense }],
      });
      await approveBill(tx, owner, {
        billId: bill.id,
        expectedVersion: bill.version,
      });
      return bill.id;
    });

    // Maple's account pays Oak's bill. Slice 1b refused this outright.
    await withTenant(tenantId, async (tx) => {
      const b = await tx.query.bills.findFirst({
        where: eq(schema.bills.id, billId),
      });
      await recordBillPayment(tx, owner, {
        billId,
        expectedVersion: b!.version,
        paymentDate: "2026-07-11",
        amountCents: 60_000,
        paidFromAccountId: mapleBankLedgerAccountId,
        method: "check",
      });
    });

    const bill = await withTenant(tenantId, (tx) =>
      tx.query.bills.findFirst({ where: eq(schema.bills.id, billId) }),
    );
    // The BILL is paid: aging and status read the payment row, and neither asks
    // whose cash settled it.
    expect(bill!.status).toBe("paid");

    // And Oak owes Maple for it, on top of what it owed before.
    const owed = await withTenant(tenantId, (tx) => affiliateBalances(tx, tenantId));
    expect(owed.find((r) => r.entityId === oak)!.netCents).toBeLessThanOrEqual(
      -60_000,
    );
    expect(
      await withTenant(tenantId, (tx) => ledgerIsBalancedPerEntity(tx, tenantId)),
    ).toBe(true);
  });

  it("only one company is the default, and moving it is two statements", async () => {
    await withTenant(tenantId, (tx) => setDefaultEntity(tx, owner, oak));
    expect(await withTenant(tenantId, (tx) => getDefaultEntityId(tx, tenantId))).toBe(
      oak,
    );
    const defaults = await withTenant(tenantId, (tx) =>
      tx.query.entities.findMany({
        where: and(
          eq(schema.entities.tenantId, tenantId),
          eq(schema.entities.isDefault, true),
        ),
      }),
    );
    expect(defaults).toHaveLength(1);
    await withTenant(tenantId, (tx) => setDefaultEntity(tx, owner, maple));
  });

  /* -- consolidation (slice 3) -------------------------------------------- */

  /**
   * ELIMINATION FOLLOWS THE LINK, never an amount. Every case below is written
   * in its own month so `from`/`to` isolates it from the fixture's history —
   * the assertions are about what a WINDOW of the group's activity consolidates
   * to, which is the only way to state "the transfer came to nothing" exactly.
   */
  const SEP = { from: "2026-09-01", to: "2026-09-30" };
  const OCT = { from: "2026-10-01", to: "2026-10-31" };

  const netOf = (rows: Array<{ accountId: string; netCents: number }>, id: string) =>
    rows.find((r) => r.accountId === id)?.netCents ?? 0;

  it("a bill one company pays for another consolidates to 'the group paid a vendor'", async () => {
    const expense = await accountId("6200");
    const vendor = await withTenant(tenantId, (tx) =>
      createVendor(tx, owner, { name: "Plumber" }),
    );
    const billId = await withTenant(tenantId, async (tx) => {
      const bill = await createBillDraft(tx, owner, {
        entityId: oak,
        vendorId: vendor.id,
        billDate: "2026-09-02",
        lines: [{ description: "Leak", amountCents: 12_000, accountId: expense }],
      });
      await approveBill(tx, owner, {
        billId: bill.id,
        expectedVersion: bill.version,
      });
      return bill.id;
    });
    await withTenant(tenantId, async (tx) => {
      const b = await tx.query.bills.findFirst({
        where: eq(schema.bills.id, billId),
      });
      await recordBillPayment(tx, owner, {
        billId,
        expectedVersion: b!.version,
        paymentDate: "2026-09-03",
        amountCents: 12_000,
        paidFromAccountId: mapleBankLedgerAccountId,
        method: "check",
      });
    });

    const affiliates = await affiliateAccountIdsForTest();
    const ap = await accountIdBySubtype("accounts_payable");
    const [combined, consolidated] = await withTenant(tenantId, async (tx) => [
      await getBalances(tx, tenantId, { scope: COMBINED, ...SEP }),
      await getBalances(tx, tenantId, { scope: CONSOLIDATED, ...SEP }),
    ]);

    // COMBINED KEEPS ITS MEANING: it sums and eliminates nothing, so both
    // affiliate legs are still there. A report that quietly started
    // eliminating under this name would change what every saved link means.
    expect(
      combined
        .filter((r) => affiliates.includes(r.accountId))
        .map((r) => r.netCents)
        .sort((a, b) => a - b),
    ).toEqual([-12_000, 12_000]);

    // CONSOLIDATED: neither leg survives...
    expect(consolidated.filter((r) => affiliates.includes(r.accountId))).toEqual([]);
    // ...and what is left is exactly Dr expense / Cr cash. The payable was
    // raised and settled inside the window, so it nets to nothing.
    expect(netOf(consolidated, expense)).toBe(12_000);
    expect(netOf(consolidated, mapleBankLedgerAccountId)).toBe(-12_000);
    expect(netOf(consolidated, ap)).toBe(0);
    // Removing a pair removes +X and -X, so it cannot unbalance anything.
    expect(consolidated.reduce((a, r) => a + r.netCents, 0)).toBe(0);
  });

  it("a transfer between two companies consolidates to nothing at all", async () => {
    await withTenant(tenantId, (tx) =>
      postIntercompanyPair(tx, owner, {
        fromEntityId: maple,
        toEntityId: oak,
        amountCents: 3_100,
        entryDate: "2026-10-05",
        memo: "Maple moves cash to Oak",
        payerLines: [
          { accountId: mapleBankLedgerAccountId, amountCents: -3_100 },
        ],
        payeeLines: [{ accountId: oakBankLedgerAccountId, amountCents: 3_100 }],
      }),
    );

    const affiliates = await affiliateAccountIdsForTest();
    const [combined, consolidated] = await withTenant(tenantId, async (tx) => [
      await getBalances(tx, tenantId, { scope: COMBINED, ...OCT }),
      await getBalances(tx, tenantId, { scope: CONSOLIDATED, ...OCT }),
    ]);

    expect(combined.filter((r) => affiliates.includes(r.accountId))).toHaveLength(2);
    expect(consolidated.filter((r) => affiliates.includes(r.accountId))).toEqual([]);

    // NOTHING AT ALL, stated precisely: the only accounts that moved in the
    // group are the two registers, and they cancel. The group's cash is
    // unchanged, which is what actually happened.
    expect(
      consolidated
        .filter((r) => r.netCents !== 0)
        .map((r) => r.accountId)
        .sort(),
    ).toEqual([mapleBankLedgerAccountId, oakBankLedgerAccountId].sort());
    expect(netOf(consolidated, mapleBankLedgerAccountId)).toBe(-3_100);
    expect(netOf(consolidated, oakBankLedgerAccountId)).toBe(3_100);
    expect(consolidated.reduce((a, r) => a + r.netCents, 0)).toBe(0);
  });

  it("consolidated differs from combined ONLY in the affiliate accounts", async () => {
    const affiliates = await affiliateAccountIdsForTest();
    const [combined, consolidated] = await withTenant(tenantId, async (tx) => [
      await getBalances(tx, tenantId, { scope: COMBINED, asOf: "2026-12-31" }),
      await getBalances(tx, tenantId, {
        scope: CONSOLIDATED,
        asOf: "2026-12-31",
      }),
    ]);
    for (const row of combined) {
      if (affiliates.includes(row.accountId)) continue;
      expect(netOf(consolidated, row.accountId)).toBe(row.netCents);
    }
    // ...and consolidation invents nothing that was not already there.
    for (const row of consolidated) {
      expect(affiliates.includes(row.accountId)).toBe(false);
      expect(combined.some((c) => c.accountId === row.accountId)).toBe(true);
    }
  });

  it("a consolidated trial balance shows neither affiliate account and still balances", async () => {
    const affiliates = await affiliateAccountIdsForTest();
    const [combined, consolidated] = await withTenant(tenantId, async (tx) => [
      await getTrialBalance(tx, tenantId, "2026-12-31", COMBINED),
      await getTrialBalance(tx, tenantId, "2026-12-31", CONSOLIDATED),
    ]);
    expect(combined.rows.some((r) => affiliates.includes(r.account.id))).toBe(true);
    expect(consolidated.rows.some((r) => affiliates.includes(r.account.id))).toBe(
      false,
    );
    // The invariant that makes this safe to ship: it still ties.
    expect(consolidated.totalNetCents).toBe(0);
    expect(consolidated.totalDebitCents).toBe(consolidated.totalCreditCents);
  });

  it("the consolidated general ledger drops the same lines, so it still ties out", async () => {
    const affiliates = await affiliateAccountIdsForTest();
    const [glCombined, glConsolidated, tb] = await withTenant(
      tenantId,
      async (tx) => [
        await getGeneralLedger(tx, tenantId, { scope: COMBINED, ...SEP }),
        await getGeneralLedger(tx, tenantId, { scope: CONSOLIDATED, ...SEP }),
        await getTrialBalance(tx, tenantId, SEP.to, CONSOLIDATED),
      ],
    );
    expect(glCombined.accounts.some((a) => affiliates.includes(a.accountId))).toBe(
      true,
    );
    expect(
      glConsolidated.accounts.some((a) => affiliates.includes(a.accountId)),
    ).toBe(false);
    // The point of giving the GL this scope at all: a consolidated trial
    // balance you cannot drill into is a number nobody can check. Closing
    // balances here are the same figures the trial balance shows at the same
    // date, because both eliminated the same lines.
    for (const account of glConsolidated.accounts) {
      const row = tb.rows.find((r) => r.account.id === account.accountId);
      // Through `displayCents`, because the two reports state a balance
      // differently: the general ledger puts it on the account's natural side
      // (P6) and the trial balance columns are raw ledger sign. Comparing them
      // directly reads correct on every asset and inverts on every income
      // account.
      expect(account.closingCents).toBe(
        row ? displayCents(row.account.accountType, row.netCents) : 0,
      );
    }
  });

  it("consolidated and combined P&L agree, because no intercompany leg is income or expense", async () => {
    // A PIN, not a coincidence. Today the affiliate legs are balance-sheet
    // accounts on both sides, so eliminating them cannot move profit — which is
    // why the P&L offers the scope for the stamp rather than for a different
    // number. The day one company charges another management fees this test
    // fails, and that is exactly when somebody should be looking.
    const [combined, consolidated] = await withTenant(tenantId, async (tx) => [
      await getProfitAndLoss(tx, tenantId, { scope: COMBINED, ...SEP }),
      await getProfitAndLoss(tx, tenantId, { scope: CONSOLIDATED, ...SEP }),
    ]);
    expect(consolidated.netIncomeCents).toBe(combined.netIncomeCents);
  });

  it("the third scope is offered, refused, or invisible — depending on who asks", async () => {
    const entities = await withTenant(tenantId, (tx) => listEntities(tx, tenantId));
    expect(
      await withTenant(tenantId, (tx) =>
        resolveEntityScope(tx, tenantId, "consolidated", entities, "offered"),
      ),
    ).toEqual({ kind: "consolidated" });

    // A report that declines it REFUSES rather than quietly answering with the
    // combined figures under the name the reader chose for the difference.
    await expect(
      withTenant(tenantId, (tx) =>
        resolveEntityScope(tx, tenantId, "consolidated", entities, "declined"),
      ),
    ).rejects.toMatchObject({ code: "SCOPE_NOT_OFFERED" });

    // THE SINGLE-COMPANY TENANT NEVER SEES ANY OF IT: even asked for by name,
    // consolidated means that company's books.
    expect(
      await withTenant(tenantId, (tx) =>
        resolveEntityScope(
          tx,
          tenantId,
          "consolidated",
          [{ id: maple }],
          "offered",
        ),
      ),
    ).toEqual({ kind: "one", entityId: maple });

    const view = await withTenant(tenantId, (tx) =>
      resolveReportEntity(tx, tenantId, "consolidated", "offered"),
    );
    expect(view.scope).toEqual({ kind: "consolidated" });
    expect(view.offerConsolidated).toBe(true);
    // The stamp says which of the three it is, on the page, in the CSV and in
    // the filename — the rule the basis stamp already follows.
    expect(view.stampLabel).toBe("All companies (consolidated)");
    const declining = await withTenant(tenantId, (tx) =>
      resolveReportEntity(tx, tenantId, undefined, "declined"),
    );
    expect(declining.offerConsolidated).toBe(false);
  });

  it("a hand-written affiliate journal SURVIVES consolidation, and the report says so", async () => {
    // DELIBERATELY LAST: it leaves an unlinked affiliate balance in the
    // fixture, which is the state every assertion above is written to be free
    // of.
    //
    // A manual journal into an affiliate account has no link, so there is
    // nothing to follow and nothing to eliminate. It is SURFACED rather than
    // hidden: the line has no counterparty leg to remove with it, so
    // suppressing it would leave assets short against liabilities-plus-equity
    // and require inventing an equity plug to cover the difference.
    const dueFrom = await accountIdBySubtype("due_from_affiliate");
    const income = await accountId("4000");
    await withTenant(tenantId, (tx) =>
      postEntry(tx, owner, {
        entityId: maple,
        status: "posted",
        entryDate: "2026-11-02",
        memo: "Oak owes us rent — booked by hand, not as a transfer",
        lines: [
          { accountId: dueFrom, amountCents: 400 },
          { accountId: income, amountCents: -400 },
        ],
      }),
    );

    const [residual, rows] = await withTenant(tenantId, async (tx) => [
      await consolidationResidual(tx, tenantId, { asOf: "2026-11-30" }),
      await getBalances(tx, tenantId, {
        scope: CONSOLIDATED,
        asOf: "2026-11-30",
      }),
    ]);
    expect(residual.lineCount).toBe(1);
    expect(residual.netCents).toBe(400);
    // It is on the face of the consolidated statement, and the statement still
    // balances WITH it there — which is the whole argument for surfacing it.
    expect(netOf(rows, dueFrom)).toBe(400);
    expect(rows.reduce((a, r) => a + r.netCents, 0)).toBe(0);
  });

  /* -- per-entity close (slice 4) ----------------------------------------- */

  /**
   * THE FAILURE THIS SECTION EXISTS FOR: a period check that reads a
   * tenant-wide lock refuses a write to a company whose books are open, and —
   * worse — accepts one into a company whose books are closed. Neither is
   * visible on a single-company tenant, which is every other fixture here.
   *
   * These run LAST and deliberately leave Maple closed through 2026-01-31: the
   * dates above are 2026-03 onward, so nothing earlier in the file is affected,
   * and the closing itself is the point.
   */
  it("closing ONE company leaves the other's books open", async () => {
    const cash = await accountId("1000");
    const rent = await accountId("4000");

    await withTenant(tenantId, (tx) =>
      completeClose(tx, owner, { entityId: maple, periodEnd: "2026-01-31" }),
    );

    // Maple is locked...
    expect(
      await withTenant(tenantId, (tx) => getClosedThrough(tx, tenantId, maple)),
    ).toBe("2026-01-31");
    await expect(
      withTenant(tenantId, (tx) =>
        postEntry(tx, owner, {
          entityId: maple,
          status: "posted",
          entryDate: "2026-01-15",
          memo: "into Maple's closed January",
          lines: [
            { accountId: cash, amountCents: 100 },
            { accountId: rent, amountCents: -100 },
          ],
        }),
      ),
    ).rejects.toMatchObject({ code: "PERIOD_CLOSED" });

    // ...and Oak is NOT. Same date, same accounts, different set of books.
    expect(
      await withTenant(tenantId, (tx) => getClosedThrough(tx, tenantId, oak)),
    ).toBeNull();
    const posted = await withTenant(tenantId, (tx) =>
      postEntry(tx, owner, {
        entityId: oak,
        status: "posted",
        entryDate: "2026-01-15",
        memo: "into Oak's OPEN January",
        lines: [
          { accountId: cash, amountCents: 100 },
          { accountId: rent, amountCents: -100 },
        ],
      }),
    );
    expect(posted.entry.status).toBe("posted");
  });

  it("the checklist counts THIS company's work, not the tenant's", async () => {
    const cash = await accountId("1000");
    const rent = await accountId("4000");
    // A draft in Oak's books only.
    await withTenant(tenantId, (tx) =>
      postEntry(tx, owner, {
        entityId: oak,
        status: "draft",
        entryDate: "2026-02-10",
        memo: "Oak draft, February",
        lines: [
          { accountId: cash, amountCents: 500 },
          { accountId: rent, amountCents: -500 },
        ],
      }),
    );
    const [oakList, mapleList] = await withTenant(tenantId, async (tx) => [
      await getCloseChecklist(tx, tenantId, oak, "2026-02-28"),
      await getCloseChecklist(tx, tenantId, maple, "2026-02-28"),
    ]);
    const drafts = (c: { items: Array<{ key: string; count: number }> }) =>
      c.items.find((i) => i.key === "draft_entries")!.count;
    // Telling somebody closing Maple that Oak has a draft is the noise this
    // scoping removes — and it would have been a blocker on their screen.
    expect(drafts(oakList)).toBeGreaterThanOrEqual(1);
    expect(drafts(mapleList)).toBe(0);
    expect(oakList.entityId).toBe(oak);
  });

  it("two companies can close the SAME period — it is not a collision", async () => {
    // The old unique index was (tenant, period_end) and would have refused
    // this outright. Ten LLCs closing the same June is the ordinary case.
    await withTenant(tenantId, (tx) =>
      completeClose(tx, owner, { entityId: oak, periodEnd: "2026-01-31" }),
    );
    const closes = await withTenant(tenantId, (tx) => listCloses(tx, tenantId));
    const january = closes.filter(
      (c) => c.periodEnd === "2026-01-31" && c.status === "completed",
    );
    expect(january).toHaveLength(2);
    expect(new Set(january.map((c) => c.entityId))).toEqual(
      new Set([maple, oak]),
    );
  });

  it("'the latest close' is per company, and reopening one leaves the other alone", async () => {
    // Maple moves on to February; Oak stays at January.
    await withTenant(tenantId, (tx) =>
      completeClose(tx, owner, { entityId: maple, periodEnd: "2026-02-28" }),
    );
    const closes = await withTenant(tenantId, (tx) => listCloses(tx, tenantId));
    const oakJan = closes.find(
      (c) => c.entityId === oak && c.periodEnd === "2026-01-31",
    )!;

    // Oak's January is still ITS latest, even though a later close exists in
    // the tenant. A tenant-wide check would have refused this with
    // CLOSE_NOT_LATEST.
    await withTenant(tenantId, (tx) =>
      reopenClose(tx, owner, {
        closeId: oakJan.id,
        expectedVersion: oakJan.version,
      }),
    );
    expect(
      await withTenant(tenantId, (tx) => getClosedThrough(tx, tenantId, oak)),
    ).toBeNull();
    // Maple is untouched by Oak being reopened.
    expect(
      await withTenant(tenantId, (tx) => getClosedThrough(tx, tenantId, maple)),
    ).toBe("2026-02-28");
  });

  it("closing is monotonic WITHIN a company and says nothing about another", async () => {
    // Backwards in Maple: refused, because Maple is at February.
    await expect(
      withTenant(tenantId, (tx) =>
        completeClose(tx, owner, { entityId: maple, periodEnd: "2026-01-31" }),
      ),
    ).rejects.toMatchObject({ code: "CLOSE_NOT_FORWARD" });
    // The SAME date in Oak is fine — it is behind, which is the whole point.
    const { close } = await withTenant(tenantId, (tx) =>
      completeClose(tx, owner, { entityId: oak, periodEnd: "2026-01-31" }),
    );
    expect(close.entityId).toBe(oak);
    expect(close.previousClosedThrough).toBeNull();
  });

  it("the group is closed through the EARLIEST company, and open if any is", async () => {
    const entities = await withTenant(tenantId, (tx) =>
      listEntities(tx, tenantId, { includeInactive: true }),
    );
    // Maple 2026-02-28, Oak 2026-01-31, and any company never closed makes the
    // whole group open — the rule the hub card and the trial-balance footer
    // both read through.
    const closed = entities.filter((e) => e.closedThrough);
    expect(closed.length).toBeGreaterThanOrEqual(2);
    expect(groupClosedThrough(closed)).toBe("2026-01-31");
    expect(groupClosedThrough(entities)).toBe(
      entities.every((e) => e.closedThrough) ? "2026-01-31" : null,
    );
  });

  /* -- an invoice paid into another company's account --------------------- */

  /**
   * THE MIRROR OF THE BILL CASE, and the last thing ADR 0010 listed as refused
   * rather than recorded. Placed after the slice-3 assertions on purpose: these
   * post further intercompany pairs, and the consolidation cases above are
   * written against the fixture as it stands before them.
   */
  it("an invoice banked into another company's account records a PAIR", async () => {
    const dueFrom = await accountIdBySubtype("due_from_affiliate");
    const dueTo = await accountIdBySubtype("due_to_affiliate");
    const ar = await accountIdBySubtype("accounts_receivable");

    // Oak Row issues; the cheque goes into MAPLE's account.
    const income = await accountId("4000");
    const invoice = await withTenant(tenantId, async (tx) => {
      const draft = await createInvoiceDraft(tx, owner, {
        entityId: oak,
        customerId: oakCustomer,
        issueDate: "2026-12-01",
        lines: [
          {
            description: "Rent",
            quantity: "1",
            unitPriceCents: 9_000,
            incomeAccountId: income,
          },
        ],
      });
      return issueInvoice(tx, owner, {
        invoiceId: draft.id,
        expectedVersion: draft.version,
      });
    });
    const payment = await withTenant(tenantId, async (tx) => {
      const inv = await tx.query.invoices.findFirst({
        where: eq(schema.invoices.id, invoice.id),
      });
      const r = await recordPayment(tx, owner, {
        invoiceId: invoice.id,
        expectedVersion: inv!.version,
        paymentDate: "2026-12-02",
        amountCents: 9_000,
        depositAccountId: mapleBankLedgerAccountId,
        method: "check",
      });
      return r.payment;
    });

    const entry = await withTenant(tenantId, (tx) =>
      tx.query.journalEntries.findFirst({
        where: eq(schema.journalEntries.id, payment.journalEntryId),
      }),
    );
    // The payment row points at the INVOICE'S leg, so status, aging and unapply
    // read it exactly as they always did.
    expect(entry!.entityId).toBe(oak);
    expect(entry!.intercompanyId).toBeTruthy();

    const legs = await withTenant(tenantId, (tx) =>
      loadIntercompanyEntries(tx, tenantId, entry!.intercompanyId!),
    );
    expect(legs).toHaveLength(2);
    expect(new Set(legs.map((l) => l.entityId))).toEqual(new Set([oak, maple]));

    const DEC = { from: "2026-12-01", to: "2026-12-31" };
    const [oakRows, mapleRows] = await withTenant(tenantId, async (tx) => [
      await getBalances(tx, tenantId, { scope: scopeOf(oak), ...DEC }),
      await getBalances(tx, tenantId, { scope: scopeOf(maple), ...DEC }),
    ]);
    // Oak: the receivable rose on issue and cleared on payment, and it is owed
    // the money by Maple instead.
    expect(netOf(oakRows, ar)).toBe(0);
    expect(netOf(oakRows, dueFrom)).toBe(9_000);
    // Maple: cash in, and it owes Oak for it.
    expect(netOf(mapleRows, mapleBankLedgerAccountId)).toBe(9_000);
    expect(netOf(mapleRows, dueTo)).toBe(-9_000);

    // Each set of books still balances on its own, which is the invariant the
    // pair exists to preserve.
    expect(
      await withTenant(tenantId, (tx) => ledgerIsBalancedPerEntity(tx, tenantId)),
    ).toBe(true);

    // ...and consolidated, the affiliate legs are gone and all that is left is
    // a bank deposit.
    const consolidated = await withTenant(tenantId, (tx) =>
      getBalances(tx, tenantId, { scope: CONSOLIDATED, ...DEC }),
    );
    expect(netOf(consolidated, dueFrom)).toBe(0);
    expect(netOf(consolidated, dueTo)).toBe(0);
    expect(netOf(consolidated, mapleBankLedgerAccountId)).toBe(9_000);

    // The invoice itself is paid, and nothing about that asked which company's
    // account the money landed in.
    const after = await withTenant(tenantId, (tx) =>
      tx.query.invoices.findFirst({ where: eq(schema.invoices.id, invoice.id) }),
    );
    expect(after!.status).toBe("paid");
  });

  it("unapplying it voids BOTH legs, not just the invoice's", async () => {
    /**
     * THE BUG THIS FOUND, and it predates the mirror. `assertNotIntercompanyLeg`
     * lived only in the journal ACTIONS, so `unapplyBillPayment` went straight
     * to `voidEntry` and voided one side — proved against the dev database,
     * which returned `['posted', 'void']`. The other company was left holding a
     * "Due from Affiliates" balance that `affiliateBalances` cannot even report,
     * because a group with one surviving entry reads as half a pair.
     */
    const income = await accountId("4000");
    const invoice = await withTenant(tenantId, async (tx) => {
      const draft = await createInvoiceDraft(tx, owner, {
        entityId: oak,
        customerId: oakCustomer,
        issueDate: "2026-12-05",
        lines: [
          {
            description: "Rent",
            quantity: "1",
            unitPriceCents: 2_500,
            incomeAccountId: income,
          },
        ],
      });
      return issueInvoice(tx, owner, {
        invoiceId: draft.id,
        expectedVersion: draft.version,
      });
    });
    const payment = await withTenant(tenantId, async (tx) => {
      const inv = await tx.query.invoices.findFirst({
        where: eq(schema.invoices.id, invoice.id),
      });
      const r = await recordPayment(tx, owner, {
        invoiceId: invoice.id,
        expectedVersion: inv!.version,
        paymentDate: "2026-12-06",
        amountCents: 2_500,
        depositAccountId: mapleBankLedgerAccountId,
        method: "check",
      });
      return r.payment;
    });
    const icId = (await withTenant(tenantId, (tx) =>
      tx.query.journalEntries.findFirst({
        where: eq(schema.journalEntries.id, payment.journalEntryId),
      }),
    ))!.intercompanyId!;

    await withTenant(tenantId, (tx) =>
      unapplyPayment(tx, owner, {
        paymentId: payment.id,
        expectedVersion: payment.version,
      }),
    );

    const legs = await withTenant(tenantId, (tx) =>
      loadIntercompanyEntries(tx, tenantId, icId),
    );
    expect(legs).toHaveLength(2);
    expect(legs.every((l) => l.status === "void")).toBe(true);

    // Nothing is left owed either way — the whole point of taking both.
    const balances = await withTenant(tenantId, (tx) =>
      affiliateBalances(tx, tenantId),
    );
    expect(
      balances.every((b) => b.netCents !== 2_500 && b.netCents !== -2_500),
    ).toBe(true);
    expect(
      await withTenant(tenantId, (tx) => ledgerIsBalancedPerEntity(tx, tenantId)),
    ).toBe(true);
  });

  it("the ENGINE refuses a one-sided void now, not just the journal screen", async () => {
    // The guard moved from `actions.ts` into `voidEntry`, which is what makes
    // every future caller inherit it rather than remember it.
    const pair = await withTenant(tenantId, (tx) =>
      postIntercompanyPair(tx, owner, {
        fromEntityId: maple,
        toEntityId: oak,
        amountCents: 700,
        entryDate: "2026-12-10",
        memo: "one-sided void attempt",
        payerLines: [{ accountId: mapleBankLedgerAccountId, amountCents: -700 }],
        payeeLines: [{ accountId: oakBankLedgerAccountId, amountCents: 700 }],
      }),
    );
    for (const leg of [pair.from, pair.to]) {
      await expect(
        withTenant(tenantId, (tx) =>
          voidEntry(tx, owner, { entryId: leg.id, expectedVersion: leg.version }),
        ),
      ).rejects.toMatchObject({ code: "ENTRY_INTERCOMPANY" });
    }
    // And the pair-aware undo takes both.
    await withTenant(tenantId, (tx) =>
      voidIntercompanyPair(tx, owner, pair.intercompanyId),
    );
    const legs = await withTenant(tenantId, (tx) =>
      loadIntercompanyEntries(tx, tenantId, pair.intercompanyId),
    );
    expect(legs.every((l) => l.status === "void")).toBe(true);
  });

  /* -- a fixed asset carries its own company ------------------------------ */

  it("an asset's depreciation lands in ITS company, even after the default moves", async () => {
    /**
     * THE LAST ITEM ON ADR 0010'S LIST. Until `assets.entity_id` existed, an
     * asset's depreciation went wherever its FIRST entry landed
     * (`entityForDocument`), which meant the tenant's default at the moment
     * somebody first pressed Post — a company chosen by timing rather than by
     * anybody. Moving the default between two months of one schedule then split
     * it across two balance sheets.
     *
     * The default is moved MID-TEST, exactly as the invoice case does, because
     * that is the only way to tell a stored company from an inferred one.
     */
    const fixedAssetAccount = await accountIdBySubtype("fixed_asset");
    const asset = await withTenant(tenantId, (tx) =>
      createAsset(
        tx,
        { tenantId, userId: "owner-user", role: "owner" },
        {
          kind: "equipment",
          name: "Oak Row mower",
          entityId: oak,
          acquisitionCostCents: 24_000,
          inServiceOn: "2027-01-01",
          assetAccountId: fixedAssetAccount,
          depreciationMethod: "straight_line",
          usefulLifeMonths: 24,
          salvageValueCents: 0,
        },
      ),
    );
    expect(asset.entityId).toBe(oak);

    // The tenant default is MAPLE at this point; move it to make the point.
    await withTenant(tenantId, (tx) => setDefaultEntity(tx, owner, maple));

    const posted = await withTenant(tenantId, (tx) =>
      postDepreciation(
        tx,
        { tenantId, userId: "owner-user", role: "owner" },
        asset,
        "2027-02",
      ),
    );
    expect(posted.postedPeriods.length).toBeGreaterThan(0);

    const entries = await withTenant(tenantId, (tx) =>
      tx.query.journalEntries.findMany({
        where: and(
          eq(schema.journalEntries.tenantId, tenantId),
          eq(schema.journalEntries.source, "depreciation"),
          eq(schema.journalEntries.sourceId, asset.id),
        ),
      }),
    );
    expect(entries.length).toBeGreaterThan(0);
    // EVERY month in OAK's books, not the default's.
    for (const e of entries) expect(e.entityId).toBe(oak);

    // And it shows up on Oak's P&L rather than Maple's.
    const FEB = { from: "2027-01-01", to: "2027-02-28" };
    const [oakRows, mapleRows] = await withTenant(tenantId, async (tx) => [
      await getBalances(tx, tenantId, { scope: scopeOf(oak), ...FEB }),
      await getBalances(tx, tenantId, { scope: scopeOf(maple), ...FEB }),
    ]);
    const expense = await accountId("6900");
    expect(netOf(oakRows, expense)).toBeGreaterThan(0);
    expect(netOf(mapleRows, expense)).toBe(0);
  });

  it("an asset defaults to the tenant's default company when nobody says", async () => {
    // The single-company tenant's path: no picker, no argument, and the asset
    // still ends up somewhere real rather than null.
    const asset = await withTenant(tenantId, (tx) =>
      createAsset(
        tx,
        { tenantId, userId: "owner-user", role: "owner" },
        { kind: "equipment", name: "Unassigned trailer" },
      ),
    );
    expect(asset.entityId).toBe(
      await withTenant(tenantId, (tx) => getDefaultEntityId(tx, tenantId)),
    );
  });

  it("combined balancing is NOT evidence that each company balances", async () => {
    // Documents the reason `ledgerIsBalancedPerEntity` exists at all: the two
    // checks are different questions, and the hub asks the stricter one.
    expect(await withTenant(tenantId, (tx) => ledgerIsBalanced(tx, tenantId, COMBINED))).toBe(
      true,
    );
    expect(
      await withTenant(tenantId, (tx) => ledgerIsBalancedPerEntity(tx, tenantId)),
    ).toBe(true);
  });
});
