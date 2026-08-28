import Link from "next/link";
import { Beef } from "lucide-react";
import { withTenant } from "@/db";
import type { TenantContext } from "@/lib/auth";
import { todayInTimezone } from "@/lib/timezone";
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
import { packContext } from "@/lib/packs/tenant-context";
import { primaryAttachments } from "@/modules/documents/attachments";
import { RecordPhotoThumb } from "@/modules/documents/components/record-photos";
import { listItems, listLots, movementKindsForLots } from "@/packs/inventory/ops";
import { currentZoneForOccupants } from "@/packs/land/ops";
import { slugLabel } from "@/packs/inventory/vocabulary";
import {
  breedPartsByLot,
  capitalStateByLot,
  groupForLots,
  membersByParent,
  parentByLot,
  groupSummaries,
  listLivestockLots,
  withdrawalByLot,
} from "./ops";
import { HerdForm } from "./components/herd-controls";
import { formatComposition, statedComposition } from "./core/pedigree";
import {
  blocksProcessing,
  describeWithdrawal,
  formatWithdrawal,
} from "./core/withdrawal";
import { ageInDays, formatAge, formatRate, mortalityRate, summariseHead } from "./core/herd";
import { labelFor } from "@/lib/packs/resolve";
import { breedLabel, breedsFrom, speciesFrom } from "./vocabulary";
import { LivestockLotForm } from "./components/lot-controls";
import { LivestockNav } from "./components/livestock-nav";

const BASE = "/dashboard/m/livestock";

/**
 * The `livestock` pack's home: every animal lot, what is in it, and where it is.
 *
 * "SEEING YOUR ANIMALS ON PADDOCKS ALREADY BEATS NOTHING" is the design's own
 * justification for this slice, and it is why the location column is here
 * rather than on the detail page. It also happens to be the visible proof of
 * the pack model: the code comes from `inventory`, the head count from
 * `inventory`'s ledger, the paddock from `land`, and the species from here.
 */
export async function LivestockModule({
  ctx,
  searchParams,
}: {
  ctx: TenantContext;
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const speciesParam = searchParams.species;
  const species = typeof speciesParam === "string" ? speciesParam : undefined;
  const today = todayInTimezone(ctx.tenant.timezone);

  const data = await withTenant(
    ctx.tenant.id,
    async (tx) => {
      const [lots, pack, items] = await Promise.all([
        listLivestockLots(tx, ctx.tenant.id, { species }),
        packContext(tx, ctx.tenant.id, ctx.tenant.industry, "livestock"),
        // Only items counted in head can hold animals, which is what makes
        // "head is a unit of measure" true in the UI as well as the schema.
        listItems(tx, ctx.tenant.id, { status: "active" }),
      ]);

      const inventoryLotIds = lots.map((l) => l.inventoryLotId);
      // Three queries for the whole page, whatever the lot count: the spine
      // rows, where each lot is, and the movements behind every head figure.
      const [
        inventoryLots,
        zones,
        movements,
        withdrawals,
        breedParts,
        portraits,
        herds,
        herdByLot,
        capitalByLot,
        lotParents,
        lotMembersByParent,
      ] = await Promise.all([
        listLots(tx, ctx.tenant.id),
        currentZoneForOccupants(
          tx,
          ctx.tenant.id,
          "livestock",
          inventoryLotIds,
          today,
        ),
        movementKindsForLots(tx, ctx.tenant.id, inventoryLotIds),
        // A LOT UNDER WITHDRAWAL HAS TO BE VISIBLE WHERE SOMEBODY IS ALREADY
        // LOOKING, not only on a page they would have to think to open.
        withdrawalByLot(
          tx,
          ctx.tenant.id,
          lots.map((l) => l.id),
          today,
        ),
        /**
         * **STATED BREEDING ONLY, ON THIS PAGE.**
         *
         * Resolving every lot's composition means walking every lot's pedigree,
         * and the honest cheaper answer is not "compute a rougher figure" — it
         * is to show only what somebody entered. A hub that showed a worked-out
         * fraction here and a differently-worked-out one on the detail page
         * would be two numbers for one fact, which is the thing this pack
         * refuses everywhere else. The animal's own page does the full walk and
         * badges the answer.
         */
        breedPartsByLot(
          tx,
          ctx.tenant.id,
          lots.map((l) => l.id),
        ),
        // **ONE QUERY FOR A PAGE OF THUMBNAILS**, not one per row. A record
        // with photos but no chosen picture is absent from this map and gets
        // the placeholder — picking one is what the primary flag exists to
        // stop the app doing on somebody's behalf.
        primaryAttachments(
          tx,
          ctx.tenant.id,
          "livestock_lot",
          lots.map((l) => l.id),
        ),
        // **HERDS FIRST.** A thousand chickens is one row and ten named cows
        // are one row that opens to ten — which is the whole reason this list
        // stopped being a flat page of every animal on the farm.
        groupSummaries(tx, ctx.tenant.id, today, { status: "active" }),
        groupForLots(
          tx,
          ctx.tenant.id,
          lots.map((l) => l.id),
          today,
        ),
        // Slice 4f. A breeding animal has NO HEAD in the ledger — she is not
        // stock — so without this she would sit in the list reading "0" as
        // though she had died.
        capitalStateByLot(
          tx,
          ctx.tenant.id,
          lots.map((l) => l.id),
          today,
        ),
        // SLICE 8B. Which lot each animal lives in, and what each lot holds.
        // The first keeps a named animal from appearing twice; the second lets
        // a lot's row show the total it stands for rather than only what is
        // loose in it.
        parentByLot(
          tx,
          ctx.tenant.id,
          lots.map((l) => l.id),
          today,
        ),
        membersByParent(
          tx,
          ctx.tenant.id,
          lots.map((l) => l.id),
          today,
        ),
      ]);

      return {
        lots,
        pack,
        items,
        inventoryLots,
        zones,
        movements,
        withdrawals,
        breedParts,
        portraits,
        herds,
        herdByLot,
        capitalByLot,
        lotParents,
        lotMembersByParent,
      };
    },
    { role: ctx.role },
  );

  const {
    lots,
    pack,
    items,
    inventoryLots,
    zones,
    movements,
    withdrawals,
    breedParts,
    portraits,
    herds,
    herdByLot,
    capitalByLot,
    lotParents,
    lotMembersByParent,
  } = data;
  const isOwner = ctx.role === "owner";
  const byId = new Map(inventoryLots.map((l) => [l.id, l]));
  const headItems = items.filter((i) => i.stockingUnit === "head");
  const suggestedSpecies = speciesFrom(pack.config);
  // Resolved here rather than in the form: the profile's config is a server
  // fact, and the form is a client component that should be handed words.
  const breedsBySpecies = Object.fromEntries(
    suggestedSpecies.map((s) => [s, breedsFrom(pack.config, s)]),
  );
  const lotWord = labelFor(pack.labels, "livestockLot", "Lot");
  const herdWord = labelFor(pack.labels, "livestockGroup", "Group");
  /**
   * **Only what is NOT in a herd goes in the flat list.** The founder's
   * complaint on 2026-08-27 was that individuals and groups sat as peer rows and
   * that a thousand animals made it unreadable; an animal in a herd is now shown
   * inside its herd, and this list is what has not been put in one yet.
   */
  /**
   * **A BREEDING ANIMAL IS IN THE LIST LIKE ANY OTHER**, because she still has
   * a head and is still an animal on the farm — slice 4f moves her value, not
   * her. She gets a badge rather than a section of her own; grouping breeding
   * stock together is what a HERD is for, and there is one of those now.
   */
  /**
   * **AND NOT WHAT IS INSIDE ANOTHER LOT** (slice 8b). A cow named out of a pen
   * is shown on that pen's page; listing her here as well would be the same
   * animal twice, and her head is already counted in the pen's total.
   */
  const loose = lots.filter(
    (lot) => !herdByLot.has(lot.id) && !lotParents.has(lot.id),
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Livestock"
        description={`A ${lotWord.toLowerCase()} is a group of animals. An animal you name has a page of its own.`}
        icon={<Beef />}
        actions={
          isOwner ? (
            <div className="flex flex-wrap items-center gap-2">
            <HerdForm word={herdWord} />
            {/* No longer gated on an item existing: the form can create one. A
                farm's first animal used to require a trip to Inventory first. */}
            <LivestockLotForm
              word={lotWord}
              items={headItems.map((i) => ({ id: i.id, name: i.name }))}
              speciesOptions={suggestedSpecies}
              breedsBySpecies={breedsBySpecies}
              today={today}
            />
            </div>
          ) : undefined
        }
      />

      {/* The daily round, feed and Ask were three outline buttons here. Their
          ORDER is a recorded decision — how often each is used, not the order
          they were built in — and it is preserved in the strip. */}
      <LivestockNav />

      {herds.length > 0 && (
        <div className="space-y-3">
          <h2 className="font-heading text-xl font-semibold tracking-heading">
            {herdWord}s
          </h2>
          <DataTable isEmpty={false}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{herdWord}</TableHead>
                  <TableHead>Species</TableHead>
                  <TableHead>Where</TableHead>
                  <TableHead className="text-right">Named</TableHead>
                  <TableHead className="text-right">Head</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {herds.map((herd) => (
                  <TableRow key={herd.group.id}>
                    <TableCell className="font-medium">
                      <Link
                        href={`${BASE}/herds/${herd.group.id}`}
                        className="hover:underline"
                      >
                        {herd.group.name}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {herd.species.map(slugLabel).join(" · ") || "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {/* Two paddocks is said out loud — see `groupSummaries`. */}
                      {herd.where ?? "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {/* How many of them are animals somebody named, as
                          against head counted in a pen. Both belong in a herd
                          and they are different things to look at. */}
                      {herd.individuals || "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-medium">
                      {herd.head}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </DataTable>
        </div>
      )}

      {herds.length > 0 && loose.length > 0 && (
        <h2 className="font-heading text-xl font-semibold tracking-heading">
          Not in a {herdWord.toLowerCase()}
        </h2>
      )}

      <DataTable
        isEmpty={loose.length === 0 && herds.length === 0}
        empty={
          <EmptyState
            icon={<Beef className="h-5 w-5" />}
            title="No animals recorded yet"
            description={
              isOwner
                ? `Start a ${lotWord.toLowerCase()} — a pen of chicks, a flock of layers, a group of feeders. Or add one animal on its own. What goes in and what leaves are both entries against it, so the count always reconciles.`
                : `An owner starts the first ${lotWord.toLowerCase()}. Once they do, the animals show up here.`
            }
          />
        }
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{lotWord}</TableHead>
              <TableHead>Species</TableHead>
              <TableHead>Where</TableHead>
              <TableHead className="text-right">Age</TableHead>
              <TableHead className="text-right">Lost</TableHead>
              <TableHead>Withdrawal</TableHead>
              <TableHead className="text-right">Head</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loose.map((lot) => {
              const inv = byId.get(lot.inventoryLotId);
              const lotMovements = movements.get(lot.inventoryLotId) ?? [];
              // The head count IS the balance — the same fold, over the same
              // ledger, that inventory's own pages use.
              const summary = summariseHead(lotMovements);
              const zone = zones.get(lot.inventoryLotId);
              const stated = statedComposition(breedParts.get(lot.id) ?? []);
              const breeding = stated
                ? formatComposition(stated, breedLabel)
                : null;
              return (
                <TableRow key={lot.id}>
                  <TableCell>
                    <div className="flex items-center gap-2 font-medium">
                      {/* IDENTIFICATION IS THE POINT — the design's first
                          reason for photos at all is knowing which animal it
                          is when a tag cannot be read across a field. */}
                      <RecordPhotoThumb
                        documentId={portraits.get(lot.id)?.id ?? null}
                        alt=""
                      />
                      <Link
                        href={`${BASE}/${lot.id}`}
                        className="hover:underline"
                      >
                        {inv?.code ?? "—"}
                      </Link>
                      {inv?.parentLotId && <Badge variant="outline">split</Badge>}
                      {/* Her cost is in fixed assets, so she is out of stock
                          valuation while her head is still counted here. */}
                      {capitalByLot.get(lot.id) === "breeding" && (
                        <Badge variant="outline">breeding stock</Badge>
                      )}
                    </div>
                    {/* What somebody ENTERED, as fractions. A lot whose
                        breeding is only computed from its parents shows nothing
                        here and the full answer on its own page — see the
                        dossier for why the two screens differ. */}
                    {breeding && (
                      <div className="text-xs text-muted-foreground">
                        {breeding}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {slugLabel(lot.species)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {/* From `land`, through land's own query. This pack never
                        touches land_occupancy directly. */}
                    {zone ? (
                      <span>
                        {zone.zoneName}
                        {zone.structureName && (
                          <span className="text-xs"> · {zone.structureName}</span>
                        )}
                      </span>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {formatAge(ageInDays(lot.bornOn, today))}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {formatRate(mortalityRate(summary))}
                  </TableCell>
                  <TableCell>
                    {/* Nothing at all when nothing has been given — a column of
                        "Clear" on a farm that has never treated anything is
                        noise, and noise is what makes a real one invisible. */}
                    {(() => {
                      const w = withdrawals.get(lot.id);
                      if (!w || w.treatmentCount === 0) {
                        return <span className="text-muted-foreground">—</span>;
                      }
                      return (
                        <Badge
                          variant={
                            blocksProcessing(w.meat) ? "default" : "outline"
                          }
                          title={describeWithdrawal(w.meat)}
                        >
                          {formatWithdrawal(w.meat)}
                        </Badge>
                      );
                    })()}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {/* **THE TOTAL, NOT WHAT IS LOOSE** (slice 8b). A pen of 100
                        that has had four cows named out of it holds 96 loose
                        plus four animals, and a row reading 96 would say the
                        farm had lost four. The members' head is folded in here
                        for the same reason the balance is a fold: two ways of
                        counting the same pen is how two screens come to
                        disagree.

                        An em dash before anything has been placed. "No animals"
                        and "none recorded yet" are different facts. */}
                    {(() => {
                      const held = lotMembersByParent.get(lot.id) ?? [];
                      if (lotMovements.length === 0 && held.length === 0) {
                        return "—";
                      }
                      const inside = held.reduce((sum, m) => {
                        const mLot = lots.find(
                          (l) => l.id === m.memberLotId,
                        );
                        if (!mLot) return sum;
                        const mv = movements.get(mLot.inventoryLotId) ?? [];
                        return sum + summariseHead(mv).balance;
                      }, 0);
                      const total = summary.balance + inside;
                      return (
                        <span className="font-medium">
                          {total}
                          {inside > 0 && (
                            <span className="ml-1 text-xs font-normal text-muted-foreground">
                              ({held.length} in)
                            </span>
                          )}
                        </span>
                      );
                    })()}
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
