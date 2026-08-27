import Link from "next/link";
import { Map as MapIcon, Search } from "lucide-react";
import { withTenant } from "@/db";
import type { TenantContext } from "@/lib/auth";
import { packContext } from "@/lib/packs/tenant-context";
import { labelFor } from "@/lib/packs/resolve";
import { Button } from "@/components/ui/button";
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
import { listParcels, mappedZoneCount, zoneCountsByParcel } from "./ops";
import { TENURE_LABELS, isTenure } from "./vocabulary";
import { PARCEL_SOURCES, parcelSourceFrom } from "./core/parcel-lookup";
import { WhereAmIShortcut } from "./components/where-am-i";
import { CombineParcelsBar } from "./components/combine-parcels";

const BASE = "/dashboard/m/land";
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

  const { parcels, zoneCounts, mapped, labels, config } = await withTenant(
    ctx.tenant.id,
    async (tx) => {
      const [parcels, zoneCounts, mapped, pack] = await Promise.all([
        listParcels(tx, ctx.tenant.id, {
          // Retired ground stays in the books forever but is noise in the list,
          // so it is opt-in rather than filtered out of existence.
          status: showRetired ? undefined : "active",
        }),
        zoneCountsByParcel(tx, ctx.tenant.id),
        mappedZoneCount(tx, ctx.tenant.id),
        packContext(tx, ctx.tenant.id, ctx.tenant.industry, "land"),
      ]);
      return {
        parcels,
        zoneCounts,
        mapped,
        labels: pack.labels,
        config: pack.config,
      };
    },
    { role: ctx.role },
  );

  const unit = areaUnitFrom(config);
  /** No boundaries, no answer — see the button below. */
  const hasGeometry = mapped > 0;
  /**
   * **THE BUTTON MUST FOLLOW THE PAGE, NOT THE CONFIG.** This was gated on a
   * PINNED source while `/land/find` itself falls back to letting the person
   * pick one — so on a tenant with no `packConfig` the page worked perfectly
   * and nothing linked to it. Found by driving it: the only way in was typing
   * the URL. The condition is now the same one the page uses.
   */
  const hasParcelSource = parcelSourceFrom(config) !== null || PARCEL_SOURCES.length > 0;
  const parcelWord = labelFor(labels, "parcel", "Parcel");
  const zoneWord = labelFor(labels, "zone", "Zone");
  const zonesWord = `${zoneWord}s`;
  const isOwner = ctx.role === "owner";

  const total = totalArea(parcels.map((p) => p.areaAcres));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Land"
        icon={<MapIcon />}
        description={
          parcels.length > 0
            ? `${parcels.length} ${parcels.length === 1 ? parcelWord.toLowerCase() : `${parcelWord.toLowerCase()}s`} · ${formatAreaTotal(total, unit)}`
            : "The ground the business holds, and what each part of it is for."
        }
        actions={
          isOwner ? (
            <div className="flex flex-wrap items-center gap-2">
              {/* Only useful once something is mapped, and honest about it:
                  offering it against a farm with no boundaries would answer
                  "not inside any paddock" every time. */}
              {/* A STRING, NEVER A FUNCTION. This is a Server Component and
                  `WhereAmIShortcut` is a client one, so a `zoneHref` builder
                  could not be serialised and threw on render — taking the
                  whole page down for any farm that had traced a boundary. */}
              {hasGeometry && <WhereAmIShortcut basePath={BASE} />}
              {/* Only when a source covers this tenant. A button that leads to
                  a 404 is worse than no button. */}
              {hasParcelSource && (
                <Button asChild variant="outline">
                  <Link href={`${BASE}/find`}>
                    <Search className="mr-2 h-4 w-4" />
                    Find my parcels
                  </Link>
                </Button>
              )}
              <ParcelForm unit={unit} />
            </div>
          ) : null
        }
      />

      {/* Two deeds are frequently one block of ground, and a zone belongs to
          exactly one parcel — so combining is what makes a fence line that
          crosses a deed boundary drawable at all. */}
      {isOwner && parcels.length > 1 && (
        <CombineParcelsBar
          unit={unit}
          parcels={parcels.map((parcel) => ({
            id: parcel.id,
            name: parcel.name,
            identifier: parcel.identifier,
            areaAcres: parcel.areaAcres,
            zoneCount: zoneCounts.get(parcel.id) ?? 0,
          }))}
        />
      )}

      <DataTable
        isEmpty={parcels.length === 0}
        empty={
          <EmptyState
            icon={<MapIcon className="h-5 w-5" />}
          title="No ground recorded yet"
          description={
            isOwner
              ? `Add the first ${parcelWord.toLowerCase()} — a deed or a lease. Divide it into ${zonesWord.toLowerCase()} and everything that happens on the ground has somewhere to land.`
              : "An owner adds the parcels the business holds. Once they do, they show up here."
            }
          />
        }
      >
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
      </DataTable>
    </div>
  );
}
