/**
 * What the barn owes a person. PURE — no imports, no database.
 *
 * **THE DEVIATIONS THE DESIGN WANTED SURFACED, AND NOBODY WAS TOLD.** The
 * dossier's open items carried two lines for a month: *"nothing warns that a
 * withdrawal is about to expire, or that one has just cleared"*, and the
 * round's whole argument — a day nobody looked is a different fact from a day
 * nothing happened — with no way to learn that a day had gone by unlooked
 * except to open the round and read `3 days ago`. `notifications.md` has the
 * seam for exactly this: an obligation is derived, never stored, and clears
 * itself the moment the thing is done. These three are that shape.
 *
 *   1. **A lot nobody has looked at for two days or more.** Yesterday is not
 *      an obligation — today's round is still to come — but a whole day gone
 *      by is a missed round, and the item says which lots. ONE line for the
 *      farm, not one per lot: thirty stale pens is one fact (the round was not
 *      walked), and thirty lines is the digest somebody mutes.
 *   2. **A withdrawal nobody looked up.** A treatment recorded `none_stated`
 *      blocks exactly as a running clock does, and stays blocking until
 *      somebody reads the label and corrects it — the one obligation here that
 *      does not clear by waiting.
 *   3. **A withdrawal clearing today or tomorrow.** The day the trailer can be
 *      booked. Informational at the edge of an obligation, and kept because it
 *      is the trigger for the next thing a farm does with those animals; a
 *      clock that cleared LAST week is finished with and is not raised.
 *
 * Dates are `YYYY-MM-DD` and day arithmetic goes through `Date.UTC`, the same
 * three-line helper the other pure files carry rather than a shared import —
 * the pack convention: a pure core file has no imports.
 */

export type BarnUrgency = "overdue" | "today" | "soon";

/** Structurally an `AttentionItem` — the source spreads it into one. */
export interface BarnItem {
  key: string;
  title: string;
  detail?: string;
  urgency: BarnUrgency;
  dueOn: string | null;
  href: string;
}

const BASE = "/dashboard/m/livestock";

/**
 * A lot last looked at this many days ago, or more, has been missed.
 *
 * Two, not one: a lot checked yesterday and not yet today is a normal
 * morning, and a digest that raised it at 7am would be raising every lot on
 * the farm every day. Two days is a day that went by with nobody looking,
 * which is the fact the round exists to record.
 */
export const ROUND_STALE_AFTER_DAYS = 2;

/** `YYYY-MM-DD` → days since the epoch. Exact: UTC has no DST. */
function toEpochDay(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 86_400_000;
}

function fromEpochDay(day: number): string {
  return new Date(day * 86_400_000).toISOString().slice(0, 10);
}

export interface RoundLotLike {
  id: string;
  /** The name a person calls it. */
  code: string;
  lastCheckedOn: string | null;
}

/** How many lots are named in the detail line before "and N more". */
const NAMED_IN_DETAIL = 4;

/**
 * The round, as one obligation for the whole farm — or nothing.
 *
 * `lots` are the ones with animals standing in them (the caller decides that,
 * because "standing in" is a fold over the ledger this file does not have).
 */
export function roundAttention(lots: RoundLotLike[], today: string): BarnItem | null {
  const now = toEpochDay(today);
  const daysSince = (lot: RoundLotLike) =>
    lot.lastCheckedOn === null ? null : now - toEpochDay(lot.lastCheckedOn);
  const stale = lots.filter((lot) => {
    const days = daysSince(lot);
    return days === null || days >= ROUND_STALE_AFTER_DAYS;
  });
  if (stale.length === 0) return null;

  // The day the round was first missed, which is the day this became due.
  const dueOn = fromEpochDay(now - 1);
  const href = `${BASE}/log`;

  if (stale.length === 1) {
    const lot = stale[0];
    const days = daysSince(lot);
    return {
      key: "livestock_round:stale",
      title:
        days === null
          ? `${lot.code} has never been looked at`
          : `${lot.code} has not been looked at for ${days} days`,
      detail: "Walk the round and mark it normal, or say what you saw",
      urgency: "overdue",
      dueOn,
      href,
    };
  }

  const named = stale.slice(0, NAMED_IN_DETAIL).map((lot) => lot.code);
  const more = stale.length - named.length;
  return {
    key: "livestock_round:stale",
    title: `${stale.length} lots have not been looked at for ${ROUND_STALE_AFTER_DAYS} days or more`,
    detail: more > 0 ? `${named.join(", ")} and ${more} more` : named.join(", "),
    urgency: "overdue",
    dueOn,
    href,
  };
}

/** The meat clock of one lot with animals standing in it, as `lotWithdrawal` reports it. */
export interface ClockLike {
  id: string;
  code: string;
  state: "clear" | "under" | "unknown";
  clearsOn: string | null;
  /** The product doing the blocking, when there is one. */
  product: string | null;
  /**
   * The treatment doing the blocking. A dose given to a pen is on the pen's
   * clock AND on the clock of every animal living in it, and it is one dose:
   * items are kept once per treatment, on the record that owns it.
   */
  treatmentId: string | null;
  /** True when the blocking treatment was recorded against THIS lot. */
  ownsTreatment: boolean;
}

/**
 * The clocks worth a line today: never looked up, clearing today, clearing
 * tomorrow. Everything else — running with days to go, cleared last week,
 * never treated — is not an obligation and is not raised.
 *
 * "Clears today" is read off `state: "clear"` with `clearsOn` today, because
 * `withdrawalStatus` clears ON the day rather than the day after; "tomorrow"
 * is a clock still `under` with a day to run.
 *
 * **ONE LINE PER TREATMENT.** A pen dosed in the water puts the same clock
 * on the pen and on every named animal in it; five lines saying the same
 * label was never read is the digest somebody mutes, and the fix is on the
 * pen. The line goes to the record the treatment was recorded against, and
 * to the first inheritor only when that record is not standing here.
 */
export function withdrawalAttention(lots: ClockLike[], today: string): BarnItem[] {
  const now = toEpochDay(today);
  const out: BarnItem[] = [];
  const seen = new Map<string, number>();
  const push = (lot: ClockLike, item: BarnItem) => {
    if (lot.treatmentId === null) {
      out.push(item);
      return;
    }
    const at = seen.get(lot.treatmentId);
    if (at === undefined) {
      seen.set(lot.treatmentId, out.length);
      out.push(item);
    } else if (lot.ownsTreatment) {
      // The owner beats an inheritor that happened to come first.
      out[at] = item;
    }
  };
  for (const lot of lots) {
    const href = `${BASE}/${lot.id}`;
    if (lot.state === "unknown") {
      push(lot, {
        key: `livestock_withdrawal_unknown:${lot.id}`,
        title: `${lot.code}'s withdrawal was never looked up`,
        detail: `${
          lot.product ? `${lot.product} was given` : "A treatment was given"
        } and nobody read the label. Correct the treatment with the period; until then nothing here can be processed`,
        urgency: "overdue",
        dueOn: null,
        href,
      });
      continue;
    }
    if (lot.clearsOn === null) continue;
    const inDays = toEpochDay(lot.clearsOn) - now;
    if (lot.state === "clear" && inDays === 0) {
      push(lot, {
        key: `livestock_withdrawal_clears:${lot.id}`,
        title: `${lot.code} clears withdrawal today`,
        detail: lot.product
          ? `After ${lot.product}. Free to be processed from today`
          : "Free to be processed from today",
        urgency: "today",
        dueOn: lot.clearsOn,
        href,
      });
    } else if (lot.state === "under" && inDays === 1) {
      push(lot, {
        key: `livestock_withdrawal_clears:${lot.id}`,
        title: `${lot.code} clears withdrawal tomorrow`,
        detail: lot.product
          ? `After ${lot.product}. Free to be processed from ${lot.clearsOn}`
          : `Free to be processed from ${lot.clearsOn}`,
        urgency: "soon",
        dueOn: lot.clearsOn,
        href,
      });
    }
  }
  return out;
}
