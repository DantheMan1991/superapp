/**
 * The daily round. PURE — no imports, no database.
 *
 * **THE DESIGN CALLS THIS SLICE THE DAY-ONE WEDGE, AND THE REASON IS COLD
 * START.** The pilot records nothing today: there is no spreadsheet to replace
 * and no habit to attach to, and a tool whose reports only pay off in year two
 * never reaches year two. So the job of this file is not analysis. It is to
 * make the act of recording cheap, and to make the record visibly add up while
 * it is still small.
 *
 * Two rules from the design govern everything here:
 *
 *   1. **Most days nothing happens.** At 10x there are ~30 broiler pens and
 *      nobody opens thirty records to type zeros. One tap confirms "all normal"
 *      across the farm, and only exceptions are entered one at a time.
 *   2. **Explicit zeros still result**, because "zero died" and "didn't check"
 *      are different facts and the mortality denominator depends on telling
 *      them apart.
 *
 * Dates are `YYYY-MM-DD` throughout, and day arithmetic goes through `Date.UTC`
 * — exact, no DST, no month-end surprise. The private `toEpochDay` matches
 * `core/herd.ts` and `land`'s `core/rest.ts` rather than importing from either:
 * a pure core file with no imports is the pack convention, and three lines is a
 * cheaper price than a dependency between two pure modules.
 */

export type CheckStatus = "normal" | "attention";

/** `YYYY-MM-DD` → days since the epoch. Exact: UTC has no DST. */
function toEpochDay(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 86_400_000;
}

/** Whole days from `from` to `to`. Negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  return toEpochDay(to) - toEpochDay(from);
}

export interface DailyCheckLike {
  livestockLotId: string;
  loggedOn: string;
  status: string;
}

/**
 * How the round stands: what has been looked at, and what has not.
 *
 * `remaining` is the list the "all normal" button acts on, which is why it is
 * ids rather than a count — tapping it must never overwrite the lot somebody
 * already flagged, and the only way to be sure of that is to know exactly which
 * lots are untouched.
 */
export interface RoundProgress {
  total: number;
  checked: number;
  /** Lots with no entry today, in the order they were given. */
  remaining: string[];
  /** Lots checked today and flagged as needing a person. */
  needsAttention: string[];
}

export function roundProgress(
  lotIds: string[],
  checksToday: DailyCheckLike[],
): RoundProgress {
  const byLot = new Map(checksToday.map((c) => [c.livestockLotId, c]));
  const remaining: string[] = [];
  const needsAttention: string[] = [];
  for (const id of lotIds) {
    const check = byLot.get(id);
    if (!check) remaining.push(id);
    else if (check.status === "attention") needsAttention.push(id);
  }
  return {
    total: lotIds.length,
    checked: lotIds.length - remaining.length,
    remaining,
    needsAttention,
  };
}

/**
 * Consecutive days the round was walked, counting back from today.
 *
 * **A STREAK THAT RESETS EVERY MORNING IS A STREAK NOBODY KEEPS.** So an
 * unchecked today does not break it: the count runs back from today when today
 * has an entry, and from yesterday when it does not. A run of eleven days shows
 * as eleven at breakfast and twelve after the round, rather than dropping to
 * zero overnight and punishing somebody for looking at the screen early.
 *
 * It breaks on the first missing day before that, which is the honest part —
 * the number means what it says.
 */
export function checkStreak(loggedDates: string[], today: string): number {
  const days = new Set(loggedDates.map(toEpochDay));
  const from = toEpochDay(today);
  // Yesterday is the start when today is untouched. Two days of silence is a
  // broken streak by anyone's reckoning.
  let cursor = days.has(from) ? from : from - 1;
  if (!days.has(cursor)) return 0;
  let streak = 0;
  while (days.has(cursor)) {
    streak += 1;
    cursor -= 1;
  }
  return streak;
}

/**
 * Days since a lot was last looked at. Null when it never has been.
 *
 * Null is not zero and must not render as one: a lot nobody has ever checked is
 * the thing this screen exists to surface, and "0 days" would read as the
 * opposite of the truth.
 */
export function daysSinceCheck(
  lastCheckedOn: string | null,
  today: string,
): number | null {
  if (!lastCheckedOn) return null;
  return daysBetween(lastCheckedOn, today);
}

/** "Today", "Yesterday", "3 days ago", "Never". */
export function formatLastChecked(
  lastCheckedOn: string | null,
  today: string,
): string {
  const days = daysSinceCheck(lastCheckedOn, today);
  if (days === null) return "Never";
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  return `${days} days ago`;
}

/**
 * Losses recorded against a lot on one day, from the ledger.
 *
 * **THE LOSSES ARE NOT STORED ON THE CHECK**, and this function is why they do
 * not need to be. They are `inventory_movements` like every other head event,
 * and the round's entry for a day is joined to them by lot and date — so the
 * count on the log screen and the count on the item page are the same number
 * read twice, never two numbers kept in step.
 */
export interface DatedLossLike {
  occurredOn: string;
  quantity: number;
  movementKind: string;
}

const LOSS_KINDS = new Set(["death", "died", "mortality", "cull"]);

export function lossesOn(movements: DatedLossLike[], date: string): number {
  let total = 0;
  for (const m of movements) {
    if (m.occurredOn === date && LOSS_KINDS.has(m.movementKind)) {
      total += Math.abs(m.quantity);
    }
  }
  return Math.round(total * 10_000) / 10_000;
}
