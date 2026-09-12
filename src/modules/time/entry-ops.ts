import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import { MAX_ENTRY_MINUTES } from "./core/duration";
import { TimeError } from "./core/errors";
import { isDateString } from "@/lib/timezone";
import { assertPeriodOpen } from "./sheet-ops";
import { isPayType } from "./core/pay-types";

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

function assertEntryFields(
  input: {
    minutes: number;
    workDate: string;
    payType: string;
    today: string;
  },
  /**
   * Let the day be in the future.
   *
   * ONLY THE AMENDMENT PATH PASSES THIS, and only because the server chooses
   * that date rather than a person typing it: a correction lands on the first
   * day of the first OPEN period, which is genuinely tomorrow or later whenever
   * the business has locked the period it is standing in. The guard below
   * exists to catch a mistyped year, and a date the server computed cannot have
   * one. Found by driving slice 3, where every correction was refused as being
   * in the future.
   */
  allowFuture = false,
): void {
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
  if (!allowFuture && input.workDate > input.today) {
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
  // Not just edits: a NEW entry backdated into a locked period would change
  // what a pay run already quoted just as surely as changing an old one.
  await assertPeriodOpen(tx, tenantId, input.workDate);

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

  /*
   * BOTH DAYS ARE CHECKED. Moving an entry OUT of a locked period would take
   * hours off a pay run that already counted them, and moving one IN would add
   * hours to it — so the day it is leaving and the day it is arriving on both
   * have to be open.
   */
  const current = await tx.query.timeEntries.findFirst({
    where: and(
      eq(schema.timeEntries.tenantId, tenantId),
      eq(schema.timeEntries.id, input.entryId),
    ),
    columns: { workDate: true },
  });
  if (!current) throw new TimeError("ENTRY_NOT_FOUND", "no such entry");
  await assertPeriodOpen(tx, tenantId, current.workDate);
  if (current.workDate !== input.workDate) {
    await assertPeriodOpen(tx, tenantId, input.workDate);
  }

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
 * A hard delete, and only while the period is open.
 *
 * Slice 3 added the guard this comment used to promise: once the pay period is
 * locked, the entry cannot be removed at all and a correction is an
 * `amendEntry` in the open period instead. Paid history is not rewritten.
 */
export async function deleteEntry(
  tx: Tx,
  tenantId: string,
  entryId: string,
): Promise<void> {
  const current = await tx.query.timeEntries.findFirst({
    where: and(
      eq(schema.timeEntries.tenantId, tenantId),
      eq(schema.timeEntries.id, entryId),
    ),
    columns: { workDate: true },
  });
  if (!current) throw new TimeError("ENTRY_NOT_FOUND", "no such entry");
  await assertPeriodOpen(tx, tenantId, current.workDate);

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

export interface AmendEntryInput {
  /** The entry in the locked period that turned out to be wrong. */
  originalEntryId: string;
  /** What the difference is worth, in the OPEN period. */
  minutes: number;
  workDate: string;
  payType: string;
  note: string;
  enteredByClerkUserId: string;
  today: string;
}

/**
 * Correct a locked entry by adding a new one that says what the difference was.
 *
 * THE ONLY WAY TO PUT RIGHT AN HOUR SOMEBODY HAS ALREADY BEEN PAID FOR. The
 * original is left exactly as the pay run saw it and the new entry points back
 * at it, so the record answers both "what were they paid?" and "what did we
 * later decide was true?" — questions a rewrite would merge into one wrong
 * answer.
 *
 * REFUSED WHEN THE ORIGINAL IS NOT ACTUALLY LOCKED. An entry that can still be
 * edited should be edited: two ways to change one number is how the two stop
 * agreeing, and an amendment of an open entry would double-count it.
 */
export async function amendEntry(
  tx: Tx,
  tenantId: string,
  input: AmendEntryInput,
): Promise<string> {
  assertEntryFields(input, true);

  const original = await tx.query.timeEntries.findFirst({
    where: and(
      eq(schema.timeEntries.tenantId, tenantId),
      eq(schema.timeEntries.id, input.originalEntryId),
    ),
  });
  if (!original) throw new TimeError("ENTRY_NOT_FOUND", "no such entry");

  // The original must be locked, and the correction must not be.
  let originalIsLocked = false;
  try {
    await assertPeriodOpen(tx, tenantId, original.workDate);
  } catch (err) {
    if (err instanceof TimeError && err.code === "PERIOD_LOCKED") {
      originalIsLocked = true;
    } else {
      throw err;
    }
  }
  if (!originalIsLocked) {
    throw new TimeError("AMEND_NOT_LOCKED", "that entry can still be edited");
  }
  await assertPeriodOpen(tx, tenantId, input.workDate);

  const [row] = await tx
    .insert(schema.timeEntries)
    .values({
      tenantId,
      // The correction belongs to the same person as the thing it corrects;
      // taking the worker from the caller would let a slip reassign an hour.
      workerId: original.workerId,
      minutes: input.minutes,
      workDate: input.workDate,
      payType: input.payType,
      note: input.note.trim(),
      enteredByClerkUserId: input.enteredByClerkUserId,
      amendsEntryId: original.id,
    })
    .returning({ id: schema.timeEntries.id });
  return row.id;
}

/**
 * Tag an entry with what it was for: one dimension member per dimension type.
 *
 * REPLACES THE WHOLE SET rather than merging, because the caller always holds
 * the complete answer — `DimensionTags` round-trips every id it was given,
 * including ones for types the surface could not show. A merge would make
 * "remove this tag" unexpressible.
 *
 * VALIDATED THE WAY THE LEDGER VALIDATES IT: the member must exist, belong to
 * this tenant and be active, and no two members may share a type. An inactive
 * member is refused rather than quietly kept, because `postEntry` will refuse
 * it too when slice 6 posts the labor cost — better to disagree now than at the
 * pay run.
 */
export async function setEntryDimensions(
  tx: Tx,
  tenantId: string,
  entryId: string,
  memberIds: readonly string[],
): Promise<void> {
  await tx
    .delete(schema.timeEntryDimensions)
    .where(
      and(
        eq(schema.timeEntryDimensions.tenantId, tenantId),
        eq(schema.timeEntryDimensions.entryId, entryId),
      ),
    );
  if (memberIds.length === 0) return;

  const unique = [...new Set(memberIds)];
  const members = await tx
    .select({
      id: schema.dimensionMembers.id,
      dimensionType: schema.dimensionMembers.dimensionType,
      isActive: schema.dimensionMembers.isActive,
    })
    .from(schema.dimensionMembers)
    .where(
      and(
        eq(schema.dimensionMembers.tenantId, tenantId),
        inArray(schema.dimensionMembers.id, unique),
      ),
    );

  const byId = new Map(members.map((m) => [m.id, m]));
  const seenTypes = new Set<string>();
  const rows = unique.map((id) => {
    const member = byId.get(id);
    if (!member || !member.isActive) {
      throw new TimeError("DIMENSION_INVALID", `dimension member ${id} invalid`);
    }
    if (seenTypes.has(member.dimensionType)) {
      throw new TimeError(
        "DIMENSION_INVALID",
        `two members of dimension type ${member.dimensionType}`,
      );
    }
    seenTypes.add(member.dimensionType);
    return {
      tenantId,
      entryId,
      dimensionType: member.dimensionType,
      memberId: id,
    };
  });

  await tx.insert(schema.timeEntryDimensions).values(rows);
}

/**
 * Divide one entry in two, so each half can say what it was for.
 *
 * THE ANSWER TO "five hours on the north field and three on the barn". The
 * original keeps the remainder and the new entry takes `minutes`, so the day's
 * total never moves — which is the property that makes this safe to offer on a
 * screen where somebody is looking at a figure they already believe.
 *
 * The new half inherits everything except the tags, which are the whole reason
 * for splitting; its own are set by the caller straight afterwards. A punch is
 * deliberately NOT inherited: `time_entries_punch_idx` allows one entry per
 * punch, and the raw record belongs to the half that kept the original id.
 */
export async function splitEntry(
  tx: Tx,
  tenantId: string,
  input: { entryId: string; minutes: number; today: string },
): Promise<string> {
  const original = await tx.query.timeEntries.findFirst({
    where: and(
      eq(schema.timeEntries.tenantId, tenantId),
      eq(schema.timeEntries.id, input.entryId),
    ),
  });
  if (!original) throw new TimeError("ENTRY_NOT_FOUND", "no such entry");
  await assertPeriodOpen(tx, tenantId, original.workDate);

  if (!Number.isInteger(input.minutes) || input.minutes <= 0) {
    throw new TimeError("DURATION_UNREADABLE", "minutes must be positive");
  }
  if (input.minutes >= original.minutes) {
    throw new TimeError(
      "SPLIT_TOO_LARGE",
      "a split has to leave something behind",
    );
  }

  await tx
    .update(schema.timeEntries)
    .set({
      minutes: original.minutes - input.minutes,
      version: sql`${schema.timeEntries.version} + 1`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.timeEntries.tenantId, tenantId),
        eq(schema.timeEntries.id, input.entryId),
      ),
    );

  const [row] = await tx
    .insert(schema.timeEntries)
    .values({
      tenantId,
      workerId: original.workerId,
      minutes: input.minutes,
      workDate: original.workDate,
      payType: original.payType,
      note: original.note,
      source: original.source,
      enteredByClerkUserId: original.enteredByClerkUserId,
    })
    .returning({ id: schema.timeEntries.id });
  return row.id;
}
