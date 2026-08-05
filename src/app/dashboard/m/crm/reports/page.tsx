import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { withTenant } from "@/db";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { Badge } from "@/components/ui/badge";
import { listReports } from "@/modules/crm/report-ops";
import {
  BUILT_IN_REPORTS,
  REPORT_TYPES,
  describeReport,
} from "@/modules/crm/core/reports";

export const dynamic = "force-dynamic";

const BASE = "/dashboard/m/crm";

/**
 * The reports list.
 *
 * EVERYTHING HERE IS NAMED AS A QUESTION, and that is the whole design of this
 * page. Somebody opening a reports list wants an answer, not a table — "What is
 * the open work worth, by stage?" finds itself, and "Deal Value Report" does
 * not. The built-ins are code rather than rows (see `BUILT_IN_REPORTS`), so
 * every tenant has them on day one without a seed.
 *
 * Readable by every member. A report runs in the reader's own transaction, so
 * two people opening the same one legitimately get different totals — there is
 * nothing here to gate, because the gate is already underneath.
 */
export default async function ReportsPage() {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, "crm");

  // Built-ins and saved ones in one call. RLS decides which saved reports
  // appear — your own, plus anything shared with the tenant.
  const reports = await withTenant(
    ctx.tenant.id,
    (tx) => listReports(tx, ctx.tenant.id, ctx.userId),
    { role: ctx.role, userId: ctx.userId },
  );
  const saved = reports.filter((r) => !r.isBuiltIn);

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <Link
        href={BASE}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="size-4" />
        All records
      </Link>

      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Reports</h1>
        <p className="text-sm text-muted-foreground">
          Questions about {ctx.tenant.name}, answered from the records you can
          see.
        </p>
      </div>

      <ul className="divide-y rounded-md border">
        {BUILT_IN_REPORTS.map((report) => (
          <li key={report.id}>
            <Link
              href={`${BASE}/reports/${encodeURIComponent(report.id)}`}
              className="flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-accent/40"
            >
              <span className="min-w-0">
                <span className="block text-sm font-medium">{report.name}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {describeReport(report.definition)}
                </span>
              </span>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
            </Link>
          </li>
        ))}
      </ul>

      {saved.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-medium">Saved</h2>
          <ul className="divide-y rounded-md border">
            {saved.map((report) => (
              <li key={report.id}>
                <Link
                  href={`${BASE}/reports/${report.id}`}
                  className="flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-accent/40"
                >
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">
                      {report.name}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {describeReport(report.definition)}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    {/*
                      Says whose it is, because a shared list needs to explain
                      why somebody else's question is in it.
                    */}
                    {report.isShared && !report.isMine && (
                      <Badge variant="outline">shared</Badge>
                    )}
                    <ChevronRight className="size-4 text-muted-foreground" />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="space-y-2">
        <h2 className="text-sm font-medium">Start from scratch</h2>
        <p className="text-xs text-muted-foreground">
          Pick what you want to count. You can group and filter it once it opens.
        </p>
        <ul className="divide-y rounded-md border">
          {REPORT_TYPES.map((type) => (
            <li key={type.id}>
              <Link
                href={`${BASE}/reports/new?type=${type.id}`}
                className="flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-accent/40"
              >
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{type.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {type.question}
                  </span>
                </span>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
