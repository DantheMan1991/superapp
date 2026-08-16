import Link from "next/link";
import { Map } from "lucide-react";
import { withTenant } from "@/db";
import type { TenantContext } from "@/lib/auth";
import { packContext } from "@/lib/packs/tenant-context";
import { labelFor } from "@/lib/packs/resolve";
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
import { listParcels, zoneCountsByParcel } from "./ops";
import { TENURE_LABELS, isTenure } from "./vocabulary";
import {
  areaUnitFrom,
  formatArea,
  formatAreaTotal,
  totalArea,
} from "./core/area";
import { ParcelForm } from "./components/parcel-form";

/**
 * The `land` pack's home: parcels, and what is inside each.
 *
 * LIST-FIRST, WITH A MAP LATER. 20 paddocks now and ~200 at 10× is a list, and
 * the design was explicit that the pack must not be gated on the map being
 * finished. Geometry is slice 2; nothing here waits for it.
 *
 * This is also the first pack surface to READ ITS TENANT'S VOCABULARY. A
 * homestead calls a zone a paddock, and `resolveLabels` has been built, tested
 * and unread since Layer 2 shipped because no pack had a word worth
 * overriding. `labelFor` falls back to the core word, so a tenant with no
 * profile installed sees "Zones" and nothing throws.
 */
export async function LandModule({
  ctx,
  searchParams,
}: {
  ctx: TenantContext;
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const showRetired = searchParams.retired === "1";

  const { parcels, zoneCounts, labels, config } = await withTenant(
    ctx.tenant.id,
    async (tx) => {
      const [parcels, zoneCounts, pack] = await Promise.all([
        listParcels(tx, ctx.tenant.id, {
          // Retired ground stays in the books forever but is noise in the list,
          // so it is opt-in rather than filtered out of existence.
          status: showRetired ? undefined : "active",
        }),
        zoneCountsByParcel(tx, ctx.tenant.id),
        packContext(tx, ctx.tenant.id, ctx.tenant.industry, "land"),
      ]);
      return {
        parcels,
        zoneCounts,
        labels: pack.labels,
        config: pack.config,
      };
    },
    { role: ctx.role },
  );

  const unit = areaUnitFrom(config);
  const parcelWord = labelFor(labels, "parcel", "Parcel");
  const zoneWord = labelFor(labels, "zone", "Zone");
  const zonesWord = `${zoneWord}s`;
  const isOwner = ctx.role === "owner";

  const total = totalArea(parcels.map((p) => p.areaAcres));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Land"
        description={
          parcels.length > 0
            ? `${parcels.length} ${parcels.length === 1 ? parcelWord.toLowerCase() : `${parcelWord.toLowerCase()}s`} · ${formatAreaTotal(total, unit)}`
            : "The ground the business holds, and what each part of it is for."
        }
        actions={isOwner ? <ParcelForm unit={unit} /> : null}
      />

      {parcels.length === 0 ? (
        <EmptyState
          panel
          icon={<Map className="h-5 w-5" />}
          title="No ground recorded yet"
          description={
            isOwner
              ? `Add the first ${parcelWord.toLowerCase()} — a deed or a lease. Divide it into ${zonesWord.toLowerCase()} and everything that happens on the ground has somewhere to land.`
              : "An owner adds the parcels the business holds. Once they do, they show up here."
          }
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{parcelWord}</TableHead>
              <TableHead>Tenure</TableHead>
              <TableHead className="text-right">{zonesWord}</TableHead>
              <TableHead className="text-right">Area</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {parcels.map((parcel) => (
              <TableRow key={parcel.id}>
                <TableCell>
                  <div className="flex items-center gap-2 font-medium">
                    <Link
                      href={`/dashboard/m/land/${parcel.id}`}
                      className="hover:underline"
                    >
                      {parcel.name}
                    </Link>
                    {parcel.status === "retired" && (
                      <Badge variant="outline">retired</Badge>
                    )}
                  </div>
                  {parcel.identifier && (
                    <div className="text-xs text-muted-foreground">
                      {parcel.identifier}
                    </div>
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {isTenure(parcel.tenure)
                    ? TENURE_LABELS[parcel.tenure]
                    : parcel.tenure}
                </TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">
                  {zoneCounts.get(parcel.id) ?? 0}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {/* Blank, not zero. Nobody owns zero acres; they own ground
                      nobody has measured, and a zero here would divide into
                      every per-acre figure downstream. */}
                  {formatArea(parcel.areaAcres, unit)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
