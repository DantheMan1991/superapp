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
  parentByLot,
  listLivestockLots,
  withdrawalByLot,
} from "./ops";
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
import { LotFilters } from "./components/lot-filters";

const BASE = "/dashboard/m/livestock";

/**
 * How many lots this page renders before it stops and says so.
 *
 * **A HUNDRED IS PAST ANY HOMESTEAD AND SHORT OF A FEEDLOT**, which is the
 * point: the pilot never meets it, and the farm at 10× gets a page that loads
 * rather than one that fetches two hundred lots' movements, zones, withdrawal
 * clocks, breeding and thumbnails to draw a screen nobody can read anyway.
 *
 * The footer names what it left out. **A list that quietly stops is a list
 * somebody trusts to be complete** — the same rule the feed report follows when
 * it says how much cost it could not allocate.
 */
const LOT_PAGE_SIZE = 100;

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
  const searchParam = searchParams.q;
  const search = (typeof searchParam === "string" ? searchParam : "").trim();
  /**
   * **CLOSED LOTS ARE OUT BY DEFAULT.** The founder's PEN-2: an emptied pen
   * that "still appears everywhere". Same `?closed=1` shape as `inventory`'s
   * retired items, so the two lists behave alike.
   */
  const showClosed = searchParams.closed === "1";
  const today = todayInTimezone(ctx.tenant.timezone);

  const data = await withTenant(
    ctx.tenant.id,
    async (tx) => {
      /**
       * **PHASE ONE: WHAT EXISTS. PHASE TWO: THE EXPENSIVE READS, FOR THE ROWS
       * THAT SURVIVED.**
       *
       * The spine and the membership map moved up here so the narrowing below
       * happens BEFORE the per-lot work. A search that filtered only the render
       * would still pay for every lot's movements, zone, withdrawal clock,
       * breeding and thumbnail — which is the shape that made this page the
       * dossier's "fine at 20 lots, wrong at 200".
       */
      // The lot rows first and alone, because three of the four reads below
      // need their ids.
      const allLots = await listLivestockLots(tx, ctx.tenant.id, { species });
      const [pack, items, inventoryLots, lotParents] = await Promise.all([
        packContext(tx, ctx.tenant.id, ctx.tenant.industry, "livestock"),
        // Only items counted in head can hold animals, which is what makes
        // "head is a unit of measure" true in the UI as well as the schema.
        listItems(tx, ctx.tenant.id, { status: "active" }),
        listLots(tx, ctx.tenant.id),
        parentByLot(
          tx,
          ctx.tenant.id,
          allLots.map((l) => l.id),
          today,
        ),
      ]);

      const invById = new Map(inventoryLots.map((l) => [l.id, l]));
      const needle = search.toLowerCase();
      /**
       * **THE THREE NARROWINGS, IN THE ORDER THEY HAVE TO HAPPEN.**
       *
       * Membership FIRST and never after the cap: a member excluded here is one
       * shown on its parent's page instead, and capping before this could let a
       * named cow through as a top-level row while her herdmates were cut.
       */
      const topLevel = allLots.filter((l) => !lotParents.has(l.id));
      const visible = topLevel.filter((l) => {
        const inv = invById.get(l.inventoryLotId);
        if (!showClosed && inv?.status === "closed") return false;
        if (!needle) return true;
        return (
          (inv?.code ?? "").toLowerCase().includes(needle) ||
          l.species.toLowerCase().includes(needle)
        );
      });
      const matched = visible.length;
      /**
       * **THE MEMBERS OF EACH VISIBLE LOT, INVERTED OUT OF `lotParents`.**
       *
       * `parentByLot` already answers "which lot is this animal in" for every
       * lot on the farm, so turning it round costs nothing and saves a second
       * membership query.
       *
       * **AND THEIR MOVEMENTS ARE FETCHED WITH THE PARENTS'.** A lot's row shows
       * its own head PLUS its members', and the members are NOT in the filtered
       * list — that is the whole point of filtering them out. Reading their head
       * from the page's own lot array made "Cows" read 0 while it held four
       * animals: caught by opening the page, not by any test.
       */
      const membersOf = new Map<string, string[]>();
      for (const [memberId, parentId] of lotParents) {
        const list = membersOf.get(parentId) ?? [];
        list.push(memberId);
        membersOf.set(parentId, list);
      }
      const allById = new Map(allLots.map((l) => [l.id, l]));
      // A CAP, said out loud rather than a silent truncation — the footer
      // reports what it left out, because a list that quietly stops is a list
      // somebody trusts to be complete.
      const lots = visible.slice(0, LOT_PAGE_SIZE);

      const inventoryLotIds = lots.map((l) => l.inventoryLotId);
      // Parents AND their members, because the head shown is the sum of both.
      const headLotIds = [
        ...new Set([
          ...inventoryLotIds,
          ...lots.flatMap((l) =>
            (membersOf.get(l.id) ?? []).flatMap((memberId) => {
              const m = allById.get(memberId);
              return m ? [m.inventoryLotId] : [];
            }),
          ),
        ]),
      ];
      const [
        zones,
        movements,
        withdrawals,
        breedParts,
        portraits,
        capitalByLot,
      ] = await Promise.all([
        currentZoneForOccupants(
          tx,
          ctx.tenant.id,
          "livestock",
          inventoryLotIds,
          today,
        ),
        movementKindsForLots(tx, ctx.tenant.id, headLotIds),
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
        // Slice 4f. A breeding animal has NO HEAD in the ledger — she is not
        // stock — so without this she would sit in the list reading "0" as
        // though she had died.
        capitalStateByLot(
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
        capitalByLot,
        membersOf,
        allById,
        matched,
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
    capitalByLot,
    membersOf,
    allById,
    matched,
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
  /**
   * **Only TOP-LEVEL lots go in this list** — what is inside another lot is
   * shown on that lot's page (8b), and listing it here as well would be the
   * same animal twice with its head already counted in the parent's total.
   *
   * Herds used to be the other exclusion. Slice 8e converted every one of them
   * into a lot holding what it held, so there is one kind of container again
   * and one rule for what this list shows.
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
  // Already narrowed on the server, before the expensive reads. Kept as its own
  // name because every table below reads it.
  const loose = lots;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Livestock"
        description={`A ${lotWord.toLowerCase()} is a group of animals. An animal you name has a page of its own.`}
        icon={<Beef />}
        actions={
          isOwner ? (
            <div className="flex flex-wrap items-center gap-2">
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

      {/* **ALWAYS SHOWN, like `inventory`'s.** A threshold was the first
          instinct — a farm with five lots does not need a search box — but it
          hides the "Show closed" toggle exactly when somebody has closed their
          first lot and wonders where it went. A consistent bar beats a clever
          one. */}
      {(
        <LotFilters
          base={BASE}
          search={search}
          showClosed={showClosed}
          shown={loose.length}
          matched={matched}
          word={lotWord}
        />
      )}

      <DataTable
        isEmpty={loose.length === 0}
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
                      {/* SLICE 8C: which KIND of record this row is. The list
                          holds a named cow and a hundred broilers as peer rows
                          and gave no way to tell them apart — the founder's
                          first complaint about this screen. */}
                      {lot.recordKind === "animal" && (
                        <Badge variant="outline">animal</Badge>
                      )}
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
                      const held = membersOf.get(lot.id) ?? [];
                      if (lotMovements.length === 0 && held.length === 0) {
                        return "—";
                      }
                      const inside = held.reduce((sum, memberId) => {
                        const mLot = allById.get(memberId);
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
