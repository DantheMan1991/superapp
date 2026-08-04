import Link from "next/link";
import { Building2, ChevronRight, Contact, User } from "lucide-react";
import { withTenant } from "@/db";
import type { TenantContext } from "@/lib/auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { listRecords } from "./party-ops";
import { RecordSearch } from "./components/record-search";
import type { CrmRecordFilter } from "./core/types";

const BASE = "/dashboard/m/crm";

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
  };

  const records = await withTenant(
    ctx.tenant.id,
    (tx) => listRecords(tx, ctx.tenant.id, filter),
    { role: ctx.role },
  );

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
          <Button asChild>
            <Link href={`${BASE}/records/new`}>Add a record</Link>
          </Button>
        </div>
      </div>

      <RecordSearch filter={filter} />

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

      {records.length >= 500 && (
        // The cap is stated rather than silently applied — a list that stops at
        // 500 without saying so reads as "that is everyone".
        <p className="text-xs text-muted-foreground">
          Showing the first 500. Narrow the search to see more.
        </p>
      )}
    </div>
  );
}
