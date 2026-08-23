import "server-only";
import { and, asc, eq, isNull, lte, ne } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import type {
  AttentionCtx,
  AttentionItem,
  AttentionSource,
} from "@/lib/attention-sources/types";
import { addDays } from "@/lib/timezone";
import {
  BOOKING_SOON_WITHIN_DAYS,
  describeBookingDate,
} from "../vocabulary";

/**
 * What `production` says you still owe: the dates you are holding, and the ones
 * that went by while nobody was looking.
 *
 * **THE FIRST ATTENTION SOURCE THAT IS A PACK RATHER THAN A CORE MODULE.** It
 * imports `@/lib/attention-sources/types` and nothing else from `src/lib` beyond
 * the db handle and the date helper — never the registry, never another pack.
 * The graph in that file's header is unchanged; only the left-hand side now
 * reads `src/packs/<slug>/attention/source.ts` as well.
 *
 * ── WHY A BOOKING IS THE STRONGEST OBLIGATION THIS PACK HAS ─────────────────
 *
 * The design calls slaughter dates *"the scarce resource"*, records that plants
 * book six to twelve months ahead with deposits involved, and says losing a date
 * is expensive — you do not get another one in October. That is an obligation
 * with a real agreed date, real money at risk, and a genuine self-clearing
 * condition, which is everything `notifications.md` asks of one.
 *
 * ── THE ITEM THAT JUSTIFIES THE WHOLE SLICE ─────────────────────────────────
 *
 * **A date that has passed with no processing day recorded and no cancellation.**
 * Either the animals went and nobody wrote it down — so the yield, the cost and
 * the traceability chain for that kill are all missing — or the date was lost.
 * Both need a person, and neither is visible anywhere else in the app. It clears
 * two ways, both of which are the correct thing to do: record what happened, or
 * cancel the booking.
 *
 * ── IT GOES TO EVERYBODY, AND THAT IS A DECISION WITH A COST ────────────────
 *
 * A booking has no assignee, and adding one would be a column nobody fills — a
 * processing day is two or three people and the design says so. Work can deliver
 * per-person because its rows carry a real assignee; this cannot, so everyone on
 * the tenant is told. **The cost is that a three-person farm gets the same line
 * three times**, once in each digest. That is accepted because the failure in the
 * other direction is a kill date nobody was told about, and because the item
 * disappears for all three the moment any one of them acts on it.
 *
 * ── WHAT IS DELIBERATELY NOT AN OBLIGATION ──────────────────────────────────
 *
 *  1. **A cancelled date.** Finished with, and a list that keeps raising it is
 *     one somebody stops reading.
 *  2. **A date that became a run.** `run_id` is set, so the thing it was asking
 *     for has happened.
 *  3. **A date beyond the horizon.** Twenty-one days — see
 *     `BOOKING_SOON_WITHIN_DAYS`, and note it is three times Work's seven,
 *     because getting animals to weight and clear of a withdrawal is not
 *     something a person can do in the last week.
 *  4. **A processor with no bookings at all**, however far ahead it says it
 *     books. "You should probably book something" is advice, not an obligation,
 *     and a digest that offers advice is one that gets muted.
 */
export const productionAttentionSource: AttentionSource = {
  slug: "production-bookings",
  moduleSlug: "production",
  label: "Production",

  async collect(tx: Tx, ctx: AttentionCtx): Promise<AttentionItem[]> {
    const horizon = addDays(ctx.today, BOOKING_SOON_WITHIN_DAYS);

    const rows = await tx
      .select({
        id: schema.productionBookings.id,
        bookedFor: schema.productionBookings.bookedFor,
        kind: schema.productionBookings.kind,
        headCount: schema.productionBookings.headCount,
        status: schema.productionBookings.status,
        processorName: schema.parties.displayName,
      })
      .from(schema.productionBookings)
      .innerJoin(
        schema.productionProcessors,
        and(
          eq(
            schema.productionProcessors.tenantId,
            schema.productionBookings.tenantId,
          ),
          eq(
            schema.productionProcessors.id,
            schema.productionBookings.processorId,
          ),
        ),
      )
      .innerJoin(
        schema.parties,
        and(
          eq(schema.parties.tenantId, schema.productionProcessors.tenantId),
          eq(schema.parties.id, schema.productionProcessors.partyId),
        ),
      )
      .where(
        and(
          eq(schema.productionBookings.tenantId, ctx.tenantId),
          ne(schema.productionBookings.status, "cancelled"),
          // Nothing has been recorded against it yet. This is the predicate
          // that makes both items below self-clearing.
          isNull(schema.productionBookings.runId),
          // Everything up to the horizon, INCLUDING the past — the missed ones
          // are the point, and a `gte(today)` here would hide exactly the rows
          // this source exists to surface.
          lte(schema.productionBookings.bookedFor, horizon),
        ),
      )
      .orderBy(asc(schema.productionBookings.bookedFor));

    return rows.map((row) => {
      const missed = row.bookedFor < ctx.today;
      const when = describeBookingDate(row.bookedFor, ctx.today);
      const what = [
        row.headCount ? `${row.headCount} head` : null,
        row.kind !== "" ? row.kind.replace(/_/g, " ") : null,
      ]
        .filter(Boolean)
        .join(" ");

      return {
        key: `production_booking:${row.id}`,
        /**
         * NO "for" BEFORE `when`, and it is not a style preference — it was
         * "booked for in 18 days" on the live page until somebody read it.
         * `describeBookingDate` returns a phrase that already carries its own
         * preposition ("in 18 days", "5 days ago") or none at all ("today",
         * "tomorrow"), so anything in front of it has to work with all four.
         * "is booked" does; "is booked for" does not.
         */
        title: missed
          ? `${row.processorName} was booked ${when} and nothing has been recorded`
          : `${row.processorName} is booked ${when}`,
        detail:
          [
            what || null,
            missed
              ? "Start the batch, or cancel the date if it did not go ahead"
              : row.status === "held"
                ? "Pencilled in, not confirmed"
                : null,
          ]
            .filter(Boolean)
            .join(" · ") || undefined,
        urgency: missed
          ? "overdue"
          : row.bookedFor === ctx.today
            ? "today"
            : "soon",
        dueOn: row.bookedFor,
        href: `/dashboard/m/production/bookings#booking-${row.id}`,
      };
    });
  },
};
