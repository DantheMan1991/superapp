import Link from "next/link";
import { Building2, ChevronRight, Contact, User } from "lucide-react";
import { withTenant } from "@/db";
import type { TenantContext } from "@/lib/auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { listRecords } from "./party-ops";
import { listViews, pinnedViewId, resolveView } from "./view-ops";
import { decodeConditions, describeFilter } from "./core/views";
import { RecordSearch } from "./components/record-search";
import { ViewControls } from "./components/view-controls";
import type { CrmRecordFilter } from "./core/types";

const BASE = "/dashboard/m/crm";

/**
 * The current URL with a different page number.
 *
 * Built from the params that arrived rather than from a remembered filter, so
 * paging carries the search, the kind and the view along with it. A "next"
 * link that dropped the filter would take somebody to page 2 of a different
 * list.
 */
function pageHref(
  searchParams: Record<string, string | string[] | undefined>,
  page: number,
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (key === "page") continue;
    const single = Array.isArray(value) ? value[0] : value;
    if (single) params.set(key, single);
  }
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  return query ? `${BASE}?${query}` : BASE;
}

/**
 * The records list, and it IS the module's home page rather than an overview
 * that links to one. A CRM whose front door reports counts is a dead end; the
 * thing somebody opens this for is the list of who they deal with.
 *
 * `{ role: ctx.role }` is passed to withTenant so RLS can apply the visibility
 * term. A staff member does not see a filtered list — they see rows whose CRM
 * half never arrived.
 */
export async function CrmModule({
  ctx,
  searchParams,
}: {
  ctx: TenantContext;
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const first = (v: string | string[] | undefined) =>
    Array.isArray(v) ? v[0] : v;

  const query = first(searchParams.q)?.trim() ?? "";
  const kindParam = first(searchParams.kind);
  const filter: CrmRecordFilter = {
    query: query || undefined,
    kind:
      kindParam === "person" || kindParam === "organization"
        ? kindParam
        : undefined,
    workedOnly: first(searchParams.worked) === "1",
    includeInactive: first(searchParams.archived) === "1",
    page: Number.parseInt(first(searchParams.page) ?? "1", 10) || 1,
  };

  // The URL is the source of truth for what the list is showing, so a filtered
  // list is a link somebody can send. `view` names where the filter CAME from;
  // the `f` params are what is on screen, which may differ once somebody edits.
  const rawConditions = searchParams.f;
  const urlConditions = decodeConditions(
    Array.isArray(rawConditions) ? rawConditions : rawConditions ? [rawConditions] : [],
  );

  const { records: page, views, current, pinned } = await withTenant(
    ctx.tenant.id,
    async (tx) => {
      const all = await listViews(tx, ctx.tenant.id, ctx.userId);
      const pinnedId = await pinnedViewId(tx, ctx.tenant.id, ctx.userId);
      // No `view` in the URL means "open where I left off", which is the pin —
      // and `resolveView` falls back if the pin names something that no longer
      // resolves, so a deleted view cannot produce a broken page.
      const selected = await resolveView(
        tx,
        ctx.tenant.id,
        ctx.userId,
        first(searchParams.view) ?? pinnedId,
      );
      const conditions = searchParams.f ? urlConditions : selected.conditions;
      return {
        records: await listRecords(tx, ctx.tenant.id, {
          ...filter,
          conditions,
          sort: selected.sort,
        }),
        views: all,
        current: selected,
        pinned: pinnedId,
      };
    },
    { role: ctx.role, userId: ctx.userId },
  );

  const activeConditions = searchParams.f ? urlConditions : current.conditions;
  const records = page.rows;
  const pageCount = Math.max(Math.ceil(page.total / page.pageSize), 1);

  const isFiltered =
    !!filter.query || !!filter.kind || !!filter.workedOnly || !!filter.includeInactive;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-lg bg-brand/15 text-brand-foreground">
            <Contact className="size-5" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">CRM</h1>
            <p className="text-sm text-muted-foreground">
              Everyone the business deals with, and where each one stands.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild variant="outline">
            <Link href={`${BASE}/tasks`}>Follow-ups</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href={`${BASE}/deals`}>Board</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href={`${BASE}/fields`}>Fields</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href={`${BASE}/reports`}>Reports</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href={`${BASE}/automations`}>Automations</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href={`${BASE}/duplicates`}>Duplicates</Link>
          </Button>
          <Button asChild>
            <Link href={`${BASE}/records/new`}>Add a record</Link>
          </Button>
        </div>
      </div>

      <ViewControls
        views={views}
        current={current}
        conditions={activeConditions}
        sort={current.sort}
        pinnedViewId={pinned}
        total={page.total}
      />

      <RecordSearch filter={filter} />

      {/*
        The list states its own state in one plain line. Somebody who can read
        why they are seeing these rows does not have to open the filter panel to
        find out — and "why is this record missing?" is the question a filtered
        list generates most.
      */}
      <p className="text-xs text-muted-foreground">{describeFilter(activeConditions)}</p>

      {records.length === 0 ? (
        <p className="rounded-md border px-4 py-10 text-center text-sm text-muted-foreground">
          {isFiltered
            ? "Nothing matches that."
            : "No records yet. Add the first one above — anyone you invoice or buy from already appears here."}
        </p>
      ) : (
        <ul className="divide-y rounded-md border">
          {records.map(({ party, details, isCustomer, isVendor }) => (
            <li key={party.id}>
              <Link
                href={`${BASE}/records/${party.id}`}
                className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-accent/40"
              >
                {party.kind === "person" ? (
                  <User className="size-4 shrink-0 text-muted-foreground" />
                ) : (
                  <Building2 className="size-4 shrink-0 text-muted-foreground" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {party.displayName}
                    {!party.isActive && (
                      <span className="ml-2 text-xs font-normal text-muted-foreground">
                        archived
                      </span>
                    )}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {details?.lifecycleStage ||
                      /* Says WHY the CRM half is blank without claiming which
                         reason — a restricted record looks identical to staff,
                         deliberately. */
                      "Not worked in CRM yet"}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  {isCustomer && <Badge variant="secondary">Customer</Badge>}
                  {isVendor && <Badge variant="secondary">Vendor</Badge>}
                  {details?.visibility === "restricted" && (
                    <Badge variant="outline">Restricted</Badge>
                  )}
                </div>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
              </Link>
            </li>
          ))}
        </ul>
      )}

      {/*
        THE 500-ROW CAP IS GONE. It used to stop the list and say so, which is
        the shape of truncation that leaves somebody wondering whether the
        record they cannot find is missing or merely past the edge. There is a
        real count and real pages now, so the answer is always reachable.
      */}
      {page.total > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>
            {page.total === 1 ? "1 record" : `${page.total} records`}
            {pageCount > 1 && ` · page ${page.page} of ${pageCount}`}
          </span>
          {pageCount > 1 && (
            <span className="flex items-center gap-2">
              {page.page > 1 && (
                <Link
                  href={pageHref(searchParams, page.page - 1)}
                  className="underline hover:text-foreground"
                >
                  Previous
                </Link>
              )}
              {page.page < pageCount && (
                <Link
                  href={pageHref(searchParams, page.page + 1)}
                  className="underline hover:text-foreground"
                >
                  Next
                </Link>
              )}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
