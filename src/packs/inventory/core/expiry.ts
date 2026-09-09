/**
 * What a "good until" date means today. PURE — no imports, no database.
 *
 * The hub's `Going off soon` panel had no lower bound and a silent cap of
 * twelve: a batch that went off last year sat under a heading that said
 * "soon", and a farm with forty expiring batches read `12` on the card. The
 * two facts a stockroom wants are different — what is ALREADY past its date
 * is a loss to act on today, what is CLOSE is a shelf to use first — so this
 * keeps them apart and puts a plain sentence on each row.
 */

const DAY_MS = 86_400_000;

/**
 * Whole days from `today` to `date`; negative once the date has passed.
 * ISO dates only, read at UTC midnight so a timezone cannot shift a day.
 */
export function daysUntil(date: string, today: string): number {
  return Math.round(
    (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) /
      DAY_MS,
  );
}

export function isPastDate(expiresOn: string, today: string): boolean {
  return expiresOn < today;
}

/**
 * The sentence beside a date: `past its date`, `goes off today`, `goes off
 * tomorrow`, `goes off in 5 days`, or `good until 2026-11-01` beyond the
 * horizon. Never a bare date, because "2026-09-12" makes the reader do the
 * subtraction the screen exists to do.
 */
export function expiryLabel(
  expiresOn: string,
  today: string,
  horizonDays = 42,
): string {
  const days = daysUntil(expiresOn, today);
  if (days < 0) return "past its date";
  if (days === 0) return "goes off today";
  if (days === 1) return "goes off tomorrow";
  if (days <= horizonDays) return `goes off in ${days} days`;
  return `good until ${expiresOn}`;
}

/**
 * Past its date and not yet — the caller's order kept within each half, so a
 * list that arrived soonest-first stays soonest-first on both sides.
 */
export function splitExpiring<T extends { expiresOn: string }>(
  rows: readonly T[],
  today: string,
): { past: T[]; soon: T[] } {
  const past: T[] = [];
  const soon: T[] = [];
  for (const row of rows) {
    (isPastDate(row.expiresOn, today) ? past : soon).push(row);
  }
  return { past, soon };
}

/**
 * The card's one sentence under its figure. `horizon` is the hub's own
 * wording for how far ahead it looks ("six weeks").
 */
export function describeExpiring(
  past: number,
  soon: number,
  horizon = "six weeks",
): string {
  const pastWords =
    past === 1 ? "1 past its date" : `${past} past their date`;
  if (past === 0 && soon === 0) return `Nothing within ${horizon}`;
  if (soon === 0) return `${pastWords}, nothing else within ${horizon}`;
  if (past === 0) return `Within ${horizon}, soonest first below`;
  return `${pastWords}, ${soon} more within ${horizon}`;
}
