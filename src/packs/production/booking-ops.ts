import "server-only";
import { and, asc, eq, isNull, lt, ne } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import type { ProductionBooking } from "@/db/schema";
import { ProductionError, requireWrite, startRun, type ProductionCtx } from "./ops";
import { BOOKING_STATUSES, isValidSlug } from "./vocabulary";

/**
 * Dates held with a processor — the scarce resource.
 *
 * **THE READ THAT MATTERS IS `missedBookings`, NOT `listBookings`.** A farm that
 * opens this screen already knows what it booked; what it cannot see anywhere
 * today is the date that went by while somebody was busy. That query is two
 * predicates — the day has passed, and nothing says what happened — and it is
 * the whole reason `run_id` is a column instead of a status.
 *
 * **NOTHING HERE POSTS AND NOTHING HERE MOVES STOCK.** A booking is a promise
 * about a future day. The only write that touches the rest of the app is
 * `startRunFromBooking`, which delegates to `startRun` and then records what the
 * booking became — deliberately in that order, so a run that refuses to start
 * leaves the booking untouched rather than pointing at a run that does not
 * exist.
 */

export interface BookingInput {
  processorId: string;
  bookedFor: string;
  kind?: string;
  headCount?: number | null;
  status?: string;
  reference?: string;
  depositCents?: number | null;
  depositPaidOn?: string | null;
  notes?: string;
}

export type BookingPatch = Partial<Omit<BookingInput, "processorId">>;

/** A booking with the name of the place it is with, for a screen. */
export interface BookingDetail {
  booking: ProductionBooking;
  processorName: string;
  /**
   * What that processor said it can take of this kind in a day, or null when
   * the kind is unstated or nobody has recorded a capacity. **Advisory only** —
   * see `listBookings`.
   */
  capacityPerDay: number | null;
}

function validate(input: BookingPatch): void {
  if (
    input.status !== undefined &&
    !(BOOKING_STATUSES as readonly string[]).includes(input.status)
  ) {
    throw new ProductionError(
      "BOOKING_INVALID",
      "a date is pencilled in, confirmed, or cancelled",
    );
  }
  if (input.kind !== undefined && input.kind !== "" && !isValidSlug(input.kind)) {
    throw new ProductionError(
      "INVALID_KIND",
      "use lowercase letters, numbers and underscores",
    );
  }
  if (
    input.headCount !== undefined &&
    input.headCount !== null &&
    (input.headCount <= 0 || !Number.isInteger(input.headCount))
  ) {
    throw new ProductionError(
      "BOOKING_INVALID",
      "how many are going is a whole number, and more than none",
    );
  }
  if (
    input.depositCents !== undefined &&
    input.depositCents !== null &&
    input.depositCents < 0
  ) {
    throw new ProductionError("BOOKING_INVALID", "a deposit cannot be negative");
  }
}

/**
 * Every booking, newest date last, with the processor's name and its stated
 * capacity for that kind attached.
 *
 * **THE CAPACITY IS CARRIED FOR A WARNING AND NEVER FOR A REFUSAL.** Promising
 * twenty hogs to a plant that told you eight a day is very often correct — it is
 * two days, or the figure is stale, or they made an exception. The app has no
 * standing to overrule a farm about what another business agreed to, so the
 * screen says the two numbers disagree and lets a person decide. That is the
 * same call `land` makes between declared and measured acreage.
 */
export async function listBookings(
  tx: Tx,
  tenantId: string,
): Promise<BookingDetail[]> {
  const bookings = await tx.query.productionBookings.findMany({
    where: eq(schema.productionBookings.tenantId, tenantId),
    orderBy: [asc(schema.productionBookings.bookedFor)],
  });
  if (bookings.length === 0) return [];

  const [processors, parties, handles] = await Promise.all([
    tx.query.productionProcessors.findMany({
      where: eq(schema.productionProcessors.tenantId, tenantId),
    }),
    tx.query.parties.findMany({
      where: eq(schema.parties.tenantId, tenantId),
    }),
    tx.query.productionProcessorHandles.findMany({
      where: eq(schema.productionProcessorHandles.tenantId, tenantId),
    }),
  ]);
  const nameByParty = new Map(parties.map((p) => [p.id, p.displayName]));
  const partyByProcessor = new Map(processors.map((p) => [p.id, p.partyId]));

  return bookings.map((booking) => {
    const partyId = partyByProcessor.get(booking.processorId);
    const handle = handles.find(
      (h) => h.processorId === booking.processorId && h.kind === booking.kind,
    );
    return {
      booking,
      processorName: partyId ? (nameByParty.get(partyId) ?? "") : "",
      capacityPerDay: handle?.capacityPerDay ?? null,
    };
  });
}

/**
 * Dates that went by with nothing recorded against them.
 *
 * **THE QUERY THIS SLICE EXISTS FOR.** Not cancelled, no run, and the day is
 * behind us. It self-clears two ways — record the processing day, or cancel the
 * booking — which is what `notifications.md` requires of anything that reaches a
 * person unasked.
 */
export async function missedBookings(
  tx: Tx,
  tenantId: string,
  today: string,
): Promise<ProductionBooking[]> {
  return tx.query.productionBookings.findMany({
    where: and(
      eq(schema.productionBookings.tenantId, tenantId),
      ne(schema.productionBookings.status, "cancelled"),
      isNull(schema.productionBookings.runId),
      lt(schema.productionBookings.bookedFor, today),
    ),
    orderBy: [asc(schema.productionBookings.bookedFor)],
  });
}

export async function getBooking(
  tx: Tx,
  tenantId: string,
  id: string,
): Promise<ProductionBooking | null> {
  const row = await tx.query.productionBookings.findFirst({
    where: and(
      eq(schema.productionBookings.tenantId, tenantId),
      eq(schema.productionBookings.id, id),
    ),
  });
  return row ?? null;
}

export async function createBooking(
  tx: Tx,
  ctx: ProductionCtx,
  input: BookingInput,
): Promise<ProductionBooking> {
  // OWNER. Holding a date commits the farm to a morning six months out and
  // usually to money; it is the planning decision the design describes, not the
  // chore a kill sheet is.
  requireWrite(ctx, "owner");
  validate(input);

  const processor = await tx.query.productionProcessors.findFirst({
    where: and(
      eq(schema.productionProcessors.tenantId, ctx.tenantId),
      eq(schema.productionProcessors.id, input.processorId),
    ),
  });
  if (!processor) {
    throw new ProductionError("NOT_FOUND", "that processor is gone");
  }

  const [row] = await tx
    .insert(schema.productionBookings)
    .values({
      tenantId: ctx.tenantId,
      processorId: input.processorId,
      bookedFor: input.bookedFor,
      kind: (input.kind ?? "").trim().toLowerCase(),
      headCount: input.headCount ?? null,
      status: input.status ?? "held",
      reference: (input.reference ?? "").trim(),
      depositCents: input.depositCents ?? null,
      depositPaidOn: input.depositPaidOn ?? null,
      notes: (input.notes ?? "").trim(),
    })
    .returning();
  return row;
}

export async function updateBooking(
  tx: Tx,
  ctx: ProductionCtx,
  id: string,
  patch: BookingPatch,
): Promise<ProductionBooking> {
  requireWrite(ctx, "owner");
  validate(patch);

  const existing = await getBooking(tx, ctx.tenantId, id);
  if (!existing) throw new ProductionError("NOT_FOUND", "that booking is gone");

  // Refused in words here as well as by the CHECK, because a person cancelling
  // a date that already happened has almost certainly picked the wrong row.
  if (patch.status === "cancelled" && existing.runId) {
    throw new ProductionError(
      "BOOKING_INVALID",
      "this date already became a processing day, so it cannot be cancelled — the run is the record of what happened",
    );
  }

  const [row] = await tx
    .update(schema.productionBookings)
    .set({
      ...(patch.bookedFor !== undefined ? { bookedFor: patch.bookedFor } : {}),
      ...(patch.kind !== undefined
        ? { kind: patch.kind.trim().toLowerCase() }
        : {}),
      ...(patch.headCount !== undefined ? { headCount: patch.headCount } : {}),
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      ...(patch.reference !== undefined
        ? { reference: patch.reference.trim() }
        : {}),
      ...(patch.depositCents !== undefined
        ? { depositCents: patch.depositCents }
        : {}),
      ...(patch.depositPaidOn !== undefined
        ? { depositPaidOn: patch.depositPaidOn }
        : {}),
      ...(patch.notes !== undefined ? { notes: patch.notes.trim() } : {}),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.productionBookings.tenantId, ctx.tenantId),
        eq(schema.productionBookings.id, id),
      ),
    )
    .returning();
  return row;
}

export async function removeBooking(
  tx: Tx,
  ctx: ProductionCtx,
  id: string,
): Promise<ProductionBooking> {
  requireWrite(ctx, "owner");
  const [row] = await tx
    .delete(schema.productionBookings)
    .where(
      and(
        eq(schema.productionBookings.tenantId, ctx.tenantId),
        eq(schema.productionBookings.id, id),
      ),
    )
    .returning();
  if (!row) throw new ProductionError("NOT_FOUND", "that is already gone");
  return row;
}

/**
 * The day arrives: turn the booking into a run.
 *
 * **THE RUN IS STARTED FIRST AND THE BOOKING UPDATED SECOND, DELIBERATELY.**
 * `startRun` can refuse — a duplicate code, a role that may not start one — and
 * doing it this way round means a refusal leaves the booking exactly as it was
 * rather than pointing at a run that was never created. Both writes are in the
 * caller's transaction, so a failure after the insert unwinds the run too; the
 * ordering is about which error a person sees, not about atomicity.
 *
 * **IT DOES NOT PUT THE ANIMALS IN.** The run starts empty and somebody adds
 * the inputs, because that is the act `livestock`'s withdrawal clock refuses,
 * and a booking made in March cannot know which pen will be ready in October.
 * Carrying the promised head over as a real input would be this pack inventing a
 * movement nobody made.
 */
export async function startRunFromBooking(
  tx: Tx,
  ctx: ProductionCtx,
  bookingId: string,
  args: { code: string; runKind?: string; startedOn: string },
): Promise<{ booking: ProductionBooking; runId: string }> {
  requireWrite(ctx, "owner");
  const booking = await getBooking(tx, ctx.tenantId, bookingId);
  if (!booking) throw new ProductionError("NOT_FOUND", "that booking is gone");
  if (booking.status === "cancelled") {
    throw new ProductionError(
      "BOOKING_INVALID",
      "this date was cancelled — reopen it first if it went ahead after all",
    );
  }
  if (booking.runId) {
    throw new ProductionError(
      "BOOKING_INVALID",
      "this date already became a processing day",
    );
  }

  const run = await startRun(tx, ctx, {
    code: args.code,
    runKind: args.runKind,
    startedOn: args.startedOn,
  });

  const [row] = await tx
    .update(schema.productionBookings)
    .set({ runId: run.id, updatedAt: new Date() })
    .where(
      and(
        eq(schema.productionBookings.tenantId, ctx.tenantId),
        eq(schema.productionBookings.id, bookingId),
      ),
    )
    .returning();
  return { booking: row, runId: run.id };
}
