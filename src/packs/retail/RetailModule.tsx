import Link from "next/link";
import { Store } from "lucide-react";
import { withTenant } from "@/db";
import type { TenantContext } from "@/lib/auth";
import { todayInTimezone } from "@/lib/timezone";
import { formatMoney } from "@/lib/money";
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
import { labelFor } from "@/lib/packs/resolve";
import {
  listChannels,
  marketDays,
  pricedCountByChannel,
  takingsByDay,
} from "./ops";
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

  const { channels, priced, days, pack, took } = await withTenant(
    ctx.tenant.id,
    async (tx) => {
      const [channels, days, pack] = await Promise.all([
        listChannels(tx, ctx.tenant.id),
        marketDays(tx, ctx.tenant.id, { limit: RECENT_DAYS }),
        packContext(tx, ctx.tenant.id, ctx.tenant.industry, "retail"),
      ]);
      const [priced, took] = await Promise.all([
        pricedCountByChannel(
          tx,
          ctx.tenant.id,
          channels.map((c) => c.id),
          today,
        ),
        takingsByDay(
          tx,
          ctx.tenant.id,
          days.map((d) => d.day.id),
        ),
      ]);
      return { channels, priced, days, pack, took };
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
        icon={<Store />}
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

      <DataTable
        isEmpty={channels.length === 0}
        empty={
          <EmptyState
            icon={<Store className="h-5 w-5" />}
          title="Nowhere to sell yet"
          description={
            isOwner
              ? `Add the first ${channelWord.toLowerCase()} — a market stall, the farm gate, a shop. Prices live per ${channelWord.toLowerCase()}, because the same pound is one price at a stall and another at the gate, and neither of them is the price.`
              : `An owner adds somewhere to sell. Once they do, prices and ${dayWord.toLowerCase()}s show up here.`
            }
          />
        }
      >
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
      </DataTable>

      {days.length > 0 && (
        <section>
          <h2 className="mb-3 font-heading text-xl font-semibold tracking-heading">
            Recent {dayWord.toLowerCase()}s
          </h2>
          <DataTable>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Where</TableHead>
                  <TableHead className="text-right">Took</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                  <TableHead className="text-right">Margin</TableHead>
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
                      {/* The date is the link again now that a day HAS a page:
                          slice 0 left it plain because there was nothing behind
                          it, and slice 1 gave it the till. */}
                      <TableCell className="tabular-nums font-medium">
                        <Link
                          href={`${BASE}/days/${row.day.id}`}
                          className="hover:underline"
                        >
                          {row.day.heldOn}
                        </Link>
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
                        {(took.get(row.day.id)?.totalCents ?? 0) === 0
                          ? "—"
                          : formatMoney(
                              took.get(row.day.id)!.totalCents,
                              currencySymbol,
                            )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {/* Nothing recorded is an em dash, not zero. A farm gate
                            with no fee and no journey is a real zero and a
                            different fact. */}
                        {row.cost.unrecorded
                          ? "—"
                          : formatMoney(row.cost.outOfPocketCents, currencySymbol)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-medium">
                        {/* THE NUMBER THE PACK WAS BUILT FOR. Takings less what
                            it cost to stand there — and NOT less the hours,
                            which sit in their own column. */}
                        {(took.get(row.day.id)?.totalCents ?? 0) === 0
                          ? "—"
                          : formatMoney(
                              took.get(row.day.id)!.totalCents -
                                row.cost.outOfPocketCents,
                              currencySymbol,
                            )}
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
          </DataTable>
          <p className="mt-3 text-xs text-muted-foreground">
              {/* Said plainly rather than left as a column of dashes. */}
              Margin is what a day took less what it cost to stand there. The
              hours stay in their own column rather than inside it: own time
              counted as nothing makes every market look worth going to. What
              the goods cost to produce is not in this either — that lives on
            the stock, and joining the two is a report nobody has built yet.
          </p>
        </section>
      )}
    </div>
  );
}
