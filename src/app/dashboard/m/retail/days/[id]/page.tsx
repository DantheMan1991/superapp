import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { withTenant } from "@/db";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { todayInTimezone } from "@/lib/timezone";
import { formatMoney, formatMoneySign } from "@/lib/money";
import { packContext } from "@/lib/packs/tenant-context";
import { labelFor } from "@/lib/packs/resolve";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
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
import { listLocations, listLots } from "@/packs/inventory/ops";
import { formatQuantity } from "@/packs/inventory/core/units";
import { dayTill, priceListFor, truckStock } from "@/packs/retail/ops";
import { Till, StockoutButton } from "@/packs/retail/components/till";
import {
  CashCountForm,
  TruckMoveForm,
} from "@/packs/retail/components/truck-controls";
import { VoidSaleButton } from "@/packs/retail/components/retail-controls";

export const dynamic = "force-dynamic";

const BASE = "/dashboard/m/retail";

/**
 * One selling day: the till, what it took, and whether the tin agrees.
 *
 * **THIS IS THE PAGE THE WHOLE PACK WAS CLIMBING TOWARDS.** Slice 0 could say
 * what a day COST. This says what it made, and therefore — for the first time
 * anywhere in the build — what standing at a market was actually worth.
 *
 * The truck picker is deliberately a storage-location asset like any other. The
 * design's claim that the offline problem "has no distributed-inventory problem
 * inside it" rests entirely on that, and it is visible here: the till reads one
 * snapshot of one location and counts down from it.
 */
export default async function SellingDayPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, "retail");

  const timezone = ctx.tenant.timezone;
  const today = todayInTimezone(timezone);
  /**
   * **THE STALL'S CLOCK, NOT UTC.** These rows were rendered with
   * `toISOString()`, so a farm in Denver selling at four in the afternoon read
   * its own market back as 22:00 — and a sale after five in the evening would
   * have been filed under tomorrow.
   */
  const atTime = (when: Date) =>
    when.toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: timezone,
    });
  const currencySymbol = ctx.tenant.currencySymbol;
  const truckParam = typeof query.truck === "string" ? query.truck : undefined;

  const data = await withTenant(
    ctx.tenant.id,
    async (tx) => {
      const till = await dayTill(tx, ctx.tenant.id, id);
      if (!till) return null;
      const [locations, lots, prices, pack] = await Promise.all([
        listLocations(tx, ctx.tenant.id),
        listLots(tx, ctx.tenant.id, { status: "open" }),
        priceListFor(tx, ctx.tenant.id, till.day.channelId, today),
        packContext(tx, ctx.tenant.id, ctx.tenant.industry, "retail"),
      ]);
      // The truck is whichever storage location the page is pointed at. No new
      // concept: a truck is an asset flagged as somewhere stock is kept.
      const truckAssetId = truckParam ?? locations[0]?.id ?? null;
      const onTruck = truckAssetId
        ? await truckStock(tx, ctx.tenant.id, truckAssetId)
        : [];
      return { till, locations, lots, prices, pack, truckAssetId, onTruck };
    },
    { role: ctx.role },
  );

  if (!data) notFound();
  const { till, locations, lots, prices, pack, truckAssetId, onTruck } = data;

  /**
   * What "bring it back" may offer: the truck's own stock, by item and batch.
   * Everything else on the price list is somewhere else entirely.
   */
  const onTruckItems = [
    ...new Map(
      onTruck.map((l) => [
        l.itemId,
        { id: l.itemId, name: l.itemName, unit: l.unit },
      ]),
    ).values(),
  ];
  const onTruckLots = onTruck
    .filter((l) => l.lotId !== null)
    .map((l) => ({ id: l.lotId!, itemId: l.itemId, code: l.lotCode ?? "" }));
  const dayWord = labelFor(pack.labels, "marketDay", "Market day");
  const priceByItem = new Map(
    prices.map((p) => [p.item.id, p.current?.priceCents ?? null]),
  );
  const stockoutItems = new Set(till.stockouts.map((s) => s.itemId));

  const tillLines = onTruck.map((line) => ({
    itemId: line.itemId,
    itemName: line.itemName,
    unit: line.unit,
    lotId: line.lotId,
    lotCode: line.lotCode,
    onHand: line.onHand,
    priceCents: priceByItem.get(line.itemId) ?? null,
  }));

  const unpriced = tillLines.filter((l) => l.priceCents === null);

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={`${BASE}/${till.day.channelId}`}
          className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="mr-1 h-4 w-4" />
          {till.channelName}
        </Link>
      </div>

      <PageHeader
        title={`${dayWord} · ${till.day.heldOn}`}
        description={`${till.channelName}${
          till.day.weather ? ` · ${till.day.weather}` : ""
        }`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {truckAssetId && (
              <>
                <TruckMoveForm
                  truckAssetId={truckAssetId}
                  items={prices.map((p) => ({
                    id: p.item.id,
                    name: p.item.name,
                    unit: p.item.stockingUnit,
                  }))}
                  lots={lots.map((l) => ({
                    id: l.id,
                    itemId: l.itemId,
                    code: l.code,
                  }))}
                  locations={locations
                    .filter((l) => l.id !== truckAssetId)
                    .map((l) => ({ id: l.id, name: l.name }))}
                  today={today}
                  direction="load"
                />
                <TruckMoveForm
                  truckAssetId={truckAssetId}
                  /* YOU CAN ONLY BRING BACK WHAT YOU TOOK. Offering the whole
                     price list here let a farmer unload feed and antibiotics
                     that were never on the truck, each one a transfer driving
                     the truck negative. The batch comes back with it, so the
                     lot does not end the day stranded on a vehicle. */
                  items={onTruckItems}
                  lots={onTruckLots}
                  locations={locations
                    .filter((l) => l.id !== truckAssetId)
                    .map((l) => ({ id: l.id, name: l.name }))}
                  today={today}
                  direction="unload"
                />
              </>
            )}
            <CashCountForm
              marketDayId={till.day.id}
              openingFloatCents={till.day.openingFloatCents}
              cashCountedCents={till.day.cashCountedCents}
              currencySymbol={currencySymbol}
            />
          </div>
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Took
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold tabular-nums">
              {formatMoney(till.takings.totalCents, currencySymbol)}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {till.takings.saleCount}{" "}
              {till.takings.saleCount === 1 ? "sale" : "sales"} ·{" "}
              {formatMoney(till.takings.cashCents, currencySymbol)} cash
              {till.takings.otherCents > 0 &&
                ` · ${formatMoney(till.takings.otherCents, currencySymbol)} other`}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Margin
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div
              className={`text-2xl font-semibold tabular-nums ${
                till.result.marginCents < 0 ? "text-destructive" : ""
              }`}
            >
              {/* A LOSING DAY MUST LOOK LIKE ONE. `formatMoney` drops the sign
                  on purpose - it formats an AMOUNT, and a margin is not one.
                  Read without the minus, a market that cost $53 and took
                  nothing reads as $53 EARNED, which is the exact opposite of
                  the fact this whole pack exists to surface. */}
              {formatMoneySign(till.result.marginCents, currencySymbol)}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {/* MARGIN, NOT PROFIT, and the name is doing work: what the goods
                  cost to produce is not in here. */}
              {till.result.costUnrecorded
                ? "Nothing recorded for the stall or the journey, so this is just the takings."
                : `After ${formatMoney(till.result.costCents, currencySymbol)} to stand there. What the goods cost to make is not in this.`}
              {till.result.perPersonHourCents !== null &&
                ` ${formatMoneySign(
                  till.result.perPersonHourCents,
                  currencySymbol,
                )} a person-hour.`}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              The tin
            </CardTitle>
          </CardHeader>
          <CardContent>
            {till.cash.uncounted ? (
              <>
                <div className="text-2xl font-semibold text-muted-foreground">
                  —
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {/* Not counted and counted-and-right are different facts. */}
                  Not counted. Expected{" "}
                  {formatMoney(till.cash.expectedCents, currencySymbol)} —
                  float plus cash taken.
                </p>
              </>
            ) : (
              <>
                <div
                  className={`text-2xl font-semibold tabular-nums ${
                    till.cash.varianceCents < 0 ? "text-destructive" : ""
                  }`}
                >
                  {till.cash.varianceCents === 0
                    ? "Balanced"
                    : `${till.cash.varianceCents > 0 ? "+" : "−"}${formatMoney(
                        Math.abs(till.cash.varianceCents),
                        currencySymbol,
                      )}`}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Counted{" "}
                  {formatMoney(till.day.cashCountedCents ?? 0, currencySymbol)}{" "}
                  against {formatMoney(till.cash.expectedCents, currencySymbol)}{" "}
                  expected.
                </p>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {truckAssetId === null ? (
        <EmptyState
          panel
          icon={<ChevronLeft className="h-5 w-5" />}
          title="No truck to sell from"
          description="A market truck is an asset marked as somewhere stock is kept. Add one under Assets and it becomes a place the till can sell out of."
        />
      ) : (
        <Till
          channelId={till.day.channelId}
          marketDayId={till.day.id}
          truckAssetId={truckAssetId}
          lines={tillLines}
          /* WHAT THIS SNAPSHOT ALREADY KNOWS ABOUT. `lines` is a point-in-time
             count, so the till has to add back only the sales that are NOT in
             it yet - and the ref each one was posted under is how it tells. */
          postedRefs={till.sales
            .map((row) => row.sale.clientRef)
            .filter((ref): ref is string => ref !== null)}
          currencySymbol={currencySymbol}
        />
      )}

      {unpriced.length > 0 && (
        <p className="text-sm text-muted-foreground">
          {/* An unpriced thing on the truck cannot be sold, and saying so here
              beats a disabled button somebody has to guess about. */}
          {unpriced.length} {unpriced.length === 1 ? "thing" : "things"} on the
          truck {unpriced.length === 1 ? "has" : "have"} no price at{" "}
          {till.channelName} and cannot be rung up.{" "}
          <Link
            href={`${BASE}/${till.day.channelId}`}
            className="underline hover:text-foreground"
          >
            Set one
          </Link>
          .
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Ran out of</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-xs text-muted-foreground">
            {/* The design's sharpest point about this pack, said on the screen
                where the tap happens. */}
            Selling everything you brought looks like a perfect day and is a lost
            sale. Nothing else in the system can tell selling out at closing time
            from running dry at eleven.
          </p>
          {tillLines.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing on the truck to run out of yet.
            </p>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              {tillLines.map((line) => (
                <span
                  key={`${line.itemId}:${line.lotId ?? ""}`}
                  className="inline-flex items-center gap-2 rounded-md border px-2 py-1"
                >
                  <span className="text-sm">{line.itemName}</span>
                  <StockoutButton
                    marketDayId={till.day.id}
                    itemId={line.itemId}
                    itemName={line.itemName}
                    alreadyNoted={stockoutItems.has(line.itemId)}
                  />
                </span>
              ))}
            </div>
          )}
          {till.stockouts.length > 0 && (
            <Table className="mt-4">
              <TableHeader>
                <TableRow>
                  <TableHead>What</TableHead>
                  <TableHead>When it went</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {till.stockouts.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-medium">{s.itemName}</TableCell>
                    <TableCell className="tabular-nums text-muted-foreground">
                      {atTime(s.noticedAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Sales {till.sales.length > 0 && `(${till.sales.length})`}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {till.sales.length === 0 ? (
            <EmptyState
              icon={<ChevronLeft className="h-5 w-5" />}
              title="Nothing sold yet"
              description="Every sale takes its stock off the truck and stamps the price it was actually charged at."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>What</TableHead>
                  <TableHead>Paid by</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="w-20" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {till.sales.map((row) => (
                  <TableRow key={row.sale.id}>
                    <TableCell className="tabular-nums text-muted-foreground">
                      {atTime(row.sale.soldAt)}
                    </TableCell>
                    <TableCell>
                      {row.lines.map((l) => (
                        <div key={l.id} className="text-sm">
                          {formatQuantity(l.quantity, l.unit)} {l.itemName}
                          <span className="text-muted-foreground">
                            {" "}
                            at {formatMoney(l.unitPriceCents, currencySymbol)}
                          </span>
                        </div>
                      ))}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{row.sale.paymentMethod}</Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-medium">
                      {formatMoney(row.totalCents, currencySymbol)}
                    </TableCell>
                    <TableCell className="text-right">
                      <VoidSaleButton
                        id={row.sale.id}
                        what={`${formatMoney(
                          row.totalCents,
                          currencySymbol,
                        )} at ${atTime(row.sale.soldAt)}`}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
