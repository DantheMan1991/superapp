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

export const dynamic = "force-dynamic";

const PAYING = ["active", "trialing"];

export default async function AdminClientsPage() {
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
  const activeClients = clients.filter(
    (r) => r.tenant.status === "active",
  ).length;
  const paying = clients.filter((r) => PAYING.includes(r.subStatus ?? ""));
  const mrrCents = paying.reduce((sum, r) => sum + (r.amountCents ?? 0), 0);

  const stats = [
    { label: "Clients", value: String(clients.length) },
    { label: "Active", value: String(activeClients) },
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
        description="Every workspace on the platform. The relationship — people, deals, notes — is the party in the operator's CRM."
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
                <TableHead>Industry</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Subscription</TableHead>
                <TableHead className="text-right">Active modules</TableHead>
                <TableHead className="text-right">Since</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="py-10 text-center text-muted-foreground"
                  >
                    No workspaces yet. Provision the first one from a party in the CRM.
                  </TableCell>
                </TableRow>
              )}
              {rows.map(({ tenant, subStatus, planName, moduleCount }) => (
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
                  </TableCell>
                  <TableCell className="capitalize text-muted-foreground">
                    {tenant.industry}
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
                  <TableCell className="text-right tabular-nums">
                    {moduleCount}
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {tenant.createdAt.toLocaleDateString()}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </DataTable>
      </div>
    </div>
  );
}
