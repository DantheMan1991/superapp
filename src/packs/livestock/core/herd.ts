/**
 * Herd arithmetic. PURE — no imports, no database.
 *
 * **THE HEAD COUNT IS A BALANCE, NEVER A COUNTER.** Nothing writes to a count
 * column; head movements are events and the number is their sum. What that buys
 * is not tidiness — it is that the count can never silently disagree with its
 * own history, which is exactly the property needed when a processor's
 * paperwork has to match the farm's records for inspected meat.
 *
 * Everything in this file is therefore a fold over the SAME ledger `inventory`
 * already keeps. Livestock adds no parallel counter, because head is just a
 * unit of measure.
 */

/**
 * How a movement kind affects the herd's story. The ledger's `movement_kind` is
 * an open taxonomy, so anything unrecognised is treated as a transfer — which
 * moves head without changing what was placed or lost, and is the safe
 * assumption for a kind this file has never heard of.
 */
export type HeadEffect = "intake" | "death" | "removal" | "transfer";

const INTAKE = new Set(["placement", "receipt", "birth", "hatched"]);
const DEATH = new Set(["death", "died", "mortality"]);
/**
 * **`processed` IS A REMOVAL, AND GETTING THAT WRONG MOVES THE ONE NUMBER THE
 * BROILER ENTERPRISE LIVES ON.** Head leaving for a production run has not died
 * and has not moved to another lot: unrecognised kinds fall through to
 * `transfer`, and a transfer OUT would leave mortality's denominator intact
 * while a transfer IN would inflate it. Birds that reach the killing cone are
 * the batch succeeding, not the batch losing anything.
 */
const REMOVAL = new Set([
  "cull",
  "sold_live",
  "issue",
  "slaughtered",
  "processed",
]);

export function headEffect(movementKind: string): HeadEffect {
  if (INTAKE.has(movementKind)) return "intake";
  if (DEATH.has(movementKind)) return "death";
  if (REMOVAL.has(movementKind)) return "removal";
  return "transfer";
}

export interface HeadMovement {
  movementKind: string;
  /** Signed, in head. */
  quantity: number;
}

export interface HeadSummary {
  /** Everything that arrived, however it arrived. The denominator of mortality. */
  intake: number;
  died: number;
  removed: number;
  /** Net effect of splits, merges and moves between lots. */
  transferred: number;
  /** What is standing there now. */
  balance: number;
}

function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

export function summariseHead(movements: HeadMovement[]): HeadSummary {
  let intake = 0;
  let died = 0;
  let removed = 0;
  let transferred = 0;
  let balance = 0;

  for (const m of movements) {
    balance += m.quantity;
    switch (headEffect(m.movementKind)) {
      case "intake":
        intake += m.quantity;
        break;
      case "death":
        died += Math.abs(m.quantity);
        break;
      case "removal":
        removed += Math.abs(m.quantity);
        break;
      case "transfer":
        transferred += m.quantity;
        // A transfer IN is also head arriving. A pen split off a batch has no
        // `placement` of its own, and without this its mortality rate would
        // divide by zero and read as unknown forever.
        if (m.quantity > 0) intake += m.quantity;
        break;
    }
  }

  return {
    intake: round(intake),
    died: round(died),
    removed: round(removed),
    transferred: round(transferred),
    balance: round(balance),
  };
}

/**
 * Deaths over everything that arrived, as a fraction.
 *
 * Returns null rather than 0 when nothing has arrived. **"No deaths" and "no
 * animals" are different facts**, and a lot showing 0% mortality before a
 * single chick has been placed is a number that reads as reassurance.
 *
 * The pilot's broiler enterprise lives or dies on this: at 1,000 birds the gap
 * between 5% and 12% loss is most of the margin, which is why it has to be
 * visible while it can still be acted on rather than at the end of the season.
 */
export function mortalityRate(summary: HeadSummary): number | null {
  if (summary.intake <= 0) return null;
  return summary.died / summary.intake;
}

/** "6.7%", or an em dash when nothing has arrived yet. */
export function formatRate(rate: number | null): string {
  if (rate === null) return "—";
  return `${(rate * 100).toFixed(1)}%`;
}

/** `YYYY-MM-DD` → days since the epoch. Exact: UTC has no DST. */
function toEpochDay(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 86_400_000;
}

/**
 * Age in days. Null when the birth date is unknown, which is the ordinary case
 * for stock bought in.
 *
 * Day arithmetic through `Date.UTC`, which is exact. The house rule against
 * doing MONTH arithmetic with `Date` still stands and is not this: adding a
 * month is ambiguous, subtracting two days is not.
 */
export function ageInDays(bornOn: string | null, today: string): number | null {
  if (!bornOn) return null;
  return toEpochDay(today) - toEpochDay(bornOn);
}

/**
 * "3 weeks", "5 months", "2 years".
 *
 * Deliberately coarse and unit-switching, because the useful precision changes
 * with the animal: a broiler's life is measured in weeks and it matters, while
 * nobody describes a cow as 1,340 days old.
 */
export function formatAge(days: number | null): string {
  if (days === null) return "—";
  if (days < 0) return "not yet";
  if (days < 14) return `${days} ${days === 1 ? "day" : "days"}`;
  if (days < 120) {
    const weeks = Math.floor(days / 7);
    return `${weeks} ${weeks === 1 ? "week" : "weeks"}`;
  }
  if (days < 730) {
    const months = Math.floor(days / 30.44);
    return `${months} ${months === 1 ? "month" : "months"}`;
  }
  const years = Math.floor(days / 365.25);
  return `${years} ${years === 1 ? "year" : "years"}`;
}

export interface IdentifierLike {
  identifierKind: string;
  value: string;
  removedOn: string | null;
}

/**
 * The name to show, from several identifiers of different standing.
 *
 * Current tags beat removed ones, and within those the order is deliberate:
 * a `name` is what a person says, an `official` tag is what paperwork says, and
 * a `visual` tag is what you can read across a field. A removed tag is still
 * returned when nothing else exists, because "#47 (removed)" beats no answer at
 * all when somebody is trying to identify an animal.
 */
const IDENTIFIER_PRIORITY = ["name", "visual", "official", "eid"];

export function preferredIdentifier(
  identifiers: IdentifierLike[],
): IdentifierLike | null {
  if (identifiers.length === 0) return null;
  const rank = (i: IdentifierLike) => {
    const index = IDENTIFIER_PRIORITY.indexOf(i.identifierKind);
    return index === -1 ? IDENTIFIER_PRIORITY.length : index;
  };
  const current = identifiers.filter((i) => i.removedOn === null);
  const pool = current.length > 0 ? current : identifiers;
  return [...pool].sort((a, b) => rank(a) - rank(b))[0];
}
