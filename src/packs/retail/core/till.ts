/**
 * The till's arithmetic. PURE — no imports, no database.
 *
 * **EVERY NUMBER A CUSTOMER SEES AND EVERY NUMBER A REPORT SEES COMES FROM HERE,
 * and that is the point of the file existing at all.** A market stall adds a
 * line up in front of somebody holding a note; the day-end report adds the same
 * lines up hours later. If the two rounded differently by one cent, the till
 * would be wrong in the only place a customer can check it.
 *
 * Money is integer cents. Quantities are the item's stocking unit and may be
 * fractional — 2.35 lb of beef is an ordinary sale — so **the rounding happens
 * once, per line, and the sale is the sum of rounded lines.** Rounding the sale
 * total instead would make the receipt disagree with its own rows.
 */

export interface SaleLineLike {
  quantity: number;
  unitPriceCents: number;
  /**
   * The money, STAMPED, for a line whose total cannot be derived — which today
   * means a line sold by weight. Null or absent on every other line, including
   * every line written before catch weight existed.
   */
  totalCents?: number | null;
}

/**
 * What one line comes to.
 *
 * **ROUNDED HERE AND NOWHERE ELSE.** 2.35 lb at $5.50 is $12.925, and a stall
 * charges $12.93. The half-cent goes up, which is the ordinary retail
 * convention and — unlike banker's rounding — is what a person doing it in
 * their head will also get.
 *
 * **THE STAMPED TOTAL WINS, AND IT IS ONE BRANCH ON PURPOSE.** A weighed line
 * is 3 packages at 3.7 lb and $8.00 a pound: $29.60 exactly. There is no
 * per-package price that reproduces it — $29.60 over three packages is $9.8667,
 * which rounds to $9.87 and multiplies back to $29.61 — so the money is
 * recorded rather than reconstructed, and this reads it. **A till that is a
 * cent wrong in front of the customer holding the note is the failure this
 * whole file exists to prevent.**
 *
 * Every line without a stamped total takes the original path and produces the
 * same number it always did. That is why the branch is here rather than a
 * second function: one place still answers "what does this line come to", and
 * the day-end report cannot drift from the receipt by taking the other one.
 */
export function lineTotalCents(line: SaleLineLike): number {
  if (line.totalCents !== undefined && line.totalCents !== null) {
    return line.totalCents;
  }
  return Math.round(line.quantity * line.unitPriceCents);
}

/**
 * What a WEIGHED line comes to before anybody haggles it.
 *
 * **HERE RATHER THAN IN THE TILL COMPONENT**, because this file's premise is
 * that the number a customer sees and the number a report sees come from one
 * place. The till shows this while somebody types on the scale, the same
 * figure is stamped into `retail_sale_lines.line_total_cents`, and
 * `lineTotalCents` reads it straight back — so the receipt, the day's takings
 * and the ledger cannot round differently from each other.
 *
 * The rate is per POUND here, not per stocking unit. 3.7 lb at $8.00 is $29.60.
 */
export function weighedLineCents(
  weightLb: number,
  ratePerLbCents: number,
): number {
  return Math.round(weightLb * ratePerLbCents);
}

/** The sale: the sum of ROUNDED lines, never a rounded sum. */
export function saleTotalCents(lines: SaleLineLike[]): number {
  return lines.reduce((sum, line) => sum + lineTotalCents(line), 0);
}

// ------------------------------------------------------ the day's takings ---

export interface SaleLike {
  paymentMethod: string;
  totalCents: number;
}

export interface Takings {
  /** Everything sold, however it was paid for. */
  totalCents: number;
  /** The part that went into the tin, and the only part a cash count can check. */
  cashCents: number;
  /** Everything else — cards, and whatever else a farm is handed. */
  otherCents: number;
  saleCount: number;
}

/**
 * What a day took.
 *
 * **CASH IS SEPARATED FROM EVERYTHING ELSE because only cash can be counted.**
 * A day-end reconciliation that compared the tin against total takings would
 * report every card sale as a shortfall, which is the fastest way to teach
 * somebody to ignore the number.
 */
export function takings(sales: SaleLike[]): Takings {
  let totalCents = 0;
  let cashCents = 0;
  for (const sale of sales) {
    totalCents += sale.totalCents;
    if (sale.paymentMethod === "cash") cashCents += sale.totalCents;
  }
  return {
    totalCents,
    cashCents,
    otherCents: totalCents - cashCents,
    saleCount: sales.length,
  };
}

export interface CashCountInput {
  openingFloatCents: number | null;
  cashCountedCents: number | null;
  cashSalesCents: number;
}

export interface CashCount {
  /** Float plus cash taken — what should be in the tin. */
  expectedCents: number;
  /** Counted less expected. Positive is over, negative is short. */
  varianceCents: number;
  /** True when nobody counted. Not the same as counting and finding it right. */
  uncounted: boolean;
}

/**
 * The day-end count.
 *
 * **NULL COUNTED IS NOT ZERO COUNTED**, and the distinction is the whole value
 * of the panel. A day nobody counted has no variance to report; a day counted
 * and found exactly right is a fact worth seeing, and showing them the same way
 * would make the second worthless.
 *
 * A missing float is treated as nothing taken to the stall, which is the honest
 * reading of a blank box — unlike the count, a float is a decision somebody made
 * before leaving rather than a measurement they might not have taken.
 */
export function cashCount(input: CashCountInput): CashCount {
  const expectedCents = (input.openingFloatCents ?? 0) + input.cashSalesCents;
  const uncounted = input.cashCountedCents === null;
  return {
    expectedCents,
    varianceCents: uncounted ? 0 : input.cashCountedCents! - expectedCents,
    uncounted,
  };
}

// ------------------------------------------------- profit per selling day ---

export interface DayResultInput {
  takings: Takings;
  /** Stall fee plus travel, from `marketDayCost`. */
  outOfPocketCents: number;
  /** Null when nobody recorded crew or hours. */
  personHours: number | null;
  /** True when NEITHER cost was recorded — see `marketDayCost`. */
  costUnrecorded: boolean;
}

export interface DayResult {
  revenueCents: number;
  costCents: number;
  /** Revenue less what it cost to stand there. NOT less the hours. */
  marginCents: number;
  /** Margin per person-hour, or null when the hours are unknown. */
  perPersonHourCents: number | null;
  /**
   * True when the day has takings but nobody recorded what standing there cost.
   * The margin is then revenue, which flatters the day and has to say so.
   */
  costUnrecorded: boolean;
}

/**
 * **PROFIT PER SELLING DAY — the number the whole pack was built for.**
 *
 * The design's argument, and slice 0 could only answer half of it:
 *
 * > With two or three markets a week, **one is usually a dud attended out of
 * > habit**, and two seasons of this data ends that argument.
 *
 * **THE HOURS ARE STILL NOT IN THE MONEY.** `marginCents` is revenue less the
 * stall fee and the travel, and the person-hours sit beside it as a divisor
 * rather than inside it as a cost. If own time were charged at some invented
 * rate, the comparison between two markets would be a comparison between two
 * guesses; left out, the farmer can see $200 over 10 hours against $180 over 4
 * and draw the conclusion themselves.
 *
 * **IT IS A MARGIN, NOT A PROFIT, AND THE NAME MATTERS.** What the stock cost to
 * produce is not in here — that lives on the output lot's stamped receipt in
 * `inventory`, and joining the two is a report this slice does not build.
 * Calling this "profit" would be claiming the goods were free.
 */
export function dayResult(input: DayResultInput): DayResult {
  const revenueCents = input.takings.totalCents;
  const costCents = input.outOfPocketCents;
  const marginCents = revenueCents - costCents;
  return {
    revenueCents,
    costCents,
    marginCents,
    perPersonHourCents:
      input.personHours !== null && input.personHours > 0
        ? Math.round(marginCents / input.personHours)
        : null,
    costUnrecorded: input.costUnrecorded && revenueCents > 0,
  };
}

// --------------------------------------------------------- what is on hand ---

export interface StockLine {
  itemId: string;
  /** What the server said was at this location when the till loaded. */
  onHand: number;
}

/**
 * What is left on the truck, given what has been sold since the snapshot.
 *
 * **THE TILL HAS TO DO THIS ARITHMETIC ITSELF, and that is a consequence of the
 * design rather than an optimisation.** The truck is a mobile inventory
 * location, so its stock is only ever touched by the one device standing beside
 * it — there is nothing to conflict over, and therefore nothing to ask a server
 * about mid-market. A till that re-fetched the balance after every sale would be
 * unusable at a stall with no signal and no better anywhere else.
 *
 * Negative is allowed through, deliberately: `inventory` permits negative stock
 * on purpose, and a till that refused to sell the last item because the morning
 * snapshot was stale would be choosing a tidy number over a customer holding
 * cash.
 */
export function remainingOnTruck(
  snapshot: StockLine[],
  soldByItem: Map<string, number>,
): StockLine[] {
  return snapshot.map((line) => ({
    itemId: line.itemId,
    onHand:
      Math.round((line.onHand - (soldByItem.get(line.itemId) ?? 0)) * 10_000) /
      10_000,
  }));
}

/**
 * What this device has sold that a server snapshot does not account for yet.
 *
 * **THE STOCK COUNT ON THE TRUCK IS A SNAPSHOT PLUS A DELTA, AND THE DELTA HAS
 * TO KNOW WHEN IT IS SPENT.** A market-day page re-reads the truck from the
 * ledger a beat after every sale; a delta that simply accumulated would then be
 * applied to a figure that already included it, and the truck would read short
 * by the whole session's sales. It reported 35.65 lb with 36.65 lb in the
 * cooler, and the cost of that is a "ran out" tapped over stock that was there
 * - the one number in this pack nothing else can reconstruct.
 *
 * Tagging each entry with the `clientRef` it was posted under makes the answer
 * exact rather than timed: a late refresh, an out-of-order one, or a queue
 * flushing an hour of sales at once all converge, and the delta drains itself.
 */
export function unconfirmedSales<T extends { clientRef: string }>(
  soldSince: T[],
  postedRefs: Iterable<string>,
): T[] {
  const posted = new Set(postedRefs);
  return soldSince.filter((entry) => !posted.has(entry.clientRef));
}

/** Quantities sold per item, for the arithmetic above. */
export function soldByItem(
  lines: { itemId: string; quantity: number }[],
): Map<string, number> {
  const out = new Map<string, number>();
  for (const line of lines) {
    out.set(
      line.itemId,
      Math.round(((out.get(line.itemId) ?? 0) + line.quantity) * 10_000) /
        10_000,
    );
  }
  return out;
}
