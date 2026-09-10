import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, Briefcase } from "lucide-react";
import { withTenant } from "@/db";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { allowsWrite } from "@/lib/packs/authorize";
import { labelFor } from "@/lib/packs/resolve";
import { packContext } from "@/lib/packs/tenant-context";
import { formatMoney } from "@/lib/money";
import { todayInTimezone } from "@/lib/timezone";
import { formatMinutesAsHours, monthOf } from "@/lib/retainer-core";
import { PageHeader } from "@/components/app/page-header";
import { Panel } from "@/components/app/panel";
import { EmptyState } from "@/components/app/empty-state";
import { DataTable } from "@/components/app/data-table";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  getEngagementDetail,
  listClientCandidates,
  PACK,
  whoLogged,
} from "@/packs/professional-services/ops";
import {
  engagementKindLabel,
  engagementStatusLabel,
  isEngagementStatus,
  nextStatuses,
} from "@/packs/professional-services/vocabulary";
import { EngagementForm } from "@/packs/professional-services/components/engagement-form";
import {
  LogTimeForm,
  StatusButtons,
  TimeEntryRow,
} from "@/packs/professional-services/components/time-controls";

export const dynamic = "force-dynamic";

const BASE = "/dashboard/m/professional-services";

/**
 * One engagement: its terms, its month, and everything logged against it.
 *
 * A PACK'S SUB-ROUTE LIVES IN `src/app/`, not in `src/packs/` — the same
 * arrangement core modules have, because Next resolves routes from the app
 * directory. The pack owns everything this page does; the file guards and
 * delegates. `requireModuleEnabled` is not optional: a route file is
 * reachable by URL whether or not the pack is switched on.
 */
export default async function EngagementPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);

  const today = todayInTimezone(ctx.tenant.timezone);
  const month = monthOf(today);
  const currencySymbol = ctx.tenant.currencySymbol;

  const data = await withTenant(
    ctx.tenant.id,
    async (tx) => {
      const detail = await getEngagementDetail(tx, ctx.tenant.id, id, month);
      if (!detail) return null;
      const [clients, pack, names] = await Promise.all([
        listClientCandidates(tx, ctx.tenant.id),
        packContext(tx, ctx.tenant.id, ctx.tenant.industry, PACK),
        whoLogged(tx, detail.entries.map((e) => e.actorClerkUserId)),
      ]);
      return { detail, clients, labels: pack.labels, names };
    },
    { role: ctx.role },
  );
  if (!data) notFound();

  const { detail, clients, labels, names } = data;
  const { engagement, clientName, thisMonth, months, entries } = detail;
  const engagementWord = labelFor(labels, "engagement", "Engagement");
  const clientWord = labelFor(labels, "client", "Client");
  const isOwner = allowsWrite(ctx.role, "owner");
  const canLog = allowsWrite(ctx.role, "member");
  const status = isEngagementStatus(engagement.status) ? engagement.status : "active";

  return (
    <div className="space-y-6">
      <Link
        href={BASE}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline"
      >
        <ChevronLeft className="size-4" /> {engagementWord}s
      </Link>

      <PageHeader
        title={engagement.name}
        icon={<Briefcase />}
        description={
          <span>
            {clientName} · {engagementKindLabel(engagement.kind)} · from{" "}
            {engagement.startsOn}
            {engagement.endsOn ? ` to ${engagement.endsOn}` : ""}
          </span>
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={status === "active" ? "secondary" : "outline"}>
              {engagementStatusLabel(status)}
            </Badge>
            {canLog && (
              <LogTimeForm
                engagementId={engagement.id}
                today={today}
                disabled={status === "ended"}
              />
            )}
            {isOwner && (
              <EngagementForm
                clients={clients}
                kindsInUse={[engagement.kind]}
                today={today}
                engagementWord={engagementWord}
                clientWord={clientWord}
                engagement={{
                  id: engagement.id,
                  version: engagement.version,
                  name: engagement.name,
                  kind: engagement.kind,
                  scope: engagement.scope,
                  startsOn: engagement.startsOn,
                  endsOn: engagement.endsOn,
                  feeInput:
                    engagement.feeCents === null ? "" : (engagement.feeCents / 100).toString(),
                  rateInput:
                    engagement.rateCents === null ? "" : (engagement.rateCents / 100).toString(),
                  retainerInput:
                    engagement.retainerMinutesMonthly === 0
                      ? ""
                      : (engagement.retainerMinutesMonthly / 60).toString(),
                  notes: engagement.notes,
                }}
              />
            )}
          </div>
        }
      />

      <div className="grid gap-4 md:grid-cols-3">
        <Panel className="p-4">
          <div className="text-sm text-muted-foreground">This month</div>
          <div className="mt-1 text-2xl font-medium tabular-nums">
            {formatMinutesAsHours(thisMonth.usedMinutes)}
          </div>
          <div className="text-sm text-muted-foreground">
            {thisMonth.includedMinutes > 0
              ? thisMonth.isOver
                ? `over ${formatMinutesAsHours(thisMonth.includedMinutes)} by ${formatMinutesAsHours(thisMonth.overageMinutes)}`
                : `${formatMinutesAsHours(thisMonth.remainingMinutes)} left of ${formatMinutesAsHours(thisMonth.includedMinutes)}`
              : "no hours included — everything logged is extra"}
          </div>
        </Panel>
        <Panel className="p-4">
          <div className="text-sm text-muted-foreground">Worth</div>
          <div className="mt-1 text-2xl font-medium tabular-nums">
            {engagement.feeCents === null
              ? "—"
              : formatMoney(engagement.feeCents, currencySymbol)}
          </div>
          <div className="text-sm text-muted-foreground">
            {engagement.rateCents === null
              ? "no rate set"
              : `${formatMoney(engagement.rateCents, currencySymbol)} an hour beyond the retainer`}
          </div>
        </Panel>
        <Panel className="p-4">
          {/* THE SAME RULE THE MONTH TABLE BELOW USES, and it has to be:
              driving this found the card saying "Logged at the rate $180.00"
              beside a table row reading $0.00 for the same month. Hours INSIDE
              a retainer are already paid for by the fee, so pricing them at
              the rate invites somebody to bill them twice. A retainer
              engagement therefore always shows its OVERAGE — zero until it
              goes over — and only an engagement with no hours included prices
              everything logged. */}
          <div className="text-sm text-muted-foreground">
            {thisMonth.includedMinutes > 0 ? "Extra this month" : "Logged at the rate"}
          </div>
          <div className="mt-1 text-2xl font-medium tabular-nums">
            {thisMonth.overageCents === null
              ? "—"
              : formatMoney(
                  thisMonth.includedMinutes > 0
                    ? thisMonth.overageCents
                    : (thisMonth.usedCents ?? 0),
                  currencySymbol,
                )}
          </div>
          <div className="text-sm text-muted-foreground">
            {thisMonth.overageCents === null
              ? "set a rate to price the hours"
              : "nothing is invoiced automatically"}
          </div>
        </Panel>
      </div>

      {isOwner && (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm text-muted-foreground">Move it along:</span>
          <StatusButtons engagementId={engagement.id} from={status} to={nextStatuses(status)} />
        </div>
      )}

      {engagement.scope && (
        <Panel className="p-4">
          <div className="text-sm font-medium">Scope</div>
          <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">
            {engagement.scope}
          </p>
        </Panel>
      )}

      <div>
        <h2 className="mb-3 font-heading font-medium tracking-heading">Time</h2>
        <DataTable
          isEmpty={entries.length === 0}
          empty={
            <EmptyState
              title="Nothing logged yet"
              description={
                canLog
                  ? "Log the first hour. The month is measured from what is here."
                  : "Hours logged against this show up here."
              }
            />
          }
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Day</TableHead>
                <TableHead>What</TableHead>
                <TableHead>Who</TableHead>
                <TableHead className="text-right">How long</TableHead>
                {canLog && <TableHead className="w-16" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell className="tabular-nums text-muted-foreground">
                    {entry.workDate}
                  </TableCell>
                  <TableCell>{entry.note || "—"}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {names.get(entry.actorClerkUserId) ?? "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatMinutesAsHours(entry.minutes)}
                  </TableCell>
                  {canLog && (
                    <TableCell className="text-right">
                      <TimeEntryRow
                        entry={{
                          id: entry.id,
                          version: entry.version,
                          minutes: entry.minutes,
                          workDate: entry.workDate,
                          note: entry.note,
                          durationLabel: formatMinutesAsHours(entry.minutes),
                          who: names.get(entry.actorClerkUserId) ?? "somebody",
                        }}
                      />
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </DataTable>
      </div>

      {months.length > 1 && (
        <div>
          <h2 className="mb-3 font-heading font-medium tracking-heading">Month by month</h2>
          <DataTable>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Month</TableHead>
                  <TableHead className="text-right">Included</TableHead>
                  <TableHead className="text-right">Logged</TableHead>
                  <TableHead className="text-right">Over</TableHead>
                  <TableHead className="text-right">At the rate</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {months.map((m) => (
                  <TableRow key={m.month}>
                    <TableCell className="tabular-nums">{m.month}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {m.includedMinutes > 0 ? formatMinutesAsHours(m.includedMinutes) : "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMinutesAsHours(m.usedMinutes)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {m.isOver ? formatMinutesAsHours(m.overageMinutes) : "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {m.overageCents === null
                        ? "—"
                        : formatMoney(
                            m.includedMinutes > 0 ? m.overageCents : (m.usedCents ?? 0),
                            currencySymbol,
                          )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </DataTable>
        </div>
      )}
    </div>
  );
}
