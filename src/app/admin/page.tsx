import Link from "next/link";
import { desc, eq, sql as dsql } from "drizzle-orm";
import { Plus } from "lucide-react";
import { withSystem, schema } from "@/db";
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

  const activeClients = rows.filter(
    (r) => r.tenant.status === "active",
  ).length;
  const paying = rows.filter((r) => PAYING.includes(r.subStatus ?? ""));
  const mrrCents = paying.reduce((sum, r) => sum + (r.amountCents ?? 0), 0);

  const stats = [
    { label: "Clients", value: String(rows.length) },
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Clients</h1>
          <p className="text-sm text-muted-foreground">
            Your whole book of business — prospects through paying clients.
          </p>
        </div>
        <Button asChild>
          <Link href="/admin/clients/new">
            <Plus className="size-4" /> Add business
          </Link>
        </Button>
      </div>

      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <Card key={stat.label} className="py-4">
            <CardContent className="space-y-1">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {stat.label}
              </p>
              <p className="text-2xl font-semibold tabular-nums tracking-tight">
                {stat.value}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            {rows.length} client{rows.length === 1 ? "" : "s"}
          </CardTitle>
          <CardDescription>
            Click a row to manage modules, billing, and notes.
          </CardDescription>
        </CardHeader>
        <CardContent>
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
                    No clients yet. Create the first one to get moving.
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
        </CardContent>
      </Card>
    </div>
  );
}
