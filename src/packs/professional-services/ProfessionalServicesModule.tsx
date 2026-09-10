import Link from "next/link";
import { Briefcase } from "lucide-react";
import { withTenant } from "@/db";
import type { TenantContext } from "@/lib/auth";
import { formatMoney } from "@/lib/money";
import { todayInTimezone } from "@/lib/timezone";
import { formatMinutesAsHours, monthOf } from "@/lib/retainer-core";
import { labelFor } from "@/lib/packs/resolve";
import { packContext } from "@/lib/packs/tenant-context";
import { PageHeader } from "@/components/app/page-header";
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
import { listClientCandidates, listEngagements, PACK } from "./ops";
import { engagementKindLabel, engagementStatusLabel } from "./vocabulary";
import { EngagementForm } from "./components/engagement-form";

/**
 * The `professional-services` pack's home: every engagement, and how each
 * one's month is going.
 *
 * Nothing here is agency-shaped. A bookkeeping firm's monthly close, a law
 * practice's matter and a studio's retainer are the same row — the words come
 * from `kind`, which the tenant supplies, and from the two labels this pack
 * declares.
 *
 * ONE QUERY SHAPE FOR THE WHOLE PAGE. `listEngagements` reads the rows, the
 * allotments and the month's minutes in three statements rather than a meter
 * per row, because a services business with forty clients would otherwise pay
 * a hundred and twenty round trips to draw a table.
 */
export async function ProfessionalServicesModule({
  ctx,
  searchParams,
}: {
  ctx: TenantContext;
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const showEnded = searchParams.ended === "1";
  const today = todayInTimezone(ctx.tenant.timezone);
  const month = monthOf(today);
  const currencySymbol = ctx.tenant.currencySymbol;

  const { rows, clients, labels } = await withTenant(
    ctx.tenant.id,
    async (tx) => {
      const [rows, clients, pack] = await Promise.all([
        listEngagements(tx, ctx.tenant.id, { month, includeEnded: showEnded }),
        listClientCandidates(tx, ctx.tenant.id),
        packContext(tx, ctx.tenant.id, ctx.tenant.industry, PACK),
      ]);
      return { rows, clients, labels: pack.labels };
    },
    { role: ctx.role },
  );

  const engagementWord = labelFor(labels, "engagement", "Engagement");
  const clientWord = labelFor(labels, "client", "Client");
  const isOwner = ctx.role === "owner";
  const kindsInUse = [...new Set(rows.map((r) => r.engagement.kind))];

  const liveMinutes = rows
    .filter((r) => r.engagement.status === "active")
    .reduce((sum, r) => sum + r.month.usedMinutes, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${engagementWord}s`}
        icon={<Briefcase />}
        description={
          rows.length > 0
            ? `${formatMinutesAsHours(liveMinutes)} logged this month across what is live.`
            : `What each ${clientWord.toLowerCase()} has agreed to, and the hours against it.`
        }
        actions={
          isOwner ? (
            <EngagementForm
              clients={clients}
              kindsInUse={kindsInUse}
              today={today}
              engagementWord={engagementWord}
              clientWord={clientWord}
            />
          ) : null
        }
      />

      <DataTable
        isEmpty={rows.length === 0}
        empty={
          <EmptyState
            icon={<Briefcase className="h-5 w-5" />}
            title={`No ${engagementWord.toLowerCase()}s yet`}
            description={
              isOwner
                ? `Agree the first one — who it is for, what you are doing, and what it is worth. Time is logged against it, and so is anything it costs you.`
                : `An owner agrees what each ${clientWord.toLowerCase()} has signed up for. Once they do, you can log time against it.`
            }
          />
        }
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{engagementWord}</TableHead>
              <TableHead>{clientWord}</TableHead>
              <TableHead>Kind</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">This month</TableHead>
              <TableHead className="text-right">Worth</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(({ engagement, clientName, month: m }) => (
              <TableRow key={engagement.id}>
                <TableCell>
                  <Link
                    href={`/dashboard/m/professional-services/${engagement.id}`}
                    className="font-medium hover:underline"
                  >
                    {engagement.name}
                  </Link>
                  {engagement.scope && (
                    <div className="line-clamp-1 text-xs text-muted-foreground">
                      {engagement.scope}
                    </div>
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground">{clientName}</TableCell>
                <TableCell className="text-muted-foreground">
                  {engagementKindLabel(engagement.kind)}
                </TableCell>
                <TableCell>
                  <Badge
                    variant={
                      engagement.status === "active"
                        ? "secondary"
                        : engagement.status === "ended"
                          ? "outline"
                          : "outline"
                    }
                  >
                    {engagementStatusLabel(engagement.status)}
                  </Badge>
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatMinutesAsHours(m.usedMinutes)}
                  {m.includedMinutes > 0 && (
                    <span className="text-muted-foreground">
                      {" "}
                      of {formatMinutesAsHours(m.includedMinutes)}
                    </span>
                  )}
                  {m.isOver && (
                    <div className="text-xs text-destructive">
                      over by {formatMinutesAsHours(m.overageMinutes)}
                      {m.overageCents !== null &&
                        ` · ${formatMoney(m.overageCents, currencySymbol)}`}
                    </div>
                  )}
                  {!m.isOver && m.isNearLimit && (
                    <div className="text-xs text-muted-foreground">near the limit</div>
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {/* A dash, not zero: an hourly engagement has no fee and that
                      is a different fact from a fee of nothing. */}
                  {engagement.feeCents === null
                    ? engagement.rateCents === null
                      ? "—"
                      : `${formatMoney(engagement.rateCents, currencySymbol)}/h`
                    : formatMoney(engagement.feeCents, currencySymbol)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </DataTable>

      <p className="text-sm text-muted-foreground">
        <Link
          href="/dashboard/m/professional-services/discovery"
          className="hover:underline"
        >
          Discovery
        </Link>
        {" · "}
        {showEnded ? (
          <Link href="/dashboard/m/professional-services" className="hover:underline">
            Hide ended
          </Link>
        ) : (
          <Link href="/dashboard/m/professional-services?ended=1" className="hover:underline">
            Show ended
          </Link>
        )}
      </p>
    </div>
  );
}
