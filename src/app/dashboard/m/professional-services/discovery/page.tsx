import Link from "next/link";
import { ChevronLeft, Search } from "lucide-react";
import { withTenant } from "@/db";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { allowsWrite } from "@/lib/packs/authorize";
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
import { listClientCandidates, PACK } from "@/packs/professional-services/ops";
import { listDiscoveries } from "@/packs/professional-services/discovery-ops";
import { NewDiscoveryButton } from "@/packs/professional-services/components/discovery-controls";

export const dynamic = "force-dynamic";

const BASE = "/dashboard/m/professional-services";

/**
 * Every discovery this business has run.
 *
 * **THIS PAGE IS THE POINT OF SLICE 7d.** The same rows were reachable only
 * at `/admin/audits`, behind `requireSuperAdmin()` — so somebody doing sales
 * for the operator had to be handed the god view of every client on the
 * platform to write down what a prospect said. Now it is an ordinary screen
 * in the business's own workspace, guarded by the pack.
 */
export default async function DiscoveryListPage() {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);

  const { rows, clients, labels } = await withTenant(
    ctx.tenant.id,
    async (tx) => {
      const [rows, clients, pack] = await Promise.all([
        listDiscoveries(tx, ctx.tenant.id),
        listClientCandidates(tx, ctx.tenant.id),
        packContext(tx, ctx.tenant.id, ctx.tenant.industry, PACK),
      ]);
      return { rows, clients, labels: pack.labels };
    },
    { role: ctx.role },
  );

  const clientWord = labelFor(labels, "client", "Client");
  const canRun = allowsWrite(ctx.role, "member");

  return (
    <div className="space-y-6">
      <Link
        href={BASE}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline"
      >
        <ChevronLeft className="size-4" /> {labelFor(labels, "engagement", "Engagement")}s
      </Link>

      <PageHeader
        title="Discovery"
        icon={<Search />}
        description="What you learned about a business before you took it on — and what the copilot made of it."
        actions={canRun ? <NewDiscoveryButton clients={clients} clientWord={clientWord} /> : null}
      />

      <DataTable
        isEmpty={rows.length === 0}
        empty={
          <EmptyState
            icon={<Search className="h-5 w-5" />}
            title="No discovery yet"
            description={
              canRun
                ? `Start one for a ${clientWord.toLowerCase()} you are talking to. Bring the copilot what they said and it will work out what it is costing them.`
                : "Discoveries your team runs show up here."
            }
          />
        }
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Business</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Exchanges</TableHead>
              <TableHead className="text-right">Last touched</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(({ audit, clientName }) => (
              <TableRow key={audit.id}>
                <TableCell>
                  <Link
                    href={`${BASE}/discovery/${audit.id}`}
                    className="font-medium hover:underline"
                  >
                    {clientName}
                  </Link>
                  {!audit.partyId && (
                    <Badge variant="outline" className="ml-2">
                      Not attached
                    </Badge>
                  )}
                  {audit.source === "self_serve" && (
                    <div className="text-xs text-muted-foreground">
                      From the health check
                    </div>
                  )}
                </TableCell>
                <TableCell>
                  <Badge variant={audit.status === "report_ready" ? "secondary" : "outline"}>
                    {audit.status === "report_ready" ? "Report ready" : "Open"}
                  </Badge>
                </TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">
                  {Array.isArray(audit.messages) ? audit.messages.length : 0}
                </TableCell>
                <TableCell className="text-right text-muted-foreground">
                  {audit.updatedAt.toLocaleDateString()}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </DataTable>
    </div>
  );
}
