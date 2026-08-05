import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { withTenant } from "@/db";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { formatCents } from "@/lib/money";
import { Badge } from "@/components/ui/badge";
import {
  DETAIL_LIMIT,
  resolveReport,
  runReport,
} from "@/modules/crm/report-ops";
import { SaveReport } from "@/modules/crm/components/save-report";
import {
  describeReport,
  measureFor,
  parseDefinition,
  reportType,
  share,
  type ReportDefinition,
} from "@/modules/crm/core/reports";

export const dynamic = "force-dynamic";

const BASE = "/dashboard/m/crm";

/**
 * One report.
 *
 * THE DEFINITION IS IN THE URL, and every control on this page is a LINK. That
 * is why there is no client component here at all: changing the grouping is a
 * navigation, the server re-runs the query, and the result is a page somebody
 * can send to a colleague or bookmark. It is the same choice the saved-view
 * filters made, arrived at for the same reason — the answer has to come from
 * the database anyway, so round-tripping the state costs nothing extra and buys
 * a shareable link.
 *
 * A built-in id supplies the starting definition; anything in the query string
 * overrides it. So "the pipeline report, but grouped by owner" is a URL rather
 * than a saved object, which is also why this slice ships without a
 * `crm_reports` table — see the dossier.
 */
export default async function ReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ reportId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { reportId } = await params;
  const query = await searchParams;
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, "crm");

  const first = (v: string | string[] | undefined) =>
    Array.isArray(v) ? v[0] : v;

  const id = decodeURIComponent(reportId);

  // A built-in or a saved one, resolved the same way. `resolveReport` returns
  // null rather than falling back, unlike a view pin: a report id in a URL is a
  // specific thing somebody asked for, and quietly showing them a different
  // question would be worse than a 404.
  const saved =
    id === "new"
      ? null
      : await withTenant(
          ctx.tenant.id,
          (tx) => resolveReport(tx, ctx.tenant.id, ctx.userId, id),
          { role: ctx.role, userId: ctx.userId },
        );
  if (id !== "new" && !saved) notFound();

  // The stored definition, then the URL's overrides, then the parser — so an
  // impossible combination from a hand-edited link falls back rather than
  // reaching the query builder.
  const definition: ReportDefinition = parseDefinition({
    ...(saved?.definition ?? { type: first(query.type) ?? "records" }),
    ...(query.group !== undefined
      ? { groupBy: first(query.group) === "" ? null : first(query.group) }
      : {}),
    ...(query.measure ? { measure: first(query.measure) } : {}),
    ...(query.detail ? { showDetail: first(query.detail) === "1" } : {}),
    ...(saved ? { filter: saved.definition.filter } : {}),
  });

  const type = reportType(definition.type)!;
  const measure = measureFor(type, definition.measure);
  const result = await withTenant(
    ctx.tenant.id,
    (tx) => runReport(tx, ctx.tenant.id, definition),
    { role: ctx.role, userId: ctx.userId },
  );

  const title = saved?.name ?? type.question;
  const format = (value: number) =>
    measure.format === "money" ? `$${formatCents(value)}` : String(value);

  /** This page with one thing changed. Controls are links, not state. */
  const href = (patch: Record<string, string>) => {
    const params = new URLSearchParams();
    if (!saved) params.set("type", definition.type);
    if (definition.groupBy) params.set("group", definition.groupBy);
    if (definition.measure !== type.measures[0].key) {
      params.set("measure", definition.measure);
    }
    if (definition.showDetail) params.set("detail", "1");
    for (const [key, value] of Object.entries(patch)) {
      if (value === "") params.delete(key);
      else params.set(key, value);
    }
    const search = params.toString();
    return `${BASE}/reports/${encodeURIComponent(reportId)}${search ? `?${search}` : ""}`;
  };

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <Link
        href={`${BASE}/reports`}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="size-4" />
        All reports
      </Link>

      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="text-sm text-muted-foreground">
          {describeReport(definition)}
        </p>
      </div>

      {/* Controls. Each one is a link that re-runs the query server-side. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="text-muted-foreground">Group by</span>
          <ControlLink href={href({ group: "" })} active={!definition.groupBy}>
            Nothing
          </ControlLink>
          {type.groupBy.map((group) => (
            <ControlLink
              key={group.key}
              href={href({ group: group.key })}
              active={definition.groupBy === group.key}
            >
              {group.label}
            </ControlLink>
          ))}
        </span>

        {type.measures.length > 1 && (
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="text-muted-foreground">Show</span>
            {type.measures.map((m) => (
              <ControlLink
                key={m.key}
                href={href({ measure: m.key })}
                active={definition.measure === m.key}
              >
                {m.label}
              </ControlLink>
            ))}
          </span>
        )}

        <ControlLink
          href={href({ detail: definition.showDetail ? "" : "1" })}
          active={definition.showDetail}
        >
          {definition.showDetail ? "Hide the rows" : "Show the rows"}
        </ControlLink>

        {/*
          The one client component on the page, and it earns its place: naming
          a thing needs a text box. Everything else stayed a link.
        */}
        <SaveReport
          definition={definition}
          savedReportId={saved && !saved.isBuiltIn ? saved.id : null}
          canDelete={!!saved && !saved.isBuiltIn && saved.isMine}
          total={result.summary.total}
        />
      </div>

      <div className="rounded-md border">
        <div className="flex items-baseline justify-between gap-3 border-b px-4 py-3">
          <span className="text-sm text-muted-foreground">{measure.label}</span>
          <span className="text-2xl font-semibold tabular-nums">
            {format(result.summary.total)}
          </span>
        </div>

        {result.summary.rows.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">
            Nothing matches yet.
          </p>
        ) : (
          <ul className="divide-y">
            {result.summary.rows.map((row) => (
              <li key={row.key ?? "__none__"} className="px-4 py-2.5">
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  {/*
                    A null group is LABELLED, never dropped: "12 with no stage
                    set" is usually the most actionable line in the report, and
                    hiding it would make the rows fail to add up to the total
                    printed above them.
                  */}
                  <span className={row.key ? "" : "text-muted-foreground italic"}>
                    {row.key ?? "Not set"}
                  </span>
                  <span className="tabular-nums">{format(row.value)}</span>
                </div>
                {definition.chart === "bar" && (
                  <div className="mt-1.5 h-1.5 w-full rounded-full bg-muted">
                    <div
                      className="h-1.5 rounded-full bg-brand"
                      style={{ width: `${share(row.value, result.summary.peak)}%` }}
                    />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {definition.showDetail && (
        <div className="space-y-2">
          <h2 className="text-sm font-medium">The rows behind it</h2>
          <ul className="divide-y rounded-md border">
            {result.detail.map((row) => (
              <li
                key={row.id}
                className="flex items-center justify-between gap-3 px-4 py-2 text-sm"
              >
                <span className="min-w-0 truncate">{row.title}</span>
                <span className="flex shrink-0 items-center gap-2">
                  {row.group && <Badge variant="outline">{row.group}</Badge>}
                  {row.value !== null && (
                    <span className="tabular-nums text-muted-foreground">
                      ${formatCents(row.value)}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
          {result.detail.length >= DETAIL_LIMIT && (
            // Stated rather than silently applied, the same rule the records
            // list used to break and slice 8 fixed.
            <p className="text-xs text-muted-foreground">
              Showing the first {DETAIL_LIMIT}. A report is a summary — narrow it
              to see fewer.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function ControlLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`rounded-md border px-2 py-1 transition-colors hover:bg-accent/40 ${
        active ? "border-foreground font-medium" : "text-muted-foreground"
      }`}
    >
      {children}
    </Link>
  );
}
