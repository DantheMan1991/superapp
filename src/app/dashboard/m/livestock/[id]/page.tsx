import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { withTenant } from "@/db";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { todayInTimezone } from "@/lib/timezone";
import { PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  getLot as getInventoryLot,
  listMovements,
  movementKindsForLots,
} from "@/packs/inventory/ops";
import { movementKindLabel, slugLabel } from "@/packs/inventory/vocabulary";
import {
  currentZoneForOccupants,
  listParcels,
  listStructures,
  listZones,
} from "@/packs/land/ops";
import { getLivestockLot, listIdentifiers } from "@/packs/livestock/ops";
import {
  ageInDays,
  formatAge,
  formatRate,
  mortalityRate,
  preferredIdentifier,
  summariseHead,
} from "@/packs/livestock/core/herd";
import {
  SEX_LABELS,
  identifierKindLabel,
} from "@/packs/livestock/vocabulary";
import {
  IdentifierForm,
  MoveToZoneForm,
  PlaceHeadForm,
  RemoveHeadForm,
  SplitHerdForm,
} from "@/packs/livestock/components/lot-controls";

export const dynamic = "force-dynamic";

const BASE = "/dashboard/m/livestock";

/**
 * One animal lot.
 *
 * Everything on this page comes from somewhere else and is folded here: the
 * code and the ledger from `inventory`, the paddock from `land`, the biology
 * and the tags from this pack. There is no livestock head table, no livestock
 * occupancy table, and no livestock counter — which is the whole argument for
 * the pack model, visible in one screen.
 */
export default async function LivestockLotPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, "livestock");

  const today = todayInTimezone(ctx.tenant.timezone);

  const data = await withTenant(
    ctx.tenant.id,
    async (tx) => {
      const lot = await getLivestockLot(tx, ctx.tenant.id, id);
      if (!lot) return null;
      const inventoryLot = await getInventoryLot(
        tx,
        ctx.tenant.id,
        lot.inventoryLotId,
      );
      if (!inventoryLot) return null;
      const [identifiers, movements, entries, zones, parcels, allZones, structures] =
        await Promise.all([
          listIdentifiers(tx, ctx.tenant.id, lot.id),
          movementKindsForLots(tx, ctx.tenant.id, [lot.inventoryLotId]),
          listMovements(tx, ctx.tenant.id, {
            lotId: lot.inventoryLotId,
            limit: 25,
          }),
          currentZoneForOccupants(tx, ctx.tenant.id, "livestock", [
            lot.inventoryLotId,
          ]),
          listParcels(tx, ctx.tenant.id, { status: "active" }),
          listZones(tx, ctx.tenant.id, { status: "active" }),
          listStructures(tx, ctx.tenant.id),
        ]);
      return {
        lot,
        inventoryLot,
        identifiers,
        movements: movements.get(lot.inventoryLotId) ?? [],
        entries,
        zone: zones.get(lot.inventoryLotId) ?? null,
        parcels,
        allZones,
        structures,
      };
    },
    { role: ctx.role },
  );

  if (!data) notFound();
  const {
    lot,
    inventoryLot,
    identifiers,
    movements,
    entries,
    zone,
    parcels,
    allZones,
    structures,
  } = data;

  const isOwner = ctx.role === "owner";
  const summary = summariseHead(movements);
  const rate = mortalityRate(summary);
  const preferred = preferredIdentifier(identifiers);
  const parcelNames = new Map(parcels.map((p) => [p.id, p.name]));
  const zoneOptions = allZones.map((z) => ({
    id: z.id,
    name: z.name,
    parcelName: parcelNames.get(z.parcelId) ?? "",
  }));

  return (
    <div className="space-y-6">
      <Link
        href={BASE}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" />
        All livestock
      </Link>

      <PageHeader
        title={inventoryLot.code}
        description={
          <span className="flex items-center gap-2">
            {slugLabel(lot.species)}
            {lot.breed && ` · ${lot.breed}`}
            {lot.sex && ` · ${SEX_LABELS[lot.sex] ?? lot.sex}`}
            {preferred && (
              <Badge variant="outline">
                {identifierKindLabel(preferred.identifierKind)} {preferred.value}
              </Badge>
            )}
          </span>
        }
        actions={
          isOwner ? (
            <div className="flex flex-wrap items-center gap-2">
              <PlaceHeadForm
                itemId={inventoryLot.itemId}
                inventoryLotId={inventoryLot.id}
                today={today}
              />
              <RemoveHeadForm
                itemId={inventoryLot.itemId}
                inventoryLotId={inventoryLot.id}
                today={today}
              />
              {summary.balance > 0 && (
                <SplitHerdForm
                  livestockLotId={lot.id}
                  balance={summary.balance}
                  today={today}
                />
              )}
              {zoneOptions.length > 0 && (
                <MoveToZoneForm
                  livestockLotId={lot.id}
                  zones={zoneOptions}
                  structures={structures.map((s) => ({ id: s.id, name: s.name }))}
                  today={today}
                />
              )}
            </div>
          ) : null
        }
      />

      <div className="grid gap-6 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Head</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-medium tabular-nums">
              {movements.length === 0 ? "—" : summary.balance}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {movements.length === 0
                ? "Nothing placed yet."
                : `${summary.intake} in, ${summary.died + summary.removed} out.`}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Lost</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-medium tabular-nums">
              {formatRate(rate)}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {/* Visible while it can still be acted on — at 1,000 birds the
                  gap between 5% and 12% is most of the margin. */}
              {summary.died} died of {summary.intake} placed.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Age</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-medium">
              {formatAge(ageInDays(lot.bornOn, today))}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {lot.bornOn ? `Born ${lot.bornOn}` : "Birth date not recorded."}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Where</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-medium">{zone ? zone.zoneName : "—"}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {/* "Loose" is stated rather than left blank. Cattle roaming a
                  paddock is a real answer, and an empty space would read as a
                  record somebody forgot to finish. */}
              {zone
                ? `${zone.structureName ? `In ${zone.structureName}` : "Loose"} · since ${zone.startedOn}`
                : "Not on a paddock. Moving them off is what starts a paddock's rest clock."}
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium">
            Tags {identifiers.length > 0 && `(${identifiers.length})`}
          </h2>
          {isOwner && <IdentifierForm livestockLotId={lot.id} today={today} />}
        </div>
        {identifiers.length === 0 ? (
          <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
            No tags yet. An animal carries several — a visual tag you can read
            across a field, and an official one that reaches processor
            paperwork.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Kind</TableHead>
                <TableHead>Value</TableHead>
                <TableHead>Applied</TableHead>
                <TableHead>Removed</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {identifiers.map((i) => (
                <TableRow key={i.id}>
                  <TableCell className="text-muted-foreground">
                    {identifierKindLabel(i.identifierKind)}
                  </TableCell>
                  <TableCell className="font-medium">{i.value}</TableCell>
                  <TableCell className="tabular-nums text-muted-foreground">
                    {i.appliedOn ?? "—"}
                  </TableCell>
                  <TableCell className="tabular-nums text-muted-foreground">
                    {i.removedOn ?? (
                      <Badge variant="outline">current</Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {entries.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-medium">Head events</h2>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>What happened</TableHead>
                <TableHead className="text-right">Head</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="tabular-nums text-muted-foreground">
                    {e.occurredOn}
                  </TableCell>
                  <TableCell>
                    {movementKindLabel(e.movementKind)}
                    {e.notes && (
                      <div className="text-xs text-muted-foreground">
                        {e.notes}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {e.quantity > 0 ? "+" : ""}
                    {e.quantity}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
