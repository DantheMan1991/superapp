import Link from "next/link";
import { Wrench } from "lucide-react";
import { withTenant } from "@/db";
import { listEntities } from "@/modules/accounting/core";
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
import { todayInTimezone } from "@/lib/timezone";
import { listAssets, listContainerCandidates, listKindsInUse } from "./ops";
import { getDepreciationStatus } from "./depreciation-ops";
import { periodOf } from "./core/depreciation";
import { assetKindLabel } from "./vocabulary";
import { AssetForm } from "./components/asset-form";
import { PostAllDepreciation } from "./components/post-all-depreciation";

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

  const currentPeriod = periodOf(todayInTimezone(ctx.tenant.timezone));

  const { rows, kinds, containers, companies, due } = await withTenant(
    ctx.tenant.id,
    async (tx) => {
      const [rows, kinds, containers, companies] = await Promise.all([
        listAssets(tx, ctx.tenant.id, {
          kind,
          // Disposed assets stay in the books forever but are noise in the
          // list, so they are opt-in rather than filtered out of existence.
          status: showDisposed ? undefined : "active",
        }),
        listKindsInUse(tx, ctx.tenant.id),
        listContainerCandidates(tx, ctx.tenant.id),
        // ACTIVE only, unlike a report picker: this list is for CREATING an
        // asset, and a wound-up company must not be given new ones.
        listEntities(tx, ctx.tenant.id),
      ]);

      // What month-end would post, so the button can say so before it is
      // pressed. Only over what is on screen — a filtered list must not offer
      // to post things it is not showing.
      let assetsDue = 0;
      let totalCents = 0;
      for (const asset of rows) {
        const status = await getDepreciationStatus(
          tx,
          ctx.tenant.id,
          asset,
          currentPeriod,
        );
        if (!status || status.due.length === 0) continue;
        assetsDue += 1;
        totalCents += status.due.reduce((s, r) => s + r.amountCents, 0);
      }
      return {
        rows,
        kinds,
        containers,
        companies,
        due: { assetsDue, totalCents },
      };
    },
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
            <div className="flex items-center gap-2">
              <PostAllDepreciation
                through={currentPeriod}
                assetsDue={due.assetsDue}
                totalLabel={formatCents(due.totalCents)}
              />
              <AssetForm
                containers={containers.map((c) => ({ id: c.id, name: c.name }))}
                kindsInUse={kinds.map((k) => k.kind)}
                companies={companies.map((c) => ({
                  id: c.id,
                  name: c.name,
                  isDefault: c.isDefault,
                }))}
              />
            </div>
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
