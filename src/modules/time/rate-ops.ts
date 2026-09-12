import "server-only";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import { TimeError } from "./core/errors";
import { isDateString } from "@/lib/timezone";

/**
 * What people are paid. ONE WRITER per table; every function takes the caller's
 * `tx` and never opens its own.
 *
 * ── EVERY FUNCTION HERE IS OWNERS-ONLY, AND NOT BY CHECKING ──────────────────
 *
 * `time_rates`' RLS policy carries `app_current_tenant_role() = 'owner'`, so a
 * `withTenant` opened with any other role sees an empty table and writes
 * nothing. That is deliberately stronger than a guard in the action layer:
 * `withTenant` defaults to `staff`, the least privileged value, so a future
 * caller that forgets to pass the role gets nothing rather than everything.
 *
 * It also means a read here returning zero rows means either "there are none"
 * or "you may not see them", and nothing downstream should try to tell those
 * apart — both come out as "no figure to show".
 */

export interface RateRow {
  id: string;
  workerId: string;
  effectiveOn: string;
  payRateCents: number;
  billRateCents: number | null;
  burdenPercent: number;
  version: number;
}

/** Every rate ever set, newest first, for the whole tenant. */
export async function listRates(tx: Tx, tenantId: string): Promise<RateRow[]> {
  return await tx
    .select({
      id: schema.timeRates.id,
      workerId: schema.timeRates.workerId,
      effectiveOn: schema.timeRates.effectiveOn,
      payRateCents: schema.timeRates.payRateCents,
      billRateCents: schema.timeRates.billRateCents,
      burdenPercent: schema.timeRates.burdenPercent,
      version: schema.timeRates.version,
    })
    .from(schema.timeRates)
    .where(eq(schema.timeRates.tenantId, tenantId))
    .orderBy(desc(schema.timeRates.effectiveOn), asc(schema.timeRates.workerId));
}

export interface SetRateInput {
  workerId: string;
  effectiveOn: string;
  payRateCents: number;
  billRateCents: number | null;
  burdenPercent: number;
}

/**
 * Set what somebody is paid from a given day.
 *
 * AN UPSERT ON `(worker, effective_on)`, which is the only shape that makes
 * sense: a second rate starting the same day is a correction of the first, not
 * a second rate. A rate starting on a different day is a new row and the
 * history keeps both — that is the whole point of effective dating, and it is
 * why nothing here ever edits an existing row's date.
 */
export async function setRate(
  tx: Tx,
  tenantId: string,
  input: SetRateInput,
): Promise<void> {
  if (!isDateString(input.effectiveOn)) {
    throw new TimeError("WORK_DATE_INVALID", "effective date must be a real day");
  }
  if (!Number.isInteger(input.payRateCents) || input.payRateCents < 0) {
    throw new TimeError("RATE_INVALID", "a wage cannot be negative");
  }
  if (
    input.billRateCents !== null &&
    (!Number.isInteger(input.billRateCents) || input.billRateCents < 0)
  ) {
    throw new TimeError("RATE_INVALID", "a bill rate cannot be negative");
  }
  if (
    !Number.isInteger(input.burdenPercent) ||
    input.burdenPercent < 0 ||
    input.burdenPercent > 200
  ) {
    throw new TimeError("RATE_INVALID", "burden must be between 0 and 200 percent");
  }

  const worker = await tx.query.timeWorkers.findFirst({
    where: and(
      eq(schema.timeWorkers.tenantId, tenantId),
      eq(schema.timeWorkers.id, input.workerId),
    ),
  });
  if (!worker) throw new TimeError("WORKER_NOT_FOUND", "no such worker");

  await tx
    .insert(schema.timeRates)
    .values({
      tenantId,
      workerId: input.workerId,
      effectiveOn: input.effectiveOn,
      payRateCents: input.payRateCents,
      billRateCents: input.billRateCents,
      burdenPercent: input.burdenPercent,
    })
    .onConflictDoUpdate({
      target: [
        schema.timeRates.tenantId,
        schema.timeRates.workerId,
        schema.timeRates.effectiveOn,
      ],
      set: {
        payRateCents: input.payRateCents,
        billRateCents: input.billRateCents,
        burdenPercent: input.burdenPercent,
        version: sql`${schema.timeRates.version} + 1`,
        updatedAt: new Date(),
      },
    });
}

/**
 * Remove one rate from the history.
 *
 * ALLOWED, unlike almost everything else in this module, because a rate is a
 * statement of intent rather than a record of something that happened: one
 * typed with the wrong effective date is simply wrong, and leaving it would
 * mis-price every week after it. What it cannot do is change an already
 * APPROVED period — those carry a frozen `gross_cents` taken at approval, so
 * the money somebody agreed to is not recomputed from a history that has since
 * moved.
 */
export async function deleteRate(
  tx: Tx,
  tenantId: string,
  rateId: string,
): Promise<void> {
  const result = await tx
    .delete(schema.timeRates)
    .where(
      and(eq(schema.timeRates.tenantId, tenantId), eq(schema.timeRates.id, rateId)),
    )
    .returning({ id: schema.timeRates.id });
  if (result.length === 0) {
    throw new TimeError("RATE_NOT_FOUND", "no such rate");
  }
}
