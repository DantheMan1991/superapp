import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { withTenant, withSystem, schema } from "../src/db";
import {
  assertEntryNotSourceManaged,
  setClosedThrough,
  startReconciliation,
  toggleReconciliationLine,
  type LedgerCtx,
} from "../src/modules/accounting/core";
import { provisionAccounting } from "../src/modules/accounting/templates/apply";
import { createBankAccount } from "../src/modules/accounting/banking/accounts";
import {
  findMatchCandidates,
  matchTransactionToEntry,
  resetBankLinkForEntry,
} from "../src/modules/accounting/banking/match";
import {
  billTotalCents,
  canTransition,
  deriveBillStatus,
  normalizeBillNumber,
} from "../src/modules/accounting/payables/lines";
import {
  approveBill,
  createBillDraft,
  deleteBillDraft,
  findPossibleDuplicates,
  loadBill,
  loadBillLines,
  returnBillToDraft,
  submitBill,
  updateBillDraft,
  voidBill,
} from "../src/modules/accounting/payables/bills";
import {
  recordBillPayment,
  unapplyBillPayment,
} from "../src/modules/accounting/payables/payments";
import {
  createBillFromDocument,
  prefillFromExtraction,
} from "../src/modules/accounting/payables/from-document";
import { buildApAging } from "../src/modules/accounting/payables/aging";
import { getApAging } from "../src/modules/accounting/payables/aging-feed";
import { createVendor } from "../src/modules/accounting/payables/vendors";
import {
  gatherBillCodingInputs,
  suggestBillCodingForBill,
} from "../src/modules/accounting/ai/bill-code";
import { validateBillCoding } from "../src/modules/accounting/ai/bill-validate";
import { buildBillCodingUserTurn } from "../src/modules/accounting/ai/bill-prompt";
import {
  registerPackContext,
  unregisterPackContext,
} from "../src/modules/accounting/ai/pack-context";
import { emptyExtraction } from "../src/modules/accounting/ai/extract-validate";
import { createDocumentRecord } from "../src/modules/accounting/documents/ingest";
import {
  detachAllForTargets,
  listDocumentsForTarget,
} from "../src/modules/accounting/documents/links";
import { loadDocument } from "../src/modules/accounting/documents/documents";

const RUN = !!process.env.DATABASE_URL;
const d = RUN ? describe : describe.skip;

// =====================================================================
// Pure suite
// =====================================================================

describe("bill status + transitions (pure)", () => {
  it("deriveBillStatus boundaries", () => {
    expect(deriveBillStatus(1000, 0)).toBe("approved");
    expect(deriveBillStatus(1000, 999)).toBe("partial");
    expect(deriveBillStatus(1000, 1000)).toBe("paid");
  });
  it("transition table (incl. owner draft→approved skip)", () => {
    expect(canTransition("approve", "draft")).toBe(true);
    expect(canTransition("approve", "awaiting_approval")).toBe(true);
    expect(canTransition("approve", "approved")).toBe(false);
    expect(canTransition("submit", "draft")).toBe(true);
    expect(canTransition("submit", "approved")).toBe(false);
    expect(canTransition("return", "awaiting_approval")).toBe(true);
    expect(canTransition("void", "approved")).toBe(true);
    expect(canTransition("void", "draft")).toBe(false);
    expect(canTransition("pay", "partial")).toBe(true);
    expect(canTransition("pay", "paid")).toBe(false);
    expect(canTransition("edit", "awaiting_approval")).toBe(false);
  });
  it("billTotalCents sums signed lines", () => {
    expect(
      billTotalCents([{ amountCents: 5000 }, { amountCents: -500 }, { amountCents: 0 }]),
    ).toBe(4500);
  });
  it("normalizeBillNumber trims and casefolds; empty never matches", () => {
    expect(normalizeBillNumber("  INV-42 ")).toBe("inv-42");
    expect(normalizeBillNumber("")).toBe("");
  });
});

describe("prefillFromExtraction (pure, P13)", () => {
  const MODEL = "m";
  const NOW = "2026-07-22T00:00:00.000Z";
  function extraction(over: {
    totalCents?: number | null;
    documentDate?: string | null;
    documentNumber?: string | null;
    vendorName?: string | null;
    lineItems?: Array<{ description: string; quantity?: number; amountCents: number | null }>;
  }) {
    const e = emptyExtraction(MODEL, NOW);
    if (over.totalCents !== undefined)
      e.fields.totalCents = { value: over.totalCents, confidence: 0.9 };
    if (over.documentDate !== undefined)
      e.fields.documentDate = { value: over.documentDate, confidence: 0.9 };
    if (over.documentNumber !== undefined)
      e.fields.documentNumber = { value: over.documentNumber, confidence: 0.9 };
    if (over.vendorName !== undefined)
      e.fields.vendorName = { value: over.vendorName, confidence: 0.9 };
    e.lineItems = over.lineItems ?? [];
    return e;
  }

  it("uses lineItems when every amount is known and sums to the total", () => {
    const p = prefillFromExtraction(
      extraction({
        totalCents: 4500,
        documentNumber: "H-99",
        documentDate: "2026-07-10",
        lineItems: [
          { description: "Pipe", quantity: 2, amountCents: 1800 },
          { description: "Wrench", amountCents: 2700 },
        ],
      }),
      "acct-1",
    );
    expect(p.usedLineItems).toBe(true);
    expect(p.lines).toHaveLength(2);
    expect(p.lines[0].description).toBe("2x Pipe");
    expect(p.lines.every((l) => l.accountId === "acct-1")).toBe(true);
    expect(billTotalCents(p.lines)).toBe(4500);
    expect(p.billNumber).toBe("H-99");
    expect(p.billDate).toBe("2026-07-10");
  });

  it("falls back to a single total line on sum mismatch or null amounts", () => {
    const mismatch = prefillFromExtraction(
      extraction({
        totalCents: 5000,
        vendorName: "Acme Supply",
        lineItems: [{ description: "Thing", amountCents: 4999 }],
      }),
      null,
    );
    expect(mismatch.usedLineItems).toBe(false);
    expect(mismatch.lines).toEqual([
      { description: "Acme Supply", amountCents: 5000, accountId: null },
    ]);

    const nullAmount = prefillFromExtraction(
      extraction({
        totalCents: 5000,
        lineItems: [{ description: "Thing", amountCents: null }],
      }),
      null,
    );
    expect(nullAmount.usedLineItems).toBe(false);
  });

  it("empty extraction produces a blank single-line draft", () => {
    const p = prefillFromExtraction(null, null);
    expect(p.lines).toEqual([
      { description: "Bill total", amountCents: 0, accountId: null },
    ]);
    expect(p.billDate).toBeNull();
    expect(p.billNumber).toBe("");
  });
});

describe("validateBillCoding (pure)", () => {
  const accounts = new Map([
    ["6000", { id: "a-6000", isActive: true }],
    ["6100", { id: "a-6100", isActive: false }],
  ]);
  const lineIds = new Set(["l1", "l2"]);

  it("keeps valid, drops unknown ids/codes/inactive, clamps, first wins", () => {
    const out = validateBillCoding(
      {
        suggestions: [
          { billLineId: "l1", accountCode: "6000", confidence: 3, reason: "history" },
          { billLineId: "l1", accountCode: "6000", confidence: 0.5 },
          { billLineId: "l2", accountCode: "6100", confidence: 0.9 },
          { billLineId: "lX", accountCode: "6000", confidence: 0.9 },
          { billLineId: "l2", accountCode: "9999", confidence: 0.9 },
        ],
      },
      lineIds,
      accounts,
      "model-x",
      "now",
    );
    expect(out.suggestions).toHaveLength(1);
    expect(out.suggestions[0]).toMatchObject({
      billLineId: "l1",
      accountId: "a-6000",
      confidence: 1,
      reason: "history",
    });
    expect(out.model).toBe("model-x");
  });

  it("malformed payloads degrade to empty", () => {
    expect(validateBillCoding("junk", lineIds, accounts, "m", "t").suggestions).toEqual([]);
    expect(validateBillCoding(null, lineIds, accounts, "m", "t").suggestions).toEqual([]);
    expect(
      validateBillCoding({ suggestions: "no" }, lineIds, accounts, "m", "t").suggestions,
    ).toEqual([]);
  });
});

describe("bill coding prompt (pure)", () => {
  it("includes history and pack guidance sections, caps guidance", () => {
    const turn = buildBillCodingUserTurn(
      [{ code: "6000", name: "Office", accountType: "expense", subtype: "operating_expense" }],
      [{ description: "Paper", code: "6000" }],
      { vendorName: "Staples", billDate: "2026-07-01", billNumber: "S-1" },
      [{ id: "l1", description: "Paper", amountCents: 1000 }],
      ["Use cost codes for job materials.", "x".repeat(5000)],
    );
    expect(turn).toContain('"Paper" -> 6000');
    expect(turn).toContain("INDUSTRY GUIDANCE");
    expect(turn).toContain("Use cost codes");
    expect(turn).toContain("Staples");
    // Second pack guidance capped at 2000 chars.
    expect(turn.length).toBeLessThan(4000);
  });
});

describe("AP aging builder (pure)", () => {
  it("buckets by vendor and excludes fully paid", () => {
    const report = buildApAging(
      [
        { billId: "1", billNumber: "A-1", vendorId: "v1", vendorName: "Acme", dueDate: "2026-07-01", totalCents: 10_000, paidCents: 4_000 },
        { billId: "2", billNumber: "A-2", vendorId: "v1", vendorName: "Acme", dueDate: null, totalCents: 5_000, paidCents: 0 },
        { billId: "3", billNumber: "B-1", vendorId: "v2", vendorName: "Beta", dueDate: "2026-01-01", totalCents: 2_000, paidCents: 2_000 },
      ],
      "2026-07-21",
    );
    expect(report.totalCents).toBe(11_000);
    expect(report.overdueCents).toBe(6_000);
    const acme = report.rows.find((r) => r.label === "Acme")!;
    expect(acme.perMemberCents).toEqual([5_000, 6_000, 0, 0, 0, 11_000]);
  });
});

// =====================================================================
// DB suite
// =====================================================================

d("payables (DB)", () => {
  const STAMP = `payables-test-${process.pid}`;
  let tenantId: string;
  let owner: LedgerCtx;
  let staff: LedgerCtx;
  let vendorId: string;
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

  const line = (cents: number, accountId: string | null, description = "Test line") => ({
    description,
    amountCents: cents,
    accountId,
    dimensionMemberIds: undefined as string[] | undefined,
  });

  async function makeBill(
    lines: Array<ReturnType<typeof line>>,
    over: { billNumber?: string; billDate?: string; vendor?: string } = {},
  ) {
    return withTenant(tenantId, (tx) =>
      createBillDraft(tx, owner, {
        vendorId: over.vendor ?? vendorId,
        billNumber: over.billNumber,
        billDate: over.billDate ?? "2026-06-15",
        lines,
      }),
    );
  }

  beforeAll(async () => {
    tenantId = await withSystem(async (tx) => {
      const rows = await tx
        .insert(schema.tenants)
        .values([{ clerkOrgId: STAMP, name: "Payables Test", slug: STAMP }])
        .returning();
      return rows[0].id;
    });
    owner = { tenantId, userId: "owner", role: "owner" };
    staff = { tenantId, userId: "staff", role: "staff" };
    await withTenant(tenantId, (tx) => provisionAccounting(tx, tenantId));
    vendorId = (
      await withTenant(tenantId, (tx) =>
        createVendor(tx, owner, { name: "Home Depot" }),
      )
    ).id;
    const bank = await withTenant(tenantId, (tx) =>
      createBankAccount(tx, owner, { name: "Payables Checking", kind: "checking" }),
    );
    acct.__bankLedger = bank.ledgerAccount.id;
    acct.__bankAccountId = bank.bankAccount.id;
    const cc = await withTenant(tenantId, (tx) =>
      createBankAccount(tx, owner, { name: "Payables Card", kind: "credit_card" }),
    );
    acct.__ccLedger = cc.ledgerAccount.id;
  });

  afterAll(async () => {
    await withSystem(async (tx) => {
      await tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantId));
    });
  });

  describe("approval posting", () => {
    it("posts Dr per line / Cr AP, skips zero lines, handles credit lines, copies dims", async () => {
      const memberId = (
        await withTenant(tenantId, async (tx) => {
          const [m] = await tx
            .insert(schema.dimensionMembers)
            .values({
              tenantId,
              dimensionType: "property",
              packEntityId: crypto.randomUUID(),
              displayName: "Unit 1",
            })
            .returning();
          return m;
        })
      ).id;
      const expense = await accountId("6000");
      const cogs = await accountId("5000");
      const bill = await makeBill([
        { ...line(6000, expense, "Lumber"), dimensionMemberIds: [memberId] },
        line(-500, expense, "Contractor discount"),
        line(0, null, "Zero note line"),
        line(2000, cogs, "Materials"),
      ]);
      expect(bill.totalCents).toBe(7500);
      const approved = await withTenant(tenantId, (tx) =>
        approveBill(tx, owner, { billId: bill.id, expectedVersion: bill.version }),
      );
      expect(approved.status).toBe("approved");
      const entryLines = await withTenant(tenantId, (tx) =>
        tx.query.journalLines.findMany({
          where: and(
            eq(schema.journalLines.tenantId, tenantId),
            eq(schema.journalLines.entryId, approved.journalEntryId!),
          ),
        }),
      );
      // 3 non-zero lines + AP credit.
      expect(entryLines).toHaveLength(4);
      expect(entryLines.reduce((s, l) => s + l.amountCents, 0)).toBe(0);
      const ap = entryLines.find((l) => l.amountCents === -7500);
      expect(ap).toBeTruthy();
      // Dim copied onto the lumber line.
      const lumberLine = entryLines.find((l) => l.amountCents === 6000)!;
      const dims = await withTenant(tenantId, (tx) =>
        tx.query.lineDimensions.findMany({
          where: and(
            eq(schema.lineDimensions.tenantId, tenantId),
            eq(schema.lineDimensions.journalLineId, lumberLine.id),
          ),
        }),
      );
      expect(dims.map((d) => d.memberId)).toEqual([memberId]);
    });

    it("resolves AP by subtype, not code", async () => {
      const expense = await accountId("6000");
      // Temporarily rename the AP account's code.
      await withTenant(tenantId, (tx) =>
        tx
          .update(schema.accounts)
          .set({ code: "9200" })
          .where(
            and(
              eq(schema.accounts.tenantId, tenantId),
              eq(schema.accounts.subtype, "accounts_payable"),
            ),
          ),
      );
      const bill = await makeBill([line(1000, expense)]);
      const approved = await withTenant(tenantId, (tx) =>
        approveBill(tx, owner, { billId: bill.id, expectedVersion: bill.version }),
      );
      expect(approved.status).toBe("approved");
      await withTenant(tenantId, (tx) =>
        tx
          .update(schema.accounts)
          .set({ code: "2000" })
          .where(
            and(
              eq(schema.accounts.tenantId, tenantId),
              eq(schema.accounts.subtype, "accounts_payable"),
            ),
          ),
      );
    });

    it("rejects uncoded lines, empty bills, staff approval", async () => {
      const expense = await accountId("6000");
      const uncoded = await makeBill([line(1000, null)]);
      await expect(
        withTenant(tenantId, (tx) =>
          approveBill(tx, owner, { billId: uncoded.id, expectedVersion: uncoded.version }),
        ),
      ).rejects.toMatchObject({ code: "BILL_UNCODED_LINES" });

      const zero = await makeBill([line(0, expense)]);
      await expect(
        withTenant(tenantId, (tx) =>
          approveBill(tx, owner, { billId: zero.id, expectedVersion: zero.version }),
        ),
      ).rejects.toMatchObject({ code: "BILL_EMPTY" });

      const forStaff = await makeBill([line(1000, expense)]);
      await expect(
        withTenant(tenantId, (tx) =>
          approveBill(tx, staff, { billId: forStaff.id, expectedVersion: forStaff.version }),
        ),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("staff submit → owner approve from awaiting_approval; return works", async () => {
      const expense = await accountId("6000");
      const bill = await makeBill([line(1500, expense)]);
      const submitted = await withTenant(tenantId, (tx) =>
        submitBill(tx, staff, { billId: bill.id, expectedVersion: bill.version }),
      );
      expect(submitted.status).toBe("awaiting_approval");
      const returned = await withTenant(tenantId, (tx) =>
        returnBillToDraft(tx, staff, {
          billId: bill.id,
          expectedVersion: submitted.version,
        }),
      );
      expect(returned.status).toBe("draft");
      const resubmitted = await withTenant(tenantId, (tx) =>
        submitBill(tx, staff, { billId: bill.id, expectedVersion: returned.version }),
      );
      const approved = await withTenant(tenantId, (tx) =>
        approveBill(tx, owner, {
          billId: bill.id,
          expectedVersion: resubmitted.version,
        }),
      );
      expect(approved.status).toBe("approved");
    });

    it("freeze-on-approve: line edits rejected, memo/dueDate ok", async () => {
      const expense = await accountId("6000");
      const bill = await makeBill([line(1000, expense)]);
      const approved = await withTenant(tenantId, (tx) =>
        approveBill(tx, owner, { billId: bill.id, expectedVersion: bill.version }),
      );
      await expect(
        withTenant(tenantId, (tx) =>
          updateBillDraft(tx, owner, {
            billId: bill.id,
            expectedVersion: approved.version,
            patch: {
              vendorId,
              billDate: "2026-06-15",
              lines: [line(9999, expense)],
            },
          }),
        ),
      ).rejects.toMatchObject({ code: "BILL_NOT_DRAFT" });
    });

    it("closed period blocks approval", async () => {
      const expense = await accountId("6000");
      const bill = await makeBill([line(1000, expense)], { billDate: "2026-01-15" });
      await withTenant(tenantId, (tx) =>
        setClosedThrough(tx, owner, { date: "2026-01-31" }),
      );
      await expect(
        withTenant(tenantId, (tx) =>
          approveBill(tx, owner, { billId: bill.id, expectedVersion: bill.version }),
        ),
      ).rejects.toMatchObject({ code: "PERIOD_CLOSED" });
      await withTenant(tenantId, (tx) =>
        setClosedThrough(tx, owner, { date: null }),
      );
    });

    it("concurrent double-approve yields exactly one entry", async () => {
      const expense = await accountId("6000");
      const bill = await makeBill([line(4200, expense)]);
      const results = await Promise.allSettled([
        withTenant(tenantId, (tx) =>
          approveBill(tx, owner, { billId: bill.id, expectedVersion: bill.version }),
        ),
        withTenant(tenantId, (tx) =>
          approveBill(tx, owner, { billId: bill.id, expectedVersion: bill.version }),
        ),
      ]);
      const ok = results.filter((r) => r.status === "fulfilled");
      expect(ok.length).toBeGreaterThanOrEqual(1);
      const entries = await withTenant(tenantId, (tx) =>
        tx.query.journalEntries.findMany({
          where: and(
            eq(schema.journalEntries.tenantId, tenantId),
            eq(schema.journalEntries.source, "bill"),
            eq(schema.journalEntries.sourceId, bill.id),
          ),
        }),
      );
      expect(entries).toHaveLength(1);
    });
  });

  describe("payments", () => {
    it("derives approved→partial→paid, guards overpayment, CC register works", async () => {
      const expense = await accountId("6000");
      const bill = await makeBill([line(10_000, expense)]);
      let current = await withTenant(tenantId, (tx) =>
        approveBill(tx, owner, { billId: bill.id, expectedVersion: bill.version }),
      );

      const first = await withTenant(tenantId, (tx) =>
        recordBillPayment(tx, owner, {
          billId: bill.id,
          expectedVersion: current.version,
          paymentDate: "2026-06-20",
          amountCents: 4_000,
          paidFromAccountId: acct.__bankLedger,
          method: "check",
        }),
      );
      expect(first.bill.status).toBe("partial");
      current = first.bill;

      await expect(
        withTenant(tenantId, (tx) =>
          recordBillPayment(tx, owner, {
            billId: bill.id,
            expectedVersion: current.version,
            paymentDate: "2026-06-21",
            amountCents: 7_000,
            paidFromAccountId: acct.__bankLedger,
            method: "check",
          }),
        ),
      ).rejects.toMatchObject({ code: "BILL_OVERPAYMENT" });

      const second = await withTenant(tenantId, (tx) =>
        recordBillPayment(tx, owner, {
          billId: bill.id,
          expectedVersion: current.version,
          paymentDate: "2026-06-22",
          amountCents: 6_000,
          paidFromAccountId: acct.__ccLedger,
          method: "card",
        }),
      );
      expect(second.bill.status).toBe("paid");

      // Payment entry is balanced Dr AP / Cr paid-from.
      const entryLines = await withTenant(tenantId, (tx) =>
        tx.query.journalLines.findMany({
          where: and(
            eq(schema.journalLines.tenantId, tenantId),
            eq(schema.journalLines.entryId, second.payment.journalEntryId),
          ),
        }),
      );
      expect(entryLines.reduce((s, l) => s + l.amountCents, 0)).toBe(0);
      expect(
        entryLines.find((l) => l.accountId === acct.__ccLedger)?.amountCents,
      ).toBe(-6_000);
    });

    it("rejects a non-register paid-from account", async () => {
      const expense = await accountId("6000");
      const bill = await makeBill([line(1000, expense)]);
      const approved = await withTenant(tenantId, (tx) =>
        approveBill(tx, owner, { billId: bill.id, expectedVersion: bill.version }),
      );
      await expect(
        withTenant(tenantId, (tx) =>
          recordBillPayment(tx, owner, {
            billId: bill.id,
            expectedVersion: approved.version,
            paymentDate: "2026-06-20",
            amountCents: 1000,
            paidFromAccountId: expense,
            method: "other",
          }),
        ),
      ).rejects.toMatchObject({ code: "ACCOUNT_NOT_FOUND" });
    });

    it("unapply voids the entry and re-derives; void blocked with payments", async () => {
      const expense = await accountId("6000");
      const bill = await makeBill([line(5_000, expense)]);
      const approved = await withTenant(tenantId, (tx) =>
        approveBill(tx, owner, { billId: bill.id, expectedVersion: bill.version }),
      );
      const paid = await withTenant(tenantId, (tx) =>
        recordBillPayment(tx, owner, {
          billId: bill.id,
          expectedVersion: approved.version,
          paymentDate: "2026-06-20",
          amountCents: 5_000,
          paidFromAccountId: acct.__bankLedger,
          method: "check",
        }),
      );
      expect(paid.bill.status).toBe("paid");

      await expect(
        withTenant(tenantId, (tx) =>
          voidBill(tx, owner, { billId: bill.id, expectedVersion: paid.bill.version }),
        ),
      ).rejects.toMatchObject({ code: "BILL_HAS_PAYMENTS" });

      const unapplied = await withTenant(tenantId, (tx) =>
        unapplyBillPayment(tx, owner, {
          paymentId: paid.payment.id,
          expectedVersion: paid.payment.version,
        }),
      );
      expect(unapplied.bill.status).toBe("approved");
      const voidedEntry = await withTenant(tenantId, (tx) =>
        tx.query.journalEntries.findFirst({
          where: eq(schema.journalEntries.id, unapplied.voidedEntryId),
        }),
      );
      expect(voidedEntry?.status).toBe("void");

      const voided = await withTenant(tenantId, (tx) =>
        voidBill(tx, owner, {
          billId: bill.id,
          expectedVersion: unapplied.bill.version,
        }),
      );
      expect(voided.status).toBe("void");
      const approvalEntry = await withTenant(tenantId, (tx) =>
        tx.query.journalEntries.findFirst({
          where: eq(schema.journalEntries.id, voided.journalEntryId!),
        }),
      );
      expect(approvalEntry?.status).toBe("void");
    });

    it("reconciled paid-from line blocks unapply", async () => {
      const expense = await accountId("6000");
      const bill = await makeBill([line(3_000, expense)]);
      const approved = await withTenant(tenantId, (tx) =>
        approveBill(tx, owner, { billId: bill.id, expectedVersion: bill.version }),
      );
      const paid = await withTenant(tenantId, (tx) =>
        recordBillPayment(tx, owner, {
          billId: bill.id,
          expectedVersion: approved.version,
          paymentDate: "2026-06-25",
          amountCents: 3_000,
          paidFromAccountId: acct.__bankLedger,
          method: "check",
        }),
      );
      const recon = await withTenant(tenantId, (tx) =>
        startReconciliation(tx, owner, {
          bankAccountId: acct.__bankAccountId,
          statementEndDate: "2026-06-30",
          statementEndBalanceCents: 0,
        }),
      );
      const paidFromLine = await withTenant(tenantId, (tx) =>
        tx.query.journalLines.findFirst({
          where: and(
            eq(schema.journalLines.tenantId, tenantId),
            eq(schema.journalLines.entryId, paid.payment.journalEntryId),
            eq(schema.journalLines.accountId, acct.__bankLedger),
          ),
        }),
      );
      await withTenant(tenantId, (tx) =>
        toggleReconciliationLine(tx, owner, {
          reconciliationId: recon.id,
          journalLineId: paidFromLine!.id,
          checked: true,
        }),
      );
      await expect(
        withTenant(tenantId, (tx) =>
          unapplyBillPayment(tx, owner, {
            paymentId: paid.payment.id,
            expectedVersion: paid.payment.version,
          }),
        ),
      ).rejects.toMatchObject({ code: "ENTRY_IMMUTABLE" });
      await withTenant(tenantId, (tx) =>
        toggleReconciliationLine(tx, owner, {
          reconciliationId: recon.id,
          journalLineId: paidFromLine!.id,
          checked: false,
        }),
      );
    });
  });

  describe("drafts + documents (P21)", () => {
    it("draft delete cascades lines and detaches documents; raw delete fails at FK", async () => {
      const expense = await accountId("6000");
      const bill = await makeBill([line(1000, expense)]);
      const { document } = await withTenant(tenantId, (tx) =>
        createDocumentRecord(tx, tenantId, {
          blobPathname: `acct/${tenantId}/receipts/pay-${bill.id}.pdf`,
          fileName: "bill.pdf",
          mimeType: "application/pdf",
          sizeBytes: 100,
          sha256: `pay-${bill.id}`,
          source: "upload",
        }),
      );
      await withTenant(tenantId, async (tx) => {
        const { attachDocument } = await import(
          "../src/modules/accounting/documents/links"
        );
        await attachDocument(tx, owner, {
          documentId: document.id,
          target: { type: "bill", id: bill.id },
        });
      });
      // The backstop: deleting the bill without detaching must fail.
      await expect(
        withTenant(tenantId, (tx) =>
          tx
            .delete(schema.bills)
            .where(
              and(eq(schema.bills.tenantId, tenantId), eq(schema.bills.id, bill.id)),
            ),
        ),
      ).rejects.toThrow();
      // Coordinated path: detach + delete in one tx.
      await withTenant(tenantId, async (tx) => {
        await detachAllForTargets(tx, tenantId, "bill", [bill.id]);
        await deleteBillDraft(tx, owner, {
          billId: bill.id,
          expectedVersion: bill.version,
        });
      });
      const doc = await withTenant(tenantId, (tx) =>
        loadDocument(tx, tenantId, document.id),
      );
      expect(doc.status).toBe("inbox");
    });
  });

  describe("create from document (P12/P13)", () => {
    async function makeExtractedDoc(over: Record<string, unknown> = {}) {
      const seq = crypto.randomUUID();
      return withTenant(tenantId, (tx) =>
        createDocumentRecord(tx, tenantId, {
          blobPathname: `acct/${tenantId}/receipts/cfd-${seq}.pdf`,
          fileName: "cfd.pdf",
          mimeType: "application/pdf",
          sizeBytes: 100,
          sha256: `cfd-${seq}`,
          source: "email",
          ...over,
        }),
      );
    }

    it("prefills, attaches, dedups by link, warns on duplicates", async () => {
      const { document } = await makeExtractedDoc();
      const extraction = emptyExtraction("m", new Date().toISOString());
      extraction.docType = "bill";
      extraction.fields.vendorName = { value: "Fresh Vendor Co", confidence: 0.9 };
      extraction.fields.totalCents = { value: 42_18, confidence: 0.95 };
      extraction.fields.documentNumber = { value: "FV-100", confidence: 0.9 };
      extraction.fields.documentDate = { value: "2026-06-10", confidence: 0.9 };
      await withTenant(tenantId, (tx) =>
        tx
          .update(schema.documents)
          .set({ extraction, extractionStatus: "done" })
          .where(eq(schema.documents.id, document.id)),
      );

      const first = await withTenant(tenantId, (tx) =>
        createBillFromDocument(tx, owner, {
          documentId: document.id,
          createVendorName: "Fresh Vendor Co",
          billDateFallback: "2026-06-15",
        }),
      );
      expect(first.existing).toBe(false);
      expect(first.bill.billNumber).toBe("FV-100");
      expect(first.bill.billDate).toBe("2026-06-10");
      expect(first.bill.totalCents).toBe(4218);
      const attached = await withTenant(tenantId, (tx) =>
        listDocumentsForTarget(tx, tenantId, { type: "bill", id: first.bill.id }),
      );
      expect(attached.map((r) => r.document.id)).toContain(document.id);

      // Double-click: link presence returns the same bill.
      const second = await withTenant(tenantId, (tx) =>
        createBillFromDocument(tx, owner, {
          documentId: document.id,
          vendorId: first.bill.vendorId,
          billDateFallback: "2026-06-15",
        }),
      );
      expect(second.existing).toBe(true);
      expect(second.bill.id).toBe(first.bill.id);

      // Same vendor + number from another doc → duplicate warning.
      const { document: dupDoc } = await makeExtractedDoc();
      await withTenant(tenantId, (tx) =>
        tx
          .update(schema.documents)
          .set({ extraction, extractionStatus: "done" })
          .where(eq(schema.documents.id, dupDoc.id)),
      );
      const dup = await withTenant(tenantId, (tx) =>
        createBillFromDocument(tx, owner, {
          documentId: dupDoc.id,
          vendorId: first.bill.vendorId,
          billDateFallback: "2026-06-15",
        }),
      );
      expect(dup.existing).toBe(false);
      expect(dup.duplicates.some((s) => s.reason === "number")).toBe(true);
    });

    it("findPossibleDuplicates catches amount+date without a number", async () => {
      const expense = await accountId("6000");
      await makeBill([line(7777, expense)], { billDate: "2026-05-10" });
      const dups = await withTenant(tenantId, (tx) =>
        findPossibleDuplicates(tx, tenantId, {
          vendorId,
          billNumber: "",
          totalCents: 7777,
          billDate: "2026-05-12",
        }),
      );
      expect(dups.some((s) => s.reason === "amount_date")).toBe(true);
    });
  });

  describe("AI coding (injected model)", () => {
    async function resetCooldown(): Promise<void> {
      await withTenant(tenantId, (tx) =>
        tx
          .update(schema.accountingSettings)
          .set({ aiLastBillCodedAt: null })
          .where(eq(schema.accountingSettings.tenantId, tenantId)),
      );
    }

    it("persists validated coding + cooldown; draft edit clears it", async () => {
      await resetCooldown();
      const bill = await makeBill([line(1000, null, "Lumber haul")]);
      const lines = await withTenant(tenantId, (tx) =>
        loadBillLines(tx, tenantId, bill.id),
      );
      const coding = await suggestBillCodingForBill(owner, bill.id, async (g) => {
        expect(g.vendorName).toBe("Home Depot");
        expect(g.lines).toHaveLength(1);
        return {
          suggestions: [
            { billLineId: lines[0].id, accountCode: "6000", confidence: 0.85, reason: "hardware vendor" },
          ],
        };
      });
      expect(coding.suggestions).toHaveLength(1);
      const reloaded = await withTenant(tenantId, (tx) =>
        loadBill(tx, tenantId, bill.id),
      );
      expect(
        (reloaded.aiCoding as { suggestions: unknown[] }).suggestions,
      ).toHaveLength(1);

      // Cooldown blocks an immediate re-run.
      await expect(
        suggestBillCodingForBill(owner, bill.id, async () => ({ suggestions: [] })),
      ).rejects.toMatchObject({ code: "AI_COOLDOWN" });

      // Draft edit clears ai_coding.
      await resetCooldown();
      const expense = await accountId("6000");
      const edited = await withTenant(tenantId, (tx) =>
        updateBillDraft(tx, owner, {
          billId: bill.id,
          expectedVersion: reloaded.version,
          patch: { vendorId, billDate: "2026-06-15", lines: [line(2000, expense)] },
        }),
      );
      expect(edited.aiCoding).toBeNull();
    });

    it("model failure surfaces AI_UNAVAILABLE; approved bills refuse coding", async () => {
      await resetCooldown();
      const bill = await makeBill([line(1000, null)]);
      await expect(
        suggestBillCodingForBill(owner, bill.id, async () => {
          const { LedgerError } = await import("../src/modules/accounting/core");
          throw new LedgerError("AI_UNAVAILABLE", "no tool block");
        }),
      ).rejects.toMatchObject({ code: "AI_UNAVAILABLE" });

      await resetCooldown();
      const expense = await accountId("6000");
      const toApprove = await makeBill([line(1000, expense)]);
      const approved = await withTenant(tenantId, (tx) =>
        approveBill(tx, owner, {
          billId: toApprove.id,
          expectedVersion: toApprove.version,
        }),
      );
      expect(approved.status).toBe("approved");
      await expect(
        suggestBillCodingForBill(owner, toApprove.id, async () => ({ suggestions: [] })),
      ).rejects.toMatchObject({ code: "BILL_NOT_DRAFT" });
    });

    it("pack stub guidance appears only when the pack is enabled (P17)", async () => {
      await resetCooldown();
      registerPackContext({
        packId: "test-pack",
        tool: "bill_coding",
        buildGuidance: async () => "Route lumber to cost code 5100.",
      });
      try {
        const bill = await makeBill([line(1000, null)]);
        // Pack NOT enabled → no guidance.
        let gathered = await withTenant(tenantId, (tx) =>
          gatherBillCodingInputs(tx, owner, bill.id),
        );
        expect(gathered.packGuidance).toEqual([]);

        // Enable the pack on the accounting module row.
        await withSystem((tx) =>
          tx
            .insert(schema.tenantModules)
            .values({
              tenantId,
              moduleId: "accounting",
              enabled: true,
              config: { packs: ["test-pack"] },
            })
            .onConflictDoUpdate({
              target: [schema.tenantModules.tenantId, schema.tenantModules.moduleId],
              set: { config: { packs: ["test-pack"] } },
            }),
        );
        await resetCooldown();
        gathered = await withTenant(tenantId, (tx) =>
          gatherBillCodingInputs(tx, owner, bill.id),
        );
        expect(gathered.packGuidance).toEqual(["Route lumber to cost code 5100."]);
      } finally {
        unregisterPackContext("test-pack", "bill_coding");
      }
    });
  });

  describe("bank-feed integration (P18/P19)", () => {
    it("bill payments surface as labeled candidates; match links without a new entry; unapply resets the feed row", async () => {
      const expense = await accountId("6000");
      const bill = await makeBill(
        [line(41_218, expense)],
        { billNumber: "HD-2041", billDate: "2026-07-01" },
      );
      const approved = await withTenant(tenantId, (tx) =>
        approveBill(tx, owner, { billId: bill.id, expectedVersion: bill.version }),
      );
      const paid = await withTenant(tenantId, (tx) =>
        recordBillPayment(tx, owner, {
          billId: bill.id,
          expectedVersion: approved.version,
          paymentDate: "2026-07-02",
          amountCents: 41_218,
          paidFromAccountId: acct.__bankLedger,
          method: "bank_transfer",
        }),
      );

      // The outflow arrives in the feed.
      const [txn] = await withTenant(tenantId, (tx) =>
        tx
          .insert(schema.bankTransactions)
          .values({
            tenantId,
            bankAccountId: acct.__bankAccountId,
            txnDate: "2026-07-03",
            description: "HOME DEPOT #2041",
            amountCents: -41_218,
            externalHash: `feed-${STAMP}-hd`,
            source: "csv",
          })
          .returning(),
      );

      const candidates = await withTenant(tenantId, (tx) =>
        findMatchCandidates(tx, tenantId, {
          ledgerAccountId: acct.__bankLedger,
          amountCents: -41_218,
          txnDate: "2026-07-03",
        }),
      );
      const candidate = candidates.find(
        (c) => c.entryId === paid.payment.journalEntryId,
      );
      expect(candidate).toBeTruthy();
      expect(candidate!.label).toBe("Bill payment — Home Depot · HD-2041");

      const entriesBefore = await withTenant(tenantId, (tx) =>
        tx.query.journalEntries.findMany({
          where: eq(schema.journalEntries.tenantId, tenantId),
        }),
      );
      await withTenant(tenantId, (tx) =>
        matchTransactionToEntry(tx, owner, {
          transactionId: txn.id,
          journalEntryId: paid.payment.journalEntryId,
        }),
      );
      const entriesAfter = await withTenant(tenantId, (tx) =>
        tx.query.journalEntries.findMany({
          where: eq(schema.journalEntries.tenantId, tenantId),
        }),
      );
      expect(entriesAfter.length).toBe(entriesBefore.length);

      // Unapply the matched payment → entry voided, feed row back to review.
      await withTenant(tenantId, async (tx) => {
        const r = await unapplyBillPayment(tx, owner, {
          paymentId: paid.payment.id,
          expectedVersion: paid.payment.version,
        });
        await resetBankLinkForEntry(tx, tenantId, r.voidedEntryId);
      });
      const feedRow = await withTenant(tenantId, (tx) =>
        tx.query.bankTransactions.findFirst({
          where: eq(schema.bankTransactions.id, txn.id),
        }),
      );
      expect(feedRow?.status).toBe("unreviewed");
      expect(feedRow?.journalEntryId).toBeNull();
    });

    it("document-owned entries refuse journal voiding (ENTRY_SOURCE_MANAGED)", async () => {
      const expense = await accountId("6000");
      const bill = await makeBill([line(2_500, expense)]);
      const approved = await withTenant(tenantId, (tx) =>
        approveBill(tx, owner, { billId: bill.id, expectedVersion: bill.version }),
      );
      await expect(
        withTenant(tenantId, (tx) =>
          assertEntryNotSourceManaged(tx, tenantId, approved.journalEntryId!),
        ),
      ).rejects.toMatchObject({ code: "ENTRY_SOURCE_MANAGED" });
      // Manual entries pass the guard.
      const manual = await withTenant(tenantId, (tx) =>
        tx.query.journalEntries.findFirst({
          where: and(
            eq(schema.journalEntries.tenantId, tenantId),
            eq(schema.journalEntries.source, "opening_balance"),
          ),
        }),
      );
      if (manual) {
        await withTenant(tenantId, (tx) =>
          assertEntryNotSourceManaged(tx, tenantId, manual.id),
        );
      }
    });
  });

  describe("AP aging feed", () => {
    it("buckets open bills and respects the as-of payment filter", async () => {
      const expense = await accountId("6000");
      const agingVendor = await withTenant(tenantId, (tx) =>
        createVendor(tx, owner, { name: "Aging Vendor" }),
      );
      const bill = await withTenant(tenantId, (tx) =>
        createBillDraft(tx, owner, {
          vendorId: agingVendor.id,
          billDate: "2026-05-01",
          dueDate: "2026-05-15",
          lines: [line(9_000, expense)],
        }),
      );
      const approved = await withTenant(tenantId, (tx) =>
        approveBill(tx, owner, { billId: bill.id, expectedVersion: bill.version }),
      );
      await withTenant(tenantId, (tx) =>
        recordBillPayment(tx, owner, {
          billId: bill.id,
          expectedVersion: approved.version,
          paymentDate: "2026-07-10",
          amountCents: 9_000,
          paidFromAccountId: acct.__bankLedger,
          method: "check",
        }),
      );
      // As of BEFORE the payment: open, 31-60 days past due.
      const before = await withTenant(tenantId, (tx) =>
        getApAging(tx, tenantId, "2026-06-20"),
      );
      const row = before.rows.find((r) => r.label === "Aging Vendor");
      expect(row?.perMemberCents).toEqual([0, 0, 9_000, 0, 0, 9_000]);
      // As of AFTER the payment: gone.
      const after = await withTenant(tenantId, (tx) =>
        getApAging(tx, tenantId, "2026-07-20"),
      );
      expect(after.rows.find((r) => r.label === "Aging Vendor")).toBeUndefined();
    });
  });
});
