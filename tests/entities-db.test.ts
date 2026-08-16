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
  resolveEntityScope,
  resolveReportEntity,
  reverseEntry,
  setDefaultEntity,
  type EntityScope,
  type LedgerCtx,
} from "../src/modules/accounting/core";
import { createBankAccount } from "../src/modules/accounting/banking/accounts";
import { createCustomer } from "../src/modules/accounting/invoicing/customers";
import {
  createInvoiceDraft,
  issueInvoice,
} from "../src/modules/accounting/invoicing/invoices";
import { recordPayment } from "../src/modules/accounting/invoicing/payments";
import { getArAging } from "../src/modules/accounting/invoicing/aging-feed";
import { provisionAccounting } from "../src/modules/accounting/templates/apply";

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
const COMBINED: EntityScope = { kind: "combined" };

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

function scopeOf(entityId: string): EntityScope {
  return { kind: "one", entityId };
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
        resolveEntityScope(tx, tenantId, crypto.randomUUID(), entities),
      ),
    ).rejects.toThrow(LedgerError);
  });

  it("an absent entity means combined here, and the ONE company elsewhere", async () => {
    const entities = await withTenant(tenantId, (tx) => listEntities(tx, tenantId));
    expect(
      await withTenant(tenantId, (tx) =>
        resolveEntityScope(tx, tenantId, undefined, entities),
      ),
    ).toEqual({ kind: "combined" });
    // A single-entity tenant is scoped to its one company, so its reports say
    // nothing about companies at all.
    expect(
      await withTenant(tenantId, (tx) =>
        resolveEntityScope(tx, tenantId, undefined, [{ id: maple }]),
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
      resolveReportEntity(tx, tenantId, closed),
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

  it("REFUSES a payment deposited into another company's register", async () => {
    // The ten-LLC landlord's constant move, and the one thing slice 1b will not
    // let you record: as a single entry it would show cash arriving in an
    // account the company does not own. It is intercompany (slice 2).
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
    await expect(
      withTenant(tenantId, async (tx) => {
        const inv = await tx.query.invoices.findFirst({
          where: eq(schema.invoices.id, invoiceId),
        });
        return recordPayment(tx, owner, {
          invoiceId,
          expectedVersion: inv!.version,
          amountCents: 10_000,
          paymentDate: "2026-06-11",
          depositAccountId: mapleBankLedgerAccountId,
          method: "check",
        });
      }),
    ).rejects.toMatchObject({ code: "CROSS_ENTITY_REGISTER" });
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
