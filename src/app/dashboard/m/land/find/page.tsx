import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { withTenant } from "@/db";
import { requireTenantOwner } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { packContext } from "@/lib/packs/tenant-context";
import { PageHeader } from "@/components/app/page-header";
import { areaUnitFrom } from "@/packs/land/core/area";
import {
  PARCEL_SOURCES,
  parcelRegionFrom,
  parcelSourceFrom,
} from "@/packs/land/core/parcel-lookup";
import { ParcelFinder } from "@/packs/land/components/parcel-finder";

export const dynamic = "force-dynamic";

const BASE = "/dashboard/m/land";

/**
 * Land 2a.1b — the entry path the founder asked for two slices ago.
 *
 * **OWNER-ONLY, because everything this page does ends in a parcel**, and a
 * parcel is a cost object. `requireTenantOwner` rather than a UI check: the
 * import action enforces it too, and a page that renders a form nobody may
 * submit is a worse answer than one that is not there.
 *
 * **The source is PICKED here rather than configured**, and that is deliberate
 * for now: `packConfig` has no editing surface yet — the same gap `assets`
 * records for its depreciation accounts — so requiring config would have made
 * this feature unreachable for the only tenant that wants it. A pinned config
 * value still wins when one exists.
 */
export default async function FindParcelsPage() {
  const ctx = await requireTenantOwner();
  await requireModuleEnabled(ctx.tenant.id, "land");

  const pack = await withTenant(
    ctx.tenant.id,
    (tx) => packContext(tx, ctx.tenant.id, ctx.tenant.industry, "land"),
    { role: ctx.role },
  );

  const pinned = parcelSourceFrom(pack.config);
  const sources = pinned ? [pinned] : PARCEL_SOURCES;
  if (sources.length === 0) notFound();

  return (
    <div className="space-y-6">
      <Link
        href={BASE}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" />
        All land
      </Link>

      <PageHeader
        title="Find my parcels"
        description="The county has already drawn your boundaries. Take the ones that are yours, with their acreage, and trace paddocks inside them afterwards."
      />

      <ParcelFinder
        sources={sources.map((source) => ({
          id: source.id,
          label: source.label,
          regionLabel: source.regionLabel,
          needsRegion: source.regionField !== null,
        }))}
        defaultRegion={parcelRegionFrom(pack.config)}
        unit={areaUnitFrom(pack.config)}
      />
    </div>
  );
}
