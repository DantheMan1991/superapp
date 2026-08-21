import Link from "next/link";
import { Store } from "lucide-react";
import { withTenant } from "@/db";
import type { TenantContext } from "@/lib/auth";
import { todayInTimezone } from "@/lib/timezone";
import { formatMoney } from "@/lib/money";
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
import { packContext } from "@/lib/packs/tenant-context";
import { labelFor } from "@/lib/packs/resolve";
import { listChannels, marketDays, pricedCountByChannel } from "./ops";
import { costPerPersonHour } from "./core/pricing";
import {
  CHANNEL_STATUS_LABELS,
  channelKindsFrom,
  slugLabel,
  type ChannelStatus,
} from "./vocabulary";
import {
  ChannelForm,
  MarketDayForm,
} from "./components/retail-controls";

const BASE = "/dashboard/m/retail";

/** Enough to show a season's shape without becoming a ledger. */
const RECENT_DAYS = 20;

/**
 * The `retail` pack's home: where the business sells, and what standing there
 * costs.
 *
 * **WHAT IS DELIBERATELY NOT ON THIS PAGE YET IS REVENUE.** Slice 0 records the
 * cost side of a selling day — the stall fee, the travel, the hours — because
 * three of the four numbers in *profit per market day* are recordable before any
 * till exists, and the fourth arrives with slice 1. A page that showed a profit
 * column full of em dashes would be promising something; a page that shows what
 * a day cost is answering the cheaper half honestly.
 */
export async function RetailModule({
  ctx,
}: {
  ctx: TenantContext;
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const today = todayInTimezone(ctx.tenant.timezone);
  const currencySymbol = ctx.tenant.currencySymbol;

  const { channels, priced, days, pack } = await withTenant(
    ctx.tenant.id,
    async (tx) => {
      const [channels, days, pack] = await Promise.all([
        listChannels(tx, ctx.tenant.id),
        marketDays(tx, ctx.tenant.id, { limit: RECENT_DAYS }),
        packContext(tx, ctx.tenant.id, ctx.tenant.industry, "retail"),
      ]);
      const priced = await pricedCountByChannel(
        tx,
        ctx.tenant.id,
        channels.map((c) => c.id),
        today,
      );
      return { channels, priced, days, pack };
    },
    { role: ctx.role },
  );

  const isOwner = ctx.role === "owner";
  const channelWord = labelFor(pack.labels, "channel", "Channel");
  const dayWord = labelFor(pack.labels, "marketDay", "Market day");
  const openChannels = channels.filter((c) => c.status === "active");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Retail"
        description={`Where the business sells, what it charges there, and what a ${dayWord.toLowerCase()} costs to stand at.`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <MarketDayForm
              channels={openChannels.map((c) => ({ id: c.id, name: c.name }))}
              dayWord={dayWord}
              currencySymbol={currencySymbol}
              today={today}
            />
            {isOwner && (
              <ChannelForm
                channelWord={channelWord}
                kindOptions={channelKindsFrom(pack.config)}
              />
            )}
          </div>
        }
      />

      {channels.length === 0 ? (
        <EmptyState
          panel
          icon={<Store className="h-5 w-5" />}
          title="Nowhere to sell yet"
          description={
            isOwner
              ? `Add the first ${channelWord.toLowerCase()} — a market stall, the farm gate, a shop. Prices live per ${channelWord.toLowerCase()}, because the same pound is one price at a stall and another at the gate, and neither of them is the price.`
              : `An owner adds somewhere to sell. Once they do, prices and ${dayWord.toLowerCase()}s show up here.`
          }
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{channelWord}</TableHead>
              <TableHead>Kind</TableHead>
              <TableHead>Where</TableHead>
              <TableHead className="text-right">Priced</TableHead>
              <TableHead>State</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {channels.map((channel) => (
              <TableRow key={channel.id}>
                <TableCell>
                  <Link
                    href={`${BASE}/${channel.id}`}
                    className="font-medium hover:underline"
                  >
                    {channel.name}
                  </Link>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {slugLabel(channel.channelKind)}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {channel.location || "—"}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {/* How many things this channel has a price for today. Zero is
                      an honest and common answer for a channel just added. */}
                  {priced.get(channel.id) ?? 0}
                </TableCell>
                <TableCell>
                  <Badge
                    variant={channel.status === "active" ? "default" : "outline"}
                  >
                    {CHANNEL_STATUS_LABELS[channel.status as ChannelStatus] ??
                      channel.status}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {days.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent {dayWord.toLowerCase()}s</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Where</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                  <TableHead className="text-right">Person-hours</TableHead>
                  <TableHead className="text-right">Cost an hour</TableHead>
                  <TableHead>Weather</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {days.map((row) => {
                  const perHour = costPerPersonHour(row.cost);
                  return (
                    <TableRow key={row.day.id}>
                      {/* THE LINK GOES ON THE THING IT OPENS. Found by
                          clicking: the DATE was the link and it led to the
                          channel, while the channel's own name sat inert
                          beside it. There is no page for a single day, so the
                          date is plain text and the channel is the link. */}
                      <TableCell className="tabular-nums font-medium">
                        {row.day.heldOn}
                      </TableCell>
                      <TableCell>
                        <Link
                          href={`${BASE}/${row.day.channelId}`}
                          className="text-muted-foreground hover:underline hover:text-foreground"
                        >
                          {row.channelName}
                        </Link>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {/* Nothing recorded is an em dash, not zero. A farm gate
                            with no fee and no journey is a real zero and a
                            different fact. */}
                        {row.cost.unrecorded
                          ? "—"
                          : formatMoney(row.cost.outOfPocketCents, currencySymbol)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {row.cost.personHours ?? "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {perHour === null
                          ? "—"
                          : formatMoney(perHour, currencySymbol)}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {row.day.weather || "—"}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            <p className="mt-3 text-xs text-muted-foreground">
              {/* Said plainly rather than left as a column of dashes. */}
              What each day MADE arrives with the till. Until then this is the
              cost side, and the hours sit beside the money rather than inside
              it — own time counted as nothing makes every market look worth
              going to.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
