import { unitLineCents } from "./billing-math";

/**
 * The arithmetic of an estimate (ADR 0069), pure and pinned in the pure
 * suite: every line is a quantity of a unit at a cost, sold either at a
 * markup on that cost or at an explicit unit price; overhead and profit sit
 * below the lines. Nothing here is stored — the extended figures and the
 * totals are computed wherever they are shown, the change order's rule.
 */

export interface EstimateLineFigures {
  quantityThousandths: number;
  unitCostCents: number;
  /** This line's markup on cost in ppm, or null for the estimate's default. */
  markupPpm: number | null;
  /** An explicit price per unit, which overrides the markup; null for none. */
  unitPriceCents: number | null;
}

export interface EstimateTerms {
  markupPpm: number;
  overheadPpm: number;
  profitPpm: number;
}

/** amount × rate in integer math, rounded half up; amounts here are never negative. */
export function rateCents(cents: number, ppm: number): number {
  if (cents <= 0 || ppm <= 0) return 0;
  return Math.floor((cents * ppm + 500_000) / 1_000_000);
}

/** The extended cost of a line: quantity at the unit cost, rounded once. */
export function lineCostCents(line: EstimateLineFigures): number {
  return unitLineCents(line.quantityThousandths, line.unitCostCents);
}

/**
 * The extended price of a line: quantity at the explicit unit price when
 * there is one — a unit-price bid — else the extended cost marked up, once,
 * by the line's rate or the estimate's default. Marking up the extended cost
 * rather than the unit cost keeps a 320 sf line's price the same to the cent
 * whether it was typed as one line or two.
 */
export function linePriceCents(line: EstimateLineFigures, defaultMarkupPpm: number): number {
  if (line.unitPriceCents !== null) {
    return unitLineCents(line.quantityThousandths, line.unitPriceCents);
  }
  const cost = lineCostCents(line);
  return cost + rateCents(cost, line.markupPpm ?? defaultMarkupPpm);
}

export interface EstimateTotals {
  /** Σ extended cost. */
  costCents: number;
  /** Σ extended price, before overhead and profit. */
  subtotalCents: number;
  overheadCents: number;
  profitCents: number;
  /** What the client is asked for: subtotal + overhead + profit. */
  totalCents: number;
  /** Total less cost. */
  marginCents: number;
  /** Margin over total, in ppm; null when there is no total. */
  marginPpm: number | null;
}

/**
 * Overhead on the subtotal, profit on the subtotal plus overhead — the trade's
 * "ten and ten" — each rounded once. A business that marks up the lines and
 * stops leaves both at zero and gets the subtotal back.
 */
export function estimateTotals(lines: readonly EstimateLineFigures[], terms: EstimateTerms): EstimateTotals {
  const costCents = lines.reduce((sum, l) => sum + lineCostCents(l), 0);
  const subtotalCents = lines.reduce((sum, l) => sum + linePriceCents(l, terms.markupPpm), 0);
  const overheadCents = rateCents(subtotalCents, terms.overheadPpm);
  const profitCents = rateCents(subtotalCents + overheadCents, terms.profitPpm);
  const totalCents = subtotalCents + overheadCents + profitCents;
  const marginCents = totalCents - costCents;
  return {
    costCents,
    subtotalCents,
    overheadCents,
    profitCents,
    totalCents,
    marginCents,
    marginPpm: totalCents > 0 ? Math.round((marginCents / totalCents) * 1_000_000) : null,
  };
}

/** Cost and price by cost code (null = no code): what the budget and the job cost report take. */
export function estimateByCode<T extends EstimateLineFigures & { costCodeId: string | null }>(
  lines: readonly T[],
  defaultMarkupPpm: number,
): Map<string | null, { costCents: number; priceCents: number }> {
  const out = new Map<string | null, { costCents: number; priceCents: number }>();
  for (const l of lines) {
    const row = out.get(l.costCodeId) ?? { costCents: 0, priceCents: 0 };
    row.costCents += lineCostCents(l);
    row.priceCents += linePriceCents(l, defaultMarkupPpm);
    out.set(l.costCodeId, row);
  }
  return out;
}

/** "10" → 100,000 ppm; "12.5" → 125,000; up to 1,000%. Null for anything else. */
export function rateStringToPpm(input: string): number | null {
  const s = input.trim().replace(/%$/, "").trim();
  if (s === "") return null;
  if (!/^\d{1,4}(\.\d{1,4})?$/.test(s)) return null;
  const [whole, frac = ""] = s.split(".");
  const ppm = Number(whole) * 10_000 + Number((frac + "0000").slice(0, 4));
  return ppm > 10_000_000 ? null : ppm;
}

/**
 * Share `extraCents` across `weights` in proportion, in integer math, so the
 * shares sum to the extra exactly: each line gets its floor, and the cents
 * that leaves go one each to the largest remainders, earliest first on a
 * tie. Nothing to share, or nothing to share it over, is a row of zeros.
 */
export function spreadCents(weights: readonly number[], extraCents: number): number[] {
  const W = weights.map((w) => BigInt(Math.max(0, Math.trunc(w))));
  const T = W.reduce((sum, w) => sum + w, BigInt(0));
  const E = BigInt(Math.max(0, Math.trunc(extraCents)));
  if (T === BigInt(0) || E === BigInt(0)) return weights.map(() => 0);
  const floors = W.map((w) => (w * E) / T);
  const remainders = W.map((w) => (w * E) % T);
  let left = E - floors.reduce((sum, f) => sum + f, BigInt(0));
  const order = remainders
    .map((r, i) => ({ r, i }))
    .sort((a, b) => (a.r === b.r ? a.i - b.i : a.r > b.r ? -1 : 1));
  for (const { i } of order) {
    if (left <= BigInt(0)) break;
    floors[i] += BigInt(1);
    left -= BigInt(1);
  }
  return floors.map(Number);
}

export interface ScheduledEstimateLine {
  scheduledCents: number;
  /** The quantity, on a line that bills by the unit; null on a sum. */
  quantityThousandths: number | null;
  /** The unit price with its share of overhead and profit in it; null on a sum. */
  unitPriceCents: number | null;
}

/**
 * The schedule of values an estimate writes: every line at its price with
 * overhead and profit SPREAD across the lines in proportion — the trade's
 * practice, and what makes the schedule total the contract sum, which a
 * G703 requires and which every application is measured against. A line
 * sold by the unit keeps billing by the quantity: its unit price is raised
 * by the same proportion, rounded to the cent, and the cents that rounding
 * leaves land on the last line priced as a sum. Only when every line is by
 * the unit can the schedule miss the total, by that rounding.
 */
export function scheduleFromEstimate(
  lines: readonly EstimateLineFigures[],
  terms: EstimateTerms,
): ScheduledEstimateLine[] {
  const totals = estimateTotals(lines, terms);
  const extra = totals.overheadCents + totals.profitCents;
  const prices = lines.map((l) => linePriceCents(l, terms.markupPpm));
  const shares = spreadCents(prices, extra);
  const factorPpm = totals.subtotalCents > 0 ? Math.round((extra / totals.subtotalCents) * 1_000_000) : 0;
  const out: ScheduledEstimateLine[] = lines.map((l, i) => {
    if (l.unitPriceCents !== null) {
      const unitPrice = l.unitPriceCents + rateCents(l.unitPriceCents, factorPpm);
      return {
        scheduledCents: unitLineCents(l.quantityThousandths, unitPrice),
        quantityThousandths: l.quantityThousandths,
        unitPriceCents: unitPrice,
      };
    }
    return { scheduledCents: prices[i] + shares[i], quantityThousandths: null, unitPriceCents: null };
  });
  const lastSum = out.map((o) => o.unitPriceCents === null).lastIndexOf(true);
  if (lastSum >= 0) {
    out[lastSum].scheduledCents += totals.totalCents - out.reduce((sum, o) => sum + o.scheduledCents, 0);
  }
  return out;
}
