import { addDays } from "@/lib/timezone";

/**
 * How a due date is said out loud. Pure, no directive — the digest renders
 * these on the server and the page could render them in the browser.
 *
 * Deliberately not "in 3 days" for everything: "today" and "tomorrow" are how
 * people actually hold a deadline, and a line reading "due in 0 days" is
 * machine output. CRM's source reached the same conclusion for follow-ups;
 * this is that phrasing, owned here because a module may not import another
 * module.
 *
 * Every comparison is between `yyyy-mm-dd` STRINGS in the reader's own day.
 */

/** Whole days between two `yyyy-mm-dd` strings, both treated as midnight UTC. */
export function daysBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  // Both endpoints are midnight UTC, so the difference is an exact multiple of
  // a day — none of the DST error that date arithmetic in a real zone carries.
  return Math.round(
    (Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000,
  );
}

export function describeDue(dueOn: string, today: string): string {
  if (dueOn === today) return "Due today";
  if (dueOn === addDays(today, 1)) return "Due tomorrow";
  if (dueOn < today) {
    const days = daysBetween(dueOn, today);
    return days === 1 ? "1 day overdue" : `${days} days overdue`;
  }
  return `Due ${dueOn}`;
}
