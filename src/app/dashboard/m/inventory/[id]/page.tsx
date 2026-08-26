import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { withTenant } from "@/db";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { formatMoney } from "@/lib/money";
import { todayInTimezone } from "@/lib/timezone";
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
  carriedCostByLot,
  costAdjustmentsForLots,
  getItem,
  listLocations,
  itemCostRate,
  listItems,
  listLots,
  listMovements,
  movementRowsForItem,
  weightRatesForItems,
} from "@/packs/inventory/ops";
import {
  balanceByLocation,
  balanceOfLot,
} from "@/packs/inventory/core/balances";
import { carriedValue } from "@/packs/inventory/core/valuation";
import { formatQuantity, getUnit } from "@/packs/inventory/core/units";
import { formatWeight, weightOf } from "@/packs/inventory/core/weight";
import {
  LOT_SOURCE_LABELS,
  isLotSource,
  adjustmentReasonLabel,
  costAdjustmentReasonLabel,
  movementKindLabel,
  slugLabel,
} from "@/packs/inventory/vocabulary";
import {
  LotCostForm,
  LotForm,
  MovementForm,
  SplitLotForm,
} from "@/packs/inventory/components/stock-controls";
import { ItemControls } from "@/packs/inventory/components/item-form";

export const dynamic = "force-dynamic";

const BASE = "/dashboard/m/inventory";

/**
 * One item: how much there is, WHERE, and which batch it belongs to.
 *
 * The "where" card is the day-one screen the design named — *"which freezer has
 * the ribeyes"* — and it needs no history at all beyond one recorded movement.
 *
 * Every number here is folded from the ledger by `core/balances.ts`. Nothing on
 * this page reads a stored quantity, because there is not one.
 */
export default async function InventoryItemPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, "inventory");

  const today = todayInTimezone(ctx.tenant.timezone);
  const currencySymbol = ctx.tenant.currencySymbol;

  const data = await withTenant(
    ctx.tenant.id,
    async (tx) => {
      const item = await getItem(tx, ctx.tenant.id, id);
      if (!item) return null;
      const [lots, rows, movements, locations, allLots, allItems, costRate, weights] =
        await Promise.all([
          listLots(tx, ctx.tenant.id, { itemId: id }),
          movementRowsForItem(tx, ctx.tenant.id, id),
          listMovements(tx, ctx.tenant.id, { itemId: id, limit: 25 }),
          listLocations(tx, ctx.tenant.id),
          // Anything that can EAT this, which is deliberately every open lot
          // on the farm: feed is not the same item as the birds that eat it.
          listLots(tx, ctx.tenant.id),
          listItems(tx, ctx.tenant.id, { status: "active" }),
          itemCostRate(tx, ctx.tenant.id, id),
          // Both halves — the item's rate for the card, every batch's for the
          // table — come back from ONE query. See `weightRatesForItems`.
          weightRatesForItems(tx, ctx.tenant.id, [id]),
        ]);
      /**
       * **THE SECOND ROUND TRIP IS THE LOT LIST'S FAULT, not an oversight.**
       * Both of these are keyed by lot, and the lots are what the first round
       * just went to fetch. Batched across every lot at once rather than asked
       * per row, which is how a page with twenty batches becomes a page with
       * twenty-one queries.
       */
      const lotIds = lots.map((l) => l.id);
      const [carried, corrections] = await Promise.all([
        carriedCostByLot(tx, ctx.tenant.id, lotIds),
        costAdjustmentsForLots(tx, ctx.tenant.id, lotIds),
      ]);
      return {
        item,
        lots,
        rows,
        movements,
        weights,
        locations,
        allLots,
        allItems,
        costRate,
        carried,
        corrections,
      };
    },
    { role: ctx.role },
  );

  if (!data) notFound();
  const {
    item,
    lots,
    rows,
    movements,
    weights,
    locations,
    allLots,
    allItems,
    costRate,
    carried,
    corrections,
  } = data;

  /**
   * Recording stock in and out is a chore and is ungated. Starting a batch or
   * splitting one creates a cost object, so both stay with the owner.
   * See src/lib/packs/authorize.ts.
   */
  const isOwner = ctx.role === "owner";
  const unit = item.stockingUnit;
  const unitLabel = getUnit(unit)?.plural ?? unit;
  const unitSingular = getUnit(unit)?.singular ?? unit;
  const locationNames = new Map(locations.map((l) => [l.id, l.name]));
  const lotCodes = new Map(lots.map((l) => [l.id, l.code]));

  const total = rows.reduce((sum, r) => sum + r.quantity, 0);
  const byLocation = balanceByLocation(rows);
  /**
   * **"258 packages · about 291 lb", and the "about" is the point.** A batch's
   * average is the only thing there is — the actual packages are each a little
   * more or less — so the figure is an estimate and has to read as one. Null
   * for anything nobody has weighed: UNWEIGHED IS NOT ZERO.
   */
  const totalReading = weightOf({
    unit,
    quantity: total,
    rate: weights.byItem.get(item.id) ?? null,
  });
  /**
   * **ONLY WHEN IT SAYS SOMETHING THE QUANTITY DOES NOT.** For an item stocked
   * by mass, `weightOf` returns the quantity converted — exact, and "840 lb"
   * printed under "840 pounds" is a second copy of one number. `approximate` is
   * true exactly when the figure came from a measured average instead, which is
   * the case where it adds something.
   */
  const totalWeight = totalReading.approximate ? formatWeight(totalReading) : null;

  const lotOptions = lots
    .filter((l) => l.status === "open")
    .map((l) => ({
      id: l.id,
      code: l.code,
      balanceLabel: formatQuantity(balanceOfLot(rows, l.id), unit),
    }));
  const locationOptions = locations.map((l) => ({ id: l.id, name: l.name }));
  /**
   * The lots feed can be fed TO. Named with their item, because "B-2026-04-15"
   * alone does not say whether it is a pen of broilers or a pallet of cartons.
   * This item's own lots are left out — stock does not consume itself.
   */
  const itemNames = new Map(allItems.map((i) => [i.id, i.name]));
  const consumerOptions = allLots
    .filter((l) => l.status === "open" && l.itemId !== item.id)
    .map((l) => ({
      id: l.id,
      label: `${l.code} · ${itemNames.get(l.itemId) ?? "—"}`,
    }));

  return (
    <div className="space-y-6">
      <Link
        href={BASE}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" />
        All inventory
      </Link>

      <PageHeader
        title={item.name}
        description={
          <span className="flex items-center gap-2">
            {slugLabel(item.itemKind)}
            {" · counted in "}
            {unitLabel}
            {item.storageRequirement && (
              <Badge variant="outline">{slugLabel(item.storageRequirement)}</Badge>
            )}
            {item.status === "archived" && <Badge variant="outline">archived</Badge>}
          </span>
        }
        actions={
          isOwner ? (
            <div className="flex flex-wrap items-center gap-2">
              {/* Starting a batch and moving stock are acts on a LIVE item.
                  Editing is not: a retired item is exactly the one somebody
                  needs to reach, to put it back. */}
              {item.status === "active" && (
                <>
                  <LotForm itemId={item.id} today={today} />
                  <MovementForm
                    itemId={item.id}
                    unitLabel={unitLabel}
                    lots={lotOptions}
                    locations={locationOptions}
                    consumers={consumerOptions}
                    unitSingular={unitSingular}
                    stockedByMass={getUnit(unit)?.dimension === "mass"}
                    currencySymbol={currencySymbol}
                    today={today}
                  />
                </>
              )}
              <ItemControls
                item={{
                  id: item.id,
                  name: item.name,
                  itemKind: item.itemKind,
                  stockingUnit: item.stockingUnit,
                  purchaseUnit: item.purchaseUnit,
                  purchaseUnitQty: item.purchaseUnitQty,
                  storageRequirement: item.storageRequirement,
                  notes: item.notes,
                  status: item.status,
                }}
                kindsInUse={[...new Set(allItems.map((i) => i.itemKind))]}
                /* ONE MOVEMENT IS ENOUGH TO FREEZE THE UNIT, and `rows` is
                   every movement this item has. Not the balance: an item that
                   received ten and issued ten is back at zero and its ledger
                   is still denominated in the old unit. */
                unitLocked={rows.length > 0}
                onHandLabel={
                  rows.length === 0 ? null : formatQuantity(total, unit)
                }
              />
            </div>
          ) : null
        }
      />

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">On hand</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-medium tabular-nums">
              {rows.length === 0 ? "—" : formatQuantity(total, unit)}
            </p>
            {rows.length > 0 && totalWeight && (
              <p className="mt-1 text-sm text-muted-foreground tabular-nums">
                {/* Only shown when somebody weighed a delivery of it. An item
                    nobody has weighed says nothing here rather than "0 lb",
                    which would be a fact that is not true. */}
                {totalWeight}
              </p>
            )}
            <p className="mt-1 text-sm text-muted-foreground">
              {rows.length === 0
                ? "Nothing recorded yet. Every number here is the sum of what you enter."
                : `From ${rows.length} ${rows.length === 1 ? "entry" : "entries"}.`}
            </p>
            {costRate !== null && (
              <p className="mt-1 text-sm text-muted-foreground">
                {/* **COST ACCUMULATION, NOT VALUATION.** This is the average
                    paid across everything received — the rate an issue is
                    stamped at. What the stock ON HAND is worth is a different
                    question, it is basis-dependent, and it belongs to slice 3
                    rather than to a card that would have to guess. */}
                Averaging{" "}
                <span className="font-medium tabular-nums">
                  {formatMoney(Math.round(costRate), currencySymbol)}
                </span>{" "}
                a {unitSingular} across everything received.
              </p>
            )}
            {total < 0 && (
              // Deliberately reported rather than prevented. Stock goes
              // negative when Monday's delivery is entered on Wednesday, and
              // refusing the Tuesday entry teaches people to stop entering.
              <p className="mt-3 text-sm text-muted-foreground">
                That is below zero, which usually means something was used
                before the delivery that covered it was entered.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Where it is</CardTitle>
          </CardHeader>
          <CardContent>
            {byLocation.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nothing on hand anywhere.
              </p>
            ) : (
              <ul className="space-y-2 text-sm">
                {byLocation.map((b) => (
                  <li
                    key={b.locationAssetId ?? "none"}
                    className="flex items-baseline justify-between gap-3"
                  >
                    <span
                      className={
                        b.locationAssetId ? "font-medium" : "text-muted-foreground"
                      }
                    >
                      {/* "Somewhere, uncounted" is kept rather than hidden —
                          otherwise the parts would not add up to the total. */}
                      {b.locationAssetId
                        ? (locationNames.get(b.locationAssetId) ?? "Unknown place")
                        : "Not recorded"}
                    </span>
                    <span className="tabular-nums">
                      {formatQuantity(b.quantity, unit)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="space-y-3">
        <h2 className="text-sm font-medium">
          Batches {lots.length > 0 && `(${lots.length})`}
        </h2>
        {lots.length === 0 ? (
          <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
            No batches yet. A batch is what traceability follows, and what a
            cost attaches to — one delivery, one hatch, one pen.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Batch</TableHead>
                <TableHead>From</TableHead>
                <TableHead>Started</TableHead>
                <TableHead>Good until</TableHead>
                <TableHead className="text-right">On hand</TableHead>
                <TableHead className="text-right">Carrying</TableHead>
                <TableHead className="w-36" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {lots.map((lot) => {
                const balance = balanceOfLot(rows, lot.id);
                /**
                 * **`carriedValue`, NEVER `remainingCents`.** A batch nobody
                 * costed and a batch whose cost has all been released both fold
                 * to zero, and only the second is worth nothing. Since
                 * ADR 0012 §A.4 an appended correction counts as having costed
                 * it too — which is what stops a batch corrected into
                 * existence reading as "No cost recorded".
                 */
                const cost = carried.get(lot.id);
                const carriedCents = cost ? carriedValue(cost) : null;
                // Same rule as the card above: shown only when it says
                // something the quantity does not.
                const reading = weightOf({
                  unit,
                  quantity: balance,
                  rate: weights.byLot.get(lot.id) ?? null,
                });
                const weightLabel = reading.approximate
                  ? formatWeight(reading)
                  : null;
                const received = rows
                  .filter((r) => r.lotId === lot.id && r.quantity > 0)
                  .reduce((sum, r) => sum + r.quantity, 0);
                return (
                  <TableRow key={lot.id}>
                    <TableCell>
                      <div className="flex items-center gap-2 font-medium">
                        {lot.code}
                        {lot.status === "closed" && (
                          <Badge variant="outline">closed</Badge>
                        )}
                        {lot.parentLotId && (
                          <Badge variant="outline">split</Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {isLotSource(lot.source)
                        ? LOT_SOURCE_LABELS[lot.source]
                        : lot.source}
                    </TableCell>
                    <TableCell className="tabular-nums text-muted-foreground">
                      {lot.openedOn ?? "—"}
                    </TableCell>
                    <TableCell
                      className={`tabular-nums ${
                        /* Past its date AND still on the shelf is the only
                           combination worth colouring: an empty batch cannot go
                           off into a loss. */
                        lot.expiresOn && lot.expiresOn < today && balance > 0
                          ? "text-destructive"
                          : "text-muted-foreground"
                      }`}
                    >
                      {lot.expiresOn ?? "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatQuantity(balance, unit)}
                      {/* **PER BATCH, AND THAT IS THE WHOLE REASON THE RATE IS
                          KEPT PER LOT.** A run packed in 1 lb bags and a run
                          packed in 2 lb bags are different batches; one figure
                          across the item would be true of neither. */}
                      {weightLabel && (
                        <span className="block text-xs text-muted-foreground">
                          {weightLabel}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {carriedCents === null ? (
                        <span className="text-muted-foreground">
                          No cost recorded
                        </span>
                      ) : (
                        formatMoney(carriedCents, currencySymbol)
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {/* **A CORRECTION IS OFFERED ON AN EMPTY BATCH TOO**, and
                          on a closed one. The invoice for a delivery routinely
                          arrives after the feed has been eaten, and a screen
                          that only offers the correction while stock is still
                          on the shelf refuses the commonest case there is. */}
                      {isOwner && (
                        <LotCostForm
                          lot={{
                            id: lot.id,
                            code: lot.code,
                            carriedLabel:
                              carriedCents === null
                                ? null
                                : formatMoney(carriedCents, currencySymbol),
                            quantityOnHand: balance,
                            quantityReceived: received,
                            onHandLabel: formatQuantity(balance, unit),
                            receivedLabel: formatQuantity(received, unit),
                          }}
                          currencySymbol={currencySymbol}
                          today={today}
                        />
                      )}
                      {isOwner && lot.status === "open" && balance > 0 && (
                        <SplitLotForm
                          lot={{
                            id: lot.id,
                            code: lot.code,
                            balanceLabel: formatQuantity(balance, unit),
                          }}
                          unitLabel={unitLabel}
                          locations={locationOptions}
                          today={today}
                        />
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>

      {corrections.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-medium">Cost corrections</h2>
          {/**
           * **A SECTION OF ITS OWN, not rows folded into "Recent entries".**
           * Every row in that table moved something; none of these did. Listing
           * them together would put a $60 correction beside a 20 lb issue under
           * a heading that says what happened, and one of the two would be
           * lying about which column matters.
           *
           * The SPLIT is shown rather than the total alone, because the split
           * is the part somebody will come back to argue with — it is why the
           * batch went up by less than the correction, and it is the figure
           * that was frozen at the moment it was written.
           */}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Batch</TableHead>
                <TableHead>Why</TableHead>
                <TableHead className="text-right">Correction</TableHead>
                <TableHead className="text-right">To the batch</TableHead>
                <TableHead className="text-right">To cost of goods</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {corrections.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="tabular-nums text-muted-foreground">
                    {c.occurredOn}
                  </TableCell>
                  <TableCell>{lotCodes.get(c.lotId) ?? "—"}</TableCell>
                  <TableCell>
                    {costAdjustmentReasonLabel(c.reason)}
                    {c.notes && (
                      <div className="text-xs text-muted-foreground">
                        {c.notes}
                      </div>
                    )}
                    <div className="text-xs text-muted-foreground">
                      {/* WHAT THE LEDGER BELIEVED, stamped. This is the whole
                          reason the two quantity columns are stored, and the
                          only place a person can check the split against it. */}
                      {formatQuantity(c.quantityOnHand, unit)} of{" "}
                      {formatQuantity(c.quantityReceived, unit)} still on hand
                      then
                    </div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {c.amountCents > 0 ? "+" : "−"}
                    {formatMoney(Math.abs(c.amountCents), currencySymbol)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {c.onHandCents === 0
                      ? "—"
                      : (c.onHandCents > 0 ? "+" : "−") +
                        formatMoney(Math.abs(c.onHandCents), currencySymbol)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {c.issuedCents === 0
                      ? "—"
                      : (c.issuedCents > 0 ? "+" : "−") +
                        formatMoney(Math.abs(c.issuedCents), currencySymbol)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {movements.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-medium">Recent entries</h2>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>What happened</TableHead>
                <TableHead>Where</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="text-right">Cost</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {movements.map((m) => (
                <TableRow key={m.id}>
                  <TableCell className="tabular-nums text-muted-foreground">
                    {m.occurredOn}
                  </TableCell>
                  <TableCell>
                    {movementKindLabel(m.movementKind)}
                    {/**
                     * **THE REASON, BESIDE THE ENTRY.** Found by clicking: the
                     * ledger said "Adjusted · −20 pounds · $10.00" and nothing
                     * at all about why, on the one screen somebody looks at
                     * when they wonder where the feed went. The reason is the
                     * whole point of an adjustment; a row that hides it is a row
                     * that turned a diagnostic back into a correction.
                     */}
                    {m.reason && (
                      <div className="text-xs text-muted-foreground">
                        {adjustmentReasonLabel(m.reason)}
                      </div>
                    )}
                    {m.notes && (
                      <div className="text-xs text-muted-foreground">
                        {m.notes}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {m.locationAssetId
                      ? (locationNames.get(m.locationAssetId) ?? "—")
                      : "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {m.quantity > 0 ? "+" : ""}
                    {formatQuantity(m.quantity, unit)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {/* **THE PAGE THAT OWNS THE MONEY HAS TO SHOW IT.** Slice 1
                        stored a cost on every receipt and issue and this table
                        listed neither, so a $340 delivery landed and the item
                        page never mentioned it. Found by driving it. */}
                    {m.costCents === null ? "—" : formatMoney(m.costCents, currencySymbol)}
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
