import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import { dateInTimezone } from "@/lib/timezone";
import { MAX_ENTRY_MINUTES } from "./core/duration";
import { TimeError } from "./core/errors";
import { minutesBetween, roundMinutes } from "./core/rounding";
import { assertPeriodOpen } from "./sheet-ops";

/**
 * The clock. ONE WRITER per table; every function takes the caller's `tx` and
 * never opens its own, so what it can reach is exactly what the caller's RLS
 * context allows.
 *
 * ── THE BUSINESS DAY OF A PUNCH IS THE DAY IT STARTED ────────────────────────
 *
 * A shift that begins at 22:00 on Tuesday and ends at 02:00 on Wednesday is
 * Tuesday's work, in the TENANT's timezone. One entry, one day, and the day is
 * the one the person would name if you asked them.
 *
 * Not configurable, deliberately. The alternative convention — split the span
 * at midnight into two entries — only starts to matter when overtime is
 * computed per DAY rather than per week (California's over-8 rule, slice 5),
 * and a setting nothing reads differently is a setting that is wrong half the
 * time without anybody finding out. It becomes a choice when there is a rule
 * that cares.
 */

/** Start somebody's clock. Refuses if one is already running for them. */
export async function clockIn(
  tx: Tx,
  tenantId: string,
  input: {
    workerId: string;
    note: string;
    actorClerkUserId: string;
    /** Passed in so one request has one idea of "now". */
    at: Date;
    /**
     * An id the DEVICE minted before it reached the network. Null from the
     * ordinary panel, set by the shared keypad, and what makes a retry over a
     * bad connection return the punch it already started.
     */
    clientRef?: string | null;
    /** What the shared device calls itself. "" from anywhere else. */
    deviceLabel?: string;
  },
): Promise<string> {
  const worker = await tx.query.timeWorkers.findFirst({
    where: and(
      eq(schema.timeWorkers.tenantId, tenantId),
      eq(schema.timeWorkers.id, input.workerId),
    ),
  });
  if (!worker) throw new TimeError("WORKER_NOT_FOUND", "no such worker");
  if (!worker.isActive) {
    throw new TimeError("WORKER_INACTIVE", "that person has left");
  }

  /*
   * READ FIRST ON THE CLIENT ID, and only on the client id.
   *
   * A device with no signal retries, and the retry must find its own punch
   * rather than be told somebody is already clocked in — which is true, and is
   * exactly the wrong thing to say to the person who started it one second ago.
   * Checking is cheaper and clearer than catching the unique violation, and it
   * lets this return the SAME punch rather than a different error; retail's
   * `recordSale` made the same call for the same reason.
   */
  if (input.clientRef) {
    const already = await tx.query.timePunches.findFirst({
      where: and(
        eq(schema.timePunches.tenantId, tenantId),
        eq(schema.timePunches.clientRef, input.clientRef),
      ),
      columns: { id: true },
    });
    if (already) return already.id;
  }

  /*
   * The partial unique index is the arbiter, not a preceding SELECT: between a
   * check and an insert another request can win, and two running clocks on one
   * person double-count an afternoon. Translated here so the screen gets a
   * sentence rather than a constraint name.
   */
  try {
    const [row] = await tx
      .insert(schema.timePunches)
      .values({
        tenantId,
        workerId: input.workerId,
        startedAt: input.at,
        startedByClerkUserId: input.actorClerkUserId,
        note: input.note.trim(),
        clientRef: input.clientRef ?? null,
        deviceLabel: input.deviceLabel ?? "",
      })
      .returning({ id: schema.timePunches.id });
    return row.id;
  } catch (err) {
    if (String(err).includes("time_punches_one_open_idx")) {
      throw new TimeError("ALREADY_CLOCKED_IN", "a clock is already running");
    }
    throw err;
  }
}

export interface ClockOutResult {
  rawMinutes: number;
  paidMinutes: number;
  /** Null when rounding took the span to nothing. */
  entryId: string | null;
  workDate: string;
}

/**
 * Stop the clock and turn the punch into an entry.
 *
 * BOTH NUMBERS COME BACK. The caller shows the raw span and the payable one, so
 * "you worked 7:53, we logged 8:00" is a sentence the screen can say rather
 * than a discrepancy somebody discovers at the end of the month.
 */
export async function clockOut(
  tx: Tx,
  tenantId: string,
  input: {
    punchId: string;
    note: string;
    actorClerkUserId: string;
    at: Date;
    roundingMinutes: number;
    timezone: string;
    /**
     * What kind of door stopped the clock. `timer` is the ordinary panel;
     * `kiosk` is a shared device, where the person who pressed the button and
     * the person who worked are different by design and worth telling apart
     * later. CHECKed on the column, so an unknown value is refused rather than
     * stored.
     */
    source?: "timer" | "kiosk";
  },
): Promise<ClockOutResult> {
  const punch = await loadPunch(tx, tenantId, input.punchId);
  if (punch.endedAt) {
    throw new TimeError("PUNCH_ALREADY_ENDED", "that clock is already stopped");
  }
  if (input.at.getTime() <= punch.startedAt.getTime()) {
    throw new TimeError("PUNCH_ENDS_BEFORE_START", "a clock cannot stop before it started");
  }

  const rawMinutes = minutesBetween(punch.startedAt, input.at);
  if (rawMinutes > MAX_ENTRY_MINUTES) {
    throw new TimeError(
      "PUNCH_TOO_LONG",
      "a clock that has run more than a day must be corrected first",
    );
  }
  const paidMinutes = roundMinutes(rawMinutes, input.roundingMinutes);
  const note = input.note.trim() || punch.note;
  const workDate = dateInTimezone(punch.startedAt, input.timezone);

  /*
   * CHECKED BEFORE THE PUNCH IS CLOSED, so a clock left running across a pay
   * run cannot silently add hours to a period somebody has already been paid
   * for. The clock keeps running and the message says what to do — refusing is
   * better than closing it into a period that will not accept the entry.
   */
  await assertPeriodOpen(tx, tenantId, workDate);

  await tx
    .update(schema.timePunches)
    .set({
      endedAt: input.at,
      endedByClerkUserId: input.actorClerkUserId,
      note,
      version: sql`${schema.timePunches.version} + 1`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.timePunches.tenantId, tenantId),
        eq(schema.timePunches.id, input.punchId),
      ),
    );

  /*
   * ZERO PAYABLE MINUTES WRITES NO ENTRY, and that is the rounding policy doing
   * exactly what it says: a five-minute visit on a quarter-hour policy is worth
   * nothing, by the same rule that pays a full quarter hour for eight minutes.
   * The punch survives as the record that somebody was here, and the caller
   * tells them what happened.
   */
  if (paidMinutes <= 0) {
    return { rawMinutes, paidMinutes: 0, entryId: null, workDate };
  }

  const [entry] = await tx
    .insert(schema.timeEntries)
    .values({
      tenantId,
      workerId: punch.workerId,
      minutes: paidMinutes,
      workDate,
      payType: "worked",
      note,
      source: input.source ?? "timer",
      punchId: punch.id,
      enteredByClerkUserId: input.actorClerkUserId,
    })
    .returning({ id: schema.timeEntries.id });

  return { rawMinutes, paidMinutes, entryId: entry.id, workDate };
}

/**
 * Throw away a running clock. Somebody clocked the wrong person in, or
 * themselves in by accident.
 *
 * ONLY WHILE IT RUNS. A stopped punch has produced an entry and is the evidence
 * behind it; the way to fix one of those is `adjustPunch`, which leaves a
 * record that the times were changed. Nothing here can remove a record of work
 * that was paid.
 */
export async function cancelPunch(
  tx: Tx,
  tenantId: string,
  punchId: string,
): Promise<void> {
  const result = await tx
    .delete(schema.timePunches)
    .where(
      and(
        eq(schema.timePunches.tenantId, tenantId),
        eq(schema.timePunches.id, punchId),
        isNull(schema.timePunches.endedAt),
      ),
    )
    .returning({ id: schema.timePunches.id });

  if (result.length === 0) {
    // Gone, or already stopped. The two need different sentences.
    const still = await tx.query.timePunches.findFirst({
      where: and(
        eq(schema.timePunches.tenantId, tenantId),
        eq(schema.timePunches.id, punchId),
      ),
    });
    throw still
      ? new TimeError("PUNCH_ALREADY_ENDED", "that clock has already stopped")
      : new TimeError("PUNCH_NOT_FOUND", "no such clock");
  }
}

/**
 * Correct when a running clock started. The forgot-to-clock-in case, and the
 * clocked-in-at-the-wrong-time case.
 *
 * A RUNNING PUNCH ONLY, for the same reason `cancelPunch` is: once a punch has
 * produced an entry, the entry is the payable fact and is edited as an entry.
 * Two ways to change one number is how the two stop agreeing.
 */
export async function adjustPunchStart(
  tx: Tx,
  tenantId: string,
  input: {
    punchId: string;
    startedAt: Date;
    expectedVersion: number;
    /** Passed in so one request has one idea of "now". */
    at: Date;
  },
): Promise<void> {
  if (input.startedAt.getTime() > input.at.getTime()) {
    throw new TimeError("PUNCH_STARTS_IN_FUTURE", "a clock cannot start later than now");
  }
  if (minutesBetween(input.startedAt, input.at) > MAX_ENTRY_MINUTES) {
    throw new TimeError("PUNCH_TOO_LONG", "that would leave a clock running more than a day");
  }

  const result = await tx
    .update(schema.timePunches)
    .set({
      startedAt: input.startedAt,
      version: sql`${schema.timePunches.version} + 1`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.timePunches.tenantId, tenantId),
        eq(schema.timePunches.id, input.punchId),
        eq(schema.timePunches.version, input.expectedVersion),
        isNull(schema.timePunches.endedAt),
      ),
    )
    .returning({ id: schema.timePunches.id });

  if (result.length === 0) {
    const still = await tx.query.timePunches.findFirst({
      where: and(
        eq(schema.timePunches.tenantId, tenantId),
        eq(schema.timePunches.id, input.punchId),
      ),
    });
    if (!still) throw new TimeError("PUNCH_NOT_FOUND", "no such clock");
    throw still.endedAt
      ? new TimeError("PUNCH_ALREADY_ENDED", "that clock has already stopped")
      : new TimeError("STALE_VERSION", "clock changed underneath");
  }
}

async function loadPunch(tx: Tx, tenantId: string, punchId: string) {
  const punch = await tx.query.timePunches.findFirst({
    where: and(
      eq(schema.timePunches.tenantId, tenantId),
      eq(schema.timePunches.id, punchId),
    ),
  });
  if (!punch) throw new TimeError("PUNCH_NOT_FOUND", "no such clock");
  return punch;
}
