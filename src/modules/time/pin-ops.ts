import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import {
  decoyPasscodeWork,
  hashPasscode,
  verifyPasscode,
} from "@/lib/public-token";
import { TimeError } from "./core/errors";
import {
  isPin,
  isPinLocked,
  isWeakPin,
  lockoutRemaining,
  pinLockedUntil,
} from "./core/pin";
import { clockIn, clockOut, type ClockOutResult } from "./punch-ops";

/**
 * The shared device's PIN: setting one, and punching with one.
 *
 * ── WHY THE VERIFY LIVES HERE AND NOT IN `punch-ops.ts` ──────────────────────
 *
 * `punch-ops.ts` writes the clock and knows nothing about credentials; this
 * file knows about credentials and writes nothing itself. Keeping them apart
 * means the ordinary panel's clock-in can never accidentally acquire a PIN
 * check, and the keypad can never accidentally skip one — the two doors are
 * two functions, not one function with a flag.
 *
 * ── THE TIMING ORACLE ────────────────────────────────────────────────────────
 *
 * Every failure below does the SAME scrypt work, via `decoyPasscodeWork()` on
 * the paths that have nothing to verify. Without it "that worker has no PIN"
 * returns measurably faster than "wrong PIN", which tells somebody standing at
 * the tablet which names are worth guessing at. The document share's unlock
 * action solves the identical problem the identical way.
 *
 * ── AND WHY A WRONG PIN RETURNS RATHER THAN THROWS ───────────────────────────
 *
 * **BECAUSE A THROW WOULD ROLL BACK THE COUNT THAT MAKES THE LOCKOUT WORK.**
 * `withTenant` opens a transaction; throwing out of it discards every write
 * inside, including the increment of `pin_failed_count` — so five wrong PINs
 * would leave the counter at zero and the lockout would never engage, silently,
 * with a test that passed because the increment really did run.
 *
 * So a credential failure is a RESULT, not an exception, and the action turns
 * it into the message. Exceptions are kept for the things that genuinely have
 * nothing to commit.
 */

/** What the keypad did, so the screen can say it in a sentence. */
export type PinPunchResult =
  | { kind: "clocked_in"; workerName: string; at: Date }
  | { kind: "clocked_out"; workerName: string; out: ClockOutResult }
  /** Wrong PIN, no such worker, or no PIN set. One answer for all three. */
  | { kind: "wrong" }
  | { kind: "locked"; remaining: string };

async function loadWorker(tx: Tx, tenantId: string, workerId: string) {
  const worker = await tx.query.timeWorkers.findFirst({
    where: and(
      eq(schema.timeWorkers.tenantId, tenantId),
      eq(schema.timeWorkers.id, workerId),
    ),
  });
  if (!worker) throw new TimeError("WORKER_NOT_FOUND", "no such worker");
  return worker;
}

/**
 * Give somebody a PIN, or change the one they have.
 *
 * Refuses the obvious ones at the point of CHOOSING. That is the only moment it
 * is safe to say so: refusing `1234` when somebody TYPES it would confirm that
 * `1234` is not the PIN, which is a worse leak than the weak PIN was.
 *
 * Setting a PIN also clears any lockout, because an owner resetting somebody's
 * PIN is the same act as letting them back in.
 */
export async function setWorkerPin(
  tx: Tx,
  tenantId: string,
  input: { workerId: string; pin: string },
): Promise<void> {
  if (!isPin(input.pin)) {
    throw new TimeError("PIN_INVALID", "a PIN is 4 to 8 digits");
  }
  if (isWeakPin(input.pin)) {
    throw new TimeError("PIN_TOO_SIMPLE", "that PIN is too easy to guess");
  }
  const worker = await loadWorker(tx, tenantId, input.workerId);
  if (!worker.isActive) {
    throw new TimeError("WORKER_INACTIVE", "that person has left");
  }

  await tx
    .update(schema.timeWorkers)
    .set({
      pinHash: hashPasscode(input.pin),
      pinFailedCount: 0,
      pinFailedAt: null,
      version: sql`${schema.timeWorkers.version} + 1`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.timeWorkers.tenantId, tenantId),
        eq(schema.timeWorkers.id, input.workerId),
      ),
    );
}

/** Take somebody's PIN away. They can still have hours logged for them. */
export async function clearWorkerPin(
  tx: Tx,
  tenantId: string,
  workerId: string,
): Promise<void> {
  await loadWorker(tx, tenantId, workerId);
  await tx
    .update(schema.timeWorkers)
    .set({
      pinHash: null,
      pinFailedCount: 0,
      pinFailedAt: null,
      version: sql`${schema.timeWorkers.version} + 1`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.timeWorkers.tenantId, tenantId),
        eq(schema.timeWorkers.id, workerId),
      ),
    );
}

/** Let somebody back in early, without changing their PIN. */
export async function resetPinLockout(
  tx: Tx,
  tenantId: string,
  workerId: string,
): Promise<void> {
  await loadWorker(tx, tenantId, workerId);
  await tx
    .update(schema.timeWorkers)
    .set({ pinFailedCount: 0, pinFailedAt: null, updatedAt: new Date() })
    .where(
      and(
        eq(schema.timeWorkers.tenantId, tenantId),
        eq(schema.timeWorkers.id, workerId),
      ),
    );
}

/**
 * Punch, with a PIN, from a shared device. **ONE BUTTON, BOTH DIRECTIONS.**
 *
 * The keypad does not ask whether you are arriving or leaving, because the
 * answer is already in the database and somebody with cold hands should not
 * have to supply a fact the system holds. A running clock means this is the
 * end of it; no running clock means this is the start.
 *
 * That also removes the failure the ordinary panel can produce — pressing the
 * wrong one of two buttons and being told "a clock is already running", which
 * is true, unhelpful, and looks like the clock is broken.
 */
export async function punchWithPin(
  tx: Tx,
  tenantId: string,
  input: {
    workerId: string;
    pin: string;
    /** Minted by the device before the request, so a retry is a no-op. */
    clientRef: string | null;
    deviceLabel: string;
    actorClerkUserId: string;
    at: Date;
    /** The tenant's settings, so the stop rounds the way everything else does. */
    roundingMinutes: number;
    timezone: string;
  },
): Promise<PinPunchResult> {
  const [worker] = await tx
    .select({
      id: schema.timeWorkers.id,
      isActive: schema.timeWorkers.isActive,
      pinHash: schema.timeWorkers.pinHash,
      pinFailedCount: schema.timeWorkers.pinFailedCount,
      pinFailedAt: schema.timeWorkers.pinFailedAt,
      name: schema.parties.displayName,
    })
    .from(schema.timeWorkers)
    .innerJoin(
      schema.parties,
      and(
        eq(schema.parties.tenantId, schema.timeWorkers.tenantId),
        eq(schema.parties.id, schema.timeWorkers.partyId),
      ),
    )
    .where(
      and(
        eq(schema.timeWorkers.tenantId, tenantId),
        eq(schema.timeWorkers.id, input.workerId),
      ),
    );

  if (!worker || !worker.isActive || !worker.pinHash) {
    // Same work, same answer, whichever of the three it was.
    decoyPasscodeWork();
    return { kind: "wrong" };
  }

  const until = pinLockedUntil(worker.pinFailedCount, worker.pinFailedAt);
  if (until && isPinLocked(worker.pinFailedCount, worker.pinFailedAt, input.at)) {
    decoyPasscodeWork();
    return { kind: "locked", remaining: lockoutRemaining(until, input.at) };
  }

  if (!verifyPasscode(input.pin, worker.pinHash)) {
    /*
     * Count from the LAST SUCCESS, not from the last hour: five wrong tries
     * spread over a week is somebody who forgot their PIN, and five in a row is
     * somebody guessing. The timestamp moves with every failure so the lockout
     * window always measures from the most recent one.
     */
    await tx
      .update(schema.timeWorkers)
      .set({
        pinFailedCount: sql`${schema.timeWorkers.pinFailedCount} + 1`,
        pinFailedAt: input.at,
      })
      .where(
        and(
          eq(schema.timeWorkers.tenantId, tenantId),
          eq(schema.timeWorkers.id, input.workerId),
        ),
      );
    return { kind: "wrong" };
  }

  if (worker.pinFailedCount > 0) {
    await tx
      .update(schema.timeWorkers)
      .set({ pinFailedCount: 0, pinFailedAt: null })
      .where(
        and(
          eq(schema.timeWorkers.tenantId, tenantId),
          eq(schema.timeWorkers.id, input.workerId),
        ),
      );
  }

  const workerName = worker.name;
  const open = await tx.query.timePunches.findFirst({
    where: and(
      eq(schema.timePunches.tenantId, tenantId),
      eq(schema.timePunches.workerId, input.workerId),
      sql`${schema.timePunches.endedAt} is null`,
    ),
  });

  if (open) {
    const out = await clockOut(tx, tenantId, {
      punchId: open.id,
      note: "",
      actorClerkUserId: input.actorClerkUserId,
      at: input.at,
      roundingMinutes: input.roundingMinutes,
      timezone: input.timezone,
      source: "kiosk",
    });
    return { kind: "clocked_out", workerName, out };
  }

  await clockIn(tx, tenantId, {
    workerId: input.workerId,
    note: "",
    actorClerkUserId: input.actorClerkUserId,
    at: input.at,
    clientRef: input.clientRef,
    deviceLabel: input.deviceLabel,
  });
  return { kind: "clocked_in", workerName, at: input.at };
}
