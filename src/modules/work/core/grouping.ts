import { addDays } from "@/lib/timezone";

/**
 * How "my work" is ordered on the page. Pure, no database, no directive —
 * the server groups the list and the BROWSER recomputes a row's badge after
 * midnight, so both have to answer the question the same way.
 *
 * crm.md carries the bug this exists to avoid: comparing a `date` column
 * against a server `Date` is wrong by up to a day for anybody off UTC, which
 * the user experiences as the product nagging about something due tomorrow.
 * Every comparison here is between `yyyy-mm-dd` STRINGS, which sort lexically
 * and have no timezone at all.
 */

export type WorkUrgency = "overdue" | "today" | "soon" | "later" | "undated";

/** How far ahead counts as "soon". Matches the digest's own window. */
export const SOON_WITHIN_DAYS = 7;

/**
 * Where one item lands, given the reader's today.
 *
 * `today` must come from `todayInTimezone(tenant.timezone)` — the tenant's day,
 * never the server's and never the browser's, so two people in one workspace
 * see the same thing.
 */
export function urgencyOf(
  dueOn: string | null,
  today: string,
  soonWithinDays: number = SOON_WITHIN_DAYS,
): WorkUrgency {
  if (!dueOn) return "undated";
  if (dueOn < today) return "overdue";
  if (dueOn === today) return "today";
  return dueOn <= addDays(today, soonWithinDays) ? "soon" : "later";
}

/**
 * True when an item should be held back rather than shown.
 *
 * `starts_on` is the "do not show me this until Monday" column. Without it a
 * list of forty items either nags on day one or stays invisible until it is
 * late; with it, deferred work simply is not in today's list.
 */
export function isDeferred(startsOn: string | null, today: string): boolean {
  return startsOn !== null && startsOn > today;
}

/** Section order on the page. Most urgent first, undated last. */
export const URGENCY_ORDER: readonly WorkUrgency[] = [
  "overdue",
  "today",
  "soon",
  "later",
  "undated",
];

const URGENCY_LABELS: Record<WorkUrgency, string> = {
  overdue: "Overdue",
  today: "Today",
  soon: "This week",
  later: "Later",
  undated: "No date",
};

export function urgencyLabel(urgency: WorkUrgency): string {
  return URGENCY_LABELS[urgency];
}

export interface UrgencyGroup<T> {
  urgency: WorkUrgency;
  items: T[];
}

/**
 * Bucket items into sections, dropping the empty ones.
 *
 * Empty sections are dropped rather than rendered with a "nothing here",
 * because five headings over an empty page is how a quiet day comes to look
 * like a broken one.
 */
export function groupByUrgency<T extends { dueOn: string | null }>(
  items: readonly T[],
  today: string,
): UrgencyGroup<T>[] {
  const buckets = new Map<WorkUrgency, T[]>();
  for (const item of items) {
    const urgency = urgencyOf(item.dueOn, today);
    const bucket = buckets.get(urgency);
    if (bucket) bucket.push(item);
    else buckets.set(urgency, [item]);
  }
  return URGENCY_ORDER.filter((u) => buckets.has(u)).map((urgency) => ({
    urgency,
    items: buckets.get(urgency) as T[],
  }));
}
