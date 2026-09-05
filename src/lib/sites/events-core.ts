import { dateInTimezone, formatTimeInTimezone } from "@/lib/timezone";

/**
 * Upcoming events on a page — pure. The events come from the business's
 * Events calendar (`src/lib/schedule/managed-calendars.ts`), read by the
 * server into `PublicSite.events` as instants; a section chooses how many
 * and how far ahead, and the words are made here.
 */
export interface LiveEvent {
  id: string;
  /** Set for one occurrence of a repeating event; with `id` it is the identity. */
  occurrenceDate: string | null;
  title: string;
  location: string;
  /** ISO 8601 instants. */
  startsAt: string;
  endsAt: string;
  allDay: boolean;
}

export const EVENT_COUNTS = [3, 5, 10] as const;
export const EVENT_HORIZONS = [30, 60, 90, 180] as const;
/** The read loads this far ahead; a section shows its own horizon inside it. */
export const EVENTS_LOAD_DAYS = 180;

/** Still to come (or under way), inside the horizon, soonest first, at most `count`. */
export function upcomingEvents(
  events: readonly LiveEvent[],
  now: Date,
  horizonDays: number,
  count: number,
): LiveEvent[] {
  const until = now.getTime() + horizonDays * 86_400_000;
  return events
    .filter((e) => new Date(e.endsAt).getTime() > now.getTime() && new Date(e.startsAt).getTime() < until)
    .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime())
    .slice(0, count);
}

/** The date block beside an event: "SAT", "12", "SEP". */
export function eventDate(event: LiveEvent, timeZone: string): { weekday: string; day: string; month: string } {
  const at = new Date(event.startsAt);
  const part = (options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat("en-US", { timeZone, ...options }).format(at);
  return { weekday: part({ weekday: "short" }), day: part({ day: "numeric" }), month: part({ month: "short" }) };
}

function shortDate(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone, month: "short", day: "numeric" }).format(at);
}

function time(at: Date, timeZone: string): string {
  return formatTimeInTimezone(at, timeZone).toLowerCase();
}

/**
 * When it is, as words: "8:00 am to 12:00 pm"; "All day"; a span for
 * anything that crosses a day, "Sep 12, 8:00 am to Sep 14, 12:00 pm" or
 * "Sep 12 to Sep 14" all day. An all-day event ends at the next midnight,
 * so its last day is the one before.
 */
export function eventWhen(event: LiveEvent, timeZone: string): string {
  const starts = new Date(event.startsAt);
  const ends = new Date(event.endsAt);
  if (event.allDay) {
    const lastDay = new Date(ends.getTime() - 1);
    const from = dateInTimezone(starts, timeZone);
    const to = dateInTimezone(lastDay, timeZone);
    return from === to ? "All day" : `${shortDate(starts, timeZone)} to ${shortDate(lastDay, timeZone)}`;
  }
  const sameDay = dateInTimezone(starts, timeZone) === dateInTimezone(ends, timeZone);
  if (sameDay) return `${time(starts, timeZone)} to ${time(ends, timeZone)}`;
  return `${shortDate(starts, timeZone)}, ${time(starts, timeZone)} to ${shortDate(ends, timeZone)}, ${time(ends, timeZone)}`;
}

/** The identity of one row on the page: a repeating event's occurrences are distinct. */
export function eventKey(event: LiveEvent): string {
  return event.occurrenceDate ? `${event.id}:${event.occurrenceDate}` : event.id;
}
