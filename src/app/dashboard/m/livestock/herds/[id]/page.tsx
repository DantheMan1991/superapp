import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, Users } from "lucide-react";
import { withTenant } from "@/db";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { packContext } from "@/lib/packs/tenant-context";
import { labelFor } from "@/lib/packs/resolve";
import { todayInTimezone } from "@/lib/timezone";
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
import { listLots, movementKindsForLots } from "@/packs/inventory/ops";
import { slugLabel } from "@/packs/inventory/vocabulary";
import {
  currentZoneForOccupants,
  listParcels,
  listStructures,
  listZones,
} from "@/packs/land/ops";
import { structureKindsFrom } from "@/packs/land/vocabulary";
import {
  getGroup,
  groupForLots,
  groupMembers,
  listGroups,
  listLivestockLots,
  withdrawalByLot,
} from "@/packs/livestock/ops";
import { summariseHead } from "@/packs/livestock/core/herd";
import {
  blocksProcessing,
  formatWithdrawal,
} from "@/packs/livestock/core/withdrawal";
import { LivestockNav } from "@/packs/livestock/components/livestock-nav";
import {
  AddToHerdForm,
  EditHerdForm,
  MoveHerdForm,
  RemoveFromHerdButton,
} from "@/packs/livestock/components/herd-controls";

const BASE = "/dashboard/m/livestock";

export const dynamic = "force-dynamic";

/**
 * **ONE HERD, AND WHAT IS IN IT.**
 *
 * The page the hub's herd row opens into, and the answer to the founder's
 * complaint that individuals and groups sat as peer rows: a thousand chickens
 * are one row on the hub and this is where you go to see what they are.
 *
 * **A member is a LOT, so a named animal and a counted pen sit in the same
 * table** — which is what was asked for. The Head column is what tells them
 * apart, and it is a fold over `inventory`'s ledger like every other head figure
 * in this pack.
 */
export default async function HerdPage({
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
      const group = await getGroup(tx, ctx.tenant.id, id);
      if (!group) return null;

      const pack = await packContext(
        tx,
        ctx.tenant.id,
        ctx.tenant.industry,
        "livestock",
      );
      const landPack = await packContext(
        tx,
        ctx.tenant.id,
        ctx.tenant.industry,
        "land",
      );
      const [members, allLots, inventoryLots, zones, parcels] =
        await Promise.all([
          groupMembers(tx, ctx.tenant.id, id, today),
          listLivestockLots(tx, ctx.tenant.id),
          listLots(tx, ctx.tenant.id),
          listZones(tx, ctx.tenant.id, { status: "active" }),
          listParcels(tx, ctx.tenant.id, { status: "active" }),
        ]);

      const memberIds = new Set(members.map((m) => m.livestockLotId));
      const memberLots = allLots.filter((lot) => memberIds.has(lot.id));
      const [places, withdrawals, herdByLot, groups, structures] =
        await Promise.all([
          currentZoneForOccupants(
            tx,
            ctx.tenant.id,
            "livestock",
            memberLots.map((l) => l.inventoryLotId),
            today,
          ),
          withdrawalByLot(
            tx,
            ctx.tenant.id,
            memberLots.map((l) => l.id),
            today,
          ),
          // Which herd everything else is in, so the picker can say what a
          // candidate would be leaving rather than silently moving it.
          groupForLots(
            tx,
            ctx.tenant.id,
            allLots.map((l) => l.id),
            today,
          ),
          listGroups(tx, ctx.tenant.id, { status: "active" }),
          listStructures(
            tx,
            ctx.tenant.id,
            structureKindsFrom(landPack.config),
          ),
        ]);
      const movements = await movementKindsForLots(
        tx,
        ctx.tenant.id,
        allLots.map((l) => l.inventoryLotId),
      );

      return {
        group,
        labels: pack.labels,
        memberLots,
        allLots,
        inventoryLots,
        movements,
        places,
        withdrawals,
        herdByLot,
        groups,
        zones,
        parcels,
        structures,
      };
    },
    { role: ctx.role },
  );

  if (!data) notFound();
  const {
    group,
    labels,
    memberLots,
    allLots,
    inventoryLots,
    movements,
    places,
    withdrawals,
    herdByLot,
    groups,
    zones,
    parcels,
    structures,
  } = data;

  const herdWord = labelFor(labels, "livestockGroup", "Group");
  const structureWord = labelFor(labels, "structure", "Pen or barn");
  const isOwner = ctx.role === "owner";
  const codeOf = new Map(inventoryLots.map((l) => [l.id, l.code]));
  const groupNames = new Map(groups.map((g) => [g.id, g.name]));
  const parcelNames = new Map(parcels.map((p) => [p.id, p.name]));

  const headOf = (inventoryLotId: string) =>
    summariseHead(movements.get(inventoryLotId) ?? []).balance;
  const head = memberLots.reduce((sum, l) => sum + headOf(l.inventoryLotId), 0);
  const named = memberLots.filter((l) => l.recordKind === "animal").length;

  /**
   * Everything not already in THIS herd, including animals in another one —
   * moving between herds is the ordinary case, and the picker says which herd a
   * candidate would be leaving rather than hiding it.
   */
  const candidates = allLots
    .filter((lot) => herdByLot.get(lot.id) !== group.id)
    .map((lot) => ({
      id: lot.id,
      code: codeOf.get(lot.inventoryLotId) ?? "—",
      species: lot.species,
      head: headOf(lot.inventoryLotId),
      currentHerd: groupNames.get(herdByLot.get(lot.id) ?? "") ?? null,
    }))
    .filter((c) => c.code !== "—")
    .sort((a, b) => a.code.localeCompare(b.code));

  return (
    <div className="space-y-6">
      <PageHeader
        icon={<Users />}
        title={group.name}
        description={
          <span className="flex items-center gap-2">
            {head} head
            {named > 0 && ` · ${named} named`}
            {group.status === "closed" && <Badge variant="outline">closed</Badge>}
          </span>
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {memberLots.length > 0 && zones.length > 0 && (
              <MoveHerdForm
                groupId={group.id}
                word={herdWord}
                head={head}
                zones={zones.map((z) => ({
                  id: z.id,
                  name: z.name,
                  parcelName: parcelNames.get(z.parcelId) ?? "",
                }))}
                structures={structures.map((sct) => ({
                  id: sct.id,
                  name: sct.name,
                }))}
                structureWord={structureWord}
                today={today}
              />
            )}
            <AddToHerdForm
              groupId={group.id}
              word={herdWord}
              candidates={candidates}
              today={today}
            />
            {isOwner && (
              <EditHerdForm
                groupId={group.id}
                word={herdWord}
                name={group.name}
                notes={group.notes}
                status={group.status}
              />
            )}
          </div>
        }
      />

      <LivestockNav />

      <Link
        href={BASE}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="size-4" /> All livestock
      </Link>

      {group.notes && (
        <Panel className="p-5">
          <p className="text-sm text-muted-foreground">{group.notes}</p>
        </Panel>
      )}

      <DataTable
        isEmpty={memberLots.length === 0}
        empty={
          <EmptyState
            icon={<Users />}
            title={`Nothing in this ${herdWord.toLowerCase()} yet`}
            description={`Add named animals, whole pens, or both — a ${herdWord.toLowerCase()} holds one cow and forty unnamed head side by side, and moving it moves all of them.`}
          />
        }
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Animal</TableHead>
              <TableHead>Species</TableHead>
              <TableHead>Where</TableHead>
              <TableHead>Withdrawal</TableHead>
              <TableHead className="text-right">Head</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {memberLots.map((lot) => {
              const balance = headOf(lot.inventoryLotId);
              const place = places.get(lot.inventoryLotId);
              const clock = withdrawals.get(lot.id);
              const code = codeOf.get(lot.inventoryLotId) ?? "—";
              return (
                <TableRow key={lot.id}>
                  <TableCell className="font-medium">
                    <Link href={`${BASE}/${lot.id}`} className="hover:underline">
                      {code}
                    </Link>
                    {/* The distinction the founder asked to see, made where it
                        is visible rather than implied by a number. Since 8c it
                        is read off the KIND: Rosie at zero head lost this badge
                        while standing in a paddock, which is what a derived
                        answer does the first time the arithmetic moves. */}
                    {lot.recordKind === "animal" && (
                      <Badge variant="outline" className="ml-2">
                        named
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {slugLabel(lot.species)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {place
                      ? place.structureName
                        ? `${place.zoneName} · ${place.structureName}`
                        : place.zoneName
                      : "—"}
                  </TableCell>
                  <TableCell>
                    {clock && blocksProcessing(clock.meat) ? (
                      <Badge variant="outline">
                        {formatWithdrawal(clock.meat)}
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {balance}
                  </TableCell>
                  <TableCell className="text-right">
                    <RemoveFromHerdButton
                      livestockLotId={lot.id}
                      code={code}
                      word={herdWord}
                      today={today}
                    />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </DataTable>
    </div>
  );
}
