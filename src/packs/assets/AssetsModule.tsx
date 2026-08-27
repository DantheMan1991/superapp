import Link from "next/link";
import { Wrench } from "lucide-react";
import { withTenant } from "@/db";
import { listEntities } from "@/modules/accounting/core";
import type { TenantContext } from "@/lib/auth";
import { formatMoney } from "@/lib/money";
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
import { todayInTimezone } from "@/lib/timezone";
import { listAssets, listContainerCandidates, listKindsInUse } from "./ops";
import { getDepreciationStatus } from "./depreciation-ops";
import { periodOf } from "./core/depreciation";
import { assetKindLabel } from "./vocabulary";
import { primaryAttachments } from "@/modules/documents/attachments";
import { RecordPhotoThumb } from "@/modules/documents/components/record-photos";
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
  const currencySymbol = ctx.tenant.currencySymbol;

  const { rows, portraits, kinds, containers, companies, due } = await withTenant(
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
      // One query for the whole page of thumbnails. A record with photos but
      // no chosen picture is absent and gets the placeholder — the app does
      // not pick a portrait on somebody's behalf.
      const portraits = await primaryAttachments(
        tx,
        ctx.tenant.id,
        "asset",
        rows.map((a) => a.id),
      );
      return {
        rows,
        portraits,
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
  /**
   * WHOSE ASSET, on a list that shows several companies' at once — the column
   * the invoice and bill lists have had since slice 1b, and the fourth screen
   * of this shape to need it (the Journal header, the close history, the
   * payment rows).
   *
   * The pattern the dossier now names: a screen showing a document's OWN data
   * is safe; one showing several companies' side by side has to say which is
   * which. Only at two or more, so the single-company tenant's list is exactly
   * what it was.
   */
  const showCompany = companies.length > 1;
  const companyName = (entityId: string | null): string =>
    (entityId && companies.find((c) => c.id === entityId)?.name) || "—";

  return (
    <div className="space-y-6">
      <PageHeader
        title="Assets"
        icon={<Wrench />}
        description="What the business owns — what it cost, where it lives, and what is still in service."
        actions={
          isOwner ? (
            <div className="flex items-center gap-2">
              <PostAllDepreciation
                through={currentPeriod}
                assetsDue={due.assetsDue}
                totalLabel={formatMoney(due.totalCents, currencySymbol)}
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

      <DataTable
        isEmpty={rows.length === 0}
        empty={
          <EmptyState
            icon={<Wrench className="h-5 w-5" />}
          title="Nothing on the books yet"
          description={
            isOwner
              ? "Add the first thing the business owns — a building, a machine, a vehicle. What it cost and where it lives both become reportable."
              : "An owner adds what the business owns. Once they do, it shows up here."
            }
          />
        }
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Asset</TableHead>
              <TableHead>Kind</TableHead>
              {showCompany && <TableHead>Company</TableHead>}
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
                    <RecordPhotoThumb
                      documentId={portraits.get(asset.id)?.id ?? null}
                      alt=""
                    />
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
                {showCompany && (
                  <TableCell className="text-muted-foreground">
                    {/* An em dash for an asset registered before the books were
                        opened: `entity_id` is legitimately null when the tenant
                        has no accounting, and inventing a company here would be
                        a claim the row cannot support. */}
                    {companyName(asset.entityId)}
                  </TableCell>
                )}
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
                    : formatMoney(asset.acquisitionCostCents, currencySymbol)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </DataTable>
    </div>
  );
}
