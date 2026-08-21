/**
 * Prices, and what a selling day cost. PURE — no imports, no database.
 *
 * **A PRICE IS A TIMELINE, NOT A FIELD.** Every function here folds a list of
 * effective-dated rows down to "what applied on this day", which is what lets
 * the same table answer *what do I charge* and *what did I charge in June*
 * without either question spoiling the other. Nothing is stored but the rows.
 *
 * Money is integer cents, the house convention.
 */

/** `YYYY-MM-DD` compares correctly as a string. No Date arithmetic needed here. */
export interface PriceRow {
  id: string;
  itemId: string;
  priceCents: number;
  effectiveFrom: string;
}

/**
 * The price that applied on a given day, or null.
 *
 * **NULL MEANS NOT PRICED HERE, AND IT IS NOT ZERO.** An item with no price in
 * this channel is one nobody has decided about — which is the ordinary state for
 * most of the shelf, since a farm sells six of the forty things it holds. Zero
 * is a real and different answer: a sample, a giveaway, a loss leader.
 *
 * Rows starting in the FUTURE are ignored rather than being an error. Setting
 * next season's price in advance is the point of dating them, and a fold that
 * picked the newest row regardless would apply it the moment it was typed.
 */
export function priceOn(rows: PriceRow[], on: string): PriceRow | null {
  let best: PriceRow | null = null;
  for (const row of rows) {
    if (row.effectiveFrom > on) continue;
    if (best === null || row.effectiveFrom > best.effectiveFrom) best = row;
  }
  return best;
}

/**
 * The price that will apply next, if one has been set ahead.
 *
 * Exists so a screen can say *"$8.00, going to $8.50 on 1 March"* rather than
 * silently holding a change nobody can see until the morning it lands. A price
 * entered for the future and then forgotten is the failure this prevents.
 */
export function nextPrice(rows: PriceRow[], after: string): PriceRow | null {
  let soonest: PriceRow | null = null;
  for (const row of rows) {
    if (row.effectiveFrom <= after) continue;
    if (soonest === null || row.effectiveFrom < soonest.effectiveFrom) {
      soonest = row;
    }
  }
  return soonest;
}

/** Newest first — the history a price cell expands into. */
export function priceHistory(rows: PriceRow[]): PriceRow[] {
  return [...rows].sort((a, b) =>
    a.effectiveFrom === b.effectiveFrom
      ? a.id < b.id
        ? 1
        : -1
      : a.effectiveFrom < b.effectiveFrom
        ? 1
        : -1,
  );
}

/**
 * What one item is charged at, across every channel that prices it.
 *
 * **THE COMPARISON IS THE POINT.** The same pound of ground beef being $9 at a
 * stall and $7 at the gate is a decision somebody made; seeing the two beside
 * each other is how they find out whether they still mean it. Channels that do
 * not price the item are left out rather than shown at zero.
 */
export function spreadAcrossChannels(
  rows: (PriceRow & { channelId: string })[],
  on: string,
): { channelId: string; priceCents: number }[] {
  const byChannel = new Map<string, (PriceRow & { channelId: string })[]>();
  for (const row of rows) {
    const list = byChannel.get(row.channelId);
    if (list) list.push(row);
    else byChannel.set(row.channelId, [row]);
  }
  const out: { channelId: string; priceCents: number }[] = [];
  for (const [channelId, list] of byChannel) {
    const current = priceOn(list, on);
    if (current) out.push({ channelId, priceCents: current.priceCents });
  }
  return out.sort((a, b) => b.priceCents - a.priceCents);
}

// ------------------------------------------------------ what a day cost ---

export interface MarketDayCostInput {
  stallFeeCents: number | null;
  travelCents: number | null;
  crewSize: number | null;
  hours: number | null;
}

export interface MarketDayCost {
  /** Stall fee plus travel. The money that actually left. */
  outOfPocketCents: number;
  /** Person-hours stood there. Null when either half is missing. */
  personHours: number | null;
  /**
   * True when NEITHER cost was recorded. Different from both being zero, which
   * is a real answer for a farm gate with no fee and no journey.
   */
  unrecorded: boolean;
}

/**
 * What a day of selling cost.
 *
 * **THE HOURS ARE NOT IN THE MONEY, AND THAT IS THE WHOLE ARGUMENT.** The design
 * wants this table to settle which market is a dud attended out of habit — and
 * if own hours count as zero, every market is profitable and the dud is
 * invisible. So person-hours come back beside the money rather than folded into
 * it, and the screen shows both. Turning them into money needs a decision about
 * what an hour is worth, which is `production`'s open item too.
 */
export function marketDayCost(input: MarketDayCostInput): MarketDayCost {
  const fee = input.stallFeeCents;
  const travel = input.travelCents;
  return {
    outOfPocketCents: (fee ?? 0) + (travel ?? 0),
    personHours:
      input.crewSize !== null && input.hours !== null
        ? Math.round(input.crewSize * input.hours * 100) / 100
        : null,
    unrecorded: fee === null && travel === null,
  };
}

/**
 * Cost per hour stood there — the number that compares a four-hour market with
 * a two-hour one.
 *
 * Null rather than zero when nobody recorded the hours, for the reason every
 * other fold in these packs returns null: **"free" and "not known" are different
 * facts** and only one of them is ever true.
 */
export function costPerPersonHour(cost: MarketDayCost): number | null {
  if (cost.personHours === null || cost.personHours <= 0) return null;
  return Math.round(cost.outOfPocketCents / cost.personHours);
}
