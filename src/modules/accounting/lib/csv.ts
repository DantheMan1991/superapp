import { centsToCsvAmount } from "./money";
import type {
  BalanceSheetReport,
  CashActivityReport,
  GeneralLedgerReport,
  ProfitAndLossReport,
  ReportRow,
} from "../core/report-builders";
import type { AccountingBasis, TrialBalance } from "../core/balances";

/**
 * RFC 4180 CSV construction (pure, client-safe). Amounts go through
 * centsToCsvAmount — integer construction, never floats (P5).
 */

function field(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replaceAll('"', '""')}"`;
  }
  return value;
}

export function toCsv(rows: string[][]): string {
  return rows.map((r) => r.map(field).join(",")).join("\r\n") + "\r\n";
}

function indent(row: ReportRow): string {
  return "  ".repeat(row.depth) + row.label;
}

function amount(cents: number | undefined): string {
  return cents === undefined ? "" : centsToCsvAmount(cents);
}

/**
 * A basis row is appended to every statement export.
 *
 * Cash and accrual produce two different, both-correct profit figures for the
 * same period. A CSV that does not say which one it is gets forwarded to an
 * accountant and read as the other — so the answer travels with the file, in
 * the content as well as the filename.
 */
function basisRow(basis: AccountingBasis): string[] {
  return [`${basis === "cash" ? "Cash" : "Accrual"} basis`];
}

/**
 * The company row, appended for the same reason as the basis row and only when
 * there is a question to answer.
 *
 * A tenant with several legal entities can produce two correct and entirely
 * different balance sheets for the same date, so a file that does not say whose
 * books it holds is worse than no file. Callers pass a label ONLY when the
 * tenant has more than one company — for everybody else the export is
 * byte-identical to what it was, which is the same promise the picker makes on
 * screen (ADR 0010).
 */
function entityRows(
  entityLabel: string | undefined,
  consolidationNote?: string,
): string[][] {
  return [
    ...(entityLabel ? [[`Company: ${entityLabel}`]] : []),
    // The residual travels with the file for the same reason the basis does: a
    // consolidated statement showing an affiliate balance is exactly what an
    // accountant queries, and the answer should be in their hand rather than in
    // a screen they were not looking at (ADR 0010 slice 3).
    ...(consolidationNote ? [[consolidationNote]] : []),
  ];
}

export function pnlToCsvRows(
  report: ProfitAndLossReport,
  basis: AccountingBasis = "accrual",
  entityLabel?: string,
  consolidationNote?: string,
): string[][] {
  const header: string[] = ["Account"];
  if (report.columns) {
    header.push(...report.columns.map((c) => c.label));
  } else {
    header.push(`${report.period.from} – ${report.period.to}`);
    if (report.comparison) {
      header.push(`${report.comparison.from} – ${report.comparison.to}`);
    }
  }
  const body = report.rows.map((row) => {
    const cells: string[] = [indent(row)];
    if (report.columns) {
      cells.push(
        ...(row.perColumnCents?.map((c) => centsToCsvAmount(c)) ??
          report.columns.map(() => "")),
      );
    } else {
      cells.push(amount(row.cents));
      if (report.comparison) cells.push(amount(row.comparisonCents));
    }
    return cells;
  });
  return [
    header,
    ...body,
    basisRow(basis),
    ...entityRows(entityLabel, consolidationNote),
  ];
}

export function balanceSheetToCsvRows(
  report: BalanceSheetReport,
  basis: AccountingBasis = "accrual",
  entityLabel?: string,
  consolidationNote?: string,
): string[][] {
  const header = ["Account", `As of ${report.asOf}`];
  if (report.comparison) header.push(`As of ${report.comparison.asOf}`);
  const body = report.rows.map((row) => {
    const cells = [indent(row), amount(row.cents)];
    if (report.comparison) cells.push(amount(row.comparisonCents));
    return cells;
  });
  return [
    header,
    ...body,
    basisRow(basis),
    ...entityRows(entityLabel, consolidationNote),
  ];
}

export function trialBalanceToCsvRows(
  tb: TrialBalance,
  asOf: string,
  entityLabel?: string,
  consolidationNote?: string,
): string[][] {
  const rows: string[][] = [
    ["Code", "Account", "Type", `Debit (as of ${asOf})`, `Credit (as of ${asOf})`],
  ];
  for (const r of tb.rows) {
    rows.push([
      r.account.code,
      r.account.name,
      r.account.accountType,
      r.debitCents ? centsToCsvAmount(r.debitCents) : "",
      r.creditCents ? centsToCsvAmount(r.creditCents) : "",
    ]);
  }
  rows.push([
    "",
    "Totals",
    "",
    centsToCsvAmount(tb.totalDebitCents),
    centsToCsvAmount(tb.totalCreditCents),
  ]);
  rows.push(...entityRows(entityLabel, consolidationNote));
  return rows;
}

export function cashActivityToCsvRows(
  report: CashActivityReport,
  entityLabel?: string,
): string[][] {
  const rows: string[][] = [
    ["Account", "Opening", "In", "Out", "Net", "Closing"],
  ];
  for (const group of report.groups) {
    rows.push([group.label, "", "", "", "", ""]);
    for (const r of group.rows) {
      rows.push([
        `  ${r.code} ${r.label}`,
        centsToCsvAmount(r.openingCents),
        centsToCsvAmount(r.inCents),
        centsToCsvAmount(r.outCents),
        centsToCsvAmount(r.netCents),
        centsToCsvAmount(r.closingCents),
      ]);
    }
    rows.push([
      `  Total ${group.label}`,
      centsToCsvAmount(group.totals.openingCents),
      centsToCsvAmount(group.totals.inCents),
      centsToCsvAmount(group.totals.outCents),
      centsToCsvAmount(group.totals.netCents),
      centsToCsvAmount(group.totals.closingCents),
    ]);
  }
  rows.push(...entityRows(entityLabel));
  return rows;
}

/**
 * One row per ledger line, with each account's opening and closing as their
 * own rows so the file reads the way the screen does.
 *
 * A truncated report says so IN THE FILE, on the first line. These get emailed
 * to accountants and opened months later with no memory of the screen that
 * produced them, so "this is only part of the period" has to travel with the
 * data rather than sit next to the download button.
 */
export function generalLedgerToCsvRows(
  report: GeneralLedgerReport,
  entityLabel?: string,
  consolidationNote?: string,
): string[][] {
  const rows: string[][] = [];
  if (report.truncated) {
    rows.push([
      `INCOMPLETE — showing the first ${report.lineCount} of ${report.matchedLineCount} lines for ${report.period.from} to ${report.period.to}. Narrow the dates or filter to fewer accounts.`,
    ]);
  }
  rows.push([
    "Account",
    "Date",
    "Source",
    "Entry memo",
    "Line memo",
    "Debit",
    "Credit",
    "Balance",
  ]);

  for (const account of report.accounts) {
    const label = `${account.code} ${account.name}`;
    rows.push([label, "", "", "", "Opening balance", "", "", centsToCsvAmount(account.openingCents)]);
    for (const line of account.lines) {
      rows.push([
        label,
        line.entryDate,
        line.source,
        line.entryMemo,
        line.lineMemo,
        line.debitCents ? centsToCsvAmount(line.debitCents) : "",
        line.creditCents ? centsToCsvAmount(line.creditCents) : "",
        centsToCsvAmount(line.runningCents),
      ]);
    }
    rows.push([
      label,
      "",
      "",
      "",
      "Closing balance",
      centsToCsvAmount(account.debitTotalCents),
      centsToCsvAmount(account.creditTotalCents),
      centsToCsvAmount(account.closingCents),
    ]);
  }

  rows.push([
    "Totals",
    "",
    "",
    "",
    "",
    centsToCsvAmount(report.totalDebitCents),
    centsToCsvAmount(report.totalCreditCents),
    "",
  ]);
  rows.push(...entityRows(entityLabel, consolidationNote));
  return rows;
}
