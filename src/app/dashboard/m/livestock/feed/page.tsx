import Link from "next/link";
import { Scale } from "lucide-react";
import { LivestockNav } from "@/packs/livestock/components/livestock-nav";
import { withTenant } from "@/db";
import { labelFor } from "@/lib/packs/resolve";
import { packContext } from "@/lib/packs/tenant-context";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { addDays, todayInTimezone } from "@/lib/timezone";
import { formatMoney } from "@/lib/money";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/app/data-table";
import { StatCard } from "@/components/app/stat-card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  listItems,
  listLocations,
  listLots,
  lotsByItem as lotsByItemQuery,
} from "@/packs/inventory/ops";
import { slugLabel } from "@/packs/inventory/vocabulary";
import {
  LEDGER_EPOCH,
  feedGroupMembers,
  feedReport,
  listFeedGroups,
  listLivestockLots,
} from "@/packs/livestock/ops";
import {
  FCR_NEEDS_WEIGHTS,
  PROVENANCE_LABELS,
  PROVENANCE_NOTES,
  formatQuantities,
  unpricedNote,
} from "@/packs/livestock/core/feed";
import {
  CONFIDENCE_NOTES,
  WEIGHT_METHOD_NOTES,
  formatLb,
  formatRatio,
} from "@/packs/livestock/core/weights";
import { formatAge } from "@/packs/livestock/core/herd";
import {
  AddLotToFeederForm,
  CloseFeederButton,
  EndMembershipForm,
  FeedGroupForm,
  RecordDrawForm,
} from "@/packs/livestock/components/feed-controls";

export const dynamic = "force-dynamic";

const BASE = "/dashboard/m/livestock";

/** The windows on offer. `null` days means everything ever recorded. */
const PERIODS: { key: string; label: string; days: number | null }[] = [
  { key: "30", label: "Last 30 days", days: 30 },
  { key: "90", label: "Last 90 days", days: 90 },
  { key: "all", label: "All time", days: null },
];

/**
 * Feed — livestock slice 2, and the number the broiler enterprise is judged on.
 *
 * **TWO WAYS A PEN'S FEED COST IS KNOWN, AND THE PAGE NEVER MERGES THEM
 * SILENTLY.** A bag issued to a named pen is *measured*: `inventory` stamped its
 * cost at the average when it happened, and nothing here recomputes it. A ton
 * into a bin serving fifteen pens is *allocated*: spread by head × days at read
 * time, because nobody knows which bird ate which pound. The design's rule is
 * that every derived cost carries its provenance, and that at 10× the bagged
 * number becomes an allocated one — so the distinction is permanent rather than
 * a migration state.
 *
 * **FEED CONVERSION ARRIVED WITH SLICE 5, AND IT IS STILL REFUSED MORE OFTEN
 * THAN IT IS GIVEN.** It is pounds of feed per pound of GAIN, so it needs two
 * weighings — one number is a weight, not a gain — and its window is each lot's
 * own gain window rather than the period on the screen, because feed fed before
 * anybody put a bird on a scale made gain nobody measured. Where there is no
 * ratio the cell carries the reason rather than a blank, since for a farm's
 * whole first season the reason is the useful part.
 */
export default async function FeedPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, "livestock");

  const today = todayInTimezone(ctx.tenant.timezone);
  const currencySymbol = ctx.tenant.currencySymbol;
  const periodKey = typeof params.period === "string" ? params.period : "all";
  const period = PERIODS.find((p) => p.key === periodKey) ?? PERIODS[2];
  const from = period.days === null ? LEDGER_EPOCH : addDays(today, -period.days);

  const data = await withTenant(
    ctx.tenant.id,
    async (tx) => {
      // The pack's config first: the feed report needs the tape divisors to turn
      // a girth and a length into a weight, and without them a herd measured by
      // tape reaches the conversion with no weight at all.
      const pack = await packContext(
        tx,
        ctx.tenant.id,
        ctx.tenant.industry,
        "livestock",
      );
      const [report, lots, groups, items, locations, inventoryLots] =
        await Promise.all([
          feedReport(tx, ctx.tenant.id, { from, to: today, packConfig: pack.config }),
          listLivestockLots(tx, ctx.tenant.id),
          listFeedGroups(tx, ctx.tenant.id, { status: "active" }),
          listItems(tx, ctx.tenant.id, { status: "active" }),
          listLocations(tx, ctx.tenant.id),
          listLots(tx, ctx.tenant.id, { status: "open" }),
        ]);
      const members = await feedGroupMembers(
        tx,
        ctx.tenant.id,
        groups.map((g) => g.id),
      );
      const lotsForItems = await lotsByItemQuery(
        tx,
        ctx.tenant.id,
        items.map((i) => i.id),
      );
      return {
        report,
        lots,
        groups,
        items,
        locations,
        inventoryLots,
        members,
        lotsForItems,
        labels: pack.labels,
      };
    },
    { role: ctx.role },
  );

  const {
    report,
    lots,
    groups,
    items,
    locations,
    inventoryLots,
    members,
    lotsForItems,
    labels,
  } = data;
  const isOwner = ctx.role === "owner";
  // Slice 8a: the page says the tenant's word for a group of animals, never
  // "batch" — `production` owns that noun and the farm profile labels a run
  // with it, so three meanings were sharing one word.
  const lotWord = labelFor(labels, "livestockLot", "Lot");
  const codeByLot = new Map(
    lots.map((lot) => [
      lot.id,
      inventoryLots.find((i) => i.id === lot.inventoryLotId)?.code ?? "—",
    ]),
  );

  const totalCents = report.lots.reduce((sum, row) => sum + row.totalCents, 0);
  const measuredCents = report.lots.reduce(
    (sum, row) => sum + row.measuredCents,
    0,
  );
  const allocatedCents = report.lots.reduce(
    (sum, row) => sum + row.allocatedCents,
    0,
  );
  const unallocatedCents = report.groups.reduce(
    (sum, group) => sum + group.unallocatedCents,
    0,
  );
  const unpriced =
    report.lots.reduce((sum, row) => sum + row.unpricedMovements, 0) +
    report.groups.reduce((sum, group) => sum + group.unpricedDraws, 0);

  /**
   * The farm's own conversion, and it is a ratio of SUMS rather than an average
   * of ratios.
   *
   * Averaging each pen's ratio would weight a pen of twelve the same as a pen of
   * two hundred. Total feed over total gain is what the farm actually converted,
   * and it is the figure a processor or a feed rep would recognise.
   *
   * **Measured only when every lot in it was measured at both ends.** One tape
   * reading or one shared-feeder share makes the whole farm figure an estimate,
   * because it is — and the badge saying so is the difference between a number
   * to price against and a trend to watch.
   */
  const converted = report.lots
    .map((row) => row.weight.conversion)
    .filter((c): c is NonNullable<typeof c> => c !== null);
  const anyWeighed = report.lots.some((row) => row.weight.weighInCount > 0);
  const farmConversion =
    converted.length === 0
      ? null
      : {
          ratio:
            Math.round(
              (converted.reduce((sum, c) => sum + c.feedLb, 0) /
                converted.reduce((sum, c) => sum + c.gainLb, 0)) *
                100,
            ) / 100,
          feedLb: Math.round(converted.reduce((sum, c) => sum + c.feedLb, 0) * 10) / 10,
          gainLb: Math.round(converted.reduce((sum, c) => sum + c.gainLb, 0) * 10) / 10,
          confidence: converted.every((c) => c.confidence === "measured")
            ? ("measured" as const)
            : ("estimated" as const),
        };

  /**
   * Only lots with animals standing in them can go onto a feeder. Offering a
   * finished lot would let somebody put an empty pen on the bin, where it
   * would contribute nothing to the basis and read as a mistake nobody made.
   */
  const feedableLots = report.lots
    .filter((row) => row.head > 0)
    .map((row) => ({ id: row.lotId, code: row.code, species: slugLabel(row.species) }));

  /**
   * What can be drawn for a feeder — everything except the animals.
   *
   * **FOUND BY CLICKING IT**: the picker offered "Broiler chicks" beside the
   * grower crumble, because both are inventory items and the ledger has no
   * opinion. Drawing 400 head of chickens into a feed bin is not a transaction
   * anything would refuse — it would just quietly issue live birds out of stock
   * and charge them to themselves.
   *
   * Excluded by KIND rather than restricted to `feed`, deliberately. **Waste
   * streams are real feed** — spent grain, surplus milk, garden culls, expired
   * bakery — and they are recorded under whatever kind they were bought as. A
   * whitelist of "feed" would refuse the half of this farm's inputs the design
   * is most insistent about.
   */
  const itemOptions = items
    .filter((i) => i.itemKind !== "livestock")
    .map((i) => ({
      id: i.id,
      name: i.name,
      unit: i.stockingUnit,
    }));
  const lotOptionsByItem: Record<string, { id: string; code: string }[]> = {};
  for (const [itemId, itemLots] of lotsForItems) {
    lotOptionsByItem[itemId] = itemLots.map((l) => ({ id: l.id, code: l.code }));
  }

  const drawForm =
    groups.length > 0 && itemOptions.length > 0 ? (
      <RecordDrawForm
        feeders={groups.map((g) => ({ id: g.id, name: g.name }))}
        items={itemOptions}
        lotsByItem={lotOptionsByItem}
        locations={locations.map((l) => ({ id: l.id, name: l.name }))}
        currencySymbol={currencySymbol}
        today={today}
      />
    ) : null;

  return (
    <div className="space-y-6">
      <PageHeader
        icon={<Scale />}
        title="Feed"
        description="The largest cash cost, and what each lot carried of it. Measured where a bag went to a named lot; allocated where a shared feeder did."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {drawForm}
            {isOwner && <FeedGroupForm />}
          </div>
        }
      />

      <LivestockNav />

      <div className="flex flex-wrap items-center gap-2">
        {PERIODS.map((option) => (
          <Button
            key={option.key}
            asChild
            size="sm"
            variant={option.key === period.key ? "default" : "outline"}
          >
            <Link href={`${BASE}/feed?period=${option.key}`}>{option.label}</Link>
          </Button>
        ))}
        <span className="text-xs text-muted-foreground">
          {period.days === null
            ? "Everything on record."
            : `${from} to ${today}.`}
        </span>
      </div>

      {report.lots.length === 0 ? (
        <EmptyState
          panel
          icon={<Scale className="h-5 w-5" />}
          title="Nothing to weigh up yet"
          description="Feed cost lands here once there are animals to carry it. Start a lot, then either issue feed to it by name from the Inventory page or set up a shared feeder and draw for it."
        />
      ) : (
        <>
          <div className="grid gap-3 md:grid-cols-4">
            <StatCard
              label="Fed"
              value={formatMoney(totalCents, currencySymbol)}
              footnote={
                totalCents === 0
                  ? "Nothing fed on record in this period."
                  : "Across every lot in this period."
              }
            />

            <StatCard
              label="Measured"
              value={formatMoney(measuredCents, currencySymbol)}
              footnote="Issued to a lot by name. Stamped when it happened, and it does not move when the next delivery arrives."
            />

            {/* The design's rule, stated where the number is: same report,
                different confidence. */}
            <StatCard
              label="Allocated"
              value={formatMoney(allocatedCents, currencySymbol)}
              footnote="Drawn for a shared feeder and spread by head × days. An estimate, and the honest one."
            />

            {/* The ratio is still said in words when it cannot be computed,
                rather than divided into existence. */}
            <StatCard
              label={
                <span className="flex items-center gap-2">
                  Feed conversion
                  {farmConversion && (
                    <Badge
                      variant={
                        farmConversion.confidence === "measured"
                          ? "outline"
                          : "default"
                      }
                      title={CONFIDENCE_NOTES[farmConversion.confidence]}
                    >
                      {farmConversion.confidence === "measured"
                        ? "Measured"
                        : "Estimated"}
                    </Badge>
                  )}
                </span>
              }
              value={formatRatio(farmConversion?.ratio ?? null)}
              footnote={
                farmConversion
                  ? `${formatLb(farmConversion.feedLb)} of feed against ${formatLb(farmConversion.gainLb)} of gain, across every lot weighed twice in this period.`
                  : anyWeighed
                    ? "Nothing has been weighed twice yet. Gain needs two weighings — the second one turns this into a number."
                    : "Needs weights, and nothing has been weighed. Feed per head is below; feed per pound of gain is not a number this farm can produce yet."
              }
            />
          </div>

          {(unallocatedCents > 0 || unpriced > 0 || report.drawsOmitted > 0) && (
            <div className="space-y-1 rounded-md border border-dashed p-4 text-sm text-muted-foreground">
              {unallocatedCents > 0 && (
                <p>
                  {/* Never dropped: the farm paid for it. */}
                  <span className="font-medium text-foreground">
                    {formatMoney(unallocatedCents, currencySymbol)} could not be
                    allocated.
                  </span>{" "}
                  It was drawn for a feeder that no lot was on with animals in
                  it during this period. Put the lots on the feeder, backdating
                  when they went on, and it lands.
                </p>
              )}
              {unpriced > 0 && <p>{unpricedNote(unpriced)}</p>}
              {report.drawsOmitted > 0 && (
                <p>
                  {report.drawsOmitted} older draws were not read into this
                  report.
                </p>
              )}
            </div>
          )}

          <section>
            <h2 className="mb-3 font-heading text-xl font-semibold tracking-heading">
              By lot
            </h2>
            <DataTable>
              <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Lot</TableHead>
                  <TableHead className="text-right">Age</TableHead>
                  <TableHead className="text-right">Head</TableHead>
                  <TableHead className="text-right">Fed</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                  <TableHead className="text-right">A head now</TableHead>
                  <TableHead className="text-right">A head placed</TableHead>
                  <TableHead className="text-right">vs last {lotWord.toLowerCase()}</TableHead>
                  <TableHead className="text-right">Weight</TableHead>
                  <TableHead className="text-right">Gain a day</TableHead>
                  <TableHead className="text-right">Feed : gain</TableHead>
                  <TableHead>How it is known</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.lots.map((row) => (
                  <TableRow key={row.lotId}>
                    <TableCell>
                      <div className="font-medium">
                        <Link
                          href={`${BASE}/${row.lotId}`}
                          className="hover:underline"
                        >
                          {row.code}
                        </Link>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {slugLabel(row.species)}
                      </div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {formatAge(row.ageDays)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.head}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {/* Units are kept apart — there is no factor between
                          pounds of grower and gallons of surplus milk. */}
                      {formatQuantities(row.quantities)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.totalCents === 0
                        ? "—"
                        : formatMoney(row.totalCents, currencySymbol)}
                      {/* WHAT HAS LEFT, under what was spent. A pen processed
                          out still ate the feed — the total is right — but the
                          money is in the freezer now, and a report that only
                          showed the total would have it in both places. */}
                      {row.releasedCents > 0 && (
                        <div className="text-xs text-muted-foreground">
                          {formatMoney(row.remainingCents, currencySymbol)} left
                          on the lot
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {row.centsPerHead === null
                        ? "—"
                        : formatMoney(row.centsPerHead, currencySymbol)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {row.centsPerHeadPlaced === null
                        ? "—"
                        : formatMoney(row.centsPerHeadPlaced, currencySymbol)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.vsPreviousCents === null ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <span
                          title={`Against ${row.previousCode}, per head placed`}
                          className={
                            row.vsPreviousCents > 0
                              ? "text-destructive"
                              : "text-muted-foreground"
                          }
                        >
                          {row.vsPreviousCents > 0 ? "+" : "−"}
                          {formatMoney(
                            Math.abs(row.vsPreviousCents),
                            currencySymbol,
                          )}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      <span
                        title={
                          row.weight.latest
                            ? (WEIGHT_METHOD_NOTES[row.weight.latest.method] ?? "")
                            : ""
                        }
                      >
                        {formatLb(row.weight.latest?.averageLb ?? null)}
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {row.weight.gain === null
                        ? "—"
                        : `${row.weight.gain.adgLb} lb`}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {/* The number the enterprise is judged on, or the reason
                          there is not one — never a blank. */}
                      {row.weight.conversion ? (
                        <span
                          title={
                            CONFIDENCE_NOTES[row.weight.conversion.confidence]
                          }
                          className={
                            row.weight.conversion.confidence === "measured"
                              ? undefined
                              : "text-muted-foreground"
                          }
                        >
                          {formatRatio(row.weight.conversion.ratio)}
                        </span>
                      ) : (
                        <span
                          className="text-muted-foreground"
                          title={row.weight.conversionBlockedBy ?? ""}
                        >
                          —
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <span title={PROVENANCE_NOTES[row.provenance]}>
                        {row.provenance === "none" ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          <Badge
                            variant={
                              row.provenance === "measured"
                                ? "outline"
                                : "default"
                            }
                          >
                            {PROVENANCE_LABELS[row.provenance]}
                          </Badge>
                        )}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
              </Table>
            </DataTable>
            {!anyWeighed && (
              <p className="text-xs text-muted-foreground">
                {/* One place, said the same way on the lot page — and gone the
                    moment it stops being true. */}
                {FCR_NEEDS_WEIGHTS}
              </p>
            )}
            {anyWeighed && (
              <p className="text-xs text-muted-foreground">
                Feed : gain is pounds of feed per pound of gain, over the period
                between each lot&rsquo;s own first and last weighing — feed fed
                before anything was weighed is left out, because the gain it
                made was never measured.
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              &ldquo;A head placed&rdquo; is the comparison figure: cost at
              today&rsquo;s count falls as birds die, which makes a bad{" "}
              {lotWord.toLowerCase()} look cheaper the worse it goes. It is over the whole bill, because
              what a {lotWord.toLowerCase()}{" "}
              cost to raise does not change when some of it is processed and
              sold on &mdash; while &ldquo;a head now&rdquo; is
              over what the lot is still carrying.
            </p>
          </section>
        </>
      )}

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium">
            Shared feeders {groups.length > 0 && `(${groups.length})`}
          </h2>
          {isOwner && groups.length > 0 && <FeedGroupForm />}
        </div>

        {groups.length === 0 ? (
          <p className="rounded-md border border-dashed p-6 text-sm text-muted-foreground">
            <span className="font-medium text-foreground">
              No shared feeders, and at this size that is right.
            </span>{" "}
            While a bag goes to a pen and somebody knows which pen, feed is
            issued to the lot by name and the cost is measured. A feeder is for
            when a ton goes into a bin serving fifteen pens and nobody can say
            which bird ate which pound — then the cost is spread by head and
            days instead.
          </p>
        ) : (
          <div className="space-y-6">
            {report.groups
              .filter((entry) => entry.group.status === "active")
              .map((entry) => {
                const rows = members.get(entry.group.id) ?? [];
                const byLot = new Map(
                  entry.members.map((m) => [m.livestockLotId, m]),
                );
                const onFeeder = new Set(
                  rows
                    .filter((row) => row.endedOn === null)
                    .map((row) => row.livestockLotId),
                );
                return (
                  <div key={entry.group.id} className="space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <h3 className="text-sm font-medium">
                          {entry.group.name}
                        </h3>
                        <p className="text-xs text-muted-foreground">
                          {entry.drawCount === 0
                            ? "Nothing drawn for it in this period."
                            : `${entry.drawCount} ${entry.drawCount === 1 ? "draw" : "draws"} · ${formatQuantities(entry.drawnQuantities)} · ${formatMoney(entry.drawnCents, currencySymbol)}`}
                          {entry.unallocatedCents > 0 &&
                            ` · ${formatMoney(entry.unallocatedCents, currencySymbol)} unallocated`}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        {itemOptions.length > 0 && (
                          <RecordDrawForm
                            feeders={groups.map((g) => ({
                              id: g.id,
                              name: g.name,
                            }))}
                            items={itemOptions}
                            lotsByItem={lotOptionsByItem}
                            locations={locations.map((l) => ({
                              id: l.id,
                              name: l.name,
                            }))}
                            currencySymbol={currencySymbol}
                            today={today}
                            defaultFeederId={entry.group.id}
                          />
                        )}
                        <AddLotToFeederForm
                          feedGroupId={entry.group.id}
                          feederName={entry.group.name}
                          lots={feedableLots.filter(
                            (lot) => !onFeeder.has(lot.id),
                          )}
                          today={today}
                        />
                        {isOwner && (
                          <CloseFeederButton
                            feedGroupId={entry.group.id}
                            feederName={entry.group.name}
                          />
                        )}
                      </div>
                    </div>

                    <DataTable
                      isEmpty={rows.length === 0}
                      empty={
                        <EmptyState
                          title="Nothing on this feeder yet"
                          description="Anything drawn for it has nowhere to land. Add the lots that eat from it — backdated to when they went on, because the share is worked out day by day."
                        />
                      }
                    >
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Lot</TableHead>
                            <TableHead>On feed</TableHead>
                            <TableHead className="text-right">Days</TableHead>
                            <TableHead className="text-right">
                              Head-days
                            </TableHead>
                            <TableHead className="text-right">Share</TableHead>
                            <TableHead className="text-right"></TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {rows.map((row) => {
                            const share = byLot.get(row.livestockLotId);
                            return (
                              <TableRow key={row.id}>
                                <TableCell className="font-medium">
                                  <Link
                                    href={`${BASE}/${row.livestockLotId}`}
                                    className="hover:underline"
                                  >
                                    {codeByLot.get(row.livestockLotId) ?? "—"}
                                  </Link>
                                </TableCell>
                                <TableCell className="tabular-nums text-muted-foreground">
                                  {row.startedOn}
                                  {row.endedOn
                                    ? ` to ${row.endedOn}`
                                    : " — still on it"}
                                </TableCell>
                                <TableCell className="text-right tabular-nums text-muted-foreground">
                                  {share?.daysOnFeed ?? 0}
                                </TableCell>
                                <TableCell className="text-right tabular-nums text-muted-foreground">
                                  {/* The basis, shown rather than hidden: an
                                      allocated number nobody can check is a
                                      number nobody believes. */}
                                  {(share?.headDays ?? 0).toLocaleString(
                                    "en-US",
                                  )}
                                </TableCell>
                                <TableCell className="text-right tabular-nums">
                                  {share && share.shareCents > 0
                                    ? formatMoney(
                                        share.shareCents,
                                        currencySymbol,
                                      )
                                    : "—"}
                                </TableCell>
                                <TableCell className="text-right">
                                  {row.endedOn === null && (
                                    <EndMembershipForm
                                      memberId={row.id}
                                      lotCode={
                                        codeByLot.get(row.livestockLotId) ?? "—"
                                      }
                                      startedOn={row.startedOn}
                                      today={today}
                                    />
                                  )}
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </DataTable>
                  </div>
                );
              })}
          </div>
        )}
      </div>
    </div>
  );
}

