/**
 * Splitting money across the things it was spent on. **PURE — no imports.**
 *
 * A week's pay is worked out for a PERSON: one regular rate, one overtime
 * premium, one figure. The books want it per ENTERPRISE, per field, per job —
 * and those are properties of the individual hours, not of the week. So the
 * figure has to be taken apart again, and the only honest basis for taking it
 * apart is the minutes.
 *
 * That is an apportionment, not a calculation, and it has the failure every
 * apportionment has: three equal shares of $10.00 are $3.33 each, which is
 * $9.99. A journal entry that is a cent out does not post at all — `postEntry`
 * refuses anything that does not sum to zero — so the rounding is the whole
 * problem and `allocateCents` is the whole answer.
 */

/** One entry's contribution: how long, and what it was tagged with. */
export interface AllocatableEntry {
  minutes: number;
  /** Dimension member ids on this entry. At most one per dimension type. */
  memberIds: readonly string[];
}

/** One posting line's worth: what it was for, how long, and how much. */
export interface DimensionSplit {
  /** Sorted, so two entries tagged the same way group together. */
  memberIds: string[];
  minutes: number;
  cents: number;
}

/**
 * The grouping key for a set of dimension members.
 *
 * **THE KEY IS THE WHOLE SET, NOT ONE MEMBER.** An hour can be tagged with an
 * enterprise AND a parcel at once — `line_dimensions` allows one member per
 * TYPE per line, so both belong on the same journal line. Grouping by a single
 * member would either double-count the hour or drop one of its tags.
 *
 * Sorted, because "Beef + North Field" and "North Field + Beef" are the same
 * hour and must not become two lines.
 */
export function dimensionKey(memberIds: readonly string[]): string {
  return [...memberIds].sort().join("|");
}

/**
 * Whole cents, apportioned by weight, summing EXACTLY to the total.
 *
 * Largest remainder: give everybody their floor, then hand the leftover cents
 * one at a time to whoever was robbed most by the flooring. The alternative —
 * rounding each share and hoping — is off by a cent often enough that it would
 * be a bug report a week, and here it is not a rounding complaint but a journal
 * entry that will not post.
 *
 * Ties go to the earlier bucket, which is arbitrary but STABLE: the same input
 * must always produce the same lines, or re-posting a reversed period would
 * shuffle cents between enterprises for no reason.
 *
 * With no weight to go on — every bucket zero, which the callers here cannot
 * produce but a future one might — the total lands whole in the first bucket.
 * Something arbitrary, never something lost.
 */
export function allocateCents(
  total: number,
  weights: readonly number[],
): number[] {
  if (weights.length === 0) return [];
  const totalWeight = weights.reduce((sum, w) => sum + w, 0);
  if (totalWeight <= 0) {
    return weights.map((_, i) => (i === 0 ? total : 0));
  }

  const exact = weights.map((w) => (total * w) / totalWeight);
  const shares = exact.map(Math.floor);
  let leftover = total - shares.reduce((sum, c) => sum + c, 0);

  // Whoever lost the most to flooring gets the next cent. `index` breaks ties
  // so the order is total rather than "whatever sort() felt like".
  const order = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);

  for (let i = 0; leftover > 0 && i < order.length; i += 1, leftover -= 1) {
    shares[order[i].index] += 1;
  }
  return shares;
}

/**
 * A person's pay for a period, split across what they worked on.
 *
 * Minutes are the basis, and that is a decision worth stating: an overtime
 * premium is NOT attributable to the hour that caused it. The forty-first hour
 * is only expensive because forty came before it, and asking which job "caused"
 * the overtime is a question with no answer — whichever was booked last is an
 * artefact of data entry, not of the work. So the premium is spread over the
 * period's hours like everything else, which is the ordinary treatment and the
 * only one that does not invent a fact.
 *
 * Entries with no dimension at all group together under an empty set and post
 * untagged, which is exactly right: the expense is real, it is just not
 * attributed. Dropping them would lose money out of the entry.
 *
 * Returns groups in first-seen order, so the lines on a posted entry come out
 * in the order the hours were logged rather than by whatever the ids sort to.
 */
export function splitByDimension(
  entries: readonly AllocatableEntry[],
  totalCents: number,
): DimensionSplit[] {
  const groups = new Map<string, DimensionSplit>();
  for (const entry of entries) {
    const key = dimensionKey(entry.memberIds);
    const found = groups.get(key);
    if (found) {
      found.minutes += entry.minutes;
    } else {
      groups.set(key, {
        memberIds: [...entry.memberIds].sort(),
        minutes: entry.minutes,
        cents: 0,
      });
    }
  }

  const splits = [...groups.values()];
  const cents = allocateCents(
    totalCents,
    splits.map((s) => s.minutes),
  );
  splits.forEach((split, i) => {
    split.cents = cents[i];
  });
  // A group that ends up worth nothing is not a journal line. Dropping it here
  // rather than at the posting site keeps "what did this cost" and "what will
  // post" the same list.
  return splits.filter((s) => s.cents !== 0);
}
