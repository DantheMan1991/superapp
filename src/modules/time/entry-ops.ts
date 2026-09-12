import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import { MAX_ENTRY_MINUTES } from "./core/duration";
import { TimeError } from "./core/errors";
import { isPayType } from "./core/pay-types";
import { isDateString } from "./core/week";

/**
 * The hours themselves. ONE WRITER per table; every function takes the caller's
 * `tx` and never opens its own.
 *
 * WHAT IS VALIDATED HERE RATHER THAN IN THE ACTION, and why: the action's Zod
 * schema checks the SHAPE of what arrived over the wire, and this file checks
 * what is true of a time entry regardless of who is asking — a real day, a
 * length a day can hold, a pay type the evaluator will be able to classify.
 * Slice 7 adds a second caller (a phone, offline, syncing later) and slice 2 a
 * third (the model reading a sentence), and neither should have to remember
 * these.
 */

export interface LogTimeInput {
  workerId: string;
  minutes: number;
  workDate: string;
  payType: string;
  note: string;
  enteredByClerkUserId: string;
  /** The tenant's today. Passed in so one request has one idea of the date. */
  today: string;
}

function assertEntryFields(input: {
  minutes: number;
  workDate: string;
  payType: string;
  today: string;
}): void {
  if (!Number.isInteger(input.minutes) || input.minutes <= 0) {
    throw new TimeError("DURATION_UNREADABLE", "minutes must be a positive whole number");
  }
  if (input.minutes > MAX_ENTRY_MINUTES) {
    throw new TimeError("DURATION_TOO_LONG", "one entry cannot exceed a day");
  }
  if (!isDateString(input.workDate)) {
    throw new TimeError("WORK_DATE_INVALID", "work date must be a real yyyy-mm-dd day");
  }
  /*
   * ANCHORED ON THE TENANT'S TODAY, never the server's. A farm in Hawaii and a
   * server in Virginia disagree about what day it is for five hours out of
   * every twenty-four, and the reader experiences that as the product refusing
   * this morning's work.
   *
   * Refused rather than warned: an hour that has not happened is not a record
   * of anything, and the only way it reaches a timesheet is a mistyped year.
   */
  if (input.workDate > input.today) {
    throw new TimeError("WORK_DATE_IN_FUTURE", "that day has not happened yet");
  }
  if (!isPayType(input.payType)) {
    throw new TimeError("PAY_TYPE_INVALID", "unknown pay type");
  }
}

/** The worker must exist, belong to this tenant, and still be here. */
async function loadActiveWorker(tx: Tx, tenantId: string, workerId: string) {
  const worker = await tx.query.timeWorkers.findFirst({
    where: and(
      eq(schema.timeWorkers.tenantId, tenantId),
      eq(schema.timeWorkers.id, workerId),
    ),
  });
  if (!worker) throw new TimeError("WORKER_NOT_FOUND", "no such worker");
  if (!worker.isActive) {
    throw new TimeError("WORKER_INACTIVE", "that person has left");
  }
  return worker;
}

export async function logTime(
  tx: Tx,
  tenantId: string,
  input: LogTimeInput,
): Promise<string> {
  assertEntryFields(input);
  await loadActiveWorker(tx, tenantId, input.workerId);

  const [row] = await tx
    .insert(schema.timeEntries)
    .values({
      tenantId,
      workerId: input.workerId,
      minutes: input.minutes,
      workDate: input.workDate,
      payType: input.payType,
      note: input.note.trim(),
      enteredByClerkUserId: input.enteredByClerkUserId,
    })
    .returning({ id: schema.timeEntries.id });
  return row.id;
}

export interface UpdateEntryInput {
  entryId: string;
  expectedVersion: number;
  minutes: number;
  workDate: string;
  payType: string;
  note: string;
  today: string;
}

export async function updateEntry(
  tx: Tx,
  tenantId: string,
  input: UpdateEntryInput,
): Promise<void> {
  assertEntryFields(input);

  const result = await tx
    .update(schema.timeEntries)
    .set({
      minutes: input.minutes,
      workDate: input.workDate,
      payType: input.payType,
      note: input.note.trim(),
      version: sql`${schema.timeEntries.version} + 1`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.timeEntries.tenantId, tenantId),
        eq(schema.timeEntries.id, input.entryId),
        eq(schema.timeEntries.version, input.expectedVersion),
      ),
    )
    .returning({ id: schema.timeEntries.id });

  if (result.length === 0) {
    const still = await tx.query.timeEntries.findFirst({
      where: and(
        eq(schema.timeEntries.tenantId, tenantId),
        eq(schema.timeEntries.id, input.entryId),
      ),
    });
    throw still
      ? new TimeError("STALE_VERSION", "entry changed underneath")
      : new TimeError("ENTRY_NOT_FOUND", "no such entry");
  }
}

/**
 * A HARD DELETE, and it is the right shape only while this slice holds.
 *
 * Nothing downstream has read these rows yet: no timesheet has been approved,
 * no pay run has quoted them, nothing has posted. Slice 3 introduces the lock,
 * and from that point an approved entry is not deletable at all — a correction
 * becomes an amendment in the open period, because paid history is not
 * rewritten. The guard belongs with the lock that makes it meaningful; adding
 * it now would guard against a state that cannot exist.
 */
export async function deleteEntry(
  tx: Tx,
  tenantId: string,
  entryId: string,
): Promise<void> {
  const result = await tx
    .delete(schema.timeEntries)
    .where(
      and(
        eq(schema.timeEntries.tenantId, tenantId),
        eq(schema.timeEntries.id, entryId),
      ),
    )
    .returning({ id: schema.timeEntries.id });
  if (result.length === 0) {
    throw new TimeError("ENTRY_NOT_FOUND", "no such entry");
  }
}
