import Link from "next/link";
import { asc, isNotNull } from "drizzle-orm";
import { withSystem, schema } from "@/db";
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
import { Badge } from "@/components/ui/badge";
import { loadAllRetainerViews } from "@/lib/retainer";
import {
  elapsedMinutes,
  formatMinutesAsHours,
  todayInRetainerTz,
} from "@/lib/retainer-core";
import { TimerControls } from "./controls";

export const dynamic = "force-dynamic";

/** Superadmin: retainer hours across every client. Layout gates /admin. */
export default async function AdminRetainersPage() {
  const [tenants, views] = await withSystem(async (tx) =>
    Promise.all([
      tx.query.tenants.findMany({
        where: isNotNull(schema.tenants.clerkOrgId),
        orderBy: [asc(schema.tenants.name)],
      }),
      loadAllRetainerViews(tx),
    ]),
  );

  const now = new Date();
  const today = todayInRetainerTz(now);
  const running = tenants.filter(
    (t) => views.get(t.id)?.retainer?.timerStartedAt != null,
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Retainers</h1>
        <p className="text-sm text-muted-foreground">
          Monthly included hours per client, your logged time, and purchased
          blocks. Balances are derived — nothing here to reconcile.
        </p>
      </div>

      {running.length > 0 && (
        <Card className="border-amber-500/50 bg-amber-500/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Timers running</CardTitle>
            <CardDescription>
              Don&apos;t forget these — stop or discard when the work ends.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {running.map((t) => {
              const r = views.get(t.id)!.retainer!;
              return (
                <div key={t.id} className="space-y-1">
                  <p className="text-sm font-medium">
                    <Link href={`/admin/tenants/${t.id}`} className="hover:underline">
                      {t.name}
                    </Link>{" "}
                    <span className="text-muted-foreground">
                      — ~
                      {formatMinutesAsHours(
                        elapsedMinutes(r.timerStartedAt!, now),
                      )}
                    </span>
                  </p>
                  <TimerControls
                    tenantId={t.id}
                    timerStartedAt={r.timerStartedAt!.toISOString()}
                    timerNote={r.timerNote}
                  />
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="pt-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Client</TableHead>
                <TableHead>Allotment</TableHead>
                <TableHead>Used this month</TableHead>
                <TableHead>Purchased left</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Timer</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tenants.map((t) => {
                const view = views.get(t.id);
                const usage = view?.usage;
                const retainer = view?.retainer ?? null;
                return (
                  <TableRow key={t.id}>
                    <TableCell className="font-medium">
                      <Link
                        href={`/admin/tenants/${t.id}`}
                        className="hover:underline"
                      >
                        {t.name}
                      </Link>
                    </TableCell>
                    <TableCell>
                      {usage
                        ? formatMinutesAsHours(usage.includedMinutes)
                        : "—"}
                    </TableCell>
                    <TableCell>
                      {usage ? formatMinutesAsHours(usage.usedMinutes) : "—"}
                    </TableCell>
                    <TableCell>
                      {usage
                        ? formatMinutesAsHours(usage.purchasedMinutesRemaining)
                        : "—"}
                    </TableCell>
                    <TableCell>
                      {!usage ? (
                        <span className="text-xs text-muted-foreground">
                          No retainer
                        </span>
                      ) : usage.isOver ? (
                        <Badge variant="destructive">
                          Over by {formatMinutesAsHours(usage.unpaidOverageMinutes)}
                        </Badge>
                      ) : usage.isNearLimit ? (
                        <Badge variant="outline">Near limit</Badge>
                      ) : (
                        <Badge variant="secondary">OK</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {retainer?.timerStartedAt ? (
                        <span className="text-xs font-medium text-amber-600">
                          ● running
                        </span>
                      ) : (
                        <TimerControls
                          tenantId={t.id}
                          timerStartedAt={null}
                          timerNote={null}
                        />
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
              {tenants.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="text-center text-sm text-muted-foreground"
                  >
                    No clients yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          <p className="mt-3 text-xs text-muted-foreground">
            Set allotments and log or fix entries on each client&apos;s detail
            page. Today ({today}) is the default work date. Entries dated
            before a client&apos;s first allotment month count fully as
            overage.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
