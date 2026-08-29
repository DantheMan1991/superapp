import Link from "next/link";
import { notFound } from "next/navigation";
import { Beef } from "lucide-react";
import { LivestockNav } from "@/packs/livestock/components/livestock-nav";
import { withTenant } from "@/db";
import { requireTenant } from "@/lib/auth";
import { isModuleEnabled, requireModuleEnabled } from "@/lib/modules";
import { listAccounts } from "@/modules/accounting/core";
import { postedToDateCents } from "@/packs/assets/depreciation-ops";
import {
  ToBreedingForm,
  ToMarketForm,
} from "@/packs/livestock/components/capital-controls";
import { attachmentsForRecord } from "@/modules/documents/attachments";
import { RecordPhotos } from "@/modules/documents/components/record-photos";
import { isDisplayableImage } from "@/modules/documents/allowlist";
import {
  attachLotPhotoAction,
  detachLotPhotoAction,
  setLotPhotoPrimaryAction,
} from "@/packs/livestock/actions";
import { packContext } from "@/lib/packs/tenant-context";
import { labelFor } from "@/lib/packs/resolve";
import { todayInTimezone } from "@/lib/timezone";
import { PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/app/data-table";
import { RecordDrawForm } from "@/packs/livestock/components/feed-controls";
import {
  AddToLotForm,
  CloseLotButton,
  TakeOutOfLotButton,
} from "@/packs/livestock/components/lot-members-controls";
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
  carriedCostByLot,
  consumedByLot,
  getLot as getInventoryLot,
  listItems,
  listLocations,
  lotsByItem as lotsByItemQuery,
  listMovements,
  movementKindsForLots,
} from "@/packs/inventory/ops";
import { formatMoney } from "@/lib/money";
import { carriedValue } from "@/packs/inventory/core/valuation";
import { movementKindLabel, slugLabel } from "@/packs/inventory/vocabulary";
import {
  currentZoneForOccupants,
  lastHauledOn,
  listParcels,
  listStructures,
  listZones,
} from "@/packs/land/ops";
import { structureKindsFrom } from "@/packs/land/vocabulary";
import {
  LEDGER_EPOCH,
  breedPartsByLot,
  codesByLivestockLot,
  feedReport,
  getLivestockLot,
  listChecksForLot,
  listIdentifiers,
  listTreatmentsForLot,
  listWeightsForLot,
  capitalStateByLot,
  capitalTransfersForLot,
  offspringOf,
  lotMemberSummaries,
  lotsAvailableToJoin,
  parentByLot,
  parentCandidates,
  pedigreeIndex,
  productsInUse,
  toWeighIns,
} from "@/packs/livestock/ops";
import {
  COMPOSITION_SOURCE_LABELS,
  COMPOSITION_SOURCE_NOTES,
  ancestorTree,
  formatComposition,
  resolveComposition,
  type AncestorNode,
} from "@/packs/livestock/core/pedigree";
import { SplitIntoIndividualsForm } from "@/packs/livestock/components/individual-controls";
import {
  BreedCompositionForm,
  RecordBirthForm,
  SetParentsForm,
} from "@/packs/livestock/components/pedigree-controls";
import {
  PROVENANCE_LABELS,
  PROVENANCE_NOTES,
  formatQuantities,
} from "@/packs/livestock/core/feed";
import {
  WEIGHT_METHOD_LABELS,
  WEIGHT_METHOD_NOTES,
  describeSample,
  formatLb,
  isMeasuredMethod,
} from "@/packs/livestock/core/weights";
import {
  RecordWeightForm,
  RemoveWeightButton,
} from "@/packs/livestock/components/weight-controls";
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
  breedLabel,
  breedsFrom,
  identifierKindLabel,
  tapeDivisorFrom,
  treatmentRouteLabel,
} from "@/packs/livestock/vocabulary";
import {
  WITHDRAWAL_SOURCE_LABELS,
  WITHDRAWAL_SOURCE_NOTES,
  blocksProcessing,
  clearsOn,
  describeWithdrawal,
  formatWithdrawal,
  lotWithdrawal,
} from "@/packs/livestock/core/withdrawal";
import {
  RecordTreatmentForm,
  RemoveTreatmentButton,
} from "@/packs/livestock/components/treatment-controls";
import { formatLastChecked } from "@/packs/livestock/core/daily";
import {
  IdentifierForm,
  MoveToZoneForm,
  PlaceHeadForm,
  RemoveHeadForm,
  SplitHerdForm,
} from "@/packs/livestock/components/lot-controls";
import { LotCheckForm } from "@/packs/livestock/components/daily-round";

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
/**
 * One side of a pedigree, indented.
 *
 * **A PARENT NOBODY RECORDED IS DRAWN, NOT SKIPPED.** An empty space reads as a
 * tree that ended; "not recorded" reads as a tree waiting to be filled in, and
 * filling it in is the entire point of the screen.
 *
 * It stops expanding at an animal with no parents on file, which is also what
 * the depth running out looks like — so the tree never renders a "not recorded"
 * it has not actually checked.
 */
function PedigreeBranch({
  node,
  role,
  codes,
}: {
  node: AncestorNode | null;
  role: string;
  codes: Map<string, string>;
}) {
  return (
    <li>
      <span className="text-muted-foreground">{role}: </span>
      {node ? (
        <Link
          href={`${BASE}/${node.id}`}
          className="font-medium hover:underline"
        >
          {codes.get(node.id) ?? "—"}
        </Link>
      ) : (
        <span className="text-muted-foreground">not recorded</span>
      )}
      {node && (node.dam || node.sire) && (
        <ul className="mt-1 ml-4 space-y-1 border-l pl-3">
          <PedigreeBranch node={node.dam} role="Dam" codes={codes} />
          <PedigreeBranch node={node.sire} role="Sire" codes={codes} />
        </ul>
      )}
    </li>
  );
}

export default async function LivestockLotPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, "livestock");

  const today = todayInTimezone(ctx.tenant.timezone);
  const currencySymbol = ctx.tenant.currencySymbol;

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
      /**
       * The pack's config first, on its own, because the feed report needs it.
       * The TAPE DIVISORS live in it: without them a herd measured by tape has
       * no weight at all, and the conversion below would silently report on a
       * lot it could not weigh.
       */
      const pack = await packContext(
        tx,
        ctx.tenant.id,
        ctx.tenant.industry,
        "livestock",
      );
      const [
        identifiers,
        movements,
        entries,
        checks,
        feedCost,
        fedIn,
        zones,
        parcels,
        allZones,
        weights,
        hauls,
        treatments,
        medicines,
        products,
        landPack,
        pedigree,
        offspring,
        candidates,
        headItems,
        capitalState,
        capitalTransfers,
        accounts,
        carriedCosts,
        attachments,
      ] = await Promise.all([
          listIdentifiers(tx, ctx.tenant.id, lot.id),
          movementKindsForLots(tx, ctx.tenant.id, [lot.inventoryLotId]),
          listMovements(tx, ctx.tenant.id, {
            lotId: lot.inventoryLotId,
            limit: 25,
          }),
          listChecksForLot(tx, ctx.tenant.id, lot.id),
          /**
           * What has been fed into this pen — and the FULL report rather than
           * the direct-issue total alone.
           *
           * `consumedCostByLot` only sees feed issued to this lot BY NAME. Since
           * slice 2 a lot can also carry a share of a shared feeder, and a card
           * that showed only the measured half would read as the whole answer
           * and quietly understate the pen. The screens must agree, so this page
           * reads the same report the feed page does.
           */
          feedReport(tx, ctx.tenant.id, {
            from: LEDGER_EPOCH,
            to: today,
            packConfig: pack.config,
          }),
          consumedByLot(tx, ctx.tenant.id, lot.inventoryLotId, 10),
          currentZoneForOccupants(
            tx,
            ctx.tenant.id,
            "livestock",
            [lot.inventoryLotId],
            today,
          ),
          listParcels(tx, ctx.tenant.id, { status: "active" }),
          listZones(tx, ctx.tenant.id, { status: "active" }),
          listWeightsForLot(tx, ctx.tenant.id, lot.id),
          // WHEN THEY WERE LAST HAULED, from `land`. A weighing taken days
          // after a trailer is 3-5% of shrink, not a loss, and the history
          // below marks it rather than quietly averaging it in.
          lastHauledOn(tx, ctx.tenant.id, "livestock", [lot.inventoryLotId]),
          listTreatmentsForLot(tx, ctx.tenant.id, lot.id),
          // Stock a treatment could come out of, so a sick pen carries its own
          // expense through the same door feed does.
          listItems(tx, ctx.tenant.id, { kind: "medicine", status: "active" }),
          productsInUse(tx, ctx.tenant.id),
          // LAND's config, not this pack's. Which assets can hold animals is
          // land's question, and `structureKindsFrom` is land's answer to it —
          // this pack hands the config straight back rather than reading a key
          // out of it, which is the `requires` seam working as intended.
          packContext(tx, ctx.tenant.id, ctx.tenant.industry, "land"),
          // THE PEDIGREE, WALKED UPWARD AND BOUNDED. What the animal is made
          // of is a fold over this — never a stored column — for the same
          // reason the head count is a fold over movements.
          pedigreeIndex(tx, ctx.tenant.id, [lot.id]),
          offspringOf(tx, ctx.tenant.id, lot.id),
          // Same species first, because a mule is real and a mis-click is
          // likelier. The write path is what refuses an impossible parent.
          parentCandidates(tx, ctx.tenant.id, {
            species: lot.species,
            excludeId: lot.id,
          }),
          listItems(tx, ctx.tenant.id, { status: "active" }),
          // Slice 4f. Whether she is stock or a capital asset is a FOLD over
          // the transfers, never a column — see `capitalStateByLot`.
          capitalStateByLot(tx, ctx.tenant.id, [lot.id], today),
          capitalTransfersForLot(tx, ctx.tenant.id, lot.id),
          listAccounts(tx, ctx.tenant.id),
          // What the lot is carrying — the figure the transfer will move, so
          // the dialog can name it before anybody presses the button.
          carriedCostByLot(tx, ctx.tenant.id, [lot.inventoryLotId], today),
          // Photos, from `documents`. Empty when the module is off, which is
          // why the section below is gated on the module rather than on this.
          attachmentsForRecord(tx, ctx.tenant.id, {
            extensionSlug: "livestock",
            entityType: "livestock_lot",
            entityId: lot.id,
          }),
        ]);
      const structures = await listStructures(
        tx,
        ctx.tenant.id,
        structureKindsFrom(landPack.config),
      );
      // SLICE 8F: what this one can be fed, and out of which delivery.
      // Loaded here rather than passing an empty list, so the form on this
      // page asks the same questions as the one on the feed page.
      const feedLocations = await listLocations(tx, ctx.tenant.id);
      const feedableItems = headItems.filter(
        (i) => i.itemKind !== "livestock",
      );
      const deliveriesByItem = await lotsByItemQuery(
        tx,
        ctx.tenant.id,
        feedableItems.map((i) => i.id),
      );
      // SLICE 8B: what is inside this lot, and what this lot is inside. Both
      // are questions about a DATE, so today is passed rather than assumed —
      // the same rule the herd and the paddock reads follow.
      const members = await lotMemberSummaries(tx, ctx.tenant.id, lot.id, today);
      const insideOf = (await parentByLot(tx, ctx.tenant.id, [lot.id], today)).get(
        lot.id,
      );
      const insideOfCode = insideOf
        ? (await codesByLivestockLot(tx, ctx.tenant.id, [insideOf])).get(insideOf)
        : null;
      // Only offered when this lot could actually hold things: one that is
      // already inside another cannot, and the picker must not say otherwise.
      const joinable = insideOf
        ? []
        : await lotsAvailableToJoin(tx, ctx.tenant.id, lot.id);
      // Every animal in the tree, plus the offspring, named in one query. The
      // index carries ids because the fold that reads it is pure.
      // Whose treatment is whose: an inherited row carries the lot id it was
      // recorded against, and the page needs that lot's CODE to name it.
      const inheritedFrom = await codesByLivestockLot(
        tx,
        ctx.tenant.id,
        [...new Set(treatments.map((t) => t.livestockLotId))].filter(
          (id) => id !== lot.id,
        ),
      );
      const pedigreeCodes = await codesByLivestockLot(tx, ctx.tenant.id, [
        ...pedigree.keys(),
        ...offspring.map((o) => o.id),
      ]);
      // What the books have already taken off her, so "back to the market
      // herd" can quote net book value rather than cost.
      const breedingAssetId =
        capitalTransfers.find((t) => t.direction === "to_breeding")?.assetId ??
        null;
      const depreciatedCents = breedingAssetId
        ? await postedToDateCents(tx, ctx.tenant.id, breedingAssetId)
        : 0;
      const statedBreed =
        (await breedPartsByLot(tx, ctx.tenant.id, [lot.id])).get(lot.id) ?? [];
      return {
        lot,
        feedLocations,
        feedableItems,
        deliveriesByItem,
        members,
        insideOf: insideOf ?? null,
        insideOfCode: insideOfCode ?? null,
        joinable,
        inventoryLot,
        identifiers,
        movements: movements.get(lot.inventoryLotId) ?? [],
        entries,
        checks,
        feed: feedCost.lots.find((row) => row.lotId === lot.id) ?? null,
        fedIn,
        zone: zones.get(lot.inventoryLotId) ?? null,
        parcels,
        allZones,
        structures,
        weights,
        hauledOn: hauls.get(lot.inventoryLotId) ?? null,
        treatments,
        medicines,
        products,
        labels: pack.labels,
        // The divisor for THIS lot's species, resolved once on the server so
        // the form knows whether a tape is even an option.
        tapeDivisor: tapeDivisorFrom(pack.config, lot.species),
        pedigree,
        pedigreeCodes,
        statedBreed,
        offspring,
        candidates,
        headItems: headItems.filter((i) => i.stockingUnit === "head"),
        breedSuggestions: breedsFrom(pack.config, lot.species),
        inheritedFrom,
        capitalState: capitalState.get(lot.id) ?? "market",
        carriedCents: (() => {
          // `carriedValue`, NEVER `remainingCents` — a lot nobody costed and a
          // lot whose cost has all been released both fold to zero, and only
          // one of those is a number.
          const row = carriedCosts.get(lot.inventoryLotId);
          return Math.max(0, Math.round((row ? carriedValue(row) : null) ?? 0));
        })(),
        capitalTransfers,
        depreciatedCents,
        // Only accounts that can CARRY an asset. The chart is the tenant's, so
        // the picker offers what is in it rather than a name this pack invented.
        fixedAssetAccounts: accounts
          .filter((a) => a.accountType === "asset" && a.subtype === "fixed_asset")
          .map((a) => ({ id: a.id, code: a.code, name: a.name })),
        photos: attachments
          // The gallery renders `<img>`, so anything the browser will not put
          // on screen has no business in it. An attachment that is not a photo
          // is a legitimate row and simply belongs on a different panel.
          .filter((a) => isDisplayableImage(a.document.mimeType))
          .map((a) => ({
            documentId: a.document.id,
            fileName: a.document.fileName,
            title: a.document.title ?? "",
            mimeType: a.document.mimeType,
            isPrimary: a.isPrimary,
          })),
      };
    },
    { role: ctx.role },
  );

  if (!data) notFound();
  const {
    lot,
    feedLocations,
    feedableItems,
    deliveriesByItem,
    members,
    insideOf,
    insideOfCode,
    joinable,
    inventoryLot,
    identifiers,
    movements,
    entries,
    checks,
    feed,
    fedIn,
    zone,
    parcels,
    allZones,
    structures,
    weights,
    hauledOn,
    treatments,
    medicines,
    products,
    labels,
    tapeDivisor,
    pedigree,
    pedigreeCodes,
    statedBreed,
    offspring,
    candidates,
    headItems,
    breedSuggestions,
    photos,
    inheritedFrom,
    capitalState,
    capitalTransfers,
    carriedCents,
    depreciatedCents,
    fixedAssetAccounts,
  } = data;
  /**
   * **HER HEAD STAYS.** Slice 4f moves the MONEY, not the animal: she is still
   * one head standing in a paddock, so every control on this page goes on
   * working. What changed is which side of the balance sheet her value sits on,
   * and the panel below is where that is said.
   */
  const isBreeding = capitalState === "breeding";
  const capitalisedCents =
    capitalTransfers.find((t) => t.direction === "to_breeding")?.amountCents ?? 0;
  const bookValueCents = Math.max(0, capitalisedCents - depreciatedCents);
  // The FILE lives in the DMS, so the panel exists only where the DMS does. A
  // button that uploads into a module the tenant has not switched on would
  // fail at the gate, which is a worse answer than not offering it.
  const documentsOn = await isModuleEnabled(ctx.tenant.id, "documents");
  // A capital asset needs an asset register to live in. `livestock` does not
  // require `assets`, so the panel exists only where it is switched on.
  const assetsOn = await isModuleEnabled(ctx.tenant.id, "assets");

  /**
   * Chores are for whoever is doing them; decisions are the owner's.
   *
   * Placing head, recording a loss, moving a lot and tagging an animal are all
   * ungated — anyone in the workspace can record what they just did. Only
   * SPLITTING is owner-gated, because it creates a new lot and therefore a cost
   * object. See src/lib/packs/authorize.ts.
   */
  const isOwner = ctx.role === "owner";
  const structureWord = labelFor(labels, "structure", "Pen or barn");
  const lotWord = labelFor(labels, "livestockLot", "Lot");
  /**
   * **SLICE 8C: ONE PAGE, TWO SUBJECTS.** A named cow and a hundred broilers
   * were rendered by the same component, so a flock was offered a photo
   * gallery about "the gradual change in this animal" and a valuation card
   * about "what SHE cost to buy".
   *
   * Read off `record_kind`, never off a head balance of one — a pen down to
   * its last bird is still a pen, and a breeding cow at zero head is still a
   * cow. That was the bug the column was added to end.
   */
  const isAnimal = lot.recordKind === "animal";
  /** Closed lots stay readable; they just leave the working lists. */
  const isClosed = inventoryLot.status === "closed";
  /** What to call this record mid-sentence. Never the word "lot" for a cow. */
  const subjectWord = isAnimal ? "animal" : lotWord.toLowerCase();
  // Measured plus allocated. The card says which, and the split is spelled out
  // underneath whenever a shared feeder contributed.
  const feedCents = feed?.totalCents ?? 0;

  /**
   * The weighings, with the two things a stored row cannot know: the average per
   * head (which needs this species' tape divisor) and whether the weighing sat
   * in the shadow of a haul (which needs `land`). `feedReport` has already done
   * exactly this fold, so the numbers on this card and on the feed page come
   * from one place and cannot disagree.
   */
  const weighIns = toWeighIns(weights, { tapeDivisor, lastHauledOn: hauledOn });

  /**
   * Both clocks, folded from the treatments rather than stored anywhere.
   *
   * The MEAT one leads on the card because it is the one that stops a trailer;
   * milk is shown beside it whenever a treatment has a milk period at all, which
   * for a beef or broiler lot is never and for a dairy cow is always.
   */
  const withdrawal = lotWithdrawal(treatments, today);
  /**
   * Show the milk line only when it SAYS SOMETHING DIFFERENT.
   *
   * For an unknown period both clocks read identically, and repeating the whole
   * sentence underneath itself is the noise that teaches somebody to skim the
   * card — which is the last card in this pack anybody should skim.
   */
  const showMilk =
    withdrawal.milk.state !== withdrawal.meat.state ||
    withdrawal.milk.clearsOn !== withdrawal.meat.clearsOn;
  const latest = feed?.weight.latest ?? null;
  const gain = feed?.weight.gain ?? null;
  const shrinkCount = feed?.weight.shrinkAffectedCount ?? 0;
  const weighedOnLabel = latest ? `weighed ${latest.weighedOn}` : "";
  const summary = summariseHead(movements);
  const rate = mortalityRate(summary);
  const preferred = preferredIdentifier(identifiers);
  /**
   * What this animal is made of, and who it came from. Both are folds over the
   * pedigree — nothing about either is stored, so a correction to a grandparent
   * shows up here the moment it is made.
   *
   * THREE GENERATIONS IS WHAT A SCREEN CAN HOLD; the walk itself goes further
   * and the composition uses all of it.
   */
  const composition = resolveComposition(lot.id, pedigree);
  const tree = ancestorTree(lot.id, pedigree, 3);
  /**
   * What goes in the header beside the species.
   *
   * The breed has been up there since slice 0 because it is half of how a
   * person recognises an animal at a glance — found by driving 4a, where stating
   * a composition emptied the header. Null when nothing is known, so an animal
   * nobody has described reads "Poultry" rather than "Poultry · ".
   */
  /**
   * **THE BIRTH FORM'S LIST INCLUDES THIS ANIMAL AND THE PARENTS FORM'S DOES
   * NOT**, and the difference is not a subtlety: on a birth, this animal is the
   * PARENT and the new lot is the child, so excluding it made the dam it
   * pre-selects invisible in its own picker. Found by opening the dialog on
   * Hilltop Farm, where it rendered "Not recorded" over a dam that was in fact
   * set — a form that lies about what it is about to do.
   */
  const birthCandidates = [
    ...candidates,
    {
      id: lot.id,
      code: inventoryLot.code,
      species: lot.species,
      sex: lot.sex,
      bornOn: lot.bornOn,
    },
  ].sort((a, b) => a.code.localeCompare(b.code));
  const breedingLabel =
    composition.source === "unknown"
      ? null
      : formatComposition(composition, breedLabel);
  const parcelNames = new Map(parcels.map((p) => [p.id, p.name]));
  const zoneOptions = allZones.map((z) => ({
    id: z.id,
    name: z.name,
    parcelName: parcelNames.get(z.parcelId) ?? "",
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        icon={<Beef />}
        title={inventoryLot.code}
        description={
          <span className="flex items-center gap-2">
            {slugLabel(lot.species)}
            {breedingLabel && ` · ${breedingLabel}`}
            {/* **WHICH LOT SHE LIVES IN** — the answer to "where does this
                animal belong", and since 8e the only answer there is: every
                herd became a lot holding what it held. */}
            {insideOf && insideOfCode && (
              <Link
                href={`${BASE}/${insideOf}`}
                className="underline-offset-4 hover:underline"
              >
                · in {insideOfCode}
              </Link>
            )}
            {/* Said in the subtitle, because a closed lot's page otherwise
                looks exactly like a working one. */}
            {isClosed && <Badge variant="outline">closed</Badge>}
            {lot.sex && ` · ${SEX_LABELS[lot.sex] ?? lot.sex}`}
            {preferred && (
              <Badge variant="outline">
                {identifierKindLabel(preferred.identifierKind)} {preferred.value}
              </Badge>
            )}
          </span>
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {/* **NOT OFFERED ON AN ANIMAL THAT ALREADY HAS HER HEAD** (slice 8c).
                It read as an invitation to add a second head to one cow, which
                is the contradiction the founder opened this whole review with.
                `startIndividual` places her single head at creation, so the only
                animal that needs this is one whose head was never recorded — and
                she still gets it. */}
            {(!isAnimal || summary.balance === 0) && (
              <PlaceHeadForm
                itemId={inventoryLot.itemId}
                inventoryLotId={inventoryLot.id}
                today={today}
              />
            )}
            <RemoveHeadForm
              itemId={inventoryLot.itemId}
              inventoryLotId={inventoryLot.id}
              today={today}
            />
            {summary.balance > 0 && (
              <RecordTreatmentForm
                livestockLotId={lot.id}
                lotCode={inventoryLot.code}
                head={summary.balance}
                today={today}
                medicines={medicines.map((m) => ({
                  id: m.id,
                  name: m.name,
                  unit: m.stockingUnit,
                }))}
                products={products}
              />
            )}
            {summary.balance > 0 && (
              <RecordWeightForm
                livestockLotId={lot.id}
                lotCode={inventoryLot.code}
                head={summary.balance}
                today={today}
                // No divisor for this species means a tape produces no weight,
                // so the method is not offered rather than offered and useless.
                tapeAvailable={tapeDivisor !== null}
              />
            )}
            {/* **SLICE 8F: FEED THIS ONE, BY NAME.** No feeders are passed, so
                the dialog opens straight into "Feed one" with this record
                already picked and no shared-feeder toggle — on her own page,
                there is only one answer to "who ate it".

                Before this, a named animal could not be fed from this module at
                all: the only control required a shared feeder, and every named
                animal on the pilot farm read "—" in every feed column. */}
            {feedableItems.length > 0 && (
              <RecordDrawForm
                feeders={[]}
                animals={[{ id: lot.id, code: inventoryLot.code }]}
                defaultAnimalId={lot.id}
                items={feedableItems.map((i) => ({
                  id: i.id,
                  name: i.name,
                  unit: i.stockingUnit,
                }))}
                lotsByItem={Object.fromEntries(
                  [...deliveriesByItem].map(([itemId, itemLots]) => [
                    itemId,
                    itemLots.map((l) => ({ id: l.id, code: l.code })),
                  ]),
                )}
                locations={feedLocations.map((l) => ({
                  id: l.id,
                  name: l.name,
                }))}
                currencySymbol={currencySymbol}
                today={today}
                trigger={
                  <Button variant="outline" size="sm">
                    Feed
                  </Button>
                }
              />
            )}
            {/* SLICE 8C: not offered on an animal. Splitting one cow into two
                pens is not a thing, and the button said otherwise. */}
            {isOwner && !isAnimal && summary.balance > 0 && (
              <SplitHerdForm
                livestockLotId={lot.id}
                balance={summary.balance}
                today={today}
              />
            )}
            {/* Offered only where it means something. An ANIMAL already is
                one, and a button inviting somebody to make it one would teach
                them the model is stranger than it is. Since 8c that is read
                off the kind rather than off a balance of one. */}
            {isOwner && !isAnimal && summary.balance > 1 && (
              <SplitIntoIndividualsForm
                livestockLotId={lot.id}
                lotCode={inventoryLot.code}
                balance={summary.balance}
                today={today}
              />
            )}
            {/* **AN EMPTIED LOT CAN BE PUT AWAY** (PEN-2, 2026-08-28). Offered
                only on a lot with nothing left in it — head or members — and
                on a closed one, to bring it back. An ANIMAL is never closed
                this way: what happened to her is a head event, and "sold" or
                "died" says more than "closed". */}
            {isOwner &&
              !isAnimal &&
              members.length === 0 &&
              (summary.balance === 0 || isClosed) && (
                <CloseLotButton
                  livestockLotId={lot.id}
                  code={inventoryLot.code}
                  closed={isClosed}
                  today={today}
                  word={lotWord}
                />
              )}
            {zoneOptions.length > 0 && (
              <MoveToZoneForm
                livestockLotId={lot.id}
                zones={zoneOptions}
                structures={structures.map((s) => ({ id: s.id, name: s.name }))}
                structureWord={structureWord}
                currentZone={
                  zone ? { id: zone.zoneId, name: zone.zoneName } : null
                }
                today={today}
              />
            )}
          </div>
        }
      />

      <LivestockNav />

      <div className="grid gap-6 md:grid-cols-3 xl:grid-cols-4">
        <Panel className="p-5">
          <h2 className="font-heading text-base font-semibold tracking-heading">
            Head
          </h2>
          <div className="mt-1">
            <p className="text-2xl font-medium tabular-nums">
              {movements.length === 0 ? "—" : summary.balance}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {movements.length === 0
                ? "Nothing placed yet."
                : `${summary.intake} in, ${summary.died + summary.removed} out.`}
            </p>
          </div>
        </Panel>

        <Panel className="p-5">
          <h2 className="font-heading text-base font-semibold tracking-heading">Lost</h2>
          <div className="mt-1">
            <p className="text-2xl font-medium tabular-nums">
              {formatRate(rate)}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {/* Visible while it can still be acted on — at 1,000 birds the
                  gap between 5% and 12% is most of the margin. */}
              {summary.died} died of {summary.intake} placed.
            </p>
          </div>
        </Panel>

        <Panel className="p-5">
          <h2 className="font-heading text-base font-semibold tracking-heading">Age</h2>
          <div className="mt-1">
            <p className="text-2xl font-medium">
              {formatAge(ageInDays(lot.bornOn, today))}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {lot.bornOn ? `Born ${lot.bornOn}` : "Birth date not recorded."}
            </p>
          </div>
        </Panel>

        <Panel className="p-5">
          <h2 className="font-heading text-base font-semibold tracking-heading">
              <span className="flex items-center gap-2">
                <Link href={`${BASE}/feed`} className="hover:underline">
                  Fed
                </Link>
                {/* PROVENANCE ON THE NUMBER ITSELF. Measured and allocated are
                    different kinds of fact and the design says the distinction
                    is permanent, so the badge is beside the figure rather than
                    in a footnote somewhere. */}
                {feed && feed.provenance !== "none" && (
                  <Badge
                    variant={feed.provenance === "measured" ? "outline" : "default"}
                    title={PROVENANCE_NOTES[feed.provenance]}
                  >
                    {PROVENANCE_LABELS[feed.provenance]}
                  </Badge>
                )}
              </span>
            </h2>
          <div className="mt-1">
            <p className="text-2xl font-medium tabular-nums">
              {/* Zero is the honest answer once something HAS been fed and it
                  cost nothing on record; before that it is still zero, and the
                  line below says which. */}
              {formatMoney(feedCents, currencySymbol)}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {feedCents === 0
                ? "Nothing fed to this lot yet."
                : (() => {
                    /**
                     * **PER HEAD OVER WHAT THE PEN STILL CARRIES.** The fold
                     * nets off cost that has left with the meat; dividing the
                     * whole bill by the birds still standing made a pen that had
                     * just been processed read as twice as expensive. See
                     * `core/feed.ts`.
                     */
                    const perHead = feed?.centsPerHead ?? null;
                    const quantity =
                      feed && feed.quantities.length > 0
                        ? formatQuantities(feed.quantities)
                        : null;
                    const rate =
                      perHead === null
                        ? "Fed to this lot."
                        : `${formatMoney(perHead, currencySymbol)} a head at today's count.`;
                    return quantity ? `${quantity} · ${rate}` : rate;
                  })()}
            </p>
            {/**
             * **WHERE THE MONEY WENT, once some of it has left.**
             *
             * Found by driving `production` slice 0 on a real pen: 100 of 197
             * birds went into a run carrying $43.15, and this card went on
             * showing the whole $141.67 against the 97 that were left. Nothing
             * in the ledger was wrong — the card simply had no idea cost could
             * leave a lot, because until that week it could not.
             *
             * The headline stays the full bill, because the feed WAS fed and
             * that is what "Fed" means. The line below says how much of it is
             * still standing in the pen.
             */}
            {feed && feed.releasedCents > 0 && (
              <p className="mt-1 text-xs text-muted-foreground">
                {formatMoney(feed.releasedCents, currencySymbol)} left with what
                was processed ·{" "}
                <span className="font-medium">
                  {formatMoney(feed.remainingCents, currencySymbol)}
                </span>{" "}
                still on this lot.
              </p>
            )}
            {feed && feed.allocatedCents > 0 && (
              <p className="mt-1 text-xs text-muted-foreground">
                {formatMoney(feed.measuredCents, currencySymbol)} issued by name,{" "}
                {formatMoney(feed.allocatedCents, currencySymbol)} a share of a
                shared feeder
                {/* THE HALF THAT EXPLAINS THE OTHER SCREEN. Only stamped cost
                    can travel: an allocated share is worked out at read time
                    and was never on a movement, so a run carries the measured
                    part and leaves this behind. Said here, in the pack that
                    owns the distinction, rather than in `production`, which has
                    no business knowing what a shared feeder is. */}
                {feed.releasedCents > 0
                  ? " — a share is an estimate, so it stays with the pen rather than travelling with the meat."
                  : "."}
              </p>
            )}
          </div>
        </Panel>

        <Panel className="p-5">
          <h2 className="font-heading text-base font-semibold tracking-heading">
              <span className="flex items-center gap-2">
                Weight
                {/* THE METHOD, BESIDE THE NUMBER. A crate on a scale and a tape
                    round the girth are different claims, and the badge is the
                    only thing on the card that says which one this is. */}
                {latest && (
                  <Badge
                    variant={
                      isMeasuredMethod(latest.method) ? "outline" : "default"
                    }
                    title={WEIGHT_METHOD_NOTES[latest.method] ?? ""}
                  >
                    {WEIGHT_METHOD_LABELS[latest.method] ?? latest.method}
                  </Badge>
                )}
              </span>
            </h2>
          <div className="mt-1">
            <p className="text-2xl font-medium tabular-nums">
              {formatLb(latest?.averageLb ?? null)}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {!latest
                ? "Nothing weighed yet. Feed per pound of gain starts the day something is."
                : gain
                  ? `A head, ${weighedOnLabel}. Gaining ${gain.adgLb} lb a day over ${gain.days} days.`
                  : `A head, ${weighedOnLabel}. One more weighing and this shows a daily gain.`}
            </p>
            {shrinkCount > 0 && (
              <p className="mt-1 text-xs text-muted-foreground">
                {shrinkCount === 1
                  ? "1 weighing set aside — taken too close to a haul."
                  : `${shrinkCount} weighings set aside — taken too close to a haul.`}
              </p>
            )}
          </div>
        </Panel>

        <Panel className="p-5">
          <h2 className="font-heading text-base font-semibold tracking-heading">
              <span className="flex items-center gap-2">
                Withdrawal
                {/* The one badge in this pack that is a legal fact rather than a
                    reading aid. `default` is the loud variant, and BOTH "under"
                    and "not looked up" get it — to somebody about to load a
                    trailer they mean the same thing.

                    NOTHING AT ALL when nothing has ever been given: the card
                    already says "Clear" once, and a badge repeating it is the
                    noise that makes a real one easy to miss. */}
                {withdrawal.treatmentCount > 0 && (
                  <Badge
                    variant={
                      blocksProcessing(withdrawal.meat) ? "default" : "outline"
                    }
                    title={describeWithdrawal(withdrawal.meat)}
                  >
                    {formatWithdrawal(withdrawal.meat)}
                  </Badge>
                )}
              </span>
            </h2>
          <div className="mt-1">
            <p className="text-2xl font-medium">
              {withdrawal.meat.state === "under"
                ? withdrawal.meat.clearsOn
                : withdrawal.meat.state === "unknown"
                  ? "—"
                  : "Clear"}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {describeWithdrawal(withdrawal.meat)}
            </p>
            {showMilk && (
              <p className="mt-1 text-xs text-muted-foreground">
                Milk: {formatWithdrawal(withdrawal.milk).toLowerCase()} —{" "}
                {describeWithdrawal(withdrawal.milk)}
              </p>
            )}
          </div>
        </Panel>

        <Panel className="p-5">
          <h2 className="font-heading text-base font-semibold tracking-heading">Where</h2>
          <div className="mt-1">
            <p className="text-2xl font-medium">{zone ? zone.zoneName : "—"}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {/* "Loose" is stated rather than left blank. Cattle roaming a
                  paddock is a real answer, and an empty space would read as a
                  record somebody forgot to finish. */}
              {zone
                ? `${zone.structureName ? `In ${zone.structureName}` : "Loose"} · since ${zone.startedOn}`
                : "Not on a paddock. Moving them off is what starts a paddock's rest clock."}
            </p>
          </div>
        </Panel>
      </div>

      {assetsOn && (
        <Panel className="p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-heading text-base font-semibold tracking-heading">
                <span className="flex items-center gap-2">
                  On the books as
                  <Badge variant="outline">
                    {isBreeding ? "Capital asset" : "Stock"}
                  </Badge>
                </span>
              </h2>
              <p className="mt-1 text-2xl font-medium">
                {isBreeding
                  ? formatMoney(bookValueCents, currencySymbol)
                  : formatMoney(carriedCents, currencySymbol)}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {isBreeding
                  ? `Breeding stock since ${capitalTransfers[0]?.occurredOn ?? "—"}. Her cost moved to fixed assets and depreciates from there, so she is out of stock valuation — she is still an animal here, and a run cannot take her until she comes back to the market herd.`
                  : isAnimal
                    ? "Inventory — what she cost to buy plus what has been spent raising her. A breeding animal is a capital asset instead, and moving her posts an entry rather than setting a flag."
                    : `Inventory — what these cost to buy plus what has been spent raising them. A breeding animal is a capital asset instead, and moving one posts an entry rather than setting a flag.`}
              </p>
              {isBreeding && depreciatedCents > 0 && (
                <p className="mt-1 text-sm text-muted-foreground">
                  {formatMoney(capitalisedCents, currencySymbol)}{" "}
                  capitalised, {formatMoney(depreciatedCents, currencySymbol)}{" "}
                  depreciated so far.
                </p>
              )}
            </div>
            {isOwner && (
              <div className="flex flex-wrap items-center gap-2">
                {isBreeding ? (
                  <ToMarketForm
                    livestockLotId={lot.id}
                    code={inventoryLot.code}
                    bookValueCents={bookValueCents}
                    currencySymbol={currencySymbol}
                    today={today}
                  />
                ) : (
                  /* One animal, because a capital asset is a thing rather than
                     a quantity — the ops layer refuses a pen and says so. */
                  summary.balance === 1 && (
                    <ToBreedingForm
                      livestockLotId={lot.id}
                      code={inventoryLot.code}
                      carriedCents={carriedCents}
                      currencySymbol={currencySymbol}
                      accounts={fixedAssetAccounts}
                      today={today}
                    />
                  )
                )}
              </div>
            )}
          </div>
        </Panel>
      )}

      {/* **WHAT IS IN THIS LOT** (slice 8b). Rendered whenever the lot holds
          anything OR could — a lot that is itself inside another cannot hold
          things, so it gets nothing here rather than an empty invitation. */}
      {/* An ANIMAL holds nothing, so it is not offered the section at all —
          only a lot can contain things (slice 8c). */}
      {!isAnimal && (members.length > 0 || (!insideOf && isOwner)) && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-heading text-xl font-semibold tracking-heading">
              In this {lotWord.toLowerCase()}
            </h2>
            {isOwner && !insideOf && (
              <AddToLotForm
                parentLotId={lot.id}
                parentSpecies={slugLabel(lot.species).toLowerCase()}
                parentSpeciesSlug={lot.species}
                parentItemId={inventoryLot.itemId}
                candidates={joinable}
                today={today}
                word={lotWord}
              />
            )}
          </div>
          <DataTable
            isEmpty={members.length === 0}
            empty={
              <EmptyState
                title={`Nothing in this ${lotWord.toLowerCase()} yet`}
                description={`The head counted above is loose in it — that is right for animals nobody names. Use Add animals to start a named one in here, put an existing one in, or name animals out of this ${lotWord.toLowerCase()} — they stay in it.`}
              />
            }
          >
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Animal</TableHead>
                  <TableHead>Species</TableHead>
                  <TableHead>In since</TableHead>
                  <TableHead className="text-right">Head</TableHead>
                  {isOwner && <TableHead className="w-24" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.map((m) => (
                  <TableRow key={m.livestockLotId}>
                    <TableCell className="font-medium">
                      <Link
                        href={`${BASE}/${m.livestockLotId}`}
                        className="hover:underline"
                      >
                        {m.code}
                      </Link>
                      {/* One head is one animal. Said out loud because the
                          whole point of the slice is that the two are not the
                          same kind of thing. */}
                      {m.isIndividual && (
                        <Badge variant="outline" className="ml-2">
                          animal
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {m.species.charAt(0).toUpperCase() + m.species.slice(1)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {m.startedOn}
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-medium">
                      {m.head}
                    </TableCell>
                    {isOwner && (
                      <TableCell className="text-right">
                        <TakeOutOfLotButton
                          memberLotId={m.livestockLotId}
                          code={m.code}
                          today={today}
                        />
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </DataTable>
          {members.length > 0 && (
            <p className="text-xs text-muted-foreground">
              The head shown at the top of this page is what is loose in the{" "}
              {lotWord.toLowerCase()} itself. These are counted on top of it.
            </p>
          )}
        </div>
      )}

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-heading text-xl font-semibold tracking-heading">
            Breeding
          </h2>
          {isOwner && (
            <div className="flex flex-wrap items-center gap-2">
              <BreedCompositionForm
                livestockLotId={lot.id}
                suggestions={breedSuggestions}
                current={statedBreed}
              />
              {/* **A LOT HAS NO MOTHER AND NO FATHER.** The founder,
                  2026-08-28: *"it gives me the ability to add a sire and a dam.
                  The lot is not the animal."*

                  8c got this wrong by conflating two things. A lot can BE a
                  parent — "these chicks came from that flock" is true, and the
                  offspring table below still says so. A lot HAVING one dam and
                  one sire is a different claim, and for a hundred broilers it
                  is not a fact about anything. */}
              {isAnimal && (
                <SetParentsForm
                  livestockLotId={lot.id}
                  candidates={candidates}
                  damLotId={lot.damLotId}
                  sireLotId={lot.sireLotId}
                />
              )}
              {/* **A LOT DOES NOT GIVE BIRTH.** The founder, 2026-08-28, after
                  the sire-and-dam fix left this behind: a birth is recorded on
                  the MOTHER's page, and a mother is an animal.

                  A hatch parented by a flock is still reachable — the dam
                  picker lists lots as well as animals — it is just started from
                  an animal rather than from the container. This animal is the
                  dam by default, which is what makes the button worth having
                  here rather than only on the hub. */}
              {isAnimal && (
              <RecordBirthForm
                damLotId={lot.sex === "male" ? null : lot.id}
                sireLotId={lot.sex === "male" ? lot.id : null}
                candidates={birthCandidates}
                items={headItems.map((i) => ({ id: i.id, name: i.name }))}
                defaultItemId={inventoryLot.itemId}
                today={today}
              />
              )}
            </div>
          )}
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <Panel className="p-5">
            <h3 className="font-heading text-base font-semibold tracking-heading">
              <span className="flex items-center gap-2">
                Made of
                {/* PROVENANCE ON THE FIGURE, as everywhere else in this pack.
                    A composition somebody entered and one the app worked out
                    from two parents look identical on screen and are not the
                    same kind of fact. */}
                <Badge variant="outline">
                  {COMPOSITION_SOURCE_LABELS[composition.source]}
                </Badge>
              </span>
            </h3>
            <div className="mt-1">
              <p className="text-2xl font-medium">
                {composition.source === "unknown"
                  ? "—"
                  : formatComposition(composition, breedLabel)}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {COMPOSITION_SOURCE_NOTES[composition.source]}
              </p>
              {composition.truncated && (
                <p className="mt-1 text-sm text-muted-foreground">
                  Part of the pedigree could not be followed all the way up, so
                  some of the unknown share is unread rather than unrecorded.
                </p>
              )}
            </div>
          </Panel>

          {/* Animal-only, with Set parents above it — a cohort does not
              have a mother. What a LOT is made of still shows, because a pen of
              Cornish Cross is a real answer to "what are they". */}
          {isAnimal && (
            <Panel className="p-5">
              <h3 className="font-heading text-base font-semibold tracking-heading">
                Pedigree
              </h3>
              <ul className="mt-3 space-y-2 text-sm">
                <PedigreeBranch node={tree.dam} role="Dam" codes={pedigreeCodes} />
                <PedigreeBranch
                  node={tree.sire}
                  role="Sire"
                  codes={pedigreeCodes}
                />
              </ul>
              {!lot.damLotId && !lot.sireLotId && (
                <p className="mt-3 text-sm text-muted-foreground">
                  Naming even one parent is worth doing — a parent nobody knows
                  is half the animal, and the breeding above will say so rather
                  than rounding the other half up.
                </p>
              )}
            </Panel>
          )}
        </div>

        <DataTable
          isEmpty={offspring.length === 0}
          empty={
            <EmptyState
              title={`Nothing out of this ${subjectWord} yet`}
              description={
                isAnimal
                  ? "A birth lands in the same lot she is in, with both parents on it and the head placed."
                  : `Anything born to this ${lotWord.toLowerCase()} shows here. A birth is recorded on the mother's own page.`
              }
            />
          }
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Out of this {subjectWord}</TableHead>
                <TableHead>Born</TableHead>
                <TableHead>Sex</TableHead>
                <TableHead>Side</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {offspring.map((child) => (
                <TableRow key={child.id}>
                  <TableCell className="font-medium">
                    <Link href={`${BASE}/${child.id}`} className="hover:underline">
                      {pedigreeCodes.get(child.id) ?? "—"}
                    </Link>
                  </TableCell>
                  <TableCell className="tabular-nums text-muted-foreground">
                    {child.bornOn ?? "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {child.sex ? (SEX_LABELS[child.sex] ?? child.sex) : "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {child.damLotId === lot.id ? "Dam" : "Sire"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </DataTable>
      </div>

      {documentsOn && (
        <div className="space-y-3">
          <h2 className="font-heading text-xl font-semibold tracking-heading">
            Photos {photos.length > 0 && `(${photos.length})`}
          </h2>
          {/* The design's own list of what a photo of an animal is FOR:
              identification when a tag is unreadable across a field, a
              condition series that shows the gradual loss a daily look cannot,
              documentation for the vet, a sales listing, and evidence for a
              predator or insurance claim. */}
          <RecordPhotos
            entityId={lot.id}
            tenantId={ctx.tenant.id}
            photos={photos}
            canEdit={ctx.role !== "expert"}
            subject={subjectWord}
            attachAction={attachLotPhotoAction}
            setPrimaryAction={setLotPhotoPrimaryAction}
            detachAction={detachLotPhotoAction}
          />
        </div>
      )}

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-heading text-xl font-semibold tracking-heading">
            Tags {identifiers.length > 0 && `(${identifiers.length})`}
          </h2>
          <IdentifierForm livestockLotId={lot.id} today={today} />
        </div>
        <DataTable
          isEmpty={identifiers.length === 0}
          empty={
            <EmptyState
              title="No tags yet"
              description={
                isAnimal
                  ? "An animal carries several — a visual tag you can read across a field, and an official one that reaches processor paperwork."
                  : `A ${lotWord.toLowerCase()} can carry a tag of its own — a pen number, or the lot number a processor will ask for.`
              }
            />
          }
        >
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
        </DataTable>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-heading text-xl font-semibold tracking-heading">
            Daily checks{" "}
            <span className="font-normal text-muted-foreground">
              {/* The lot's own answer to "when did anyone last look at these
                  animals", which is the question the round screen asks about
                  the whole farm. */}
              · last {formatLastChecked(checks[0]?.loggedOn ?? null, today).toLowerCase()}
            </span>
          </h2>
          {summary.balance > 0 && (
            <LotCheckForm
              livestockLotId={lot.id}
              lotCode={inventoryLot.code}
              today={today}
              balance={summary.balance}
              hasEntry={checks[0]?.loggedOn === today}
            />
          )}
        </div>
        <DataTable
          isEmpty={checks.length === 0}
          empty={
            <EmptyState
              title="No checks recorded"
              description="A day with no entry is a day nobody looked — which is a different fact from a day when nothing happened, and it is the difference the mortality rate above depends on."
            />
          }
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Day</TableHead>
                <TableHead>How it was</TableHead>
                <TableHead>Noted</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {checks.map((check) => (
                <TableRow key={check.id}>
                  <TableCell className="tabular-nums text-muted-foreground">
                    {check.loggedOn}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        check.status === "attention" ? "default" : "outline"
                      }
                    >
                      {check.status === "attention" ? "Noted" : "Normal"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {check.notes || "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </DataTable>
      </div>

      {treatments.length > 0 && (
        <div className="space-y-3">
          <h2 className="font-heading text-xl font-semibold tracking-heading">
            Treatments{" "}
            <span className="font-normal text-muted-foreground">
              {/* The sentence as written. Lowercasing it mangled the product
                  name — "penicillin g was given…" — which is the one word in it
                  somebody needs to recognise. */}
              · {formatWithdrawal(withdrawal.meat)} for meat
            </span>
          </h2>
          <DataTable>
            <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>What</TableHead>
                <TableHead>How</TableHead>
                <TableHead className="text-right">Meat clear</TableHead>
                <TableHead className="text-right">Milk clear</TableHead>
                <TableHead>Noted</TableHead>
                <TableHead className="text-right"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {treatments.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="tabular-nums text-muted-foreground">
                    {t.treatedOn}
                  </TableCell>
                  <TableCell>
                    <div className="font-medium">{t.product}</div>
                    <div className="text-xs text-muted-foreground">
                      {[t.dose, t.administeredBy && `by ${t.administeredBy}`]
                        .filter(Boolean)
                        .join(" · ") || "—"}
                    </div>
                    {/* Said out loud rather than left to be inferred from a
                        missing button: this clock is running because of
                        something that happened before this animal was its own
                        record. */}
                    {t.livestockLotId !== lot.id && (
                      <div className="text-xs text-muted-foreground">
                        Given to{" "}
                        {inheritedFrom.get(t.livestockLotId) ?? "the lot it came from"}
                        , before this one was split out
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {treatmentRouteLabel(t.route)}
                    <div className="text-xs">
                      {/* Provenance, as everywhere else in this pack. */}
                      <span
                        title={WITHDRAWAL_SOURCE_NOTES[t.withdrawalSource] ?? ""}
                      >
                        {WITHDRAWAL_SOURCE_LABELS[t.withdrawalSource] ??
                          t.withdrawalSource}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {clearsOn(t.treatedOn, t.meatWithdrawalDays) ?? (
                      <span className="text-muted-foreground">not looked up</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {clearsOn(t.treatedOn, t.milkWithdrawalDays) ?? "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {t.notes || "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    {/* CORRECT for a period or a date typed wrong, REMOVE for a
                        treatment that never happened. Both move the clock, and
                        the clock is what decides whether these can be
                        processed. */}
                    <div className="flex items-center justify-end">
                      {/* AN INHERITED TREATMENT IS ANOTHER RECORD'S ROW. It
                          reaches this animal because it was in the pen when the
                          dose was given — see `treatmentsByLot` — and offering
                          to correct it here would edit the pen's history from
                          an animal's page, silently changing the clock for
                          every other animal that came out of it. */}
                      {t.livestockLotId === lot.id ? (
                        <>
                          <RecordTreatmentForm
                            livestockLotId={lot.id}
                            lotCode={inventoryLot.code}
                            head={summary.balance}
                            today={today}
                            medicines={[]}
                            products={products}
                            existing={{
                              id: t.id,
                              treatedOn: t.treatedOn,
                              product: t.product,
                              dose: t.dose,
                              route: t.route,
                              headTreated: t.headTreated,
                              meatWithdrawalDays: t.meatWithdrawalDays,
                              milkWithdrawalDays: t.milkWithdrawalDays,
                              withdrawalSource: t.withdrawalSource,
                              administeredBy: t.administeredBy,
                              notes: t.notes,
                            }}
                          />
                          <RemoveTreatmentButton
                            treatmentId={t.id}
                            product={t.product}
                            treatedOn={t.treatedOn}
                            fromStock={t.inventoryMovementId !== null}
                          />
                        </>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          Correct it on {inheritedFrom.get(t.livestockLotId) ?? "the lot it came from"}
                        </span>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
            </Table>
          </DataTable>
        </div>
      )}

      {weights.length > 0 && (
        <div className="space-y-3">
          <h2 className="font-heading text-xl font-semibold tracking-heading">
            Weighings{" "}
            <span className="font-normal text-muted-foreground">
              {feed?.weight.conversion
                ? `· ${feed.weight.conversion.ratio} lb of feed per lb of gain`
                : feed?.weight.conversionBlockedBy
                  ? `· ${feed.weight.conversionBlockedBy}`
                  : ""}
            </span>
          </h2>
          <DataTable>
            <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>How</TableHead>
                <TableHead className="text-right">A head</TableHead>
                <TableHead className="text-right">The whole lot</TableHead>
                <TableHead>Noted</TableHead>
                <TableHead className="text-right"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[...weighIns].reverse().map((w) => {
                const row = weights.find((x) => x.id === w.id)!;
                return (
                  <TableRow key={w.id}>
                    <TableCell className="tabular-nums text-muted-foreground">
                      {w.weighedOn}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {/* The sample size, in words, because the design asks for
                          it to be recorded so somebody knows how far to trust
                          the number — which only pays off if it is shown. */}
                      {describeSample(w.method, row.sampleSize, summary.balance)}
                      {w.shrinkAffected && (
                        <Badge variant="outline" className="ml-2">
                          near a haul
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatLb(w.averageLb)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {w.averageLb === null || summary.balance <= 0
                        ? "—"
                        : formatLb(
                            Math.round(w.averageLb * summary.balance * 10) / 10,
                          )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {row.notes || "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      {/* CORRECT for a number typed wrong, REMOVE for a
                          weighing that never happened. A measurement is not a
                          ledger entry, so neither is a compensating row. */}
                      <div className="flex items-center justify-end">
                        <RecordWeightForm
                          livestockLotId={lot.id}
                          lotCode={inventoryLot.code}
                          head={summary.balance}
                          today={today}
                          tapeAvailable={tapeDivisor !== null}
                          existing={{
                            id: row.id,
                            weighedOn: row.weighedOn,
                            method: row.method,
                            sampleSize: row.sampleSize,
                            sampleWeightLb: row.sampleWeightLb,
                            heartGirthIn: row.heartGirthIn,
                            bodyLengthIn: row.bodyLengthIn,
                            notes: row.notes,
                          }}
                        />
                        <RemoveWeightButton
                          weightId={row.id}
                          weighedOn={row.weighedOn}
                        />
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
            </Table>
          </DataTable>
          {feed?.weight.conversion && (
            <p className="text-xs text-muted-foreground">
              {/* The confidence, said out loud. Feed measured against a scale is
                  a number to act on; anything with an estimate at either end is
                  a trend to watch. */}
              {feed.weight.conversion.confidence === "measured"
                ? "Feed issued to this lot by name, against weights off a scale. A number to act on."
                : "Some part of this is an estimate — a share of a shared feeder, or a weight from a tape or an eye. A trend to watch rather than a figure to price against."}
            </p>
          )}
        </div>
      )}

      {fedIn.length > 0 && (
        <div className="space-y-3">
          <h2 className="font-heading text-xl font-semibold tracking-heading">
            Fed in by name{" "}
            <span className="font-normal text-muted-foreground">
              {/* MEASURED ONLY. These are the issues that named this lot; a
                  share of a shared feeder has no row of its own here, because
                  it is a fold over the feeder's draws rather than a movement
                  against this pen. */}
              · {formatMoney(feed?.measuredCents ?? 0, currencySymbol)}
            </span>
          </h2>
          <DataTable>
            <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead className="text-right">Quantity</TableHead>
                <TableHead className="text-right">Cost</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {fedIn.map((movement) => (
                <TableRow key={movement.id}>
                  <TableCell className="tabular-nums text-muted-foreground">
                    {movement.occurredOn}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {Math.abs(movement.quantity)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {/* The cost stamped when it was issued. It does not move
                        when the next delivery arrives, which is what makes
                        comparing lots mean anything. */}
                    {movement.costCents === null
                      ? "—"
                      : formatMoney(movement.costCents, currencySymbol)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
            </Table>
          </DataTable>
        </div>
      )}

      {entries.length > 0 && (
        <div className="space-y-3">
          <h2 className="font-heading text-xl font-semibold tracking-heading">Head events</h2>
          <DataTable>
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
          </DataTable>
        </div>
      )}
    </div>
  );
}
