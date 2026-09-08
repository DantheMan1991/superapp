import Link from "next/link";
import { Beef } from "lucide-react";
import { withTenant } from "@/db";
import type { TenantContext } from "@/lib/auth";
import { todayInTimezone } from "@/lib/timezone";
import { matchesAny, searchTerm } from "@/lib/list-query";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { DataTable } from "@/components/app/data-table";
import { LinkRow } from "@/components/app/link-row";
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
  lotIdsByTag,
  withdrawalByLot,
} from "./ops";
import { formatComposition, statedComposition } from "./core/pedigree";
import {
  blocksProcessing,
  describeWithdrawal,
  formatWithdrawal,
} from "./core/withdrawal";
import {
  ageInDays,
  formatAge,
  formatRate,
  mortalityRate,
  splitInHead,
  summariseHead,
  summarisePen,
} from "./core/herd";
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
 *
 * **A TABLE ON A WIDE SCREEN, A CARD PER LOT ON A PHONE.** The table is 655px
 * in a 343px phone column, and the two columns that fell off its right edge —
 * Withdrawal and Head — are the two a farmer opens this page for. Both layouts
 * render from one `rows` array with CSS choosing, the round's pattern. The
 * whole card is the link, and above `md` so is the whole row.
 */
export async function LivestockModule({
  ctx,
  searchParams,
}: {
  ctx: TenantContext;
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const speciesParam = searchParams.species;
  const species =
    typeof speciesParam === "string" ? speciesParam.trim().toLowerCase() : "";
  const searchParam = searchParams.q;
  const search = searchTerm(typeof searchParam === "string" ? searchParam : "");
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
      // Every lot, unfiltered: the species pills have to offer the species
      // you are NOT looking at, and the search has to reach inside lots.
      const allLots = await listLivestockLots(tx, ctx.tenant.id);
      const [pack, items, inventoryLots, lotParents, tagged] = await Promise.all([
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
        // **WHO IS WEARING THAT TAG.** One indexed query, only when there is a
        // term — the value index has waited since slice 0 for this read.
        search ? lotIdsByTag(tx, ctx.tenant.id, search) : Promise.resolve(new Set<string>()),
      ]);

      const invById = new Map(inventoryLots.map((l) => [l.id, l]));
      const allById = new Map(allLots.map((l) => [l.id, l]));
      const speciesOptions = [...new Set(allLots.map((l) => l.species))].sort();
      /**
       * **THE THREE NARROWINGS, IN THE ORDER THEY HAVE TO HAPPEN.**
       *
       * Membership FIRST and never after the cap: a member excluded here is one
       * shown on its parent's page instead, and capping before this could let a
       * named cow through as a top-level row while her herdmates were cut.
       *
       * **EXCEPT UNDER A SEARCH, WHICH REACHES INSIDE LOTS.** A cow named into
       * `Cows` is no top-level row, so "find Bluebell" found nothing at all —
       * the one question this box exists to answer. A search is about an
       * animal, not a list, so a member that matches is shown, with the lot
       * she lives in named beside her.
       */
      const pool = search ? allLots : allLots.filter((l) => !lotParents.has(l.id));
      const visible = pool.filter((l) => {
        const inv = invById.get(l.inventoryLotId);
        if (!showClosed && inv?.status === "closed") return false;
        if (species && l.species !== species) return false;
        if (!search) return true;
        return tagged.has(l.id) || matchesAny(search, [inv?.code, l.species]);
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
        // The pens AND the animals living in them: a cow dosed on her own
        // is not clear while her pen is, and the pen's row is the only
        // place on this page she is visible.
        withdrawalByLot(
          tx,
          ctx.tenant.id,
          [...lots.map((l) => l.id), ...lots.flatMap((l) => membersOf.get(l.id) ?? [])],
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
        lotParents,
        allById,
        matched,
        speciesOptions,
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
    lotParents,
    allById,
    matched,
    speciesOptions,
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
   * **ONE ROW MODEL FOR BOTH LAYOUTS.** Everything a card or a table row shows
   * is folded here once, so the two can never disagree about a lot — the same
   * reason the head count is a fold rather than a column.
   *
   * Only TOP-LEVEL lots are here unless a search reached inside one (see the
   * pool above); what is inside another lot is shown on that lot's page, and
   * listing it here as well would be the same animal twice with its head
   * already counted in the parent's total. A breeding animal is in the list
   * like any other, because she still has a head and is still an animal on the
   * farm — slice 4f moves her value, not her.
   */
  const rows = lots.map((lot) => {
    const inv = byId.get(lot.inventoryLotId);
    const lotMovements = movements.get(lot.inventoryLotId) ?? [];
    // The head count IS the balance — the same fold, over the same ledger,
    // that inventory's own pages use.
    const summary = summariseHead(lotMovements);
    const stated = statedComposition(breedParts.get(lot.id) ?? []);
    /**
     * **THE TOTAL, NOT WHAT IS LOOSE** (slice 8b). A pen of 100 that has had
     * four cows named out of it holds 96 loose plus four animals, and a row
     * reading 96 would say the farm had lost four. The members' head is folded
     * in for the same reason the balance is a fold: two ways of counting the
     * same pen is how two screens come to disagree.
     *
     * Null before anything has been placed. "No animals" and "none recorded
     * yet" are different facts.
     */
    const held = membersOf.get(lot.id) ?? [];
    // **THE SAME FOLD THE LOT PAGE MAKES** — `summarisePen`, so the list and
    // the page cannot disagree about a pen, and `Lost` is over the same
    // population as `Head` at last.
    const population = summarisePen(
      summary,
      held.flatMap((memberId) => {
        const mLot = allById.get(memberId);
        if (!mLot) return [];
        const mv = movements.get(mLot.inventoryLotId) ?? [];
        return [
          {
            summary: summariseHead(mv),
            splitInHead: splitInHead(mv),
            splitFromHere:
              byId.get(mLot.inventoryLotId)?.parentLotId === lot.inventoryLotId,
          },
        ];
      }),
    );
    const inside = population.balance - summary.balance;
    const total =
      lotMovements.length === 0 && held.length === 0 ? null : population.balance;
    // The lot this one lives IN, named only for a member a search reached.
    const parentId = lotParents.get(lot.id);
    const parent = parentId ? allById.get(parentId) : undefined;
    const w = withdrawals.get(lot.id);
    return {
      lot,
      code: inv?.code ?? "—",
      href: `${BASE}/${lot.id}`,
      isAnimal: lot.recordKind === "animal",
      isSplit: Boolean(inv?.parentLotId),
      // Her cost is in fixed assets, so she is out of stock valuation while
      // her head is still counted here.
      isBreeding: capitalByLot.get(lot.id) === "breeding",
      // What somebody ENTERED, as fractions. A lot whose breeding is only
      // computed from its parents shows nothing here and the full answer on
      // its own page — see the dossier for why the two screens differ.
      breeding: stated ? formatComposition(stated, breedLabel) : null,
      speciesLabel: slugLabel(lot.species),
      // From `land`, through land's own query. This pack never touches
      // land_occupancy directly.
      zone: zones.get(lot.inventoryLotId) ?? null,
      age: formatAge(ageInDays(lot.bornOn, today)),
      rate: formatRate(mortalityRate(population)),
      // Nothing at all when nothing has been given — a column of "Clear" on a
      // farm that has never treated anything is noise, and noise is what
      // makes a real one invisible.
      withdrawal: w && w.treatmentCount > 0 ? w.meat : null,
      total,
      inside,
      heldCount: held.length,
      // Animals living in here whose OWN clock is running. A dose given to
      // one of them is hers alone and never the pen's, but she is standing
      // in the pen somebody is about to load from.
      insideNotClear: held.filter((memberId) => {
        const mw = withdrawals.get(memberId);
        return Boolean(mw && mw.treatmentCount > 0 && blocksProcessing(mw.meat));
      }).length,
      portraitId: portraits.get(lot.id)?.id ?? null,
      inCode: parent ? (byId.get(parent.inventoryLotId)?.code ?? null) : null,
      inHref: parent ? `${BASE}/${parent.id}` : null,
    };
  });

  const withdrawalBadge = (row: (typeof rows)[number]) =>
    row.withdrawal ? (
      <Badge
        variant={blocksProcessing(row.withdrawal) ? "default" : "outline"}
        title={describeWithdrawal(row.withdrawal)}
      >
        {formatWithdrawal(row.withdrawal)}
      </Badge>
    ) : null;

  // Only while the pen's own clock is clear — under a pen dose every animal
  // inside is covered by the pen's badge, and a second one would double it.
  const insideBadge = (row: (typeof rows)[number]) =>
    row.insideNotClear > 0 && !(row.withdrawal && blocksProcessing(row.withdrawal)) ? (
      <Badge
        variant="default"
        title="An animal living in this lot was treated on her own and is not clear. Open the lot to see which."
      >
        {row.insideNotClear} inside not clear
      </Badge>
    ) : null;

  const kindBadges = (row: (typeof rows)[number]) => (
    <>
      {/* SLICE 8C: which KIND of record this row is. The list holds a named
          cow and a hundred broilers as peer rows and gave no way to tell
          them apart — the founder's first complaint about this screen. */}
      {row.isAnimal && <Badge variant="outline">animal</Badge>}
      {row.isSplit && <Badge variant="outline">split</Badge>}
      {row.isBreeding && <Badge variant="outline">breeding stock</Badge>}
    </>
  );

  const emptyState = (
    <EmptyState
      icon={<Beef className="h-5 w-5" />}
      title={search || species ? "Nothing matches" : "No animals recorded yet"}
      description={
        search || species
          ? `Nothing on the farm answers to that. A tag is matched on any part of its number; a name on any part of it.`
          : isOwner
            ? `Start a ${lotWord.toLowerCase()} — a pen of chicks, a flock of layers, a group of feeders. Or add one animal on its own. What goes in and what leaves are both entries against it, so the count always reconciles.`
            : `An owner starts the first ${lotWord.toLowerCase()}. Once they do, the animals show up here.`
      }
    />
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
      <LotFilters
        base={BASE}
        search={search}
        showClosed={showClosed}
        species={species}
        speciesPills={speciesOptions.map((s) => ({ key: s, label: slugLabel(s) }))}
        shown={rows.length}
        matched={matched}
        word={lotWord}
      />

      {rows.length === 0 ? (
        <div className="rounded-2xl bg-card shadow-elevation-1">{emptyState}</div>
      ) : (
        <>
          {/* Phone: one card per lot, and the whole card opens it. */}
          <ul className="space-y-3 md:hidden">
            {rows.map((row) => (
              <li key={row.lot.id}>
                <Link
                  href={row.href}
                  className="flex gap-3 rounded-2xl bg-card p-4 shadow-elevation-1 transition-shadow hover:shadow-elevation-3"
                >
                  {/* IDENTIFICATION IS THE POINT — the design's first reason
                      for photos at all is knowing which animal it is when a
                      tag cannot be read across a field. Bigger here than in
                      the table, because a thumb is what a phone is for. */}
                  <RecordPhotoThumb
                    documentId={row.portraitId}
                    alt=""
                    className="size-12 shrink-0 overflow-hidden rounded-lg border bg-muted object-cover"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 font-medium">
                          <span className="truncate">{row.code}</span>
                          {kindBadges(row)}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {row.speciesLabel}
                          {row.breeding && ` · ${row.breeding}`}
                          {/* Plain text, not a link: the card is already one,
                              and a link inside a link is not a thing. */}
                          {row.inCode && ` · in ${row.inCode}`}
                        </p>
                      </div>
                      <p className="shrink-0 text-right tabular-nums">
                        {row.total === null ? (
                          <span className="text-xs text-muted-foreground">
                            nothing placed
                          </span>
                        ) : (
                          <>
                            <span className="font-medium">{row.total}</span>
                            <span className="ml-1 text-xs text-muted-foreground">
                              head
                            </span>
                            {row.inside > 0 && (
                              <span className="block text-xs text-muted-foreground">
                                {row.heldCount} in
                              </span>
                            )}
                          </>
                        )}
                      </p>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      <span>
                        {row.zone
                          ? `${row.zone.zoneName}${row.zone.structureName ? ` · ${row.zone.structureName}` : ""}`
                          : "No paddock"}
                      </span>
                      {row.age !== "—" && <span>{row.age}</span>}
                      {row.rate !== "—" && <span>{row.rate} lost</span>}
                      {withdrawalBadge(row)}
                      {insideBadge(row)}
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>

          {/* Wide screen: the table, and the whole row opens the record. */}
          <div className="hidden md:block">
            <DataTable>
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
                  {rows.map((row) => (
                    <LinkRow key={row.lot.id} href={row.href}>
                      <TableCell>
                        <div className="flex items-center gap-2 font-medium">
                          <RecordPhotoThumb documentId={row.portraitId} alt="" />
                          <Link href={row.href} className="hover:underline">
                            {row.code}
                          </Link>
                          {kindBadges(row)}
                        </div>
                        {row.breeding && (
                          <div className="text-xs text-muted-foreground">
                            {row.breeding}
                          </div>
                        )}
                        {row.inCode && row.inHref && (
                          <div className="text-xs text-muted-foreground">
                            in{" "}
                            <Link href={row.inHref} className="hover:underline">
                              {row.inCode}
                            </Link>
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {row.speciesLabel}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {row.zone ? (
                          <span>
                            {row.zone.zoneName}
                            {row.zone.structureName && (
                              <span className="text-xs"> · {row.zone.structureName}</span>
                            )}
                          </span>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {row.age}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {row.rate}
                      </TableCell>
                      <TableCell>
                        {withdrawalBadge(row) || insideBadge(row) ? (
                          <div className="flex flex-wrap gap-1">
                            {withdrawalBadge(row)}
                            {insideBadge(row)}
                          </div>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {row.total === null ? (
                          "—"
                        ) : (
                          <span className="font-medium">
                            {row.total}
                            {row.inside > 0 && (
                              <span className="ml-1 text-xs font-normal text-muted-foreground">
                                ({row.heldCount} in)
                              </span>
                            )}
                          </span>
                        )}
                      </TableCell>
                    </LinkRow>
                  ))}
                </TableBody>
              </Table>
            </DataTable>
          </div>
        </>
      )}
    </div>
  );
}
