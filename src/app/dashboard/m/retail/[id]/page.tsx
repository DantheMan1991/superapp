import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { withTenant } from "@/db";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled, isModuleEnabled } from "@/lib/modules";
import { todayInTimezone } from "@/lib/timezone";
import { formatMoney } from "@/lib/money";
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
import { getUnit } from "@/packs/inventory/core/units";
import {
  getChannel,
  listChannels,
  marketDays,
  priceListFor,
} from "@/packs/retail/ops";
import { costPerPersonHour } from "@/packs/retail/core/pricing";
import {
  CHANNEL_STATUS_LABELS,
  slugLabel,
  type ChannelStatus,
} from "@/packs/retail/vocabulary";
import {
  ChannelStatusButton,
  MarketDayForm,
  RemoveMarketDayButton,
  RemovePriceButton,
  SetPriceForm,
} from "@/packs/retail/components/retail-controls";

export const dynamic = "force-dynamic";

const BASE = "/dashboard/m/retail";

/**
 * One channel: what it charges, and what standing there has cost.
 *
 * **THE PRICE LIST SHOWS UNPRICED ITEMS TOO, and that is the point.** A farm
 * sells six of the forty things it holds, so the useful question at a price list
 * is as often *what have I not decided about* as *what do I charge*. Showing
 * only priced rows would make the gap invisible, which is the same reading
 * defect as a card that hides a reason.
 */
export default async function RetailChannelPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, "retail");

  const today = todayInTimezone(ctx.tenant.timezone);
  const currencySymbol = ctx.tenant.currencySymbol;
  // Only signpost a module this tenant actually has.
  const inventoryEnabled = await isModuleEnabled(ctx.tenant.id, "inventory");

  const data = await withTenant(
    ctx.tenant.id,
    async (tx) => {
      const channel = await getChannel(tx, ctx.tenant.id, id);
      if (!channel) return null;
      const [prices, days, channels, pack] = await Promise.all([
        priceListFor(tx, ctx.tenant.id, id, today),
        marketDays(tx, ctx.tenant.id, { channelId: id }),
        listChannels(tx, ctx.tenant.id, { status: "active" }),
        packContext(tx, ctx.tenant.id, ctx.tenant.industry, "retail"),
      ]);
      return { channel, prices, days, channels, pack };
    },
    { role: ctx.role },
  );

  if (!data) notFound();
  const { channel, prices, days, channels, pack } = data;
  const isOwner = ctx.role === "owner";
  const channelWord = labelFor(pack.labels, "channel", "Channel");
  const dayWord = labelFor(pack.labels, "marketDay", "Market day");
  const pricedCount = prices.filter((p) => p.current !== null).length;

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={BASE}
          className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="mr-1 h-4 w-4" />
          Retail
        </Link>
      </div>

      <PageHeader
        title={channel.name}
        description={`${slugLabel(channel.channelKind)}${
          channel.location ? ` · ${channel.location}` : ""
        }`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={channel.status === "active" ? "default" : "outline"}>
              {CHANNEL_STATUS_LABELS[channel.status as ChannelStatus] ??
                channel.status}
            </Badge>
            <MarketDayForm
              channels={channels.map((c) => ({ id: c.id, name: c.name }))}
              dayWord={dayWord}
              currencySymbol={currencySymbol}
              today={today}
              defaultChannelId={channel.id}
            />
            {isOwner && (
              <ChannelStatusButton
                id={channel.id}
                status={channel.status}
                channelWord={channelWord}
              />
            )}
          </div>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Prices · {pricedCount} of {prices.length} priced
          </CardTitle>
        </CardHeader>
        <CardContent>
          {prices.length === 0 ? (
            <EmptyState
              icon={<ChevronLeft className="h-5 w-5" />}
              title="Nothing to price yet"
              description="Prices are set against what the business holds. Add an item in Inventory and it appears here."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead className="text-right">Price</TableHead>
                  <TableHead>Since</TableHead>
                  <TableHead>Next</TableHead>
                  <TableHead className="w-40" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {prices.map((row) => {
                  const unit = getUnit(row.item.stockingUnit);
                  const singular = unit?.singular ?? row.item.stockingUnit;
                  return (
                    <TableRow key={row.item.id}>
                      <TableCell>
                        {inventoryEnabled ? (
                          <Link
                            href={`/dashboard/m/inventory/${row.item.id}`}
                            className="font-medium hover:underline"
                          >
                            {row.item.name}
                          </Link>
                        ) : (
                          <span className="font-medium">{row.item.name}</span>
                        )}
                        <div className="text-xs text-muted-foreground">
                          per {singular}
                        </div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {/* NOT priced here and free are different facts, and the
                            em dash is the first one. Zero is a real price. */}
                        {row.current === null ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          <span className="font-medium">
                            {formatMoney(row.current.priceCents, currencySymbol)}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="tabular-nums text-muted-foreground">
                        {row.current?.effectiveFrom ?? "—"}
                      </TableCell>
                      <TableCell className="tabular-nums text-muted-foreground">
                        {/* A price set ahead and then forgotten is the failure
                            this column exists to prevent. */}
                        {row.upcoming === null ? (
                          "—"
                        ) : (
                          <span>
                            {formatMoney(row.upcoming.priceCents, currencySymbol)}{" "}
                            on {row.upcoming.effectiveFrom}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {isOwner && (
                          <SetPriceForm
                            channelId={channel.id}
                            itemId={row.item.id}
                            itemName={row.item.name}
                            unitSingular={singular}
                            currencySymbol={currencySymbol}
                            currentCents={row.current?.priceCents ?? null}
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
        </CardContent>
      </Card>

      {prices.some((p) => p.history.length > 1) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">What it used to cost</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead className="text-right">Price</TableHead>
                  <TableHead>From</TableHead>
                  {isOwner && <TableHead className="w-24" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {prices
                  .filter((p) => p.history.length > 1)
                  .flatMap((p) =>
                    p.history.map((h) => (
                      <TableRow key={h.id}>
                        <TableCell className="font-medium">
                          {p.item.name}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatMoney(h.priceCents, currencySymbol)}
                        </TableCell>
                        <TableCell className="tabular-nums text-muted-foreground">
                          {h.effectiveFrom}
                          {h.id === p.current?.id && (
                            <Badge variant="outline" className="ml-2">
                              now
                            </Badge>
                          )}
                        </TableCell>
                        {isOwner && (
                          <TableCell className="text-right">
                            <RemovePriceButton id={h.id} />
                          </TableCell>
                        )}
                      </TableRow>
                    )),
                  )}
              </TableBody>
            </Table>
            <p className="mt-3 text-xs text-muted-foreground">
              A price change is a new row from a day, never an edit — which is
              what lets a margin report ask what you charged in June rather than
              only what you charge now.
            </p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{dayWord}s here</CardTitle>
        </CardHeader>
        <CardContent>
          {days.length === 0 ? (
            <EmptyState
              icon={<ChevronLeft className="h-5 w-5" />}
              title={`No ${dayWord.toLowerCase()} recorded here yet`}
              description="Record what it cost to stand there. Two seasons of this is what settles which market is worth going to and which one is habit."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead className="text-right">Stall fee</TableHead>
                  <TableHead className="text-right">Getting there</TableHead>
                  <TableHead className="text-right">Person-hours</TableHead>
                  <TableHead className="text-right">Cost an hour</TableHead>
                  <TableHead>Weather</TableHead>
                  <TableHead className="w-24" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {days.map((row) => {
                  const perHour = costPerPersonHour(row.cost);
                  return (
                    <TableRow key={row.day.id}>
                      <TableCell className="tabular-nums font-medium">
                        {row.day.heldOn}
                        {row.day.notes && (
                          <div className="text-xs font-normal text-muted-foreground">
                            {row.day.notes}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {row.day.stallFeeCents === null
                          ? "—"
                          : formatMoney(row.day.stallFeeCents, currencySymbol)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {row.day.travelCents === null
                          ? "—"
                          : formatMoney(row.day.travelCents, currencySymbol)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {row.cost.personHours ?? "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {perHour === null
                          ? "—"
                          : formatMoney(perHour, currencySymbol)}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {row.day.weather || "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        <RemoveMarketDayButton id={row.day.id} />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {channel.notes && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Notes</CardTitle>
          </CardHeader>
          <CardContent className="whitespace-pre-wrap text-sm text-muted-foreground">
            {channel.notes}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
