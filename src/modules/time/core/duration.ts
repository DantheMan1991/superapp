/**
 * Reading and writing a length of time. NO IMPORTS AND NO DIRECTIVE,
 * deliberately — these run in the browser inside the log form, and importing
 * anything from the schema would drag drizzle into that bundle (the trap
 * documents.md wrote up). `src/packs/assets/vocabulary.ts` is the precedent.
 */

/** A single entry can never exceed a day. Mirrors the CHECK on `time_entries`. */
export const MAX_ENTRY_MINUTES = 1440;

/**
 * "1:30", "1.5", "90m", "1h30", "1h 30m", "90" — the ways somebody writes an
 * hour and a half.
 *
 * A box that only takes decimal hours is a box people get wrong twice a day, so
 * this reads what they actually type. Returns 0 when it cannot tell, and the
 * caller refuses rather than guessing — a duration this misreads is money.
 *
 * THE BARE-NUMBER RULE, inherited from the professional-services parser this
 * replaces: a bare number under 16 is HOURS ("2" is two hours, not two
 * minutes), 16 or more is MINUTES (nobody logs a sixteen-hour day, everybody
 * logs ninety minutes). It is a guess, which is why the log form echoes what it
 * understood back before anything is saved.
 */
export function parseDuration(raw: string): number {
  const s = raw.trim().toLowerCase();
  if (!s) return 0;

  // 1:30 — hours and minutes, the way a clock is read.
  const colon = s.match(/^(\d{1,2}):([0-5]?\d)$/);
  if (colon) return Number(colon[1]) * 60 + Number(colon[2]);

  // 1h30, 1h 30m, 1 hr 30 min — both halves, in any of the spellings.
  const both = s.match(
    /^(\d{1,2})\s*(?:h|hr|hrs|hour|hours)\s*(\d{1,2})\s*(?:m|min|mins|minute|minutes)?$/,
  );
  if (both) {
    const mins = Number(both[2]);
    // "1h 75m" is not a duration anybody means; refusing beats inventing.
    if (mins > 59) return 0;
    return Number(both[1]) * 60 + mins;
  }

  // 1.5h, 90m — one number with its unit.
  const withUnit = s.match(
    /^(\d+(?:\.\d+)?)\s*(h|hr|hrs|hour|hours|m|min|mins|minute|minutes)$/,
  );
  if (withUnit) {
    const n = Number(withUnit[1]);
    return withUnit[2].startsWith("h") ? Math.round(n * 60) : Math.round(n);
  }

  const bare = Number(s);
  if (!Number.isFinite(bare) || bare <= 0) return 0;
  return bare < 16 ? Math.round(bare * 60) : Math.round(bare);
}

/**
 * Minutes as a person reads them: "7h 30m", "45m", "8h".
 *
 * HOURS AND MINUTES RATHER THAN DECIMAL HOURS, because "7.5" invites the
 * reader to wonder whether it means seven hours fifty, and half the people
 * looking at a timesheet are checking somebody else's day. The decimal form is
 * what a payroll export needs, and `decimalHours` below is that, kept separate
 * so the two never get confused for each other.
 */
export function formatDuration(minutes: number): string {
  if (minutes <= 0) return "0m";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/**
 * The same length as decimal hours, for a box somebody types back into and for
 * the payroll export in slice 6. Trailing zeros trimmed: 90 minutes is "1.5",
 * not "1.50", and 120 is "2".
 */
export function decimalHours(minutes: number): string {
  return (minutes / 60).toFixed(2).replace(/\.?0+$/, "");
}
