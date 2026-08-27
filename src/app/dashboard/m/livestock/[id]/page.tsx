import Link from "next/link";
import { notFound } from "next/navigation";
import { Beef } from "lucide-react";
import { LivestockNav } from "@/packs/livestock/components/livestock-nav";
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
import {
  consumedByLot,
  getLot as getInventoryLot,
  listItems,
  listMovements,
  movementKindsForLots,
} from "@/packs/inventory/ops";
import { formatMoney } from "@/lib/money";
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
  offspringOf,
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
        ]);
      const structures = await listStructures(
        tx,
        ctx.tenant.id,
        structureKindsFrom(landPack.config),
      );
      // Every animal in the tree, plus the offspring, named in one query. The
      // index carries ids because the fold that reads it is pure.
      const pedigreeCodes = await codesByLivestockLot(tx, ctx.tenant.id, [
        ...pedigree.keys(),
        ...offspring.map((o) => o.id),
      ]);
      const statedBreed =
        (await breedPartsByLot(tx, ctx.tenant.id, [lot.id])).get(lot.id) ?? [];
      return {
        lot,
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
  } = data;

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
            {isOwner && summary.balance > 0 && (
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
              <SetParentsForm
                livestockLotId={lot.id}
                candidates={candidates}
                damLotId={lot.damLotId}
                sireLotId={lot.sireLotId}
              />
              {/* This animal is the dam by default, which is what makes the
                  button worth having HERE rather than only on the hub. */}
              <RecordBirthForm
                damLotId={lot.sex === "male" ? null : lot.id}
                sireLotId={lot.sex === "male" ? lot.id : null}
                candidates={candidates}
                items={headItems.map((i) => ({ id: i.id, name: i.name }))}
                defaultItemId={inventoryLot.itemId}
                today={today}
              />
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
                  : formatComposition(composition, slugLabel)}
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
              {/* The superseded column, shown only while it still holds
                  something. Nothing can parse "½ Angus, ¼ Hereford" back into
                  fractions, so the old string is a prompt rather than data. */}
              {lot.breed && (
                <p className="mt-3 text-sm text-muted-foreground">
                  Recorded before breeding was kept as fractions:{" "}
                  <span className="font-medium text-foreground">{lot.breed}</span>
                  . Enter it again above and this note goes away.
                </p>
              )}
            </div>
          </Panel>

          <Panel className="p-5">
            <h3 className="font-heading text-base font-semibold tracking-heading">
              Pedigree
            </h3>
            <ul className="mt-3 space-y-2 text-sm">
              <PedigreeBranch node={tree.dam} role="Dam" codes={pedigreeCodes} />
              <PedigreeBranch node={tree.sire} role="Sire" codes={pedigreeCodes} />
            </ul>
            {!lot.damLotId && !lot.sireLotId && (
              <p className="mt-3 text-sm text-muted-foreground">
                Naming even one parent is worth doing — a parent nobody knows is
                half the animal, and the breeding above will say so rather than
                rounding the other half up.
              </p>
            )}
          </Panel>
        </div>

        <DataTable
          isEmpty={offspring.length === 0}
          empty={
            <EmptyState
              title="Nothing out of this animal yet"
              description="A birth starts a lot of its own, with both parents on it and the head placed."
            />
          }
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Out of this animal</TableHead>
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
              description="An animal carries several — a visual tag you can read across a field, and an official one that reaches processor paperwork."
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
                        comparing batches mean anything. */}
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
