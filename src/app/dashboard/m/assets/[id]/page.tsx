import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { withTenant } from "@/db";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { formatCents } from "@/lib/money";
import { todayInTimezone } from "@/lib/timezone";
import { PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  getAsset,
  listChildren,
  listContainerCandidates,
  listKindsInUse,
} from "@/packs/assets/ops";
import { assetKindLabel } from "@/packs/assets/vocabulary";
import {
  AssetControls,
  type AssetDetailView,
} from "@/packs/assets/components/asset-controls";

export const dynamic = "force-dynamic";

const BASE = "/dashboard/m/assets";

/**
 * One asset.
 *
 * A PACK'S SUB-ROUTE LIVES IN `src/app/`, not in `src/packs/`. That is the same
 * arrangement core modules have — the renderer is in the module, the route file
 * is here — because Next resolves routes from the app directory and nothing
 * about a pack changes that. The pack still owns everything this page does; the
 * file is a thin entry point that guards and delegates.
 *
 * `requireModuleEnabled` is not optional here. A route file is reachable by URL
 * whether or not the pack is switched on for the tenant, so the guard is what
 * makes "switched off" mean something.
 */
export default async function AssetDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, "assets");

  const data = await withTenant(
    ctx.tenant.id,
    async (tx) => {
      const asset = await getAsset(tx, ctx.tenant.id, id);
      if (!asset) return null;
      const [parent, children, containers, kinds] = await Promise.all([
        asset.parentId ? getAsset(tx, ctx.tenant.id, asset.parentId) : null,
        listChildren(tx, ctx.tenant.id, asset.id),
        // Excludes this asset AND its descendants, so the picker cannot offer
        // a cycle. The refusal in ops.ts stays as the backstop.
        listContainerCandidates(tx, ctx.tenant.id, asset.id),
        listKindsInUse(tx, ctx.tenant.id),
      ]);
      return { asset, parent, children, containers, kinds };
    },
    { role: ctx.role },
  );

  if (!data) notFound();
  const { asset, parent, children, containers, kinds } = data;
  const isOwner = ctx.role === "owner";

  const view: AssetDetailView = {
    id: asset.id,
    name: asset.name,
    kind: asset.kind,
    identifier: asset.identifier,
    status: asset.status,
    acquiredOn: asset.acquiredOn,
    // Cents on the wire, dollars in the field. Empty string rather than "0"
    // when unknown — the two are different facts.
    costInput:
      asset.acquisitionCostCents === null
        ? ""
        : (asset.acquisitionCostCents / 100).toFixed(2),
    parentId: asset.parentId,
    notes: asset.notes,
  };

  return (
    <div className="space-y-6">
      <Link
        href={BASE}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" />
        All assets
      </Link>

      <PageHeader
        title={asset.name}
        description={
          <span className="flex items-center gap-2">
            {assetKindLabel(asset.kind)}
            {asset.status === "disposed" && (
              <Badge variant="outline">
                disposed {asset.disposedOn ?? ""}
              </Badge>
            )}
          </span>
        }
        actions={
          isOwner ? (
            <AssetControls
              asset={view}
              containers={containers.map((c) => ({ id: c.id, name: c.name }))}
              kindsInUse={kinds.map((k) => k.kind)}
              // The tenant's today, never the browser's, so two people in one
              // workspace agree what "today" means on a disposal.
              today={todayInTimezone(ctx.tenant.timezone)}
            />
          ) : null
        }
      />

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Details</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-[9rem_1fr] gap-y-3 text-sm">
              <dt className="text-muted-foreground">Serial or tag</dt>
              <dd>{asset.identifier || "—"}</dd>

              <dt className="text-muted-foreground">Acquired</dt>
              <dd className="tabular-nums">{asset.acquiredOn ?? "—"}</dd>

              <dt className="text-muted-foreground">Cost</dt>
              <dd className="tabular-nums">
                {asset.acquisitionCostCents === null
                  ? "—"
                  : formatCents(asset.acquisitionCostCents)}
              </dd>

              <dt className="text-muted-foreground">Kept in</dt>
              <dd>
                {parent ? (
                  <Link
                    href={`${BASE}/${parent.id}`}
                    className="hover:underline"
                  >
                    {parent.name}
                  </Link>
                ) : (
                  "—"
                )}
              </dd>

              {asset.notes && (
                <>
                  <dt className="text-muted-foreground">Notes</dt>
                  <dd className="whitespace-pre-wrap">{asset.notes}</dd>
                </>
              )}
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">
              Contains {children.length > 0 && `(${children.length})`}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {children.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nothing is kept in this one.
              </p>
            ) : (
              <ul className="space-y-2 text-sm">
                {children.map((child) => (
                  <li key={child.id} className="flex items-center gap-2">
                    <Link
                      href={`${BASE}/${child.id}`}
                      className="font-medium hover:underline"
                    >
                      {child.name}
                    </Link>
                    <span className="text-muted-foreground">
                      {assetKindLabel(child.kind)}
                    </span>
                    {child.status === "disposed" && (
                      <Badge variant="outline">disposed</Badge>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
