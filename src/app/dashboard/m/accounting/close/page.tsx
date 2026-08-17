import Link from "next/link";
import { notFound } from "next/navigation";
import { inArray } from "drizzle-orm";
import { CheckCircle2, CircleAlert } from "lucide-react";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { schema, withTenant } from "@/db";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PageHeader } from "@/components/app/page-header";
import { AccountingNav } from "@/modules/accounting/components/accounting-nav";
import {
  getCloseChecklist,
  getDefaultEntityId,
  listCloses,
  listEntities,
  type CloseChecklist,
} from "@/modules/accounting/core";
import {
  addDaysIso,
  lastCompleteMonthEndIso,
  monthEndIso,
} from "@/modules/accounting/lib/dates";
import { isValidIsoDate, todayInTimezone } from "@/modules/accounting/lib/money";
import { CloseControls, ReopenCloseButton } from "./close-controls";
import { ExportBooksDialog } from "@/modules/accounting/components/export-books-dialog";

export const dynamic = "force-dynamic";

/** Eligible close targets: month ends after closedThrough, up to this month. */
function periodOptions(closedThrough: string | null, today: string): string[] {
  const first = closedThrough
    ? monthEndIso(addDaysIso(closedThrough, 1))
    : monthEndIso(addDaysIso(lastCompleteMonthEndIso(today), -340)); // ~12 months back
  const last = monthEndIso(today);
  const out: string[] = [];
  let cur = first;
  while (cur <= last && out.length < 24) {
    out.push(cur);
    cur = monthEndIso(addDaysIso(cur, 1));
  }
  return out;
}

export default async function ClosePage({
  searchParams,
}: {
  searchParams: Promise<{ periodEnd?: string; entity?: string }>;
}) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, "accounting");
  const sp = await searchParams;

  const data = await withTenant(ctx.tenant.id, async (tx) => {
    /**
     * A CLOSE IS AN ACT ON ONE SET OF BOOKS, so this picker has no "all
     * companies" — unlike every report picker in the module. You cannot close
     * everything at once any more, and offering it would be offering the very
     * thing slice 4 took away.
     *
     * Inactive companies included, for the reason the report picker includes
     * them: a wound-up LLC still has a final period to close and a return to
     * file. Absent means the tenant's default; an unknown id 404s rather than
     * quietly closing a different company's books, which is the same refusal
     * every report makes and matters more here, because this one WRITES.
     */
    const entities = await listEntities(tx, ctx.tenant.id, {
      includeInactive: true,
    });
    const defaultEntityId = await getDefaultEntityId(tx, ctx.tenant.id);
    if (sp.entity && !entities.some((e) => e.id === sp.entity)) notFound();
    const entityId = sp.entity ?? defaultEntityId;
    const entity = entities.find((e) => e.id === entityId)!;
    const showPicker = entities.length > 1;

    const today = todayInTimezone(ctx.tenant.timezone);
    const options = periodOptions(entity.closedThrough, today);
    const defaultEnd =
      options.find((o) => o >= lastCompleteMonthEndIso(today)) ??
      options[options.length - 1] ??
      monthEndIso(today);
    const periodEnd =
      sp.periodEnd && isValidIsoDate(sp.periodEnd) && options.includes(sp.periodEnd)
        ? sp.periodEnd
        : defaultEnd;
    const checklist: CloseChecklist | null =
      periodEnd && (!entity.closedThrough || periodEnd > entity.closedThrough)
        ? await getCloseChecklist(tx, ctx.tenant.id, entityId, periodEnd)
        : null;
    // Every company's closes, not just this one's — see listCloses. An owner
    // comes here to find out that Oak has not been closed since March.
    const closes = await listCloses(tx, ctx.tenant.id);
    const userIds = [
      ...new Set(
        closes.flatMap((c) =>
          [c.completedByClerkUserId, c.signedOffByClerkUserId].filter(
            (v): v is string => !!v,
          ),
        ),
      ),
    ];
    const people = userIds.length
      ? await tx
          .select({
            clerkUserId: schema.profiles.clerkUserId,
            name: schema.profiles.name,
            email: schema.profiles.email,
          })
          .from(schema.profiles)
          .where(inArray(schema.profiles.clerkUserId, userIds))
      : [];
    return {
      entities,
      entity,
      showPicker,
      options,
      periodEnd,
      checklist,
      closes,
      people,
    };
  });

  const who = (clerkUserId: string | null): string => {
    if (!clerkUserId) return "";
    const p = data.people.find((x) => x.clerkUserId === clerkUserId);
    return p?.name || p?.email || "member";
  };

  // Latest completed OF THIS COMPANY: the reopen button lives on that row, and
  // a tenant-wide "latest" would offer it on a row `reopenClose` refuses.
  const latestCompleted = data.closes.find(
    (c) => c.status === "completed" && c.entityId === data.entity.id,
  );
  const nameOfEntity = (id: string | null): string =>
    (id && data.entities.find((e) => e.id === id)?.name) || "";
  const blockers =
    data.checklist?.items.filter((i) => !i.ok).map((i) => ({
      label: i.label,
      count: i.count,
    })) ?? [];
  const canExport = ctx.role === "owner" || ctx.role === "expert";

  return (
    <div className="space-y-6">
      <PageHeader
        title="Close"
        description="Month-end review, period lock, and the close history."
        actions={
          <>
            {canExport && <ExportBooksDialog />}
            {data.entity.closedThrough ? (
              <Badge variant="secondary">
                {data.showPicker ? `${data.entity.name} · ` : ""}Closed through{" "}
                {data.entity.closedThrough}
              </Badge>
            ) : (
              <Badge variant="outline">
                {data.showPicker ? `${data.entity.name} · ` : ""}Books open
              </Badge>
            )}
          </>
        }
      />

      <AccountingNav />

      {/* WHERE EVERY COMPANY STANDS, on the page whose job is to tell you. One
          company closed through June and another through March is the ordinary
          state of a ten-LLC client, and it is invisible from a picker that only
          shows the one you happen to have selected. */}
      {data.showPicker && (
        <div className="flex flex-wrap items-center gap-2">
          {data.entities.map((e) => (
            <Link
              key={e.id}
              href={`/dashboard/m/accounting/close?entity=${e.id}`}
              className={
                e.id === data.entity.id
                  ? "border-primary bg-primary/8 rounded-full border px-3 py-1 text-xs font-medium"
                  : "border-border hover:bg-muted rounded-full border px-3 py-1 text-xs"
              }
            >
              {e.name}
              <span className="text-muted-foreground ml-1.5">
                {e.closedThrough ? `closed through ${e.closedThrough}` : "open"}
              </span>
            </Link>
          ))}
        </div>
      )}

      {data.checklist && (
        <Card>
          <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0">
            <div>
              <CardTitle>
                Pre-close checklist{data.showPicker ? ` — ${data.entity.name}` : ""}{" "}
                — through {data.periodEnd}
              </CardTitle>
              <CardDescription>
                Outstanding items warn but never block a close; they get
                snapshotted with it.
              </CardDescription>
            </div>
            {ctx.role === "owner" && (
              <CloseControls
                entityId={data.entity.id}
                entityName={data.showPicker ? data.entity.name : undefined}
                periodEnd={data.periodEnd}
                periodOptions={data.options}
                blockers={blockers}
              />
            )}
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              {data.checklist.items.map((item) => (
                <li
                  key={item.key}
                  className="flex items-center justify-between gap-3 py-2.5"
                >
                  <div className="flex min-w-0 items-center gap-2.5">
                    {item.ok ? (
                      <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                    ) : (
                      <CircleAlert className="h-4 w-4 shrink-0 text-amber-600" />
                    )}
                    <div className="min-w-0">
                      <p className="text-sm">
                        {item.label}
                        {!item.ok && item.count > 0 && (
                          <span className="ml-1.5 font-medium">
                            ({item.count})
                          </span>
                        )}
                      </p>
                      {item.detail && (
                        <p className="truncate text-xs text-muted-foreground">
                          {item.detail}
                        </p>
                      )}
                    </div>
                  </div>
                  {!item.ok && (
                    <Button asChild variant="ghost" size="sm">
                      <Link href={item.href}>Review</Link>
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Close history</CardTitle>
          <CardDescription>
            Every close, who completed it, and its review state.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {data.closes.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-muted-foreground">
              No closes yet. The first close locks the books through the
              period you pick above.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Period end</TableHead>
                  {data.showPicker && <TableHead>Company</TableHead>}
                  <TableHead>Status</TableHead>
                  <TableHead>Completed</TableHead>
                  <TableHead>Review</TableHead>
                  <TableHead className="text-right" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.closes.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell>
                      <Link
                        href={`/dashboard/m/accounting/close/${c.id}`}
                        className="font-medium underline-offset-2 hover:underline"
                      >
                        {c.periodEnd}
                      </Link>
                    </TableCell>
                    {data.showPicker && (
                      <TableCell className="text-sm">
                        {/* Blank on a close that predates per-entity closes:
                            it locked every company at once, and naming one
                            would be a claim the row cannot support. */}
                        {nameOfEntity(c.entityId) || (
                          <span className="text-muted-foreground">
                            All companies
                          </span>
                        )}
                      </TableCell>
                    )}
                    <TableCell>
                      {c.status === "completed" ? (
                        <Badge className="bg-success/12 text-success-foreground hover:bg-success/12">
                          Completed
                        </Badge>
                      ) : (
                        <Badge variant="secondary">Reopened</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {who(c.completedByClerkUserId)} ·{" "}
                      {c.completedAt.toISOString().slice(0, 10)}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1.5">
                        {c.signedOffAt ? (
                          <Badge variant="outline">
                            Signed off · {who(c.signedOffByClerkUserId)}
                          </Badge>
                        ) : (
                          c.status === "completed" && (
                            <Badge variant="outline" className="text-muted-foreground">
                              Awaiting sign-off
                            </Badge>
                          )
                        )}
                        {c.narrative != null && (
                          <Badge variant="outline">Narrative</Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      {ctx.role === "owner" &&
                        latestCompleted?.id === c.id && (
                          <ReopenCloseButton
                            closeId={c.id}
                            periodEnd={c.periodEnd}
                            version={c.version}
                          />
                        )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
