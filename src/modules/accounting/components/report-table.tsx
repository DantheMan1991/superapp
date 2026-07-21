import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { formatCentsSigned } from "../lib/money";
import type { ReportColumn, ReportRow } from "../core/report-builders";

/**
 * Presentational renderer for ReportRow[] — used by P&L and Balance Sheet.
 * Server component; no interactivity.
 */
export function ReportTable({
  rows,
  amountHeader,
  comparisonHeader,
  columns,
}: {
  rows: ReportRow[];
  amountHeader: string;
  comparisonHeader?: string;
  /** By-dimension mode: overrides amount/comparison headers. */
  columns?: ReportColumn[];
}) {
  const amountHeads = columns
    ? columns.map((c) => c.label)
    : [amountHeader, ...(comparisonHeader ? [comparisonHeader] : [])];

  return (
    <Card>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Account</TableHead>
                {amountHeads.map((h) => (
                  <TableHead key={h} className="text-right whitespace-nowrap">
                    {h}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row, i) => {
                const amounts = columns
                  ? (row.perMemberCents ?? columns.map(() => undefined))
                  : [row.cents, ...(comparisonHeader ? [row.comparisonCents] : [])];
                return (
                  <TableRow
                    key={i}
                    className={cn(
                      row.kind === "section" && "hover:bg-transparent",
                      row.kind === "total" && "border-t-2 font-semibold",
                      row.kind === "subtotal" && "font-medium",
                      row.kind === "computed" && "italic",
                    )}
                  >
                    <TableCell
                      className={cn(
                        "text-sm",
                        row.kind === "section" &&
                          "pt-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground",
                      )}
                      style={{ paddingLeft: `${1 + row.depth * 1.25}rem` }}
                    >
                      {row.kind === "account" && row.code && (
                        <span className="mr-2 font-mono text-xs text-muted-foreground">
                          {row.code}
                        </span>
                      )}
                      {row.label}
                    </TableCell>
                    {amounts.map((cents, j) => (
                      <TableCell
                        key={j}
                        className="text-right font-mono text-sm whitespace-nowrap"
                      >
                        {row.kind === "section" || cents === undefined
                          ? ""
                          : formatCentsSigned(cents)}
                      </TableCell>
                    ))}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
