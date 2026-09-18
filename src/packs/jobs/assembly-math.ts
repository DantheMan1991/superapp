/**
 * AN ITEM, SAVED, AND DROPPED AT ANOTHER SIZE (E6, ADR 0086). Pure — no
 * database, no clock, no money rules beyond the arithmetic.
 *
 * **ONLY THE QUANTITY SCALES. EVERY RATE IS A RATE.** A unit cost, an explicit
 * unit price and a markup are all *per unit* already, so a bathroom twice the
 * size buys twice as much tile at the same price per foot. Scaling a rate
 * would be the one mistake here that produced a plausible, wrong number — and
 * a plausible wrong number in an estimate is worse than a refusal, because it
 * goes out in a proposal.
 *
 * **THE QUANTITIES ARE STORED AS THEY WERE PRICED**, at the assembly's own
 * driving quantity, and the division happens once, here, at the moment of
 * dropping. `6 bags at 320 sf` is a number an estimator recognises from the
 * job it came off; `0.01875 bags per sf` is not, and would have to be stored
 * to more places than the column has to survive the round trip.
 */

/** Quantities are thousandths, so `320` reads as `320_000`. */
const ONE = 1_000;

/** A line of a saved item, as the assembly keeps it. */
export interface AssemblyLineShape {
  description: string;
  clientDescription: string;
  clientVisible: boolean;
  unit: string;
  /** As it was priced, at the assembly's driving quantity. */
  quantityThousandths: number;
  unitCostCents: number;
  markupPpm: number | null;
  unitPriceCents: number | null;
  /** The code AS WRITTEN — `09 30 00` — resolved against the target job's set. */
  costCode: string;
  sortOrder: number;
}

/**
 * The saved quantity at a new size.
 *
 * Rounded to the nearest thousandth, which is the smallest quantity the pack
 * can hold: 6 bags per 320 sf at 500 sf is 9.375 bags, and at 501 sf it is
 * 9.394 — both exact. What rounding costs is a fraction of a thousandth on
 * the last line of a very odd ratio, and what it buys is an integer column
 * that never carries a float's drift.
 */
export function scaleQuantity(
  savedThousandths: number,
  savedDrivingThousandths: number,
  wantedThousandths: number,
): number {
  // The table's CHECK makes this impossible; the guard is here so a caller
  // that has not read it gets the saved quantity rather than an Infinity.
  if (savedDrivingThousandths <= 0) return savedThousandths;
  return Math.round((savedThousandths * wantedThousandths) / savedDrivingThousandths);
}

export interface ExplodedLine extends Omit<AssemblyLineShape, "sortOrder"> {
  sortOrder: number;
}

/**
 * The item an assembly makes at the size asked for. One line out per line in,
 * in the order they were saved, with every rate untouched.
 */
export function explodeAssembly(
  assembly: { drivingQuantityThousandths: number },
  lines: readonly AssemblyLineShape[],
  wantedThousandths: number,
): ExplodedLine[] {
  return lines.map((l) => ({
    ...l,
    quantityThousandths: scaleQuantity(
      l.quantityThousandths,
      assembly.drivingQuantityThousandths,
      wantedThousandths,
    ),
  }));
}

/**
 * WHAT THIS ITEM IS PER, guessed from its own lines, so the save dialog opens
 * with the answer already in it.
 *
 * The most common (quantity, unit) pair among the lines that HAVE a unit: a
 * tile item of `320 sf tile`, `320 sf labour` and `6 bags thinset` is a floor
 * of 320 sf, because two of its three lines say so. Ties go to the larger
 * quantity, which is the one more likely to be the thing being measured
 * rather than a fitting that goes with it.
 *
 * An item whose lines are all lump sums has nothing to measure, so it is
 * `1` of nothing — drop it once, and it is the same item again. That is a
 * useful assembly (a kitchen, a bathroom suite), not a broken one.
 */
export function suggestDriver(
  lines: readonly Pick<AssemblyLineShape, "unit" | "quantityThousandths">[],
): { quantityThousandths: number; unit: string } {
  const counts = new Map<string, { n: number; quantityThousandths: number; unit: string }>();
  for (const l of lines) {
    const unit = l.unit.trim();
    if (unit === "" || l.quantityThousandths <= 0) continue;
    const key = `${l.quantityThousandths}|${unit.toLowerCase()}`;
    const seen = counts.get(key);
    if (seen) seen.n += 1;
    else counts.set(key, { n: 1, quantityThousandths: l.quantityThousandths, unit });
  }
  let best: { n: number; quantityThousandths: number; unit: string } | null = null;
  for (const c of counts.values()) {
    if (
      best === null ||
      c.n > best.n ||
      (c.n === best.n && c.quantityThousandths > best.quantityThousandths)
    ) {
      best = c;
    }
  }
  return best
    ? { quantityThousandths: best.quantityThousandths, unit: best.unit }
    : { quantityThousandths: ONE, unit: "" };
}

/**
 * The code a dropped line should carry on THIS job: the target set's own code
 * with the same number, or none.
 *
 * Matching on the code rather than the name, and ignoring case and spacing,
 * because `09 30 00` is the thing two businesses agree on and `Tiling` is
 * what one of them calls it. **No match means NO CODE**, never a guess: an
 * uncoded line still prices and is left out of the budget, which is visible;
 * a line silently filed under the wrong code is not.
 */
export function resolveCostCode(
  written: string,
  codes: readonly { id: string; code: string }[],
): string | null {
  const want = written.replace(/\s+/g, "").toLowerCase();
  if (want === "") return null;
  const hit = codes.find((c) => c.code.replace(/\s+/g, "").toLowerCase() === want);
  return hit?.id ?? null;
}
