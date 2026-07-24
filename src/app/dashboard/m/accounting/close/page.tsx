import Link from "next/link";
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
import { AccountingNav } from "@/modules/accounting/components/accounting-nav";
import {
  getCloseChecklist,
  getSettings,
  listCloses,
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
  searchParams: Promise<{ periodEnd?: string }>;
}) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, "accounting");
  const sp = await searchParams;

  const data = await withTenant(ctx.tenant.id, async (tx) => {
    const settings = await getSettings(tx, ctx.tenant.id);
    const today = todayInTimezone(settings.bookkeepingTimezone);
    const options = periodOptions(settings.closedThrough, today);
    const defaultEnd =
      options.find((o) => o >= lastCompleteMonthEndIso(today)) ??
      options[options.length - 1] ??
      monthEndIso(today);
    const periodEnd =
      sp.periodEnd && isValidIsoDate(sp.periodEnd) && options.includes(sp.periodEnd)
        ? sp.periodEnd
        : defaultEnd;
    const checklist: CloseChecklist | null =
      periodEnd && (!settings.closedThrough || periodEnd > settings.closedThrough)
        ? await getCloseChecklist(tx, ctx.tenant.id, periodEnd)
        : null;
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
    return { settings, options, periodEnd, checklist, closes, people };
  });

  const who = (clerkUserId: string | null): string => {
    if (!clerkUserId) return "";
    const p = data.people.find((x) => x.clerkUserId === clerkUserId);
    return p?.name || p?.email || "member";
  };

  const latestCompleted = data.closes.find((c) => c.status === "completed");
  const blockers =
    data.checklist?.items.filter((i) => !i.ok).map((i) => ({
      label: i.label,
      count: i.count,
    })) ?? [];
  const canExport = ctx.role === "owner" || ctx.role === "expert";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Close</h1>
          <p className="text-sm text-muted-foreground">
            Month-end review, period lock, and the close history.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canExport && <ExportBooksDialog />}
          {data.settings.closedThrough ? (
            <Badge variant="secondary">
              Closed through {data.settings.closedThrough}
            </Badge>
          ) : (
            <Badge variant="outline">Books open</Badge>
          )}
        </div>
      </div>

      <AccountingNav />

      {data.checklist && (
        <Card>
          <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0">
            <div>
              <CardTitle>
                Pre-close checklist — through {data.periodEnd}
              </CardTitle>
              <CardDescription>
                Outstanding items warn but never block a close; they get
                snapshotted with it.
              </CardDescription>
            </div>
            {ctx.role === "owner" && (
              <CloseControls
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
                    <TableCell>
                      {c.status === "completed" ? (
                        <Badge className="bg-emerald-600 hover:bg-emerald-600">
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
