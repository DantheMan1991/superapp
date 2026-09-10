import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, Map as MapIcon } from "lucide-react";
import { withTenant } from "@/db";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { todayInTimezone } from "@/lib/timezone";
import { packContext } from "@/lib/packs/tenant-context";
import { labelFor } from "@/lib/packs/resolve";
import { PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/app/data-table";
import { EmptyState } from "@/components/app/empty-state";
import { Panel } from "@/components/app/panel";
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
  listZones,
  occupantLabelsUsed,
  openStaysOnParcel,
} from "@/packs/land/ops";
import { zoneUseLabel } from "@/packs/land/vocabulary";
import { areaUnitFrom, formatArea } from "@/packs/land/core/area";
import { asFeatureGeometry } from "@/packs/land/core/geo";
import { lengthUnitFrom } from "@/packs/land/core/length";
import { NavigateTo } from "@/packs/land/components/navigate-to";
import { daysOccupied, formatDays, zoneRest } from "@/packs/land/core/rest";
import { BoundarySummary } from "@/packs/land/components/boundary-summary";
import { MoveOccupant } from "@/packs/land/components/move-occupant";
import { UnretireZone } from "@/packs/land/components/unretire-controls";
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
      // The neighbouring paddocks were only ever context for the map that used
      // to live here; they are drawn on the parcel's site plan now, so this
      // page no longer loads them.
      const [parcel, stays, uses, pack, onParcel, siblings, namesUsed] =
        await Promise.all([
          getParcel(tx, ctx.tenant.id, id),
          listOccupancy(tx, ctx.tenant.id, zoneId),
          listZoneUses(tx, ctx.tenant.id, zoneId),
          packContext(tx, ctx.tenant.id, ctx.tenant.industry, "land"),
          // What is on this whole parcel today, so a move can name a ROW
          // rather than a name that has to match. See `moveOccupantAction`.
          openStaysOnParcel(tx, ctx.tenant.id, id, today),
          listZones(tx, ctx.tenant.id, { parcelId: id, status: "active" }),
          // Names this ground has carried, for the datalist on Record a stay.
          occupantLabelsUsed(tx, ctx.tenant.id, id),
        ]);
      if (!parcel) return null;
      return {
        zone,
        parcel,
        stays,
        uses,
        pack,
        onParcel,
        siblings,
        namesUsed,
      };
    },
    { role: ctx.role },
  );

  if (!data) notFound();
  const { zone, parcel, stays, uses, pack, onParcel, siblings, namesUsed } =
    data;

  const unit = areaUnitFrom(pack.config);
  /** Null when nobody has drawn it — there is nowhere to be walked to. */
  const navigable = asFeatureGeometry(zone.geometry);
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
        icon={<MapIcon />}
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
            <div className="flex flex-wrap items-center gap-2">
              {/*
                **ONE DIRECTION AT A TIME, and which one follows from the
                state.** While something is on this ground the useful act is
                "where are they going"; while nothing is, it is "what is coming
                here" — which is the field flow, because `Which paddock am I
                in?` lands you on the paddock you just let them into. Offering
                both at once would put four buttons in a 375px header to say
                one thing twice.
              */}
              {openStay ? (
                <MoveOccupant
                  mode="away"
                  zoneId={zone.id}
                  zoneName={zone.name}
                  zoneWord={zoneWord}
                  stays={onParcel.filter((s) => s.zoneId === zone.id)}
                  targets={siblings
                    .filter((z) => z.id !== zone.id)
                    .map((z) => ({ id: z.id, name: z.name }))}
                  unit={unit}
                  today={today}
                />
              ) : (
                onParcel.length > 0 && (
                  <MoveOccupant
                    mode="here"
                    zoneId={zone.id}
                    zoneName={zone.name}
                    zoneWord={zoneWord}
                    stays={onParcel.filter((s) => s.zoneId !== zone.id)}
                    targets={[]}
                    unit={unit}
                    today={today}
                  />
                )
              )}
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
                namesUsed={namesUsed}
              />
            </div>
          ) : ctx.role === "owner" && parcel.status === "active" ? (
            // Retired, and this is where somebody lands from a link. The way
            // back has to be here or the page is a dead end.
            <UnretireZone
              id={zone.id}
              name={zone.name}
              zoneWord={zoneWord}
              trigger="header"
            />
          ) : null
        }
      />

      {/*
        NO MAP HERE SINCE 2026-08-29. This outline is traced on the parcel's
        site plan — click the paddock there and the toolbar offers it — which is
        the same act on the same geometry as tracing the parcel itself. Keeping
        a second map on this page to do that one job was the last of the
        duplication the pack carried.

        What stays is the READING: measured against recorded, and the sentence
        about why they are allowed to disagree. Plus the paste box, for a county
        export that beats anything traced by hand.
      */}
      <BoundarySummary
        target="zone"
        id={zone.id}
        name={zone.name}
        declaredAcres={zone.areaAcres}
        geometry={zone.geometry}
        unit={unit}
        canEdit={ctx.role === "owner" && zone.status === "active"}
        drawnAt={`${BASE}/${parcel.id}#site-plan`}
      />

      {/*
        **WALKING TO THE GROUND ITSELF, WHICH NOTHING COULD DO BEFORE.** The
        navigator handled polygons from its first commit — a ring's corners are
        the posts — and the only button that opened it was on a feature. This is
        also where `Which paddock am I in?` lands, so it is the page somebody is
        already on when they want to reach the next one.

        Not owner-gated and not status-gated: walking to a corner changes
        nothing, and a retired paddock is still somewhere you might have to go.
      */}
      {navigable && (
        <Panel className="p-5">
          <h2 className="font-heading text-base font-semibold tracking-heading">
            Walk to it
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Its corners, nearest first. Nothing is recorded about where you were.
          </p>
          <div className="mt-3">
            <NavigateTo
              name={zone.name}
              geometry={navigable}
              lengthUnit={lengthUnitFrom(pack.config)}
            />
          </div>
        </Panel>
      )}

      <div className="grid gap-6 md:grid-cols-3">
        <Panel className="p-5">
          <h2 className="font-heading text-base font-semibold tracking-heading">
              {rest.status === "occupied" ? "Currently" : "Rested"}
            </h2>
          <div className="mt-3">
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
          </div>
        </Panel>

        <Panel className="p-5">
          <h2 className="font-heading text-base font-semibold tracking-heading">Grazing days</h2>
          <div className="mt-3">
            <p className="text-2xl font-medium tabular-nums">
              {rest.grazingDays}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Across {rest.stays} {rest.stays === 1 ? "stay" : "stays"}, all
              time.
            </p>
          </div>
        </Panel>

        <Panel className="p-5">
          <h2 className="font-heading text-base font-semibold tracking-heading">What it is for</h2>
          <div className="mt-3">
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
          </div>
        </Panel>
      </div>

      <div className="space-y-3">
        <h2 className="text-sm font-medium">
          Stays {rows.length > 0 && `(${rows.length})`}
        </h2>
        <DataTable
          isEmpty={rows.length === 0}
          empty={
            <EmptyState
              title="Nothing recorded yet"
              description="Every rest and rotation figure is computed from these, so the first one is what makes the rest of the page work."
            />
          }
        >
          {/*
            Phone: a card per stay.

            The table is 533px in a 343px column at 375 — `Area used` starts at
            x=374 and `Remove` lands at x=466, ninety-one pixels past the edge
            of the screen. Taking a stay off that never happened is a
            correction somebody makes from wherever they are, and it was the
            furthest-away control in the pack.
          */}
          <ul className="space-y-3 md:hidden">
            {rows.map((row) => (
              <li
                key={row.id}
                className="rounded-2xl bg-card p-4 shadow-elevation-1"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{row.occupantLabel}</p>
                    <p className="mt-0.5 text-xs tabular-nums text-muted-foreground">
                      {row.startedOn} –{" "}
                      {row.endedOn ??
                        (row.startedOn > today ? "not yet" : "still on it")}
                    </p>
                  </div>
                  <p className="shrink-0 text-right tabular-nums">
                    {row.daysLabel ?? (
                      <Badge variant="outline">
                        {row.startedOn > today ? "not yet" : "still on it"}
                      </Badge>
                    )}
                  </p>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  {row.areaLabel ?? "all of it"}
                  {row.notes && ` · ${row.notes}`}
                </p>
                <div className="mt-2 flex justify-end">
                  <DeleteOccupancy stay={row} />
                </div>
              </li>
            ))}
          </ul>

          <div className="hidden md:block">
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
          </div>
        </DataTable>
      </div>
    </div>
  );
}
