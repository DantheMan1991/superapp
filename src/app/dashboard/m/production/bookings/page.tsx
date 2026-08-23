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
import { listBookings } from "@/packs/production/booking-ops";
import { listProcessors } from "@/packs/production/processor-ops";
import { listOrders } from "@/packs/production/order-ops";
import {
  BOOKING_STATUS_LABELS,
  bookingStanding,
  centsToDisplay,
  describeBookingDate,
  processorHandlesFrom,
  runKindsFrom,
  slugLabel,
} from "@/packs/production/vocabulary";
import {
  AddBookingDialog,
  EditBookingDialog,
  RemoveBookingButton,
  StartRunFromBookingButton,
} from "@/packs/production/components/booking-controls";
import { AddOrderDialog } from "@/packs/production/components/order-controls";

export const dynamic = "force-dynamic";

const BASE = "/dashboard/m/production";

/**
 * Dates held with a processor — the scarce resource, and the screen this whole
 * slice exists for.
 *
 * **THE MISSED SECTION IS FIRST, AND IT IS NOT SORTED WITH THE REST.** A date
 * that went by with nothing recorded against it is the only thing on this page
 * that needs somebody today: either the animals went and nobody wrote it down —
 * so the yield, the cost and the traceability chain for that kill are all
 * missing — or the date was lost. Everything else here is information.
 *
 * The same rows reach the morning digest through
 * `src/packs/production/attention/source.ts`, which is what makes this page
 * something a person does not have to remember to open.
 */
export default async function BookingsPage() {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, "production");

  const { bookings, processors, pack, orders } = await withTenant(
    ctx.tenant.id,
    async (tx) => {
      const [bookings, processors, pack, orders] = await Promise.all([
        listBookings(tx, ctx.tenant.id),
        listProcessors(tx, ctx.tenant.id),
        packContext(tx, ctx.tenant.id, ctx.tenant.industry, "production"),
        // Every sheet, in one read. A per-row query would be an N+1 in the
        // critical path of the page the whole booking slice exists for.
        listOrders(tx, ctx.tenant.id),
      ]);
      return { bookings, processors, pack, orders };
    },
    { role: ctx.role },
  );

  const today = todayInTimezone(ctx.tenant.timezone);
  const word = labelFor(pack.labels, "processor", "Processor");
  const runWord = labelFor(pack.labels, "productionRun", "Run");
  const cutSheetWord = labelFor(pack.labels, "cutSheet", "Order");
  const kindOptions = processorHandlesFrom(pack.config);
  const isOwner = ctx.role === "owner";

  // Sheets by the date they were written against. A sheet that has become a run
  // is still listed here, because the booking is where somebody looks for it
  // before the day and the link goes to the same page either way.
  const sheetsByBooking = new Map<string, typeof orders>();
  for (const entry of orders) {
    const key = entry.order.bookingId;
    if (!key) continue;
    const existing = sheetsByBooking.get(key);
    if (existing) existing.push(entry);
    else sheetsByBooking.set(key, [entry]);
  }

  const options = processors.map((p) => ({
    id: p.processor.id,
    name: p.name,
    kinds: p.handles.map((h) => ({
      kind: h.kind,
      capacityPerDay: h.capacityPerDay,
    })),
  }));

  const withStanding = bookings.map((b) => ({
    ...b,
    standing: bookingStanding(
      {
        status: b.booking.status,
        bookedFor: b.booking.bookedFor,
        runId: b.booking.runId,
      },
      today,
    ),
  }));

  const missed = withStanding.filter((b) => b.standing === "missed");
  const ahead = withStanding.filter(
    (b) => b.standing === "today" || b.standing === "soon" || b.standing === "upcoming",
  );
  const finished = withStanding.filter(
    (b) => b.standing === "done" || b.standing === "cancelled",
  );

  const section = (
    title: string,
    note: string,
    rows: typeof withStanding,
    tone: "alert" | "plain",
  ) =>
    rows.length === 0 ? null : (
      <section className="space-y-2">
        <h2 className="text-sm font-medium">{title}</h2>
        <p className={tone === "alert" ? "text-sm" : "text-sm text-muted-foreground"}>
          {note}
        </p>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{word}</TableHead>
              <TableHead>When</TableHead>
              <TableHead>What</TableHead>
              <TableHead className="text-right">Deposit</TableHead>
              <TableHead>Standing</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(({ booking, processorName, capacityPerDay, standing }) => {
              const deposit = centsToDisplay(booking.depositCents);
              const over =
                capacityPerDay !== null &&
                booking.headCount !== null &&
                booking.headCount > capacityPerDay;
              return (
                // The anchor the digest links to. An obligation has to land on
                // the record, not on a list somebody then has to search.
                <TableRow key={booking.id} id={`booking-${booking.id}`}>
                  <TableCell className="font-medium">{processorName}</TableCell>
                  <TableCell>
                    {booking.bookedFor}
                    <span className="block text-xs text-muted-foreground">
                      {describeBookingDate(booking.bookedFor, today)}
                    </span>
                  </TableCell>
                  <TableCell>
                    {booking.headCount !== null
                      ? `${booking.headCount} head`
                      : "—"}
                    {booking.kind !== "" && (
                      <span className="block text-xs text-muted-foreground">
                        {slugLabel(booking.kind)}
                        {over && ` · they said ${capacityPerDay} a day`}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {/* Never $0.00 for a date held on a phone call. */}
                    {deposit ?? "—"}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        booking.status === "confirmed" ? "secondary" : "outline"
                      }
                    >
                      {standing === "done"
                        ? "Went ahead"
                        : BOOKING_STATUS_LABELS[booking.status]}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex flex-wrap items-center justify-end gap-1">
                      {/*
                        THE CUT SHEETS WRITTEN AGAINST THIS DATE. They belong on
                        the booking rather than only on the run, because the
                        sheet is what goes over WITH the animals — it exists
                        months before a run does, and `startRunFromBooking`
                        carries it across.
                      */}
                      {(sheetsByBooking.get(booking.id) ?? []).map((entry) => (
                        <Button
                          key={entry.order.id}
                          asChild
                          variant="ghost"
                          size="sm"
                        >
                          <Link href={`${BASE}/orders/${entry.order.id}`}>
                            {entry.order.title || cutSheetWord}
                          </Link>
                        </Button>
                      ))}
                      {isOwner && !booking.runId && (
                        <AddOrderDialog
                          processorId={booking.processorId}
                          processorName={processorName}
                          bookingId={booking.id}
                          kindOptions={kindOptions}
                          sheetWord={cutSheetWord}
                        />
                      )}
                    </div>
                    {isOwner && (
                      <div className="flex items-center justify-end gap-1">
                        {standing === "missed" || standing === "today" ? (
                          <StartRunFromBookingButton
                            bookingId={booking.id}
                            defaultCode={`${runWord} ${booking.bookedFor}`}
                            runWord={runWord}
                            kindOptions={runKindsFrom(pack.config)}
                            bookedFor={booking.bookedFor}
                          />
                        ) : null}
                        {booking.runId ? (
                          <Button asChild variant="ghost" size="sm">
                            <Link href={`${BASE}/${booking.runId}`}>
                              Open the {runWord.toLowerCase()}
                            </Link>
                          </Button>
                        ) : (
                          <>
                            <EditBookingDialog
                              id={booking.id}
                              word={word}
                              processors={options}
                              initial={{
                                processorId: booking.processorId,
                                bookedFor: booking.bookedFor,
                                kind: booking.kind === "" ? "any" : booking.kind,
                                headCount:
                                  booking.headCount?.toString() ?? "",
                                status: booking.status,
                                reference: booking.reference,
                                deposit:
                                  booking.depositCents !== null
                                    ? (booking.depositCents / 100).toFixed(2)
                                    : "",
                                depositPaidOn: booking.depositPaidOn ?? "",
                                notes: booking.notes,
                              }}
                            />
                            <RemoveBookingButton id={booking.id} />
                          </>
                        )}
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </section>
    );

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
        title="Booked dates"
        description={`Good places are booked six to twelve months ahead and losing a date is expensive. This is what you are holding, and what went by without anybody saying what happened.`}
        actions={
          isOwner ? (
            <AddBookingDialog
              processors={options}
              word={word}
              today={today}
            />
          ) : null
        }
      />

      {processors.length === 0 ? (
        <EmptyState
          title={`Nobody to book with yet`}
          description={`A date is held with somebody. Add them to the ${word.toLowerCase()} directory first, then come back.`}
        />
      ) : bookings.length === 0 ? (
        <EmptyState
          title="No dates held"
          description={`Nothing is booked. If a season is coming, this is the thing to do first — the animals can wait, the date cannot.`}
        />
      ) : (
        <div className="space-y-8">
          {section(
            "Nothing recorded",
            "These days have gone by and nothing says what happened. Either it went ahead and needs recording, or the date was lost.",
            missed,
            "alert",
          )}
          {section(
            "Coming up",
            "What you are holding.",
            ahead,
            "plain",
          )}
          {section(
            "Done with",
            "Kept so the season's history stays honest.",
            finished,
            "plain",
          )}
        </div>
      )}
    </div>
  );
}
