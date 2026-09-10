import Link from "next/link";
import { desc, eq, sql as dsql } from "drizzle-orm";
import { Plus } from "lucide-react";
import { withSystem, schema } from "@/db";
import { Badge } from "@/components/ui/badge";
import { CreatePartiesButton } from "./relationship-controls";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/app/page-header";
import { StatCard } from "@/components/app/stat-card";
import { DataTable } from "@/components/app/data-table";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  SubscriptionStatusBadge,
  TenantStatusBadge,
} from "@/components/status-badge";
import { formatCents } from "@/modules/accounting/lib/money";
import { formatMinutesAsHours } from "@/lib/retainer-core";
import { describeAgo } from "@/lib/last-seen";
import { getFeature } from "@/lib/features";
import { CONCERN_WORDS, loadHealthSignals, type Concern } from "./health";

export const dynamic = "force-dynamic";

const PAYING = ["active", "trialing"];

/** The badge a concern wears: money is red, silence is quiet. */
function concernVariant(c: Concern): "destructive" | "outline" {
  return c === "past_due" || c === "over_retainer" ? "destructive" : "outline";
}

export default async function AdminClientsPage() {
  const now = new Date();
  const rows = await withSystem((tx) =>
    tx
      .select({
        tenant: schema.tenants,
        subStatus: schema.subscriptions.status,
        planName: schema.subscriptions.planName,
        amountCents: schema.subscriptions.amountCents,
        moduleCount: dsql<number>`(
          select count(*)::int from tenant_modules tm
          where tm.tenant_id = tenants.id and tm.enabled = true
        )`,
      })
      .from(schema.tenants)
      .leftJoin(
        schema.subscriptions,
        eq(schema.subscriptions.tenantId, schema.tenants.id),
      )
      .orderBy(desc(schema.tenants.createdAt)),
  );

  // The operator tenant — the platform's own workspace (ADR 0041) — is listed
  // but is not a client: it counts in nothing and pays nobody.
  const clients = rows.filter((r) => !r.tenant.isOperator);
  // Workspaces the operator's CRM does not know yet (ADR 0041, slice 1).
  // Prospect rows are not counted: they have no workspace, and slice 3 decides
  // which of them are real.
  const unlinked = clients.filter(
    (r) => r.tenant.clerkOrgId && !r.tenant.operatorPartyId,
  ).length;

  // Health (slice 6): derived, never typed — last seen, thirty days of
  // activity, the retainer's month, what the client owes the operator.
  const signals = await loadHealthSignals(
    clients.map((r) => ({
      id: r.tenant.id,
      operatorPartyId: r.tenant.operatorPartyId,
      subscriptionStatus: r.subStatus ?? null,
    })),
    now,
  );
  const needALook = clients.filter(
    (r) => (signals.get(r.tenant.id)?.concerns.length ?? 0) > 0,
  ).length;

  // Concern first, then the operator's own row, then newest — so the table
  // stops being a list of names in the order they arrived.
  const ordered = [...rows].sort((a, b) => {
    const sa = signals.get(a.tenant.id)?.concernScore ?? 0;
    const sb = signals.get(b.tenant.id)?.concernScore ?? 0;
    if (sb !== sa) return sb - sa;
    if (a.tenant.isOperator !== b.tenant.isOperator) return a.tenant.isOperator ? -1 : 1;
    return b.tenant.createdAt.getTime() - a.tenant.createdAt.getTime();
  });

  const paying = clients.filter((r) => PAYING.includes(r.subStatus ?? ""));
  const mrrCents = paying.reduce((sum, r) => sum + (r.amountCents ?? 0), 0);

  const stats = [
    { label: "Clients", value: String(clients.length) },
    { label: "Need a look", value: String(needALook) },
    { label: "Paying subscriptions", value: String(paying.length) },
    {
      label: "MRR",
      value: (mrrCents / 100).toLocaleString(undefined, {
        style: "currency",
        currency: "usd",
        maximumFractionDigits: 0,
      }),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Clients"
        description="Every workspace on the platform, the ones that need a look first. The relationship — people, deals, notes — is the party in the operator's CRM."
        actions={
          <Button asChild size="sm">
            <Link href="/admin/clients/new">
              <Plus className="size-4" /> New workspace
            </Link>
          </Button>
        }
      />

      {/* These are `StatCard`s in everything but name — the label/value/tabular
          relationship was hand-built here before the primitive existed. */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.map((stat) => (
          <StatCard key={stat.label} label={stat.label} value={stat.value} />
        ))}
      </div>

      <div>
        <h2 className="font-heading font-medium tracking-heading">
          {clients.length} client{clients.length === 1 ? "" : "s"}
        </h2>
        <p className="mb-3 text-sm text-muted-foreground">
          Click a row to manage modules, billing, and its party in the CRM.
          Last seen is a member&apos;s own sign-in; the thirty days are what
          the audit log saw.
        </p>
        {unlinked > 0 && (
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm">
            <span className="text-muted-foreground">
              {unlinked} workspace{unlinked === 1 ? " has" : "s have"}{" "}
              no party in the operator&apos;s CRM yet.
            </span>
            <CreatePartiesButton count={unlinked} />
          </div>
        )}
        <DataTable>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Business</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Subscription</TableHead>
                <TableHead>Last seen</TableHead>
                <TableHead>30 days</TableHead>
                <TableHead className="text-right">Modules</TableHead>
                <TableHead className="text-right">Since</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={7}
                    className="py-10 text-center text-muted-foreground"
                  >
                    No workspaces yet. Provision the first one from a party in the CRM.
                  </TableCell>
                </TableRow>
              )}
              {ordered.map(({ tenant, subStatus, planName, moduleCount }) => {
                const health = signals.get(tenant.id);
                return (
                  <TableRow key={tenant.id}>
                    <TableCell>
                      <Link
                        href={`/admin/tenants/${tenant.id}`}
                        className="font-medium hover:underline"
                      >
                        {tenant.name}
                      </Link>
                      {tenant.isOperator && (
                        <Badge variant="outline" className="ml-2">
                          Operator
                        </Badge>
                      )}
                      {health && health.concerns.length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {health.concerns.map((c) => (
                            <Badge
                              key={c}
                              variant={concernVariant(c)}
                              className="text-xs"
                            >
                              {c === "owes" && health.owesCents !== null
                                ? `Owes ${formatCents(health.owesCents)}`
                                : c === "over_retainer" && health.retainer
                                  ? `Over retainer by ${formatMinutesAsHours(health.retainer.unpaidOverageMinutes)}`
                                  : CONCERN_WORDS[c]}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <TenantStatusBadge status={tenant.status} />
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <SubscriptionStatusBadge status={subStatus ?? "none"} />
                        {planName && (
                          <span className="text-xs text-muted-foreground">
                            {planName}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {health ? describeAgo(health.lastSeenAt, now) : "—"}
                    </TableCell>
                    <TableCell>
                      {health ? (
                        <div className="text-sm">
                          <span className="tabular-nums">{health.activity.count}</span>
                          <span className="text-muted-foreground">
                            {" "}
                            action{health.activity.count === 1 ? "" : "s"}
                          </span>
                          {health.activity.features.length > 0 && (
                            <div className="text-xs text-muted-foreground">
                              {health.activity.features
                                .map((f) => getFeature(f)?.name ?? f)
                                .join(", ")}
                            </div>
                          )}
                        </div>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {moduleCount}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {tenant.createdAt.toLocaleDateString()}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </DataTable>
      </div>
    </div>
  );
}
