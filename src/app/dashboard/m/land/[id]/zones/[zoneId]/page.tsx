import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { withTenant } from "@/db";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { todayInTimezone } from "@/lib/timezone";
import { packContext } from "@/lib/packs/tenant-context";
import { labelFor } from "@/lib/packs/resolve";
import { PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
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
  getParcel,
  getZone,
  listOccupancy,
  listZoneUses,
} from "@/packs/land/ops";
import { zoneUseLabel } from "@/packs/land/vocabulary";
import { areaUnitFrom, formatArea } from "@/packs/land/core/area";
import { daysOccupied, formatDays, zoneRest } from "@/packs/land/core/rest";
import { BoundarySummary } from "@/packs/land/components/boundary-summary";
import {
  DeleteOccupancy,
  EndOccupancy,
  RecordOccupancy,
  type OccupancyRow,
} from "@/packs/land/components/occupancy-controls";

export const dynamic = "force-dynamic";

const BASE = "/dashboard/m/land";

/**
 * One zone: what is on it, what has been on it, and how long it has rested.
 *
 * THE REST NUMBER ON THIS PAGE IS COMPUTED, NEVER STORED — the same reasoning
 * `assets` applies to accumulated depreciation. A `rest_days` column would be
 * wrong the moment the clock ticked, and a backdated correction would leave it
 * wrong forever.
 *
 * Nested under the parcel rather than at `/land/z/[zoneId]`, so the URL says
 * where the zone lives and the static-beats-dynamic segment rule never has to
 * be reasoned about.
 */
export default async function ZoneDetailPage({
  params,
}: {
  params: Promise<{ id: string; zoneId: string }>;
}) {
  const { id, zoneId } = await params;
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, "land");

  const today = todayInTimezone(ctx.tenant.timezone);

  const data = await withTenant(
    ctx.tenant.id,
    async (tx) => {
      const zone = await getZone(tx, ctx.tenant.id, zoneId);
      // The zone must actually live on the parcel in the URL, or a guessed
      // path would render somebody's paddock under the wrong deed.
      if (!zone || zone.parcelId !== id) return null;
      const [parcel, stays, uses, pack] = await Promise.all([
        getParcel(tx, ctx.tenant.id, id),
        listOccupancy(tx, ctx.tenant.id, zoneId),
        listZoneUses(tx, ctx.tenant.id, zoneId),
        packContext(tx, ctx.tenant.id, ctx.tenant.industry, "land"),
      ]);
      if (!parcel) return null;
      return { zone, parcel, stays, uses, pack };
    },
    { role: ctx.role },
  );

  if (!data) notFound();
  const { zone, parcel, stays, uses, pack } = data;

  const unit = areaUnitFrom(pack.config);
  const zoneWord = labelFor(pack.labels, "zone", "Zone");
  /**
   * Moving an occupant on or off is a chore — anyone in the workspace records
   * what they just did. Everything structural about the zone is a decision and
   * lives on the parcel page, owner-gated. See src/lib/packs/authorize.ts.
   */

  const rest = zoneRest(
    stays.map((s) => ({ startedOn: s.startedOn, endedOn: s.endedOn })),
    today,
  );
  /**
   * Open AND BEGUN. A stay recorded ahead of time is not something you can
   * move off, and calling it "occupied now" is the same lie `zoneRest` was
   * fixed to stop telling — the headline card reads from `rest`, so without
   * this the two halves of this page would contradict each other.
   */
  const openStay =
    stays.find((s) => s.endedOn === null && s.startedOn <= today) ?? null;
  const currentUse = uses.find((u) => u.endedOn === null) ?? null;

  const rows: OccupancyRow[] = stays.map((s) => ({
    id: s.id,
    occupantLabel: s.occupantLabel,
    startedOn: s.startedOn,
    endedOn: s.endedOn,
    // Null on the record means the whole zone, which is the fixed-paddock case
    // and the majority of records — say so rather than showing an em dash.
    areaLabel: s.areaAcres === null ? null : formatArea(s.areaAcres, unit),
    notes: s.notes,
    daysLabel:
      s.endedOn === null
        ? null
        : formatDays(daysOccupied(s.startedOn, s.endedOn)),
  }));

  const restHeadline =
    rest.status === "occupied"
      ? "Occupied now"
      : rest.status === "never_grazed"
        ? "Never used"
        : formatDays(rest.restDays);

  return (
    <div className="space-y-6">
      <Link
        href={`${BASE}/${parcel.id}`}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" />
        {parcel.name}
      </Link>

      <PageHeader
        title={zone.name}
        description={
          <span className="flex items-center gap-2">
            {formatArea(zone.areaAcres, unit)}
            {currentUse && (
              <>
                {" · "}
                {zoneUseLabel(currentUse.use)}
                {!currentUse.isProductive && (
                  <Badge variant="outline">not productive</Badge>
                )}
              </>
            )}
            {zone.status === "retired" && (
              <Badge variant="outline">retired</Badge>
            )}
          </span>
        }
        actions={
          zone.status === "active" ? (
            <div className="flex items-center gap-2">
              {openStay && (
                <EndOccupancy
                  stay={rows.find((r) => r.id === openStay.id)!}
                  today={today}
                />
              )}
              <RecordOccupancy
                zoneId={zone.id}
                zoneWord={zoneWord}
                unit={unit}
                today={today}
                occupied={openStay !== null}
              />
            </div>
          ) : null
        }
      />

      <BoundarySummary
        target="zone"
        id={zone.id}
        name={zone.name}
        declaredAcres={zone.areaAcres}
        geometry={zone.geometry}
        unit={unit}
        canEdit={ctx.role === "owner" && zone.status === "active"}
      />

      <div className="grid gap-6 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">
              {rest.status === "occupied" ? "Currently" : "Rested"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-medium tabular-nums">{restHeadline}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {rest.status === "occupied"
                ? `${openStay?.occupantLabel} since ${openStay?.startedOn}`
                : rest.status === "never_grazed"
                  ? // Not "infinitely rested". A paddock nobody has used and one
                    // resting 200 days are different facts.
                    "Nothing has been recorded on it yet."
                  : `Since ${rest.restingSince}`}
            </p>
            {parcel.restTargetDays !== null &&
              rest.status === "resting" &&
              rest.restDays !== null && (
                <p className="mt-3 text-sm text-muted-foreground">
                  {/* A comparison line, never a rule. Nothing is refused for
                      being under target. */}
                  Target on this parcel is {parcel.restTargetDays} days —{" "}
                  {rest.restDays >= parcel.restTargetDays
                    ? "met"
                    : `${parcel.restTargetDays - rest.restDays} short`}
                  .
                </p>
              )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Grazing days</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-medium tabular-nums">
              {rest.grazingDays}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Across {rest.stays} {rest.stays === 1 ? "stay" : "stays"}, all
              time.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">What it is for</CardTitle>
          </CardHeader>
          <CardContent>
            {uses.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nothing declared yet.
              </p>
            ) : (
              <ul className="space-y-1 text-sm">
                {uses.slice(0, 5).map((use) => (
                  <li key={use.id} className="tabular-nums">
                    <span className="text-muted-foreground">
                      {use.startedOn} – {use.endedOn ?? "now"}
                    </span>{" "}
                    {zoneUseLabel(use.use)}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="space-y-3">
        <h2 className="text-sm font-medium">
          Stays {rows.length > 0 && `(${rows.length})`}
        </h2>
        {rows.length === 0 ? (
          <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
            Nothing recorded yet. Every rest and rotation figure is computed
            from these, so the first one is what makes the rest of the page
            work.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>What</TableHead>
                <TableHead>On</TableHead>
                <TableHead>Off</TableHead>
                <TableHead className="text-right">Days</TableHead>
                <TableHead className="text-right">Area used</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-medium">
                    {row.occupantLabel}
                    {row.notes && (
                      <div className="text-xs text-muted-foreground">
                        {row.notes}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="tabular-nums text-muted-foreground">
                    {row.startedOn}
                  </TableCell>
                  <TableCell className="tabular-nums text-muted-foreground">
                    {row.endedOn ??
                      (row.startedOn > today ? (
                        // Recorded ahead. "Still on it" would claim a herd is
                        // standing on ground it has not reached, and this row
                        // is the only place that distinction is visible.
                        <Badge variant="outline">not yet</Badge>
                      ) : (
                        <Badge variant="outline">still on it</Badge>
                      ))}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {row.daysLabel ?? "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {row.areaLabel ?? "all of it"}
                  </TableCell>
                  <TableCell className="text-right">
                    <DeleteOccupancy stay={row} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}
