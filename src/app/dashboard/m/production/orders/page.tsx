import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { withTenant } from "@/db";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { todayInTimezone } from "@/lib/timezone";
import { packContext } from "@/lib/packs/tenant-context";
import { labelFor } from "@/lib/packs/resolve";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { listOrders } from "@/packs/production/order-ops";
import { listBookings } from "@/packs/production/booking-ops";
import { listRuns } from "@/packs/production/ops";
import { listProcessors } from "@/packs/production/processor-ops";
import {
  bookingStanding,
  describeBookingDate,
  processorHandlesFrom,
  slugLabel,
} from "@/packs/production/vocabulary";
import {
  StartSheetDialog,
  type SheetTarget,
} from "@/packs/production/components/order-controls";

export const dynamic = "force-dynamic";

const BASE = "/dashboard/m/production";

/**
 * EVERY CUT SHEET — the front door this pack did not have.
 *
 * **THE FOUNDER COULD NOT FIND ONE, AND THAT IS THE BUG.** Two slices built the
 * sheet, printed it and priced it, and the only ways in were a row on Booked
 * dates and a card inside an open run — so a sheet was reachable only by
 * somebody who already knew which date or which run it hung off. A document that
 * leaves the building and is handed to somebody else needs a list of its own.
 *
 * **NOT A CARD ON THE PRODUCTION LANDING PAGE.** That page's job is the run
 * list and its yield column, and a sheet is not a run — it exists before one and
 * frequently without one. It sits beside Booked dates for the same reason
 * Booked dates does: it is a thing you go to, not a summary you pass.
 *
 * **THE DAY IS THE SPINE OF THE TABLE.** Reverse-chronological, because the
 * sheet somebody is looking for is nearly always the one for the day nearest to
 * hand; sheets with no day at all sort last, since a sheet nothing has dated is
 * the one least likely to be the one you want.
 */
export default async function CutSheetsPage() {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, "production");

  const { orders, bookings, runs, processors, pack } = await withTenant(
    ctx.tenant.id,
    async (tx) => {
      const [orders, bookings, runs, processors, pack] = await Promise.all([
        listOrders(tx, ctx.tenant.id),
        listBookings(tx, ctx.tenant.id),
        // Open runs only: a finished run's sheet was handed over weeks ago, and
        // writing one against it now would be a sheet for a day that has been.
        listRuns(tx, ctx.tenant.id, { status: "in_progress" }),
        listProcessors(tx, ctx.tenant.id),
        packContext(tx, ctx.tenant.id, ctx.tenant.industry, "production"),
      ]);
      return { orders, bookings, runs, processors, pack };
    },
    { role: ctx.role },
  );

  const today = todayInTimezone(ctx.tenant.timezone);
  const sheetWord = labelFor(pack.labels, "cutSheet", "Order");
  const runWord = labelFor(pack.labels, "productionRun", "Run");
  const processorWord = labelFor(pack.labels, "processor", "Processor");
  const kindOptions = processorHandlesFrom(pack.config);
  const isOwner = ctx.role === "owner";

  const nameByProcessor = new Map(
    processors.map((p) => [p.processor.id, p.name]),
  );

  /**
   * Where a new sheet can hang. A cancelled date and a date that already became
   * a run are both out: the first is not happening, and the second has a run
   * that carries its own Start.
   */
  const targets: SheetTarget[] = [
    ...bookings
      .filter(({ booking }) => {
        const standing = bookingStanding(
          {
            status: booking.status,
            bookedFor: booking.bookedFor,
            runId: booking.runId,
          },
          today,
        );
        return standing !== "cancelled" && standing !== "done";
      })
      .map(({ booking, processorName }) => ({
        id: booking.id,
        what: "booking" as const,
        processorId: booking.processorId,
        processorName,
        label: `${booking.bookedFor} · ${processorName} · ${describeBookingDate(
          booking.bookedFor,
          today,
        )}`,
      })),
    // A run with no plant was done here, and there is nobody to hand a sheet to.
    ...runs
      .filter((run) => run.processorId !== null)
      .map((run) => ({
        id: run.id,
        what: "run" as const,
        processorId: run.processorId as string,
        processorName: nameByProcessor.get(run.processorId as string) ?? "",
        label: `${run.code} · ${run.startedOn}`,
      })),
  ];

  /** The day a sheet is for: the run's if it became one, else the booking's. */
  const dayOf = (entry: (typeof orders)[number]) =>
    entry.run?.startedOn ?? entry.bookedFor ?? "";
  const rows = [...orders].sort((a, b) => {
    const dayA = dayOf(a);
    const dayB = dayOf(b);
    if (dayA === dayB) return 0;
    if (dayA === "") return 1;
    if (dayB === "") return -1;
    return dayB.localeCompare(dayA);
  });

  return (
    <div className="space-y-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link href={BASE}>
            <ChevronLeft className="size-4" />
            Production
          </Link>
        </Button>
      </div>

      <PageHeader
        title={`Every ${sheetWord.toLowerCase()}`}
        description={`What each plant was asked to do with one lot of animals. The sheet goes over with the animals at drop-off, so it exists before the ${runWord.toLowerCase()} does — and this is where to find one again.`}
        actions={
          isOwner ? (
            <StartSheetDialog
              targets={targets}
              kindOptions={kindOptions}
              sheetWord={sheetWord}
              runWord={runWord}
            />
          ) : null
        }
      />

      {rows.length === 0 ? (
        <EmptyState
          title={`Nothing asked for yet`}
          description={
            targets.length === 0
              ? `A ${sheetWord.toLowerCase()} is written against a booked date or an open ${runWord.toLowerCase()} at a ${processorWord.toLowerCase()}. Hold a date first, then come back.`
              : `What they cut is what you told them to cut, and the plant reads this rather than guessing.`
          }
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{sheetWord}</TableHead>
              <TableHead>{processorWord}</TableHead>
              <TableHead>What</TableHead>
              <TableHead>Which day</TableHead>
              <TableHead className="text-right">On it</TableHead>
              <TableHead>Printed</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((entry) => {
              const { order, processorName, lines, bookedFor, run } = entry;
              return (
                <TableRow key={order.id}>
                  <TableCell>
                    <Link
                      href={`${BASE}/orders/${order.id}`}
                      className="font-medium hover:underline"
                    >
                      {order.title || sheetWord}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {processorName}
                  </TableCell>
                  <TableCell>
                    {order.kind === "" ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <Badge variant="outline">{slugLabel(order.kind)}</Badge>
                    )}
                    {order.headCount !== null && (
                      <span className="ml-2 text-sm text-muted-foreground">
                        {order.headCount} head
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {/*
                      THE RUN'S DAY WINS ONCE THERE IS ONE, because that is when
                      the work actually happened; the booking's is the promise it
                      was written against. Both are shown when they differ, since
                      a sheet written for the 10th and used on the 12th is a real
                      thing to be able to see — the same rule the printed header
                      settled on in 2c.
                    */}
                    {run ? (
                      <Link
                        href={`${BASE}/${run.id}`}
                        className="hover:underline"
                      >
                        {run.startedOn}
                        <span className="block text-xs text-muted-foreground">
                          {run.code}
                          {bookedFor && bookedFor !== run.startedOn
                            ? ` · booked for ${bookedFor}`
                            : ""}
                        </span>
                      </Link>
                    ) : bookedFor ? (
                      <>
                        {bookedFor}
                        <span className="block text-xs text-muted-foreground">
                          {describeBookingDate(bookedFor, today)}
                        </span>
                      </>
                    ) : (
                      <span className="text-muted-foreground">No day set</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {lines.length === 0
                      ? "Nothing yet"
                      : `${lines.length} ${lines.length === 1 ? "line" : "lines"}`}
                  </TableCell>
                  <TableCell>
                    {/*
                      **"NOT PRINTED", NEVER "NOT SENT".** The stamp records that
                      this page went to a printer and nothing more — a sheet can
                      be read off a screen at the counter or photographed, so a
                      blank here is not evidence the plant never got one. It is
                      the nearest honest thing to a handed-over state, which the
                      dossier has wanted since 2b.
                    */}
                    {order.printedAt === null ? (
                      <span className="text-muted-foreground">Not printed</span>
                    ) : (
                      <span className="tabular-nums">
                        {order.printedAt.toISOString().slice(0, 10)}
                      </span>
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
}
