import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { Account } from "../src/db/schema";
import { withTenant, withSystem, schema } from "../src/db";
import type { BalanceRow } from "../src/modules/accounting/core/balances";
import {
  getBalanceSheet,
  getCashActivity,
  getProfitAndLoss,
  postEntry,
  upsertDimensionMember,
  voidEntry,
} from "../src/modules/accounting/core";
import { provisionAccounting } from "../src/modules/accounting/templates/apply";
import {
  buildBalanceSheet,
  buildCashActivity,
  buildProfitAndLoss,
  pnlSectionFor,
} from "../src/modules/accounting/core/report-builders";
import {
  addDaysIso,
  fiscalYearStart,
  presetRange,
  previousPeriod,
  previousYear,
  shiftYearsIso,
} from "../src/modules/accounting/lib/dates";
import {
  centsToCsvAmount,
  formatCentsSigned,
} from "../src/modules/accounting/lib/money";
import { toCsv } from "../src/modules/accounting/lib/csv";

/**
 * Session 2 certification. Part A: pure builders and helpers — runs with
 * NO database. Part B: DB-backed integration through the real wrappers
 * (DATABASE_URL-gated, same pattern as ledger.test.ts).
 */

// ------------------------------------------------------------ fixtures

const T = "tenant-fixture";
const NOW = new Date(0);

function mkAccount(
  over: Partial<Account> & {
    id: string;
    code: string;
    name: string;
    accountType: Account["accountType"];
  },
): Account {
  return {
    tenantId: T,
    subtype: "other",
    parentId: null,
    description: "",
    isActive: true,
    isSystem: false,
    version: 1,
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}

function mkRow(
  accountId: string,
  netCents: number,
  memberId: string | null = null,
): BalanceRow {
  return {
    accountId,
    memberId,
    debitCents: netCents > 0 ? netCents : 0,
    creditCents: netCents < 0 ? -netCents : 0,
    netCents,
  };
}

/**
 * Tiny ledger simulator for balance-sheet fixtures: entries as dated
 * per-account deltas; rowsThrough(date) aggregates into BalanceRow[].
 */
interface SimEntry {
  date: string;
  deltas: Array<[accountId: string, cents: number]>;
}

function rowsThrough(entries: SimEntry[], asOf: string): BalanceRow[] {
  const net = new Map<string, number>();
  const debit = new Map<string, number>();
  const credit = new Map<string, number>();
  for (const e of entries) {
    if (e.date > asOf) continue;
    for (const [id, cents] of e.deltas) {
      net.set(id, (net.get(id) ?? 0) + cents);
      if (cents > 0) debit.set(id, (debit.get(id) ?? 0) + cents);
      else credit.set(id, (credit.get(id) ?? 0) - cents);
    }
  }
  return [...net.entries()].map(([accountId, netCents]) => ({
    accountId,
    memberId: null,
    debitCents: debit.get(accountId) ?? 0,
    creditCents: credit.get(accountId) ?? 0,
    netCents,
  }));
}

const cell = (r: { label: string; cents?: number }) => [r.label, r.cents];

// =====================================================================
// Part A — pure (no DB)
// =====================================================================

describe("dates (P1/P3)", () => {
  it("fiscalYearStart", () => {
    expect(fiscalYearStart("2026-06-15", 1)).toBe("2026-01-01");
    expect(fiscalYearStart("2026-06-30", 7)).toBe("2025-07-01");
    expect(fiscalYearStart("2026-07-01", 7)).toBe("2026-07-01");
    expect(fiscalYearStart("2026-11-30", 12)).toBe("2025-12-01");
    expect(fiscalYearStart("2026-12-01", 12)).toBe("2026-12-01");
  });

  it("addDaysIso crosses month and year boundaries", () => {
    expect(addDaysIso("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDaysIso("2024-03-01", -1)).toBe("2024-02-29");
    expect(addDaysIso("2025-12-31", 1)).toBe("2026-01-01");
  });

  it("shiftYearsIso clamps Feb 29", () => {
    expect(shiftYearsIso("2024-02-29", -1)).toBe("2023-02-28");
    expect(shiftYearsIso("2026-05-10", -1)).toBe("2025-05-10");
  });

  it("previousPeriod is same-length, immediately preceding", () => {
    expect(previousPeriod("2026-06-01", "2026-06-30")).toEqual({
      from: "2026-05-02",
      to: "2026-05-31",
    });
    expect(previousPeriod("2026-06-15", "2026-06-15")).toEqual({
      from: "2026-06-14",
      to: "2026-06-14",
    });
  });

  it("previousYear shifts both ends", () => {
    expect(previousYear("2026-01-01", "2026-06-30")).toEqual({
      from: "2025-01-01",
      to: "2025-06-30",
    });
  });

  it("presetRange incl. FY-aware presets with m=7", () => {
    const today = "2026-08-15";
    expect(presetRange("this-month", today, 7)).toEqual({
      from: "2026-08-01",
      to: today,
    });
    expect(presetRange("last-month", today, 7)).toEqual({
      from: "2026-07-01",
      to: "2026-07-31",
    });
    expect(presetRange("this-quarter", today, 7)).toEqual({
      from: "2026-07-01",
      to: today,
    });
    expect(presetRange("this-fy", today, 7)).toEqual({
      from: "2026-07-01",
      to: today,
    });
    expect(presetRange("last-fy", today, 7)).toEqual({
      from: "2025-07-01",
      to: "2026-06-30",
    });
    expect(presetRange("last-month", "2026-01-10", 1)).toEqual({
      from: "2025-12-01",
      to: "2025-12-31",
    });
  });
});

describe("money formatting (P5/P6)", () => {
  it("formatCentsSigned uses accounting parentheses", () => {
    expect(formatCentsSigned(123456)).toBe("1,234.56");
    expect(formatCentsSigned(-123456)).toBe("(1,234.56)");
  });
  it("centsToCsvAmount is integer-constructed", () => {
    expect(centsToCsvAmount(-123456)).toBe("-1234.56");
    expect(centsToCsvAmount(5)).toBe("0.05");
    expect(centsToCsvAmount(0)).toBe("0.00");
  });
});

describe("P&L builder", () => {
  const accounts = [
    mkAccount({ id: "sales", code: "4000", name: "Sales", accountType: "income", subtype: "operating_revenue" }),
    mkAccount({ id: "disc", code: "4100", name: "Discounts Given", accountType: "income", subtype: "contra_revenue" }),
    mkAccount({ id: "packrev", code: "4500", name: "Pack Revenue", accountType: "income", subtype: "pack_special" }),
    mkAccount({ id: "other-inc", code: "4900", name: "Other Income", accountType: "income", subtype: "other_income" }),
    mkAccount({ id: "cogs", code: "5000", name: "COGS", accountType: "expense", subtype: "cogs" }),
    mkAccount({ id: "opex", code: "6000", name: "Advertising", accountType: "expense", subtype: "operating_expense" }),
    mkAccount({ id: "payroll", code: "6450", name: "Wages", accountType: "expense", subtype: "payroll_expense" }),
    mkAccount({ id: "packexp", code: "6800", name: "Pack Expense", accountType: "expense", subtype: "pack_exp" }),
  ];
  const rows = [
    mkRow("sales", -100_000),
    mkRow("disc", 5_000),
    mkRow("packrev", -1_000),
    mkRow("other-inc", -2_000),
    mkRow("cogs", 30_000),
    mkRow("opex", 20_000),
    mkRow("payroll", 10_000),
    mkRow("packexp", 500),
  ];

  it("maps subtypes to sections with type fallbacks", () => {
    expect(pnlSectionFor(accounts[0])).toBe("income");
    expect(pnlSectionFor(accounts[2])).toBe("income"); // unknown income subtype
    expect(pnlSectionFor(accounts[7])).toBe("expenses"); // unknown expense subtype
    expect(
      pnlSectionFor(mkAccount({ id: "x", code: "1", name: "x", accountType: "asset" })),
    ).toBeNull();
  });

  it("computes sections, Gross Profit, NOI, and Net Income (hand-verified)", () => {
    const report = buildProfitAndLoss(accounts, rows, {
      from: "2026-01-01",
      to: "2026-06-30",
    });
    // Income 100000 − 5000 + 1000 = 96000; COGS 30000; GP 66000;
    // Expenses 30500; NOI 35500; Other income 2000; Net 37500.
    expect(report.grossProfitCents).toBe(66_000);
    expect(report.netOperatingIncomeCents).toBe(35_500);
    expect(report.netIncomeCents).toBe(37_500);
    const discRow = report.rows.find((r) => r.accountId === "disc");
    expect(discRow?.cents).toBe(-5_000); // contra shows negative (P6)
    expect(report.rows.map(cell)).toContainEqual(["Total Income", 96_000]);
    expect(report.rows.map(cell)).toContainEqual(["Total Expenses", 30_500]);
  });

  it("emits only Net Income when no COGS/Other sections exist", () => {
    const simple = [accounts[0], accounts[5]];
    const report = buildProfitAndLoss(simple, [mkRow("sales", -1000), mkRow("opex", 400)], {
      from: "2026-01-01",
      to: "2026-01-31",
    });
    expect(report.grossProfitCents).toBeUndefined();
    expect(report.netOperatingIncomeCents).toBeUndefined();
    expect(report.netIncomeCents).toBe(600);
  });

  it("rolls up hierarchy and promotes cross-section orphans (P7)", () => {
    const tree = [
      mkAccount({ id: "p", code: "4000", name: "Sales", accountType: "income", subtype: "operating_revenue" }),
      mkAccount({ id: "c1", code: "4010", name: "Service", accountType: "income", subtype: "operating_revenue", parentId: "p" }),
      mkAccount({ id: "c2", code: "4020", name: "Product", accountType: "income", subtype: "operating_revenue", parentId: "p" }),
      mkAccount({ id: "opex-p", code: "6000", name: "Ops", accountType: "expense", subtype: "operating_expense" }),
      // cogs-subtype child under an opex parent → promoted to COGS section
      mkAccount({ id: "orphan", code: "5100", name: "Subs", accountType: "expense", subtype: "cogs", parentId: "opex-p" }),
      mkAccount({ id: "zero", code: "6999", name: "Unused", accountType: "expense", subtype: "operating_expense" }),
    ];
    const report = buildProfitAndLoss(
      tree,
      [mkRow("c1", -40_000), mkRow("c2", -60_000), mkRow("orphan", 7_000), mkRow("opex-p", 3_000)],
      { from: "2026-01-01", to: "2026-01-31" },
    );
    const salesIdx = report.rows.findIndex((r) => r.accountId === "p");
    expect(salesIdx).toBeGreaterThan(-1);
    expect(report.rows[salesIdx].cents).toBe(0); // own activity only
    expect(report.rows[salesIdx + 1]).toMatchObject({ accountId: "c1", depth: 2 });
    expect(report.rows.map(cell)).toContainEqual(["Total Sales", 100_000]);
    // Orphan reports under COGS, not nested under Ops:
    const orphanRow = report.rows.find((r) => r.accountId === "orphan");
    expect(orphanRow?.depth).toBe(1);
    expect(report.rows.map(cell)).toContainEqual(["Total Cost of Goods Sold", 7_000]);
    // Zero-balance account hidden by default, shown with showZero:
    expect(report.rows.some((r) => r.accountId === "zero")).toBe(false);
    const withZero = buildProfitAndLoss(tree, [mkRow("c1", -1000), mkRow("opex-p", 1000)], {
      from: "2026-01-01",
      to: "2026-01-31",
      showZero: true,
    });
    expect(withZero.rows.some((r) => r.accountId === "zero")).toBe(true);
  });

  it("by-dimension: member columns + Unassigned + Total (and column cap)", () => {
    const acc = [accounts[5]]; // opex
    const members = [
      { id: "mA", displayName: "Alpha" },
      { id: "mB", displayName: "Beta" },
    ];
    const report = buildProfitAndLoss(
      acc,
      [mkRow("opex", 3_000, "mA"), mkRow("opex", 2_000, "mB"), mkRow("opex", 500, null)],
      {
        from: "2026-01-01",
        to: "2026-01-31",
        dimension: { type: "property", members },
      },
    );
    expect(report.columns?.map((c) => c.label)).toEqual([
      "Alpha",
      "Beta",
      "Unassigned",
      "Total",
    ]);
    const row = report.rows.find((r) => r.accountId === "opex");
    expect(row?.perMemberCents).toEqual([3_000, 2_000, 500, 5_500]);
    const totalRow = report.rows.find((r) => r.label === "Net Income");
    expect(totalRow?.perMemberCents).toEqual([-3_000, -2_000, -500, -5_500]);

    // Cap: 5 members, cap 2 → top-2 + Other + Total.
    const manyMembers = ["m1", "m2", "m3", "m4", "m5"].map((id, i) => ({
      id,
      displayName: `M${i + 1}`,
    }));
    const capped = buildProfitAndLoss(
      acc,
      manyMembers.map((m, i) => mkRow("opex", (i + 1) * 1000, m.id)),
      {
        from: "2026-01-01",
        to: "2026-01-31",
        dimension: { type: "property", members: manyMembers },
        maxMemberColumns: 2,
      },
    );
    expect(capped.columns?.map((c) => c.label)).toEqual(["M4", "M5", "Other", "Total"]);
    const cappedRow = capped.rows.find((r) => r.accountId === "opex");
    expect(cappedRow?.perMemberCents).toEqual([4_000, 5_000, 6_000, 15_000]);
  });

  it("comparison merges one-sided accounts", () => {
    const acc = [accounts[0], accounts[5]];
    const report = buildProfitAndLoss(acc, [mkRow("sales", -1_000)], {
      from: "2026-02-01",
      to: "2026-02-28",
      comparison: {
        mode: "prev-period",
        from: "2026-01-01",
        to: "2026-01-31",
        rows: [mkRow("opex", 700)],
      },
    });
    const sales = report.rows.find((r) => r.accountId === "sales");
    expect(sales).toMatchObject({ cents: 1_000, comparisonCents: 0 });
    const opex = report.rows.find((r) => r.accountId === "opex");
    expect(opex).toMatchObject({ cents: 0, comparisonCents: 700 });
    expect(report.netIncomeCents).toBe(1_000);
    expect(report.comparisonNetIncomeCents).toBe(-700);
  });
});

describe("Balance sheet builder (P2 — the flagship)", () => {
  const accounts = [
    mkAccount({ id: "bank", code: "1000", name: "Checking", accountType: "asset", subtype: "bank" }),
    mkAccount({ id: "accdep", code: "1700", name: "Accum. Depreciation", accountType: "asset", subtype: "accumulated_depreciation" }),
    mkAccount({ id: "contrib", code: "3100", name: "Owner Contributions", accountType: "equity", subtype: "owner_equity" }),
    mkAccount({ id: "re", code: "3900", name: "Retained Earnings", accountType: "equity", subtype: "retained_earnings", isSystem: true }),
    mkAccount({ id: "rev", code: "4000", name: "Sales", accountType: "income", subtype: "operating_revenue" }),
    mkAccount({ id: "exp", code: "6000", name: "Expense", accountType: "expense", subtype: "operating_expense" }),
  ];
  // Dated ledger; E3 (2025-09-01) is PRIOR-year with m=1 but CURRENT-FY with m=7.
  const entries: SimEntry[] = [
    { date: "2025-03-15", deltas: [["bank", 100_000], ["rev", -100_000]] },
    { date: "2025-03-20", deltas: [["exp", 40_000], ["bank", -40_000]] },
    { date: "2025-04-01", deltas: [["bank", 1_000], ["re", -1_000]] }, // manual 3900 posting
    { date: "2025-05-01", deltas: [["bank", 50_000], ["contrib", -50_000]] },
    { date: "2025-09-01", deltas: [["bank", 10_000], ["rev", -10_000]] },
    { date: "2026-02-10", deltas: [["bank", 20_000], ["rev", -20_000]] },
    { date: "2026-02-15", deltas: [["exp", 5_000], ["bank", -5_000]] },
  ];
  const asOf = "2026-06-30";

  function sheet(fyStartMonth: number) {
    const fyStart = fiscalYearStart(asOf, fyStartMonth);
    return buildBalanceSheet(
      accounts,
      {
        cumulative: rowsThrough(entries, asOf),
        priorFyBoundary: rowsThrough(entries, addDaysIso(fyStart, -1)),
      },
      { asOf, fyStart },
    );
  }

  it("derives RE (prior FYs + 3900 activity) and current-FY Net Income — m=1", () => {
    const report = sheet(1);
    // Prior NI (2025) = 100000 − 40000 + 10000 = 70000; RE = 70000 + 1000.
    expect(report.rows.map(cell)).toContainEqual(["Retained Earnings", 71_000]);
    expect(report.rows.map(cell)).toContainEqual(["Net Income", 15_000]);
    expect(report.totalAssetsCents).toBe(136_000);
    expect(report.totalEquityCents).toBe(136_000);
    expect(report.balanced).toBe(true);
    // 3900 never renders as its own account row (merged into the line):
    expect(report.rows.some((r) => r.accountId === "re")).toBe(false);
  });

  it("fiscal year start month = 7 shifts which entries are 'prior'", () => {
    const report = sheet(7);
    // Prior NI (through 2025-06-30) = 60000; current FY NI = 25000.
    expect(report.rows.map(cell)).toContainEqual(["Retained Earnings", 61_000]);
    expect(report.rows.map(cell)).toContainEqual(["Net Income", 25_000]);
    expect(report.totalEquityCents).toBe(136_000);
    expect(report.balanced).toBe(true);
  });

  it("contra asset shows negative inside Fixed Assets", () => {
    const report = buildBalanceSheet(
      accounts,
      {
        cumulative: [mkRow("bank", 10_000), mkRow("accdep", -2_500), mkRow("contrib", -7_500)],
        priorFyBoundary: [],
      },
      { asOf: "2026-01-31", fyStart: "2026-01-01" },
    );
    const dep = report.rows.find((r) => r.accountId === "accdep");
    expect(dep?.cents).toBe(-2_500);
    expect(report.totalAssetsCents).toBe(7_500);
    expect(report.balanced).toBe(true);
  });

  it("empty ledger balances at zero", () => {
    const report = buildBalanceSheet(
      accounts,
      { cumulative: [], priorFyBoundary: [] },
      { asOf: "2020-01-01", fyStart: "2020-01-01" },
    );
    expect(report.totalAssetsCents).toBe(0);
    expect(report.totalEquityCents).toBe(0);
    expect(report.balanced).toBe(true);
  });
});

describe("Cash activity builder", () => {
  const accounts = [
    mkAccount({ id: "bank", code: "1000", name: "Checking", accountType: "asset", subtype: "bank" }),
    mkAccount({ id: "idle", code: "1010", name: "Savings", accountType: "asset", subtype: "bank" }),
    mkAccount({ id: "empty", code: "1020", name: "Never Used", accountType: "asset", subtype: "bank" }),
    mkAccount({ id: "cc", code: "2100", name: "Credit Card", accountType: "liability", subtype: "credit_card" }),
  ];

  it("opening + in − out = closing; owed-positive credit cards; row filtering", () => {
    const opening = [mkRow("bank", 50_000), mkRow("idle", 20_000), mkRow("cc", -3_000)];
    const activity = [
      { accountId: "bank", memberId: null, debitCents: 12_000, creditCents: 7_000, netCents: 5_000 },
      { accountId: "cc", memberId: null, debitCents: 1_000, creditCents: 4_000, netCents: -3_000 },
    ];
    const report = buildCashActivity(accounts, opening, activity, {
      from: "2026-06-01",
      to: "2026-06-30",
    });
    const cash = report.groups.find((g) => g.key === "cash")!;
    const bank = cash.rows.find((r) => r.accountId === "bank")!;
    expect(bank).toMatchObject({
      openingCents: 50_000,
      inCents: 12_000,
      outCents: 7_000,
      netCents: 5_000,
      closingCents: 55_000,
    });
    // Opening balance but no activity → still shown:
    expect(cash.rows.some((r) => r.accountId === "idle")).toBe(true);
    // Nothing at all → hidden:
    expect(cash.rows.some((r) => r.accountId === "empty")).toBe(false);
    // Credit card: owed-positive; charges = credits, payments = debits.
    const cards = report.groups.find((g) => g.key === "credit_card")!;
    expect(cards.rows[0]).toMatchObject({
      openingCents: 3_000,
      inCents: 4_000,
      outCents: 1_000,
      netCents: 3_000,
      closingCents: 6_000,
    });
    expect(cash.totals.closingCents).toBe(75_000);
  });
});

describe("CSV (RFC 4180)", () => {
  it("quotes commas, quotes, and newlines", () => {
    const csv = toCsv([
      ["Name, with \"quotes\"", "plain"],
      ["line\nbreak", "-1234.56"],
    ]);
    expect(csv).toBe(
      '"Name, with ""quotes""",plain\r\n"line\nbreak",-1234.56\r\n',
    );
  });
});

// =====================================================================
// Part B — DB-backed integration (DATABASE_URL-gated)
// =====================================================================

const RUN = !!process.env.DATABASE_URL;
const d = RUN ? describe : describe.skip;

d("reports integration (DB)", () => {
  const STAMP = `reports-test-${process.pid}`;
  let tenantId: string;
  let owner: { tenantId: string; userId: string; role: "owner" };
  const acct: Record<string, string> = {};

  async function accountId(code: string): Promise<string> {
    if (acct[code]) return acct[code];
    const row = await withTenant(tenantId, (tx) =>
      tx.query.accounts.findFirst({
        where: (a, { and, eq }) => and(eq(a.tenantId, tenantId), eq(a.code, code)),
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
        .values([{ clerkOrgId: STAMP, name: "Reports Test", slug: STAMP }])
        .returning();
      return rows[0].id;
    });
    owner = { tenantId, userId: "owner", role: "owner" };
    await withTenant(tenantId, (tx) => provisionAccounting(tx, tenantId));

    const bank = await accountId("1000");
    const sales = await accountId("4000");
    const insurance = await accountId("6100");
    // FY2025: revenue 1000.00, expense 300.00; FY2026: revenue 500.00.
    await withTenant(tenantId, (tx) =>
      postEntry(tx, owner, {
        status: "posted",
        entryDate: "2025-03-01",
        lines: [
          { accountId: bank, amountCents: 100_000 },
          { accountId: sales, amountCents: -100_000 },
        ],
      }),
    );
    await withTenant(tenantId, (tx) =>
      postEntry(tx, owner, {
        status: "posted",
        entryDate: "2025-04-01",
        lines: [
          { accountId: insurance, amountCents: 30_000 },
          { accountId: bank, amountCents: -30_000 },
        ],
      }),
    );
    await withTenant(tenantId, (tx) =>
      postEntry(tx, owner, {
        status: "posted",
        entryDate: "2026-02-01",
        lines: [
          { accountId: bank, amountCents: 50_000 },
          { accountId: sales, amountCents: -50_000 },
        ],
      }),
    );
  });

  afterAll(async () => {
    await withSystem(async (tx) => {
      await tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantId));
    });
  });

  it("P&L, Balance Sheet, and Cash Activity agree end-to-end", async () => {
    const pnl = await withTenant(tenantId, (tx) =>
      getProfitAndLoss(tx, tenantId, { from: "2026-01-01", to: "2026-06-30" }),
    );
    expect(pnl.netIncomeCents).toBe(50_000);

    const bs = await withTenant(tenantId, (tx) =>
      getBalanceSheet(tx, tenantId, { asOf: "2026-06-30" }),
    );
    // Prior-year NI = 70000; current FY NI = 50000; assets = 120000.
    expect(bs.rows.map((r) => [r.label, r.cents])).toContainEqual([
      "Retained Earnings",
      70_000,
    ]);
    expect(bs.rows.map((r) => [r.label, r.cents])).toContainEqual([
      "Net Income",
      50_000,
    ]);
    expect(bs.totalAssetsCents).toBe(120_000);
    expect(bs.balanced).toBe(true);
    // The balance-sheet Net Income line equals the FY-to-date P&L (P6).
    expect(bs.rows.find((r) => r.label === "Net Income")?.cents).toBe(
      pnl.netIncomeCents,
    );

    const cash = await withTenant(tenantId, (tx) =>
      getCashActivity(tx, tenantId, { from: "2026-01-01", to: "2026-06-30" }),
    );
    const bankRow = cash.groups
      .find((g) => g.key === "cash")!
      .rows.find((r) => r.code === "1000")!;
    expect(bankRow).toMatchObject({
      openingCents: 70_000,
      inCents: 50_000,
      outCents: 0,
      closingCents: 120_000,
    });
  });

  it("by-dimension P&L splits by member; voided entries vanish everywhere", async () => {
    const bank = await accountId("1000");
    const repairs = await accountId("6400");
    const member = await withTenant(tenantId, (tx) =>
      upsertDimensionMember(tx, owner, {
        dimensionType: "property",
        packEntityId: crypto.randomUUID(),
        displayName: "123 Maple St",
      }),
    );
    await withTenant(tenantId, (tx) =>
      postEntry(tx, owner, {
        status: "posted",
        entryDate: "2026-03-01",
        lines: [
          { accountId: repairs, amountCents: 8_000, dimensionMemberIds: [member.id] },
          { accountId: bank, amountCents: -8_000 },
        ],
      }),
    );
    const byDim = await withTenant(tenantId, (tx) =>
      getProfitAndLoss(tx, tenantId, {
        from: "2026-01-01",
        to: "2026-06-30",
        dimensionType: "property",
      }),
    );
    const mapleIdx = byDim.columns!.findIndex((c) => c.label === "123 Maple St");
    const repairsRow = byDim.rows.find((r) => r.accountId === repairs);
    expect(repairsRow?.perMemberCents?.[mapleIdx]).toBe(8_000);

    const { entry } = await withTenant(tenantId, (tx) =>
      postEntry(tx, owner, {
        status: "posted",
        entryDate: "2026-04-01",
        lines: [
          { accountId: repairs, amountCents: 9_999 },
          { accountId: bank, amountCents: -9_999 },
        ],
      }),
    );
    const before = await withTenant(tenantId, (tx) =>
      getProfitAndLoss(tx, tenantId, { from: "2026-01-01", to: "2026-06-30" }),
    );
    await withTenant(tenantId, (tx) =>
      voidEntry(tx, owner, { entryId: entry.id, expectedVersion: entry.version }),
    );
    const after = await withTenant(tenantId, (tx) =>
      getProfitAndLoss(tx, tenantId, { from: "2026-01-01", to: "2026-06-30" }),
    );
    expect(before.netIncomeCents - after.netIncomeCents).toBe(-9_999);
  });
});
