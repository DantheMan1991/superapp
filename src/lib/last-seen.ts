/**
 * Last seen (back-office slice 6), the pure half.
 *
 * A member's own request stamps their membership's `last_seen_at` — but not
 * on every request: a dashboard render calls the resolver from the layout,
 * the page and whatever else asks, and a write per call would make the
 * cheapest page the most expensive. So the stamp is worth making only when
 * the last one is an hour old or older. The hour is the resolution "when did
 * they last use it" needs; nobody asks to the minute.
 *
 * Import-free so it can be tested without a request.
 */

export const SEEN_STAMP_MINUTES = 60;

export function shouldStampSeen(lastSeenAt: Date | null, now: Date): boolean {
  if (!lastSeenAt) return true;
  return now.getTime() - lastSeenAt.getTime() >= SEEN_STAMP_MINUTES * 60_000;
}

/** How long ago, in the words a console reads at a glance. */
export function describeAgo(at: Date | null, now: Date): string {
  if (!at) return "never";
  const minutes = Math.max(0, Math.round((now.getTime() - at.getTime()) / 60_000));
  if (minutes < 2) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} d ago`;
  const months = Math.round(days / 30);
  return `${months} mo ago`;
}

/** Quiet: no sign of life for this many days. */
export const QUIET_DAYS = 30;

export function isQuiet(lastSeenAt: Date | null, lastActivityAt: Date | null, now: Date): boolean {
  const latest = [lastSeenAt, lastActivityAt]
    .filter((d): d is Date => d !== null)
    .reduce<Date | null>((a, b) => (a && a > b ? a : b), null);
  if (!latest) return true;
  return now.getTime() - latest.getTime() >= QUIET_DAYS * 24 * 60 * 60_000;
}
