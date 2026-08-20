import Link from "next/link";
import { ChevronLeft, Scale } from "lucide-react";
import { withTenant } from "@/db";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { addDays, todayInTimezone } from "@/lib/timezone";
import { formatMoney } from "@/lib/money";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
 * **AND THERE IS NO FCR ON THIS PAGE.** Feed conversion is feed per pound of
 * GAIN, gain needs weights, and weights are slice 5. Feed per head is here; the
 * page says in words what it cannot yet compute rather than dividing by
 * something plausible.
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
      const [report, lots, groups, items, locations, inventoryLots] =
        await Promise.all([
          feedReport(tx, ctx.tenant.id, { from, to: today }),
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
  } = data;
  const isOwner = ctx.role === "owner";
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
   * Only lots with animals standing in them can go onto a feeder. Offering a
   * finished batch would let somebody put an empty pen on the bin, where it
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
      <Link
        href={BASE}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" />
        All livestock
      </Link>

      <PageHeader
        title="Feed"
        description="The largest cash cost, and what each lot carried of it. Measured where a bag went to a named lot; allocated where a shared feeder did."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {drawForm}
            {isOwner && <FeedGroupForm />}
          </div>
        }
      />

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
          <div className="grid gap-6 md:grid-cols-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Fed</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-medium tabular-nums">
                  {formatMoney(totalCents, currencySymbol)}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {totalCents === 0
                    ? "Nothing fed on record in this period."
                    : "Across every lot in this period."}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Measured</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-medium tabular-nums">
                  {formatMoney(measuredCents, currencySymbol)}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Issued to a lot by name. Stamped when it happened, and it does
                  not move when the next delivery arrives.
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Allocated</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-medium tabular-nums">
                  {formatMoney(allocatedCents, currencySymbol)}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {/* The design's rule, stated where the number is: same
                      report, different confidence. */}
                  Drawn for a shared feeder and spread by head × days. An
                  estimate, and the honest one.
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Feed conversion</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-medium">—</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {/* Said in words rather than divided into existence. */}
                  Needs weights, and nothing has been weighed. Feed per head is
                  below; feed per pound of gain is not a number this farm can
                  produce yet.
                </p>
              </CardContent>
            </Card>
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

          <div className="space-y-3">
            <h2 className="text-sm font-medium">By lot</h2>
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
                  <TableHead className="text-right">vs last batch</TableHead>
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
            <p className="text-xs text-muted-foreground">
              {/* One place, said the same way on the lot page. */}
              {FCR_NEEDS_WEIGHTS}
            </p>
            <p className="text-xs text-muted-foreground">
              &ldquo;A head placed&rdquo; is the comparison figure: cost at
              today&rsquo;s count falls as birds die, which makes a bad batch
              look cheaper the worse it goes.
            </p>
          </div>
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

                    {rows.length === 0 ? (
                      <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                        Nothing is on this feeder yet, so anything drawn for it
                        has nowhere to land. Add the lots that eat from it —
                        backdated to when they went on, because the share is
                        worked out day by day.
                      </p>
                    ) : (
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
                    )}
                  </div>
                );
              })}
          </div>
        )}
      </div>
    </div>
  );
}
