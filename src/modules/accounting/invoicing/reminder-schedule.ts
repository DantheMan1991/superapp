import { z } from "zod";
import { addDaysIso } from "../lib/dates";

/**
 * Which reminder — if any — is due for one invoice today. Pure, no database,
 * no `server-only`.
 *
 * Mirrors `banking/rules-match.ts`: every decision about whether a customer
 * gets emailed lives in one exhaustively table-testable function, and the
 * server module around it only reads rows and sends. That split matters more
 * here than anywhere else in the module — this is the one piece of accounting
 * that mails a person nobody on our side chose, so being able to prove its
 * behaviour on a table of cases is the control.
 *
 * A malformed offsets list is SKIPPED, never thrown on — hand-edited jsonb or
 * a shape from a future version must not break the sweep for other tenants,
 * the same rule `rules-match.ts` follows.
 */

/** Days before the due date the earliest nudge may sit. Two months is plenty. */
export const MIN_OFFSET = -60;
/** Days after. A year is where chasing stops being chasing. */
export const MAX_OFFSET = 365;
/** More than this is not a schedule, it is harassment. */
export const MAX_OFFSETS = 8;

/**
 * Sorted ascending and de-duplicated on the way in, so "is this the latest
 * applicable offset" is a positional question everywhere downstream and no
 * caller has to remember to sort. Order in the stored array is not meaningful.
 */
export const reminderOffsetsSchema = z
  .array(z.number().int().min(MIN_OFFSET).max(MAX_OFFSET))
  .max(MAX_OFFSETS)
  .transform((offsets) => [...new Set(offsets)].sort((a, b) => a - b));

export type ReminderOffsets = z.infer<typeof reminderOffsetsSchema>;

/** The default schedule: a nudge before, one on the day, then chasing. */
export const DEFAULT_OFFSETS: readonly number[] = [-3, 0, 7, 14, 30];

/**
 * Local hour the sweep sends at. An hour after the digest's 7am, so an owner
 * reads "invoice 12 is 30 days overdue" in their own mail before the reminder
 * for it reaches their customer — if that is the morning they wanted to
 * intervene, they get the chance.
 *
 * Lives here rather than with the sweep so the settings screen can name the
 * hour without importing the PDF renderer to do it.
 */
export const REMINDER_SEND_HOUR = 8;

/**
 * Parse stored offsets, falling back to an empty schedule.
 *
 * Empty means "nothing fires", which is the safe direction: a tenant whose
 * jsonb cannot be read sends no mail rather than falling back to a default
 * schedule they never chose.
 */
export function parseOffsets(stored: unknown): ReminderOffsets {
  const parsed = reminderOffsetsSchema.safeParse(stored);
  return parsed.success ? parsed.data : [];
}

export interface ReminderDueInput {
  /** The invoice's due date, or null when it has none. */
  dueDate: string | null;
  /** Tenant-local today, from `todayInTimezone` at the call site (P1). */
  today: string;
  offsets: readonly number[];
  /** Offsets already emailed for this invoice, derived from the send log. */
  sentOffsets: readonly number[];
}

/**
 * The offset whose reminder should go out today, or null for nothing.
 *
 * THE RULE IS "LATEST APPLICABLE OFFSET WINS", and it is the whole design:
 *
 *   • **No blast.** Turning reminders on over a book of invoices that are
 *     already 90 days late sends at most ONE email each, not one per offset
 *     the invoice has sailed past. That is the failure that would lose a
 *     client on the first morning, and it is prevented here rather than by a
 *     rate cap noticing afterwards.
 *   • **No nonsense ordering.** An invoice 30 days overdue never receives
 *     "due in three days" merely because that offset was never sent. Earlier
 *     offsets are not queued, they are overtaken.
 *   • **Monotonic and bounded.** Each offset fires at most once, later ones
 *     supersede earlier ones, and when the last offset has been sent the
 *     invoice goes quiet forever. Chasing has to end on its own; an owner
 *     extends the schedule if they want more.
 *
 * A missed cron run is therefore self-healing rather than a lost reminder:
 * tomorrow the same offset is still the latest applicable one and still
 * unsent, so it simply goes a day late.
 */
export function dueReminderOffset(input: ReminderDueInput): number | null {
  // Nothing to be relative to. An invoice with no due date is never chased —
  // there is no date it is late against, and inventing one (issue date? net
  // 30?) would mail somebody about a deadline they never agreed to.
  if (input.dueDate === null) return null;

  let latest: number | null = null;
  for (const offset of input.offsets) {
    // Lexical comparison is correct for yyyy-mm-dd and is the module-wide
    // convention (lib/dates.ts header, policy P1).
    if (addDaysIso(input.dueDate, offset) > input.today) continue;
    if (latest === null || offset > latest) latest = offset;
  }

  if (latest === null) return null;
  return input.sentOffsets.includes(latest) ? null : latest;
}

/**
 * When this invoice will next be chased, for the settings screen.
 *
 * `date` is the tenant-local day it goes out. An offset that is already due
 * reports today, because that is when the next sweep will send it — showing
 * the historical date it "should" have gone would be describing a past that
 * did not happen.
 *
 * Returns null when the schedule is finished, which is the answer the screen
 * needs in order to say "no more reminders" rather than leaving a blank.
 */
export function nextReminder(
  input: ReminderDueInput,
): { offset: number; date: string } | null {
  const dueNow = dueReminderOffset(input);
  if (dueNow !== null) return { offset: dueNow, date: input.today };
  if (input.dueDate === null) return null;

  let soonest: number | null = null;
  for (const offset of input.offsets) {
    if (addDaysIso(input.dueDate, offset) <= input.today) continue;
    if (input.sentOffsets.includes(offset)) continue;
    if (soonest === null || offset < soonest) soonest = offset;
  }
  return soonest === null
    ? null
    : { offset: soonest, date: addDaysIso(input.dueDate, soonest) };
}

/**
 * How this reminder should read: a nudge before the date, chasing after it.
 *
 * Derived from the offset rather than stored, so the wording can never
 * disagree with the schedule that produced it.
 */
export function reminderTone(offset: number): "upcoming" | "due_today" | "overdue" {
  if (offset < 0) return "upcoming";
  if (offset === 0) return "due_today";
  return "overdue";
}

/** Plain-language label for one offset, for the settings screen. */
export function describeOffset(offset: number): string {
  if (offset === 0) return "On the due date";
  if (offset < 0) {
    const d = Math.abs(offset);
    return `${d} ${d === 1 ? "day" : "days"} before due`;
  }
  return `${offset} ${offset === 1 ? "day" : "days"} after due`;
}
