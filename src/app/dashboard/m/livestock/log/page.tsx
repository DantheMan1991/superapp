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
  withdrawalByLot,
} from "@/packs/livestock/ops";
import {
  blocksProcessing,
  describeWithdrawal,
  formatWithdrawal,
} from "@/packs/livestock/core/withdrawal";
import { summariseHead } from "@/packs/livestock/core/herd";
import {
  checkStreak,
  formatLastChecked,
  lossesOn,
  roundProgress,
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
  } = data;
  const byInventoryLot = new Map(inventoryLots.map((l) => [l.id, l]));

  /**
   * The round is the lots with animals standing in them.
   *
   * A lot whose balance is zero is not a pen somebody forgot to check — it is a
   * batch that has gone. Leaving them on the list would grow it by one every
   * time a batch finished, and the first thing an unusable list teaches is to
   * stop tapping the button.
   */
  const round = lots
    .map((lot) => {
      const inv = byInventoryLot.get(lot.inventoryLotId);
      const summary = summariseHead(movements.get(lot.inventoryLotId) ?? []);
      const dated = (lostToday.get(lot.inventoryLotId) ?? []).map((m) => ({
        ...m,
        occurredOn: today,
      }));
      return {
        lot,
        code: inv?.code ?? "—",
        balance: summary.balance,
        lost: lossesOn(dated, today),
        zone: zones.get(lot.inventoryLotId) ?? null,
        check: checks.get(lot.id) ?? null,
        lastCheckedOn: lastChecked.get(lot.id) ?? null,
        withdrawal: withdrawals.get(lot.id) ?? null,
      };
    })
    .filter((row) => row.balance > 0);

  const progress = roundProgress(
    round.map((r) => r.lot.id),
    [...checks.values()],
  );
  const streak = checkStreak(checkedDays, today);
  const lostTotal = round.reduce((sum, r) => sum + r.lost, 0);

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

      {round.length === 0 ? (
        <EmptyState
          panel
          icon={<ClipboardCheck className="h-5 w-5" />}
          title="Nothing to check yet"
          description="The round lists every lot with animals in it. Start a lot and place head into it, and it turns up here the same day."
        />
      ) : (
        <>
          <div className="grid gap-3 md:grid-cols-3">
            <StatCard
              label="Checked"
              value={`${progress.checked} of ${progress.total}`}
              tone={
                progress.remaining.length === 0 ? "success" : "default"
              }
              footnote={
                progress.remaining.length === 0
                  ? "The whole farm, today."
                  : `${progress.remaining.length} still to look at.`
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

            {/* Read back out of inventory's ledger. Not a column here. */}
            <StatCard
              label="Lost today"
              value={lostTotal}
              tone={lostTotal === 0 ? "default" : "destructive"}
              footnote={
                lostTotal === 0
                  ? "Nothing recorded against today."
                  : "Head, already off the count."
              }
            />
          </div>

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
              {round.map((row) => (
                <TableRow key={row.lot.id}>
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
                    </div>
                    {row.withdrawal &&
                      blocksProcessing(row.withdrawal.meat) && (
                        <Badge
                          variant="default"
                          className="mt-1"
                          title={describeWithdrawal(row.withdrawal.meat)}
                        >
                          {/* Only when it BLOCKS. A "clear" badge on every row
                              would be the noise that hides this one. */}
                          Withdrawal · {formatWithdrawal(row.withdrawal.meat)}
                        </Badge>
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
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatLastChecked(row.lastCheckedOn, today)}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-2">
                      {row.check ? (
                        <Badge
                          variant={
                            row.check.status === "attention" ? "default" : "outline"
                          }
                        >
                          {row.check.status === "attention" ? "Noted" : "Normal"}
                        </Badge>
                      ) : (
                        <QuickNormalButton
                          livestockLotId={row.lot.id}
                          today={today}
                        />
                      )}
                      <LotCheckForm
                        livestockLotId={row.lot.id}
                        lotCode={row.code}
                        today={today}
                        balance={row.balance}
                        hasEntry={row.check !== null}
                      />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
            </Table>
          </DataTable>

          {progress.needsAttention.length > 0 && (
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
                  {round
                    .filter((row) => row.check?.status === "attention")
                    .map((row) => (
                      <TableRow key={row.lot.id}>
                        <TableCell className="font-medium">{row.code}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {row.check?.notes || (
                            <span>
                              {row.lost > 0
                                ? `${row.lost} lost, no note left.`
                                : "Flagged with no note."}
                            </span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
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
