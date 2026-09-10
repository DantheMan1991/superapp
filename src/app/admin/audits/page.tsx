import Link from "next/link";
import { and, desc, eq, inArray } from "drizzle-orm";
import { Plus } from "lucide-react";
import { withSystem, withTenant, schema } from "@/db";
import { getOperatorTenant } from "@/lib/operator-tenant";
import type { AuditMessage } from "@/db/schema";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/app/page-header";
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
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const STATUS_STYLES: Record<string, string> = {
  open: "bg-accent text-accent-foreground",
  report_ready: "bg-success/15 text-emerald-700 dark:text-emerald-300",
  won: "bg-success/15 text-emerald-700 dark:text-emerald-300",
  lost: "bg-muted text-muted-foreground",
};

export default async function AuditsPage() {
  // Discovery is the operator's (ADR 0041, slice 2): read through its own
  // context as staff, with the party each record is about and — when a
  // workspace points at that party — the workspace, for the link.
  const operator = await getOperatorTenant();
  const rows = operator
    ? await withTenant(
        operator.id,
        (tx) =>
          tx
            .select({ audit: schema.audits, partyName: schema.parties.displayName })
            .from(schema.audits)
            .leftJoin(
              schema.parties,
              and(
                eq(schema.parties.tenantId, schema.audits.tenantId),
                eq(schema.parties.id, schema.audits.partyId),
              ),
            )
            .where(eq(schema.audits.tenantId, operator.id))
            .orderBy(desc(schema.audits.updatedAt)),
        { role: "staff" },
      )
    : [];
  const partyIds = rows.flatMap((r) => (r.audit.partyId ? [r.audit.partyId] : []));
  const workspaces =
    partyIds.length > 0
      ? await withSystem((tx) =>
          tx
            .select({ id: schema.tenants.id, partyId: schema.tenants.operatorPartyId })
            .from(schema.tenants)
            .where(inArray(schema.tenants.operatorPartyId, partyIds)),
        )
      : [];
  const workspaceByParty = new Map(workspaces.map((w) => [w.partyId, w.id]));
  const audits = rows.map((r) => r.audit);
  const selfServeCount = audits.filter((a) => a.source === "self_serve").length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Discovery"
        description={
          <>
            Tier 0 audits — learn a prospect&apos;s business with an AI copilot,
            then generate the health check and build spec.
          </>
        }
        actions={
          <Button asChild size="sm">
            <Link href="/admin/audits/new">
              <Plus className="size-4" /> New audit
            </Link>
          </Button>
        }
      />

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            {audits.length} engagement{audits.length === 1 ? "" : "s"}
          </CardTitle>
          <CardDescription>
            The audit is the sales wedge — it reveals the work.
            {selfServeCount > 0 && (
              <> {selfServeCount} came in from the website health check.</>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Business</TableHead>
                <TableHead>Industry</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Exchanges</TableHead>
                <TableHead className="text-right">Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {audits.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="py-10 text-center text-muted-foreground"
                  >
                    No discovery engagements yet. Start one before your next
                    prospect call.
                  </TableCell>
                </TableRow>
              )}
              {audits.map((audit) => {
                const exchanges = Math.floor(
                  ((audit.messages as AuditMessage[])?.length ?? 0) / 2,
                );
                return (
                  <TableRow key={audit.id}>
                    <TableCell>
                      <Link
                        href={`/admin/audits/${audit.id}`}
                        className="font-medium hover:underline"
                      >
                        {audit.businessName}
                      </Link>
                      {audit.source === "self_serve" && (
                        <Badge
                          variant="outline"
                          className="ml-2 border-transparent bg-brand/10 text-brand"
                        >
                          Self-serve
                        </Badge>
                      )}
                      <div className="text-xs text-muted-foreground">
                        {audit.contactName && <>{audit.contactName} · </>}
                        {audit.partyId && workspaceByParty.get(audit.partyId) ? (
                          <Link
                            href={`/admin/tenants/${workspaceByParty.get(audit.partyId)}`}
                            className="underline hover:text-foreground"
                          >
                            Workspace
                          </Link>
                        ) : audit.partyId ? (
                          <span>In the CRM</span>
                        ) : (
                          <span>Not attached to a business yet</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="capitalize text-muted-foreground">
                      {audit.industry}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={cn(
                          "border-transparent",
                          STATUS_STYLES[audit.status],
                        )}
                      >
                        {audit.status.replace("_", " ")}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {exchanges}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {audit.updatedAt.toLocaleDateString()}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
