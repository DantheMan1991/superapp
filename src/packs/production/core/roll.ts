/**
 * The cost roll. PURE — no imports, no database.
 *
 * **THIS IS THE HALF THAT MATTERS MORE THAN THE SCREEN.** A pen of broilers
 * accumulates chicks, feed and medicine; a run turns it into boxes; and until
 * that cost follows the meat into the freezer, "what did this pen make" is not a
 * question the app can answer. Profit per pen is the thesis the whole farm
 * profile rests on, and this file is where the cost crosses over.
 *
 * Two rules carried in from the packs either side, and neither is negotiable:
 *
 *   - **Stamped when it happens, never derived later.** `inventory` stamps an
 *     issue at the average as it stands right now, because a cost recomputed
 *     from next month's prices would move last month's batch under its own
 *     feet. The same applies twice here: the input cost is stamped on the
 *     movement that takes the stock out, and each output's share is stamped on
 *     the receipt that puts it on the shelf.
 *   - **What cannot be split is reported, not spread.** `livestock`'s allocator
 *     returns an empty map rather than charging pens that were not there, and
 *     makes the caller surface the remainder. Same here: a run whose outputs
 *     cannot be compared lands them with no cost, and says so.
 */

/**
 * How much of a lot's accumulated cost goes with the part being taken.
 *
 * **THE ACCUMULATED FIGURE MUST ALREADY BE NET OF WHAT HAS LEFT**, which is
 * what `remainingCents` means on the inventory side. Process half a pen on
 * Saturday and the rest a fortnight later, and pro-rating the gross accumulated
 * cost both times charges the run one and a half pens: the first half takes 50%
 * of the whole, then the second half takes 100% of a total that never went
 * down. Netting the released cost off first makes the two halves sum to the
 * pen.
 *
 * Taking everything standing — or more, which `inventory` permits, because it
 * allows negative stock on purpose — carries the whole remainder rather than
 * more than it exists.
 *
 * Null when there is nothing standing to pro-rate against: a share of a lot
 * whose balance is zero is not zero cost, it is a question with no denominator,
 * and the caller has to say so rather than stamp a confident nothing.
 */
export function lotShareCents(
  remainingCents: number,
  quantityTaken: number,
  quantityStanding: number,
): number | null {
  if (quantityStanding <= 0) return null;
  const taken = Math.min(Math.abs(quantityTaken), quantityStanding);
  return Math.round((remainingCents * taken) / quantityStanding);
}

/** One output, as the roll sees it. */
export interface RollShare {
  key: string;
  /** Pounds, when everything was weighed. */
  lb: number | null;
  quantity: number;
  /** The item's stocking unit — the roll only compares counts within one. */
  unit: string;
}

export type RollBasis = "weight" | "quantity" | "none";

/**
 * Which basis this set of outputs can actually be split on.
 *
 * **WEIGHT FIRST, BECAUSE IT IS THE ONLY ONE THAT WORKS ACROSS UNITS.** 400 lb
 * of cuts and 60 lb of trim are comparable; 400 lb of cuts and 12 whole birds
 * are not, and no amount of arithmetic makes them so.
 *
 * **COUNT SECOND, AND ONLY WHEN EVERY OUTPUT IS COUNTED THE SAME WAY.** Sixty
 * loaves out of one bake are each a sixtieth of the flour, which is how a bakery
 * has always costed and is the right answer for a run nobody weighed. Two
 * different units is where it stops: a dozen eggs and a pound of butter have no
 * ratio between them, which is `inventory`'s own rule about adding quantities
 * across units.
 *
 * **`none` IS AN ANSWER, NOT A FAILURE.** It means the outputs land with no cost
 * on them and the screen explains why — better than a split invented from
 * whichever number happened to be there.
 */
export function rollBasis(shares: RollShare[]): RollBasis {
  if (shares.length === 0) return "none";
  if (shares.every((s) => s.lb !== null && s.lb > 0)) return "weight";
  const units = new Set(shares.map((s) => s.unit));
  if (units.size === 1 && shares.every((s) => s.quantity > 0)) return "quantity";
  return "none";
}

/**
 * Split a pot of cents across shares, largest remainder.
 *
 * Same allocator as `livestock`'s feed split and for the same reason: the
 * pieces must sum to the pot exactly, or the freezer holds a different amount of
 * money than the run took out of stock. The odd cent goes to whoever was closest
 * to another whole one, ties broken by key so two runs of the same arithmetic
 * never disagree.
 */
export function rollCents(
  potCents: number,
  shares: { key: string; basis: number }[],
): Map<string, number> {
  const out = new Map<string, number>();
  const usable = shares.filter((s) => s.basis > 0);
  const total = usable.reduce((sum, s) => sum + s.basis, 0);
  if (total <= 0 || potCents <= 0) return out;

  const exact = usable.map((s) => ({
    key: s.key,
    value: (potCents * s.basis) / total,
  }));
  let assigned = 0;
  for (const row of exact) {
    const floored = Math.floor(row.value);
    out.set(row.key, floored);
    assigned += floored;
  }
  const remainder = potCents - assigned;
  const ranked = [...exact].sort((a, b) => {
    const fa = a.value - Math.floor(a.value);
    const fb = b.value - Math.floor(b.value);
    if (fb !== fa) return fb - fa;
    return a.key < b.key ? -1 : 1;
  });
  for (let i = 0; i < remainder; i++) {
    const row = ranked[i % ranked.length];
    out.set(row.key, (out.get(row.key) ?? 0) + 1);
  }
  return out;
}

export interface RunRoll {
  basis: RollBasis;
  /** key → cents stamped on that output's receipt. Empty when the basis is `none`. */
  byOutput: Map<string, number>;
}

/**
 * The whole roll: pick a basis, split the pot.
 *
 * A pot of zero is an ordinary answer, not an error — a run over raised stock
 * with no purchase basis genuinely cost nothing that anybody has recorded, and
 * `inventory` is explicit that a model insisting every input has a price will be
 * lied to. The basis is still reported, because *how it would have been split*
 * is what the screen has to explain either way.
 */
export function rollRun(potCents: number, shares: RollShare[]): RunRoll {
  const basis = rollBasis(shares);
  if (basis === "none") return { basis, byOutput: new Map() };
  const weighted = shares.map((s) => ({
    key: s.key,
    basis: basis === "weight" ? (s.lb ?? 0) : s.quantity,
  }));
  return { basis, byOutput: rollCents(potCents, weighted) };
}
