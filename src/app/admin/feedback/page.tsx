import Link from "next/link";
import { MessageSquarePlus, Smartphone } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { Panel } from "@/components/app/panel";
import { EmptyState } from "@/components/app/empty-state";
import { FilterPills, type FilterPill } from "@/components/app/filter-pills";
import { StatCard } from "@/components/app/stat-card";
import {
  FeedbackKindChip,
  FeedbackStatusChip,
} from "@/components/app/feedback-chips";
import { requireSuperAdmin } from "@/lib/auth";
import { listReportsForConsole } from "@/lib/feedback/read";
import { needsOperator, screenLabel } from "@/lib/feedback/core";
import { describeAgo } from "@/lib/last-seen";
import { FEEDBACK_STATUSES } from "@/lib/feedback/vocabulary";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * WHAT CLIENTS ARE TELLING US, across every workspace.
 *
 * `requireSuperAdmin()` here as well as in the layout. The layout's call is
 * what redirects a stranger; this one is what makes the page safe to read on
 * its own terms, because a page that inherits its only gate from a layout is a
 * page that loses it the day somebody moves the file (security.md).
 *
 * SORTED BY WHOSE MOVE IT IS, not by date — the whole argument for a console
 * over an inbox. Within the waiting group a new report goes oldest first,
 * because one that has sat for three days beats one from this morning, and a
 * newest-first list buries exactly the report that is turning a client off the
 * product.
 */
export default async function AdminFeedbackPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireSuperAdmin();
  const now = new Date();
  const params = await searchParams;
  const raw = typeof params.f === "string" ? params.f : "open";
  const filter =
    raw === "all" || raw === "open" || FEEDBACK_STATUSES.includes(raw as never)
      ? raw
      : "open";

  const reports = await listReportsForConsole(
    filter === "all" ? {} : { status: filter },
  );
  const waiting = reports.filter(needsOperator).length;
  const bugs = reports.filter((r) => r.kind === "bug").length;

  const pills: FilterPill[] = [
    { key: "open", label: "Open", href: "/admin/feedback?f=open" },
    ...FEEDBACK_STATUSES.map((status) => ({
      key: status,
      label:
        status === "needs_info"
          ? "Waiting on client"
          : status.replace("_", " ").replace(/^./, (c) => c.toUpperCase()),
      href: `/admin/feedback?f=${status}`,
    })),
    { key: "all", label: "Everything", href: "/admin/feedback?f=all" },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Feedback"
        description="What clients report from inside the product, and the conversations that answer it."
        icon={<MessageSquarePlus />}
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Needs a reply" value={String(waiting)} />
        <StatCard
          label={filter === "all" ? "All reports" : "In this view"}
          value={String(reports.length)}
        />
        <StatCard label="Bugs" value={String(bugs)} />
      </div>

      <FilterPills items={pills} activeKey={filter} />

      <Panel
        isEmpty={reports.length === 0}
        empty={
          <EmptyState
            title="Nothing here"
            description={
              filter === "open"
                ? "No open reports. Either nobody has hit anything, or you have answered everything."
                : "No reports match this filter."
            }
            icon={<MessageSquarePlus />}
          />
        }
        className="divide-y divide-divider"
      >
        {reports.map((report) => {
          const mine = needsOperator(report);
          return (
            <Link
              key={report.id}
              href={`/admin/feedback/${report.id}`}
              className="flex items-start gap-3 px-4 py-3 hover:bg-muted/50"
            >
              <span
                aria-hidden
                className={cn(
                  "mt-2 size-2 shrink-0 rounded-full",
                  mine && "bg-destructive",
                )}
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={mine ? "font-semibold" : "font-medium"}>
                    {report.title}
                  </span>
                  <FeedbackStatusChip status={report.status} side="operator" />
                  <FeedbackKindChip kind={report.kind} side="operator" />
                  {report.surface === "app" && (
                    <span
                      className="inline-flex items-center gap-1 text-xs text-muted-foreground"
                      title={`Mobile app ${report.appVersion || ""}`.trim()}
                    >
                      <Smartphone className="size-3" />
                      {report.appVersion || "app"}
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  <span className="font-medium text-foreground">
                    {report.tenantName}
                  </span>
                  {report.isOperatorTenant && " (us)"}
                  {" · "}
                  {report.reporterName || report.reporterEmail || "somebody"}
                  {" · "}
                  {screenLabel(report.route)}
                  {" · "}
                  {/* RELATIVE, not a clock. Every row here is from a different
                      business in a different timezone, and a column of absolute
                      times in mixed zones is unscannable — the same reason the
                      Clients list reads "3 d ago". The thread page shows real
                      times, in the CLIENT's own clock, where "I did this at
                      8am" has to line up. */}
                  {describeAgo(report.createdAt, now)}
                </p>
              </div>
            </Link>
          );
        })}
      </Panel>
    </div>
  );
}
