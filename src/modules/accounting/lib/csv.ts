import { centsToCsvAmount } from "./money";
import type {
  BalanceSheetReport,
  CashActivityReport,
  ProfitAndLossReport,
  ReportRow,
} from "../core/report-builders";

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

export function pnlToCsvRows(report: ProfitAndLossReport): string[][] {
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
        ...(row.perMemberCents?.map((c) => centsToCsvAmount(c)) ??
          report.columns.map(() => "")),
      );
    } else {
      cells.push(amount(row.cents));
      if (report.comparison) cells.push(amount(row.comparisonCents));
    }
    return cells;
  });
  return [header, ...body];
}

export function balanceSheetToCsvRows(report: BalanceSheetReport): string[][] {
  const header = ["Account", `As of ${report.asOf}`];
  if (report.comparison) header.push(`As of ${report.comparison.asOf}`);
  const body = report.rows.map((row) => {
    const cells = [indent(row), amount(row.cents)];
    if (report.comparison) cells.push(amount(row.comparisonCents));
    return cells;
  });
  return [header, ...body];
}

export function cashActivityToCsvRows(report: CashActivityReport): string[][] {
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
  return rows;
}
