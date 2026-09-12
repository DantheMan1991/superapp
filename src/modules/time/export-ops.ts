import "server-only";
import type { Tx } from "@/db";
import { toCsv } from "@/lib/csv";
import { decimalHours } from "./core/duration";
import type { PayPeriod } from "./core/periods";
import { listWorkers } from "./read";
import { listSheets, totalsFor } from "./sheet-ops";

/**
 * A pay period as a file a payroll provider can read.
 *
 * **DECIMAL HOURS, NOT `7:30`.** Every payroll system in the world takes 7.5
 * and none of them agree on how to parse a colon. This is the one place in Time
 * where hours stop being minutes, and it is the boundary that justifies it.
 *
 * **THE APPROVED SNAPSHOT WHERE THERE IS ONE, live totals where there is not.**
 * A sheet that has been approved carries the figures somebody agreed to, and
 * those are what a pay run should see. A worker with no sheet still appears,
 * with what their hours currently come to and an empty Approved column — they
 * are on the payroll whether or not the paperwork was done, and a file that
 * silently dropped them is how somebody does not get paid.
 */
export async function payPeriodCsvRows(
  tx: Tx,
  tenantId: string,
  period: PayPeriod,
  prefs: { weekStartsOn: number; overtimeRuleset: string },
): Promise<string[][]> {
  const workers = await listWorkers(tx, tenantId);
  const sheets = await listSheets(tx, tenantId, period);
  const sheetByWorker = new Map(sheets.map((s) => [s.workerId, s]));

  const rows: string[][] = [
    [
      "Worker",
      "Period start",
      "Period end",
      "Regular hours",
      "Overtime hours",
      "Double time hours",
      "Paid leave hours",
      "Gross pay",
      "Approved",
    ],
  ];

  for (const worker of workers) {
    const sheet = sheetByWorker.get(worker.id);
    const totals =
      sheet && sheet.approvedAt
        ? {
            regularMinutes: sheet.regularMinutes ?? 0,
            overtimeMinutes: sheet.overtimeMinutes ?? 0,
            doubleTimeMinutes: sheet.doubleTimeMinutes ?? 0,
            paidLeaveMinutes: sheet.paidLeaveMinutes ?? 0,
            grossCents: sheet.grossCents,
          }
        : await totalsFor(tx, tenantId, worker.id, period, prefs);

    const anyHours =
      totals.regularMinutes +
        totals.overtimeMinutes +
        totals.doubleTimeMinutes +
        totals.paidLeaveMinutes >
      0;
    // Somebody who did not work this period is not a row. A payroll file full
    // of zeroes is how a provider creates zero-dollar payslips.
    if (!anyHours) continue;

    rows.push([
      worker.name,
      period.start,
      period.end,
      decimalHours(totals.regularMinutes),
      decimalHours(totals.overtimeMinutes),
      decimalHours(totals.doubleTimeMinutes),
      decimalHours(totals.paidLeaveMinutes),
      // Bare digits, no currency symbol and no thousands separator: a comma in
      // a money column is the classic way to break somebody's import.
      totals.grossCents === null ? "" : (totals.grossCents / 100).toFixed(2),
      sheet?.approvedAt ? "yes" : "no",
    ]);
  }
  return rows;
}

/** The file itself: rows, a name with the dates in it, ready to download. */
export async function payPeriodCsv(
  tx: Tx,
  tenantId: string,
  period: PayPeriod,
  prefs: { weekStartsOn: number; overtimeRuleset: string },
): Promise<{ filename: string; csv: string }> {
  const rows = await payPeriodCsvRows(tx, tenantId, period, prefs);
  return {
    filename: `hours-${period.start}-to-${period.end}.csv`,
    csv: toCsv(rows),
  };
}
