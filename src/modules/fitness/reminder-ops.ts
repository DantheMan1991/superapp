import "server-only";
import { and, eq, inArray, isNull, ne, or } from "drizzle-orm";
import { schema, withSystem, withTenant, type Tx } from "@/db";
import { isModuleEnabled } from "@/lib/modules";
import { sendPushToPerson } from "@/lib/notifications/push";
import { doorTo } from "@/lib/personal-space-core";
import { dayOf, localDayIn } from "./core/day";
import { FitnessError } from "./core/errors";
import {
  handledOnWhenSaved,
  minuteIn,
  reminderDue,
  reminderMessage,
  reminderViews,
  type ReminderSlot,
  type ReminderView,
  type SpaceNow,
} from "./core/reminders";
import { dayItemsOf, loadProgram } from "./program-ops";
import { lastSession, recentSessions } from "./session-ops";

/**
 * WORKOUT REMINDERS, THE SERVER HALF (docs/modules/fitness.md, F4a; ADR 0116).
 * The rules are `core/reminders.ts`'s; this reads and writes the rows, and
 * runs the ten-minute cron (`/api/cron/fitness-reminders`).
 */

const r = schema.fitnessReminders;

/** The program's two reminders as the card shows them, a slot never saved off at its default time. */
export async function loadReminders(tx: Tx, tenantId: string, programId: string): Promise<ReminderView[]> {
  const rows = await tx
    .select({ slot: r.slot, atMinute: r.atMinute, enabled: r.enabled })
    .from(r)
    .where(and(eq(r.tenantId, tenantId), eq(r.programId, programId)));
  return reminderViews(rows);
}

/**
 * Set one of a program's reminders: its time and whether it is on. A time
 * already past today starts tomorrow (`handledOnWhenSaved`), so saving never
 * sends one on the spot.
 */
export async function saveReminder(
  tx: Tx,
  tenantId: string,
  input: { programId: string; slot: ReminderSlot; atMinute: number; enabled: boolean },
  now: SpaceNow,
): Promise<void> {
  const [program] = await tx
    .select({ id: schema.fitnessPrograms.id })
    .from(schema.fitnessPrograms)
    .where(and(eq(schema.fitnessPrograms.tenantId, tenantId), eq(schema.fitnessPrograms.id, input.programId)));
  if (!program) throw new FitnessError("NOT_FOUND");
  const [existing] = await tx
    .select({ lastHandledOn: r.lastHandledOn })
    .from(r)
    .where(and(eq(r.tenantId, tenantId), eq(r.programId, input.programId), eq(r.slot, input.slot)));
  const lastHandledOn = handledOnWhenSaved(input.atMinute, now, existing?.lastHandledOn ?? null);
  await tx
    .insert(r)
    .values({
      tenantId,
      programId: input.programId,
      slot: input.slot,
      atMinute: input.atMinute,
      enabled: input.enabled,
      lastHandledOn,
    })
    .onConflictDoUpdate({
      target: [r.tenantId, r.programId, r.slot],
      set: { atMinute: input.atMinute, enabled: input.enabled, lastHandledOn, updatedAt: new Date() },
    });
}

/* -- the cron ----------------------------------------------------------------- */

/** Bounded work: far more reminders than personal spaces exist, twice over. */
export const MAX_REMINDERS_PER_RUN = 1_000;

/** Counts only: never a space, a program or a word of what was sent (S9). */
export interface ReminderRunResult {
  /** Reminders switched on, in personal spaces that are not churned. */
  considered: number;
  /** Of those, the ones whose time had come and that this run took. */
  taken: number;
  sent: number;
  /** Taken, and not sent because the day's sets were already done. */
  skippedDone: number;
  /** Taken, and nobody's phone could be told: none registered, or the sender is not set up. */
  noPhone: number;
  failed: number;
}

/**
 * Every ten minutes: each reminder whose time has come on its space's clock
 * is taken (once, however many runs overlap), and, unless the day's sets are
 * already done, the person's phones are told.
 *
 * withSystem, justified (S2), for the one read across spaces: trusted
 * background code with no caller, picking its own work and taking no input,
 * as the digest and the post reminders do. Everything about one space,
 * the claim included, is read and written under withTenant.
 *
 * Taken BEFORE it is sent: a run that dies between the two loses that
 * reminder rather than sending it twice. A reminder late is not worth a
 * second try, and the grace window says so anyway.
 */
export async function runWorkoutReminders(
  at: Date,
  options: {
    send?: typeof sendPushToPerson;
    /** Tests only: the spaces to look at, so a run leaves every other space's reminders alone. */
    onlyTenants?: readonly string[];
  } = {},
): Promise<ReminderRunResult> {
  const send = options.send ?? sendPushToPerson;
  const t = schema;
  const rows = await withSystem((tx) =>
    tx
      .select({
        id: r.id,
        tenantId: r.tenantId,
        programId: r.programId,
        atMinute: r.atMinute,
        lastHandledOn: r.lastHandledOn,
        timezone: t.tenants.timezone,
        owner: t.tenants.personalOwnerClerkUserId,
      })
      .from(r)
      .innerJoin(t.tenants, eq(t.tenants.id, r.tenantId))
      .innerJoin(
        t.fitnessPrograms,
        and(eq(t.fitnessPrograms.tenantId, r.tenantId), eq(t.fitnessPrograms.id, r.programId)),
      )
      .where(
        and(
          eq(r.enabled, true),
          eq(t.tenants.kind, "personal"),
          ne(t.tenants.status, "churned"),
          isNull(t.fitnessPrograms.archivedAt),
          options.onlyTenants ? inArray(r.tenantId, [...options.onlyTenants]) : undefined,
        ),
      )
      .limit(MAX_REMINDERS_PER_RUN),
  );

  const result: ReminderRunResult = { considered: rows.length, taken: 0, sent: 0, skippedDone: 0, noPhone: 0, failed: 0 };
  const workoutsOn = new Map<string, boolean>();

  for (const row of rows) {
    const now: SpaceNow = { day: localDayIn(row.timezone, at), minute: minuteIn(row.timezone, at) };
    if (!row.owner || !reminderDue(row, now)) continue;
    // Workouts switched off in the space: its reminders are quiet, and stay
    // untaken, so they go again the day it is back on.
    if (!workoutsOn.has(row.tenantId)) workoutsOn.set(row.tenantId, await isModuleEnabled(row.tenantId, "fitness"));
    if (!workoutsOn.get(row.tenantId)) continue;

    const outcome = await withTenant(row.tenantId, async (tx) => {
      const [claimed] = await tx
        .update(r)
        .set({ lastHandledOn: now.day, updatedAt: at })
        .where(
          and(
            eq(r.tenantId, row.tenantId),
            eq(r.id, row.id),
            eq(r.enabled, true),
            or(isNull(r.lastHandledOn), ne(r.lastHandledOn, now.day)),
          ),
        )
        .returning({ id: r.id });
      if (!claimed) return null;
      const program = await loadProgram(tx, row.tenantId, row.programId);
      if (!program) return { message: null };
      // The phase of the last workout, as the program page opens on; the
      // first before there is one.
      const last = await lastSession(tx, row.tenantId, row.programId);
      const index = last?.phaseId ? program.phases.findIndex((phase) => phase.id === last.phaseId) : -1;
      const phase = program.phases[index >= 0 ? index : 0];
      if (!phase) return { message: null };
      const sessions = await recentSessions(tx, row.tenantId, row.programId, now.day, now.day);
      const day = dayOf(dayItemsOf(phase), now.day, sessions, []);
      return { message: reminderMessage(day, { phaseName: phase.name, exercises: phase.items.length }) };
    });
    if (!outcome) continue;
    result.taken += 1;
    if (!outcome.message) {
      result.skippedDone += 1;
      continue;
    }
    try {
      const pushed = await send(
        row.owner,
        {
          ...outcome.message,
          url: doorTo(`/personal/m/fitness/programs/${row.programId}`),
          collapseId: `workout:${row.id}:${now.day}`,
        },
        "workout-reminder",
      );
      if (pushed.delivered > 0) result.sent += 1;
      else if (pushed.devices === 0 || pushed.unconfigured === pushed.devices) result.noPhone += 1;
      else result.failed += 1;
    } catch (err) {
      result.failed += 1;
      console.error("workout reminder failed", err instanceof Error ? err.message : "unknown");
    }
  }
  return result;
}
