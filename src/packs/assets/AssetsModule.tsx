import Link from "next/link";
import { Wrench } from "lucide-react";
import { withTenant } from "@/db";
import type { TenantContext } from "@/lib/auth";
import { formatCents } from "@/lib/money";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { listAssets, listContainerCandidates, listKindsInUse } from "./ops";
import { assetKindLabel } from "./vocabulary";
import { AssetForm } from "./components/asset-form";

/**
 * The `assets` pack's home — THE FIRST CAPABILITY PACK TO RENDER.
 *
 * Nothing here is farm-shaped, and that is the point: a tractor, a dental
 * chair and a service van are the same row. The words come from `kind`, which
 * the tenant and its profile supply.
 *
 * One query, one table. Depreciation, maintenance schedules and meter readings
 * are later slices — this one exists to prove the chain end to end: a pack
 * declared in `src/packs/`, seeded as a `modules` row, installed by a profile,
 * writing to a pack-owned table under RLS, and syncing a cost object into
 * `dimension_members` so the P&L can group by it.
 */
export async function AssetsModule({
  ctx,
  searchParams,
}: {
  ctx: TenantContext;
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const kindParam = searchParams.kind;
  const kind = typeof kindParam === "string" ? kindParam : undefined;
  const showDisposed = searchParams.disposed === "1";

  const [rows, kinds, containers] = await withTenant(
    ctx.tenant.id,
    async (tx) =>
      Promise.all([
        listAssets(tx, ctx.tenant.id, {
          kind,
          // Disposed assets stay in the books forever but are noise in the
          // list, so they are opt-in rather than filtered out of existence.
          status: showDisposed ? undefined : "active",
        }),
        listKindsInUse(tx, ctx.tenant.id),
        listContainerCandidates(tx, ctx.tenant.id),
      ]),
    { role: ctx.role },
  );

  const byId = new Map(rows.map((r) => [r.id, r]));
  const isOwner = ctx.role === "owner";

  return (
    <div className="space-y-6">
      <PageHeader
        title="Assets"
        description="What the business owns — what it cost, where it lives, and what is still in service."
        actions={
          isOwner ? (
            <AssetForm
              containers={containers.map((c) => ({ id: c.id, name: c.name }))}
              kindsInUse={kinds.map((k) => k.kind)}
            />
          ) : null
        }
      />

      {rows.length === 0 ? (
        <EmptyState
          panel
          icon={<Wrench className="h-5 w-5" />}
          title="Nothing on the books yet"
          description={
            isOwner
              ? "Add the first thing the business owns — a building, a machine, a vehicle. What it cost and where it lives both become reportable."
              : "An owner adds what the business owns. Once they do, it shows up here."
          }
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Asset</TableHead>
              <TableHead>Kind</TableHead>
              <TableHead>Kept in</TableHead>
              <TableHead>Acquired</TableHead>
              <TableHead className="text-right">Cost</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((asset) => (
              <TableRow key={asset.id}>
                <TableCell>
                  <div className="flex items-center gap-2 font-medium">
                    <Link
                      href={`/dashboard/m/assets/${asset.id}`}
                      className="hover:underline"
                    >
                      {asset.name}
                    </Link>
                    {asset.status === "disposed" && (
                      <Badge variant="outline">disposed</Badge>
                    )}
                  </div>
                  {asset.identifier && (
                    <div className="text-xs text-muted-foreground">
                      {asset.identifier}
                    </div>
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {assetKindLabel(asset.kind)}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {asset.parentId
                    ? (byId.get(asset.parentId)?.name ?? "—")
                    : "—"}
                </TableCell>
                <TableCell className="text-muted-foreground tabular-nums">
                  {asset.acquiredOn ?? "—"}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {/* Blank, not zero: "cost unknown" and "cost nothing" are
                      different facts, and depreciation needs to tell them
                      apart. See the column comment in schema/assets.ts. */}
                  {asset.acquisitionCostCents === null
                    ? "—"
                    : formatCents(asset.acquisitionCostCents)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
