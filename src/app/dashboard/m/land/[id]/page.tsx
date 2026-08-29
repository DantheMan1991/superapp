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
  completedStayDays,
  currentUses,
  getParcel,
  listFeatures,
  listPlanItems,
  listPlans,
  listUsesInUse,
  listZones,
  restByZone,
  usesByZone,
} from "@/packs/land/ops";
import { asBoundary, asFeatureGeometry } from "@/packs/land/core/geo";
import {
  availableFeatureKinds,
  isFeatureStatus,
  readAttributes,
} from "@/packs/land/core/features";
import { basemapFrom } from "@/packs/land/core/basemap";
import { lengthUnitFrom } from "@/packs/land/core/length";
import { SitePlan } from "@/packs/land/components/site-plan";
import { formatDays, rotationFinding } from "@/packs/land/core/rest";
import {
  TENURE_LABELS,
  isTenure,
  zoneUseLabel,
} from "@/packs/land/vocabulary";
import {
  areaUnitFrom,
  formatArea,
  formatAreaTotal,
  fromAcres,
  zoneCoverage,
} from "@/packs/land/core/area";
import {
  ParcelControls,
  type ParcelDetailView,
} from "@/packs/land/components/parcel-controls";
import { ZoneForm } from "@/packs/land/components/zone-form";
import { PaddockLayout } from "@/packs/land/components/paddock-layout";
import { PlannedZones } from "@/packs/land/components/planned-zones";
import { PlanTakeoff } from "@/packs/land/components/plan-takeoff";
import { ZoneControls } from "@/packs/land/components/zone-controls";
import { BoundarySummary } from "@/packs/land/components/boundary-summary";

export const dynamic = "force-dynamic";

const BASE = "/dashboard/m/land";

/**
 * One parcel, and the zones inside it.
 *
 * A PACK'S SUB-ROUTE LIVES IN `src/app/`, not in `src/packs/` — same
 * arrangement core modules have, because Next resolves routes from the app
 * directory and nothing about a pack changes that. The pack still owns
 * everything this page does; the file is a thin entry point that guards and
 * delegates.
 *
 * `requireModuleEnabled` is not optional here. A route file is reachable by URL
 * whether or not the pack is switched on for the tenant, so the guard is what
 * makes "switched off" mean something.
 */
export default async function ParcelDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, "land");

  // The tenant's today, never the server's or the browser's, so two people in
  // one workspace agree what day a use started on.
  const today = todayInTimezone(ctx.tenant.timezone);

  const data = await withTenant(
    ctx.tenant.id,
    async (tx) => {
      const parcel = await getParcel(tx, ctx.tenant.id, id);
      if (!parcel) return null;
      const zones = await listZones(tx, ctx.tenant.id, {
        parcelId: id,
        status: "active",
      });
      /**
       * Ground a layout proposed and nobody has fenced yet (slice 2b.2).
       *
       * A SEPARATE READ, NOT A WIDENED ONE. Every figure below — rest, the
       * paddock count, the rotation arithmetic, `zoneCoverage` — is about
       * ground that exists, and folding planned rows into `zones` would put
       * unfenced acres into all of them at once. It travels on its own so the
       * only things that see it are the plan and its own list.
       */
      const plannedZones = await listZones(tx, ctx.tenant.id, {
        parcelId: id,
        status: "planned",
      });
      const zoneIds = zones.map((z) => z.id);
      const [current, history, usesInUse, pack, rest, stayDays, features, plans] =
        await Promise.all([
          currentUses(tx, ctx.tenant.id, zoneIds),
          usesByZone(tx, ctx.tenant.id, zoneIds),
          listUsesInUse(tx, ctx.tenant.id),
          packContext(tx, ctx.tenant.id, ctx.tenant.industry, "land"),
          restByZone(tx, ctx.tenant.id, zoneIds, today),
          completedStayDays(tx, ctx.tenant.id, id, today),
          // EVERY status, `removed` included. The list filters history out
          // behind a toggle; the map dims it. Filtering here would make the
          // toggle a second round trip for data the page already had.
          listFeatures(tx, ctx.tenant.id, { parcelId: id }),
          // Plans and their saved lists (slice 2b.4). Loaded together because
          // a plan with no list and a plan whose list has drifted look
          // different on screen, and both need the items to tell.
          listPlans(tx, ctx.tenant.id, { parcelId: id }),
        ]);
      const planItems = await Promise.all(
        plans.map((plan) => listPlanItems(tx, ctx.tenant.id, plan.id)),
      );
      return {
        parcel,
        zones,
        plannedZones,
        current,
        history,
        usesInUse,
        pack,
        rest,
        stayDays,
        features,
        plans,
        planItems,
      };
    },
    { role: ctx.role },
  );

  if (!data) notFound();
  const {
    parcel,
    zones,
    plannedZones,
    current,
    history,
    usesInUse,
    pack,
    rest,
    stayDays,
    features,
    plans,
    planItems,
  } = data;

  // The finding this whole category was argued for. Returns null rather than
  // guessing when there is not enough history — a rotation figure computed
  // from one stay is noise wearing a decimal point.
  const rotation = rotationFinding({
    paddocks: zones.length,
    restTargetDays: parcel.restTargetDays,
    staysDays: stayDays,
  });

  const unit = areaUnitFrom(pack.config);
  const zoneWord = labelFor(pack.labels, "zone", "Zone");
  const isOwner = ctx.role === "owner";

  const coverage = zoneCoverage(
    parcel.areaAcres,
    zones.map((z) => z.areaAcres),
  );

  const view: ParcelDetailView = {
    id: parcel.id,
    name: parcel.name,
    tenure: parcel.tenure,
    // Acres in the column, the tenant's unit in the field. Empty string rather
    // than "0" when unknown — the two are different facts.
    areaInput:
      parcel.areaAcres === null
        ? ""
        : String(fromAcres(parcel.areaAcres, unit)),
    identifier: parcel.identifier,
    notes: parcel.notes,
    status: parcel.status,
    activeZones: zones.length,
    restTargetInput:
      parcel.restTargetDays === null ? "" : String(parcel.restTargetDays),
  };

  // The chronological read across the whole parcel, derived from the same
  // fetch the per-zone dialogs use rather than a second query.
  const zoneNames = new Map(zones.map((z) => [z.id, z.name]));
  const changes = [...history.values()]
    .flat()
    .sort((a, b) =>
      a.startedOn === b.startedOn
        ? b.createdAt.getTime() - a.createdAt.getTime()
        : b.startedOn.localeCompare(a.startedOn),
    )
    .slice(0, 12);

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
        icon={<MapIcon />}
        title={parcel.name}
        description={
          <span className="flex items-center gap-2">
            {isTenure(parcel.tenure)
              ? TENURE_LABELS[parcel.tenure]
              : parcel.tenure}
            {" · "}
            {formatArea(parcel.areaAcres, unit)}
            {parcel.status === "retired" && (
              <Badge variant="outline">retired</Badge>
            )}
          </span>
        }
        actions={
          isOwner ? (
            <ParcelControls parcel={view} unit={unit} zoneWord={zoneWord} />
          ) : null
        }
      />

      <BoundarySummary
        target="parcel"
        id={parcel.id}
        name={parcel.name}
        declaredAcres={parcel.areaAcres}
        geometry={parcel.geometry}
        unit={unit}
        canEdit={isOwner && parcel.status === "active"}
        // The site plan below draws the boundary now. What is left here is the
        // reading — measured against recorded — and the paste box.
        drawnAt="#site-plan"
      />

      <Panel className="p-5">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="font-heading text-base font-semibold tracking-heading">
            Site plan
          </h2>
          <p className="text-xs text-muted-foreground">
            What is on the ground — and what is only proposed.
          </p>
        </div>
        <div className="mt-4">
          <SitePlan
            parcelId={parcel.id}
            parcelBoundary={asBoundary(parcel.geometry)}
            zones={[...zones, ...plannedZones].map((zone) => ({
              id: zone.id,
              name: zone.name,
              geometry: zone.geometry,
              status: zone.status,
              areaAcres: zone.areaAcres,
            }))}
            features={features.map((feature) => ({
              id: feature.id,
              kind: feature.kind,
              name: feature.name,
              status: isFeatureStatus(feature.status) ? feature.status : "built",
              geometry: feature.geometry,
              notes: feature.notes,
              // jsonb with no shape constraint, so the bag is read through the
              // same total-by-construction discipline as everything else here.
              attributes: readAttributes(feature.attributes),
              fedById: feature.fedById,
              lineWidth: feature.lineWidth,
            }))}
            kinds={availableFeatureKinds(pack.config)}
            basemap={basemapFrom(pack.config)}
            areaUnit={unit}
            lengthUnit={lengthUnitFrom(pack.config)}
            // A CHORE, NOT A DECISION — see the ops comment. Drawing the fence
            // you just built is not the owner's job, so this is not `isOwner`.
            canEdit={parcel.status === "active"}
            // The OUTLINE is a different matter: it is what the deed says and
            // what every acreage divides by, so it stays the owner's.
            canEditBoundary={isOwner && parcel.status === "active"}
            parcelName={parcel.name}
            declaredAcres={parcel.areaAcres}
          />
        </div>
      </Panel>

      {plans.length > 0 && (
        <Panel className="p-5">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="font-heading text-base font-semibold tracking-heading">
              What it will take
            </h2>
            <p className="text-xs text-muted-foreground">
              Counted off the drawing. Nothing here is guessed.
            </p>
          </div>
          <div className="mt-4 space-y-4">
            {plans.map((plan, index) => (
              <PlanTakeoff
                key={plan.id}
                lengthUnit={lengthUnitFrom(pack.config)}
                canEdit={isOwner && parcel.status === "active"}
                plan={{
                  id: plan.id,
                  name: plan.name,
                  takenOffAt: plan.takenOffAt
                    ? plan.takenOffAt.toISOString()
                    : null,
                  features: features
                    .filter((feature) => feature.planId === plan.id)
                    .map((feature) => ({
                      id: feature.id,
                      name: feature.name,
                      kind: feature.kind,
                      geometry: asFeatureGeometry(feature.geometry),
                      attributes: readAttributes(feature.attributes),
                    })),
                  items: planItems[index].map((item) => ({
                    id: item.id,
                    material: item.material,
                    label: item.label,
                    quantity: item.quantity,
                    unit: item.unit,
                    unitCost: item.unitCost,
                    sourceFeatureId: item.sourceFeatureId,
                  })),
                }}
              />
            ))}
          </div>
        </Panel>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        <Panel className="p-5">
          <h2 className="font-heading text-base font-semibold tracking-heading">Details</h2>
          <div className="mt-3">
            <dl className="grid grid-cols-[10rem_1fr] gap-y-3 text-sm">
              <dt className="text-muted-foreground">Tenure</dt>
              <dd>
                {isTenure(parcel.tenure)
                  ? TENURE_LABELS[parcel.tenure]
                  : parcel.tenure}
              </dd>

              <dt className="text-muted-foreground">Deed or lease</dt>
              <dd>{parcel.identifier || "—"}</dd>

              <dt className="text-muted-foreground">Area</dt>
              <dd className="tabular-nums">
                {formatArea(parcel.areaAcres, unit)}
              </dd>

              <dt className="text-muted-foreground">
                In {zoneWord.toLowerCase()}s
              </dt>
              <dd className="tabular-nums">
                {formatAreaTotal(coverage.assigned, unit)}
              </dd>

              {/* Zones do not have to tile a parcel — lanes, ditches and the
                  bit behind the barn are real and frequently unmapped — so
                  this reports the difference and never enforces it. */}
              {coverage.unassignedAcres !== null && (
                <>
                  <dt className="text-muted-foreground">
                    {coverage.overAssigned ? "Over by" : "Not divided up"}
                  </dt>
                  <dd className="tabular-nums">
                    {formatArea(
                      Math.abs(coverage.unassignedAcres),
                      unit,
                    )}
                  </dd>
                </>
              )}

              {parcel.notes && (
                <>
                  <dt className="text-muted-foreground">Notes</dt>
                  <dd className="whitespace-pre-wrap">{parcel.notes}</dd>
                </>
              )}
            </dl>
          </div>
        </Panel>

        <Panel className="p-5">
          <h2 className="font-heading text-base font-semibold tracking-heading">Rotation</h2>
          <div className="mt-3">
            {rotation === null ? (
              <p className="text-sm text-muted-foreground">
                {parcel.restTargetDays === null
                  ? `Set a rest target on this parcel and record a few stays, and the arithmetic below fills itself in from what you have already entered.`
                  : `Record a few more stays and this works out whether ${zones.length} ${zones.length === 1 ? zoneWord.toLowerCase() : `${zoneWord.toLowerCase()}s`} can actually deliver ${parcel.restTargetDays} days of rest.`}
              </p>
            ) : (
              <div className="space-y-2 text-sm">
                <p>
                  {rotation.paddocks} {zoneWord.toLowerCase()}
                  {rotation.paddocks === 1 ? "" : "s"} at{" "}
                  {rotation.grazeDaysPerZone} days each delivers{" "}
                  <span className="font-medium tabular-nums">
                    {formatDays(rotation.achievableRestDays)}
                  </span>{" "}
                  of rest.
                </p>
                {rotation.shortfallPaddocks > 0 ? (
                  // The finding, stated as arithmetic rather than as a
                  // reprimand: the target is out of reach at this pace, and
                  // that is a fact about the count, not about the grazier.
                  <p className="text-muted-foreground">
                    Your target is {rotation.restTargetDays} days, which needs{" "}
                    {rotation.paddocksNeeded} at this pace — {""}
                    {rotation.shortfallPaddocks} more. Hitting it is
                    arithmetic, not effort: more subdivisions, slower moves, or
                    ground you cannot currently reach.
                  </p>
                ) : (
                  <p className="text-muted-foreground">
                    That meets your {rotation.restTargetDays}-day target.
                  </p>
                )}
              </div>
            )}
          </div>
        </Panel>

        <Panel className="p-5">
          <h2 className="font-heading text-base font-semibold tracking-heading">What changed</h2>
          <div className="mt-3">
            {changes.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nothing has been declared yet. Setting what a{" "}
                {zoneWord.toLowerCase()} is for, and from when, is what makes
                rotation reportable later.
              </p>
            ) : (
              <ul className="space-y-2 text-sm">
                {changes.map((change) => (
                  <li key={change.id} className="flex items-baseline gap-2">
                    <span className="tabular-nums text-muted-foreground">
                      {change.startedOn}
                    </span>
                    <span className="font-medium">
                      {zoneNames.get(change.zoneId) ?? "—"}
                    </span>
                    <span className="text-muted-foreground">
                      {zoneUseLabel(change.use)}
                      {change.endedOn && ` (to ${change.endedOn})`}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Panel>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium">
            {zoneWord}s {zones.length > 0 && `(${zones.length})`}
          </h2>
          {isOwner && parcel.status === "active" && (
            <div className="flex flex-wrap items-center gap-2">
              <PaddockLayout
                parcelId={parcel.id}
                zoneWord={zoneWord}
                areaUnit={unit}
                lengthUnit={lengthUnitFrom(pack.config)}
                lanes={features
                  .filter(
                    (feature) =>
                      feature.kind === "lane" &&
                      feature.status !== "removed" &&
                      feature.geometry !== null,
                  )
                  .map((feature) => ({
                    id: feature.id,
                    label: feature.name || "Lane",
                    geometry: feature.geometry,
                  }))}
                areas={[
                  {
                    id: null,
                    label: `All of ${parcel.name}`,
                    geometry: parcel.geometry,
                  },
                  ...zones
                    .filter((zone) => zone.geometry !== null)
                    .map((zone) => ({
                      id: zone.id,
                      label: zone.name,
                      geometry: zone.geometry,
                    })),
                ]}
              />
              <ZoneForm parcelId={parcel.id} unit={unit} zoneWord={zoneWord} />
            </div>
          )}
        </div>

        {plannedZones.length > 0 && (
          <PlannedZones
            zones={plannedZones.map((zone) => ({
              id: zone.id,
              name: zone.name,
              areaAcres: zone.areaAcres,
            }))}
            unit={unit}
            zoneWord={zoneWord}
            canActivate={isOwner && parcel.status === "active"}
          />
        )}

        <DataTable
          isEmpty={zones.length === 0}
          empty={
            <EmptyState
              title={`No ${zoneWord.toLowerCase()} on this parcel yet`}
              description={`Divide the ground into ${zoneWord.toLowerCase()}s and everything that happens on it has somewhere to land.`}
            />
          }
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{zoneWord}</TableHead>
                <TableHead>Currently</TableHead>
                <TableHead>Rested</TableHead>
                <TableHead className="text-right">Area</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {zones.map((zone) => {
                const use = current.get(zone.id);
                const zoneRestInfo = rest.get(zone.id);
                return (
                  <TableRow key={zone.id}>
                    <TableCell className="font-medium">
                      <Link
                        href={`${BASE}/${parcel.id}/zones/${zone.id}`}
                        className="hover:underline"
                      >
                        {zone.name}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {use ? (
                        <span className="flex items-center gap-2">
                          {zoneUseLabel(use.use)}
                          {!use.isProductive && (
                            <Badge variant="outline">not productive</Badge>
                          )}
                          <span className="text-xs">since {use.startedOn}</span>
                        </span>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {/* Computed from occupancy, never stored, and never
                          entered a second time. "Never used" is not the same
                          fact as "rested a long time". */}
                      {zoneRestInfo?.status === "occupied" ? (
                        <Badge variant="outline">occupied</Badge>
                      ) : zoneRestInfo?.status === "never_grazed" ? (
                        "—"
                      ) : (
                        <span className="tabular-nums">
                          {formatDays(zoneRestInfo?.restDays ?? null)}
                          {parcel.restTargetDays !== null &&
                            zoneRestInfo?.restDays !== null &&
                            zoneRestInfo !== undefined &&
                            zoneRestInfo.restDays !== null &&
                            zoneRestInfo.restDays < parcel.restTargetDays && (
                              <span className="ml-2 text-xs">
                                under target
                              </span>
                            )}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatArea(zone.areaAcres, unit)}
                    </TableCell>
                    <TableCell>
                      {isOwner && (
                        <ZoneControls
                          zone={{
                            id: zone.id,
                            name: zone.name,
                            areaInput:
                              zone.areaAcres === null
                                ? ""
                                : String(fromAcres(zone.areaAcres, unit)),
                            notes: zone.notes,
                            history: (history.get(zone.id) ?? []).map((h) => ({
                              id: h.id,
                              use: h.use,
                              isProductive: h.isProductive,
                              startedOn: h.startedOn,
                              endedOn: h.endedOn,
                            })),
                          }}
                          unit={unit}
                          zoneWord={zoneWord}
                          today={today}
                          usesInUse={usesInUse.map((u) => u.use)}
                        />
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </DataTable>
      </div>
    </div>
  );
}
