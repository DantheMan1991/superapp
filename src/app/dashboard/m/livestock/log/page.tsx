import { Fragment } from "react";
import Link from "next/link";
import { ClipboardCheck } from "lucide-react";
import { LivestockNav } from "@/packs/livestock/components/livestock-nav";
import { withTenant } from "@/db";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { addDays, todayInTimezone } from "@/lib/timezone";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { Badge } from "@/components/ui/badge";
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
import { listLots, movementKindsForLots, movementsOnDate } from "@/packs/inventory/ops";
import { slugLabel } from "@/packs/inventory/vocabulary";
import { currentZoneForOccupants } from "@/packs/land/ops";
import {
  checkedDaysSince,
  checksOn,
  lastCheckedByLot,
  listLivestockLots,
  parentByLot,
  withdrawalByLot,
} from "@/packs/livestock/ops";
import {
  blocksProcessing,
  describeWithdrawal,
  formatWithdrawal,
  type LotWithdrawal,
} from "@/packs/livestock/core/withdrawal";
import { splitInHead, summariseHead, summarisePen } from "@/packs/livestock/core/herd";
import {
  checkStreak,
  describeLeft,
  formatLastChecked,
  lossesOn,
  roundProgress,
  soldOn,
} from "@/packs/livestock/core/daily";
import {
  LotCheckForm,
  MarkRoundNormalButton,
  QuickNormalButton,
} from "@/packs/livestock/components/daily-round";

export const dynamic = "force-dynamic";

const BASE = "/dashboard/m/livestock";

/** Ninety days is long enough for any streak worth showing and short enough to stay one small query. */
const STREAK_WINDOW_DAYS = 90;

/**
 * The daily round — livestock slice 1, and the design calls it the day-one wedge.
 *
 * **THE COLD START IS THE PROBLEM THIS PAGE EXISTS FOR.** The pilot records
 * nothing today: there is no spreadsheet to replace and no habit to attach to,
 * and every report in the rest of this pack — FCR, mortality by week, sire
 * comparison — produces nothing at all until somebody has been entering things
 * for a season. So the first thing built is not a report. It is the cheapest
 * possible way to say "I looked, and they are fine", because a tool that is
 * only valuable in year two never reaches year two.
 *
 * Everything on the page is either one tap or already known: the lots come from
 * this pack, the head count from `inventory`'s ledger, the paddock from `land`,
 * and the losses recorded today are read back out of the ledger rather than
 * stored here a second time.
 *
 * **THE ROUND IS WALKED BY PEN** (2026-09-07). It used to be walked by record:
 * every lot with head of its own was a row, so five cows named into `Cows`
 * were five rows and `Cows` itself — its head all named — was not there at
 * all. A person walks to a pen and looks at what is in it, so a pen is one
 * row with its named animals under it, and one tap marks the pen and
 * everything in it. Each animal keeps a row in the log of her own, so her
 * page still answers "when was she last looked at", and `Something's up`
 * under her name is where a lame cow or a dead one is recorded.
 *
 * **A TABLE ON A WIDE SCREEN, A CARD PER PEN ON A PHONE.** The table is 733px
 * with its two buttons, and the phone this is walked on is 375px — so `Mark
 * normal` and `Something's up` sat at x=516–736 on every row, off the right
 * edge. Both layouts render from the same `pens` array and CSS picks
 * (`md:hidden` / `hidden md:block`), the review queue's pattern.
 */
export default async function DailyRoundPage() {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, "livestock");

  const today = todayInTimezone(ctx.tenant.timezone);

  const data = await withTenant(
    ctx.tenant.id,
    async (tx) => {
      const lots = await listLivestockLots(tx, ctx.tenant.id);
      const inventoryLotIds = lots.map((l) => l.inventoryLotId);
      const [
        inventoryLots,
        movements,
        lostToday,
        zones,
        checks,
        lastChecked,
        checkedDays,
        withdrawals,
        lotParents,
      ] = await Promise.all([
        listLots(tx, ctx.tenant.id),
        movementKindsForLots(tx, ctx.tenant.id, inventoryLotIds),
        movementsOnDate(tx, ctx.tenant.id, inventoryLotIds, today),
        currentZoneForOccupants(tx, ctx.tenant.id, "livestock", inventoryLotIds, today),
        checksOn(tx, ctx.tenant.id, today),
        lastCheckedByLot(tx, ctx.tenant.id),
        checkedDaysSince(tx, ctx.tenant.id, addDays(today, -STREAK_WINDOW_DAYS)),
        // The round is the screen somebody opens every morning, which makes it
        // the right place to notice that a pen cannot go anywhere yet.
        withdrawalByLot(
          tx,
          ctx.tenant.id,
          lots.map((l) => l.id),
          today,
        ),
        // Which lot each animal lives in, today — what turns a flat list of
        // records into pens with animals under them.
        parentByLot(
          tx,
          ctx.tenant.id,
          lots.map((l) => l.id),
          today,
        ),
      ]);
      return {
        lots,
        inventoryLots,
        movements,
        lostToday,
        zones,
        checks,
        lastChecked,
        checkedDays,
        withdrawals,
        lotParents,
      };
    },
    { role: ctx.role },
  );

  const {
    lots,
    inventoryLots,
    movements,
    lostToday,
    zones,
    checks,
    lastChecked,
    checkedDays,
    withdrawals,
    lotParents,
  } = data;
  const byInventoryLot = new Map(inventoryLots.map((l) => [l.id, l]));
  const byLivestockId = new Map(lots.map((l) => [l.id, l]));
  const membersOf = new Map<string, string[]>();
  for (const [memberId, parentId] of lotParents) {
    const list = membersOf.get(parentId) ?? [];
    list.push(memberId);
    membersOf.set(parentId, list);
  }

  /** What one record — a pen or an animal in it — did today, from the ledger. */
  const leftToday = (inventoryLotId: string) => {
    const dated = (lostToday.get(inventoryLotId) ?? []).map((m) => ({
      ...m,
      occurredOn: today,
    }));
    return { lost: lossesOn(dated, today), sold: soldOn(dated, today) };
  };

  /**
   * The round is the pens with animals standing in them — loose, or named
   * and living inside.
   *
   * A pen whose population is zero is not a pen somebody forgot to check — it
   * is a pen that has gone. Leaving them on the list would grow it by one
   * every time a lot finished, and the first thing an unusable list teaches
   * is to stop tapping the button.
   */
  const pens = lots
    .filter((lot) => !lotParents.has(lot.id))
    .map((lot) => {
      const inv = byInventoryLot.get(lot.inventoryLotId);
      const own = summariseHead(movements.get(lot.inventoryLotId) ?? []);
      const members = (membersOf.get(lot.id) ?? []).flatMap((memberId) => {
        const m = byLivestockId.get(memberId);
        if (!m) return [];
        const mInv = byInventoryLot.get(m.inventoryLotId);
        const rows = movements.get(m.inventoryLotId) ?? [];
        return [
          {
            lot: m,
            code: mInv?.code ?? "—",
            summary: summariseHead(rows),
            splitInHead: splitInHead(rows),
            splitFromHere: mInv?.parentLotId === lot.inventoryLotId,
            ...leftToday(m.inventoryLotId),
            check: checks.get(m.id) ?? null,
            withdrawal: withdrawals.get(m.id) ?? null,
          },
        ];
      });
      // The pen counted ONCE: what is loose plus what is named inside, with a
      // split between the two treated as internal — see `summarisePen`.
      const population = summarisePen(own, members);
      const ownLeft = leftToday(lot.inventoryLotId);
      return {
        lot,
        code: inv?.code ?? "—",
        loose: own.balance,
        balance: population.balance,
        members,
        lost: ownLeft.lost + members.reduce((sum, m) => sum + m.lost, 0),
        sold: ownLeft.sold + members.reduce((sum, m) => sum + m.sold, 0),
        zone: zones.get(lot.inventoryLotId) ?? null,
        check: checks.get(lot.id) ?? null,
        lastCheckedOn: lastChecked.get(lot.id) ?? null,
        withdrawal: withdrawals.get(lot.id) ?? null,
      };
    })
    .filter((row) => row.balance > 0);

  // Progress is over every record — the pens and the animals in them — which
  // is exactly what the one-tap button acts on.
  const everyId = pens.flatMap((p) => [p.lot.id, ...p.members.map((m) => m.lot.id)]);
  const progress = roundProgress(everyId, [...checks.values()]);
  const streak = checkStreak(checkedDays, today);
  const lostTotal = pens.reduce((sum, r) => sum + r.lost, 0);
  const soldTotal = pens.reduce((sum, r) => sum + r.sold, 0);
  const noted = pens.flatMap((p) => [
    ...(p.check?.status === "attention"
      ? [{ id: p.lot.id, code: p.code, notes: p.check.notes, lost: p.lost - p.members.reduce((s, m) => s + m.lost, 0), sold: p.sold - p.members.reduce((s, m) => s + m.sold, 0) }]
      : []),
    ...p.members
      .filter((m) => m.check?.status === "attention")
      .map((m) => ({ id: m.lot.id, code: m.code, notes: m.check?.notes ?? "", lost: m.lost, sold: m.sold })),
  ]);

  /** The check's state, once there is one. The same badge in both layouts. */
  const checkBadge = (check: { status: string } | null) =>
    check ? (
      <Badge variant={check.status === "attention" ? "default" : "outline"}>
        {check.status === "attention" ? "Noted" : "Normal"}
      </Badge>
    ) : null;

  /** The withdrawal, only when it BLOCKS. A "clear" badge on every row would be the noise that hides this one. */
  const withdrawalBadge = (w: LotWithdrawal | null) =>
    w && blocksProcessing(w.meat) ? (
      <Badge variant="default" title={describeWithdrawal(w.meat)}>
        Withdrawal · {formatWithdrawal(w.meat)}
      </Badge>
    ) : null;

  return (
    <div className="space-y-6">
      <PageHeader
        icon={<ClipboardCheck />}
        title="Daily round"
        description={`What you saw today, ${today}. Most days nothing happens — say so in one tap.`}
        actions={
          progress.remaining.length > 0 ? (
            <MarkRoundNormalButton
              remainingLotIds={progress.remaining}
              today={today}
            />
          ) : null
        }
      />

      <LivestockNav />

      {pens.length === 0 ? (
        <EmptyState
          panel
          icon={<ClipboardCheck className="h-5 w-5" />}
          title="Nothing to check yet"
          description="The round lists every lot with animals in it. Start a lot and place head into it, and it turns up here the same day."
        />
      ) : (
        <>
          {/* Two-up from the narrowest phone, three across from `md`. One per
              row cost the list three screens before the first lot appeared. */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            <StatCard
              label="Checked"
              value={`${progress.checked} of ${progress.total}`}
              tone={
                progress.remaining.length === 0 ? "success" : "default"
              }
              footnote={
                progress.remaining.length === 0
                  ? "The whole farm, today."
                  : `${progress.remaining.length} still to look at, pens and animals together.`
              }
            />

            {/* Today being untouched does not break it — see `checkStreak`. A
                counter that resets at breakfast is a counter nobody keeps. */}
            <StatCard
              label="Streak"
              value={
                streak === 0
                  ? "—"
                  : `${streak} ${streak === 1 ? "day" : "days"}`
              }
              footnote={
                streak === 0
                  ? "Record today and it starts."
                  : "Days in a row the round was walked."
              }
            />

            {/* Read back out of inventory's ledger. Not a column here. The
                third card takes the whole row on a phone rather than sitting
                alone beside a gap. */}
            <StatCard
              className="col-span-2 md:col-span-1"
              label="Lost today"
              value={lostTotal}
              tone={lostTotal === 0 ? "default" : "destructive"}
              footnote={
                lostTotal === 0
                  ? soldTotal > 0
                    ? `Nothing lost. ${soldTotal} sold live, already off the count.`
                    : "Nothing recorded against today."
                  : soldTotal > 0
                    ? `Head, already off the count — and ${soldTotal} sold live.`
                    : "Head, already off the count."
              }
            />
          </div>

          {/* Phone: one card per pen, its animals listed under it. What a
              person walking the pens needs to see, then the two buttons — and
              nothing off the edge. */}
          <ul className="space-y-3 md:hidden">
            {pens.map((row) => {
              const left = describeLeft(row.lost, row.sold);
              return (
                <li
                  key={row.lot.id}
                  className="rounded-2xl bg-card p-4 shadow-elevation-1"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Link
                        href={`${BASE}/${row.lot.id}`}
                        className="font-medium hover:underline"
                      >
                        {row.code}
                      </Link>
                      <p className="text-xs text-muted-foreground">
                        {slugLabel(row.lot.species)}
                        {row.zone && (
                          <>
                            {" · "}
                            {row.zone.zoneName}
                            {row.zone.structureName &&
                              ` · ${row.zone.structureName}`}
                          </>
                        )}
                      </p>
                      {withdrawalBadge(row.withdrawal) && (
                        <div className="mt-1">{withdrawalBadge(row.withdrawal)}</div>
                      )}
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="font-medium tabular-nums">
                        {row.balance}
                        <span className="ml-1 text-xs font-normal text-muted-foreground">
                          head
                        </span>
                      </p>
                      {left && (
                        <p
                          className={
                            row.lost > 0
                              ? "text-xs text-destructive"
                              : "text-xs text-muted-foreground"
                          }
                        >
                          {left} today
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs text-muted-foreground">
                      Last checked ·{" "}
                      {formatLastChecked(row.lastCheckedOn, today).toLowerCase()}
                    </span>
                    <div className="flex items-center gap-2">
                      {checkBadge(row.check) ?? (
                        <QuickNormalButton
                          livestockLotIds={[
                            row.lot.id,
                            ...row.members.map((m) => m.lot.id),
                          ]}
                          today={today}
                        />
                      )}
                      <LotCheckForm
                        livestockLotId={row.lot.id}
                        lotCode={row.code}
                        today={today}
                        balance={row.loose}
                        namedInside={row.members.length}
                        hasEntry={row.check !== null}
                        idPrefix="card-"
                      />
                    </div>
                  </div>
                  {row.members.length > 0 && (
                    <ul className="mt-3 divide-y divide-divider border-t border-divider">
                      {row.members.map((m) => {
                        const mLeft = describeLeft(m.lost, m.sold);
                        return (
                          <li
                            key={m.lot.id}
                            className="flex items-center justify-between gap-2 py-2"
                          >
                            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                              <Link
                                href={`${BASE}/${m.lot.id}`}
                                className="font-medium hover:underline"
                              >
                                {m.code}
                              </Link>
                              {m.summary.balance !== 1 && (
                                <span className="text-xs text-muted-foreground">
                                  {m.summary.balance} head
                                </span>
                              )}
                              {mLeft && (
                                <span
                                  className={
                                    m.lost > 0
                                      ? "text-xs text-destructive"
                                      : "text-xs text-muted-foreground"
                                  }
                                >
                                  {mLeft} today
                                </span>
                              )}
                              {withdrawalBadge(m.withdrawal)}
                              {checkBadge(m.check)}
                            </div>
                            <LotCheckForm
                              livestockLotId={m.lot.id}
                              lotCode={m.code}
                              today={today}
                              balance={m.summary.balance}
                              hasEntry={m.check !== null}
                              idPrefix="card-"
                            />
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>

          {/* Wide screen: the table, a pen's animals as rows under it. */}
          <div className="hidden md:block">
            <DataTable>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Lot</TableHead>
                    <TableHead>Where</TableHead>
                    <TableHead className="text-right">Head</TableHead>
                    <TableHead className="text-right">Lost today</TableHead>
                    <TableHead>Last checked</TableHead>
                    <TableHead className="text-right">Today</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pens.map((row) => (
                    <Fragment key={row.lot.id}>
                      <TableRow>
                        <TableCell>
                          <div className="font-medium">
                            <Link
                              href={`${BASE}/${row.lot.id}`}
                              className="hover:underline"
                            >
                              {row.code}
                            </Link>
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {slugLabel(row.lot.species)}
                            {row.members.length > 0 &&
                              ` · ${row.loose} loose, ${row.members.length} named`}
                          </div>
                          {withdrawalBadge(row.withdrawal) && (
                            <div className="mt-1">{withdrawalBadge(row.withdrawal)}</div>
                          )}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {row.zone ? row.zone.zoneName : "—"}
                          {row.zone?.structureName && (
                            <span className="text-xs"> · {row.zone.structureName}</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {row.balance}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">
                          {row.lost === 0 ? "—" : row.lost}
                          {/* Under the loss, not in it: sold is off the count
                              and is not a death. */}
                          {row.sold > 0 && (
                            <div className="text-xs">{row.sold} sold live</div>
                          )}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {formatLastChecked(row.lastCheckedOn, today)}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center justify-end gap-2">
                            {checkBadge(row.check) ?? (
                              <QuickNormalButton
                                livestockLotIds={[
                                  row.lot.id,
                                  ...row.members.map((m) => m.lot.id),
                                ]}
                                today={today}
                              />
                            )}
                            <LotCheckForm
                              livestockLotId={row.lot.id}
                              lotCode={row.code}
                              today={today}
                              balance={row.loose}
                              namedInside={row.members.length}
                              hasEntry={row.check !== null}
                              idPrefix="row-"
                            />
                          </div>
                        </TableCell>
                      </TableRow>
                      {row.members.map((m) => (
                        <TableRow key={m.lot.id} className="bg-muted/30">
                          <TableCell className="pl-8">
                            <div className="flex flex-wrap items-center gap-2">
                              <Link
                                href={`${BASE}/${m.lot.id}`}
                                className="font-medium hover:underline"
                              >
                                {m.code}
                              </Link>
                              {withdrawalBadge(m.withdrawal)}
                            </div>
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            in {row.code}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-muted-foreground">
                            {m.summary.balance}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-muted-foreground">
                            {m.lost === 0 ? "—" : m.lost}
                            {m.sold > 0 && (
                              <div className="text-xs">{m.sold} sold live</div>
                            )}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {formatLastChecked(lastChecked.get(m.lot.id) ?? null, today)}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center justify-end gap-2">
                              {checkBadge(m.check)}
                              <LotCheckForm
                                livestockLotId={m.lot.id}
                                lotCode={m.code}
                                today={today}
                                balance={m.summary.balance}
                                hasEntry={m.check !== null}
                                idPrefix="row-"
                              />
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </Fragment>
                  ))}
                </TableBody>
              </Table>
            </DataTable>
          </div>

          {noted.length > 0 && (
            <section>
              <h2 className="mb-3 font-heading text-xl font-semibold tracking-heading">
                Noted today
              </h2>
              <DataTable>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Lot</TableHead>
                      <TableHead>What was seen</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {noted.map((entry) => {
                      const left = describeLeft(entry.lost, entry.sold);
                      return (
                        <TableRow key={entry.id}>
                          <TableCell className="font-medium">{entry.code}</TableCell>
                          <TableCell className="text-muted-foreground">
                            {entry.notes || (
                              <span>
                                {left
                                  ? `${left}, no note left.`
                                  : "Flagged with no note."}
                              </span>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </DataTable>
            </section>
          )}
        </>
      )}
    </div>
  );
}
