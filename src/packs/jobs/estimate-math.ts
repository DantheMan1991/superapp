import { unitLineCents } from "./billing-math";

/**
 * The arithmetic of an estimate (ADR 0069), pure and pinned in the pure
 * suite: every line is a quantity of a unit at a cost, sold either at a
 * markup on that cost or at an explicit unit price; overhead and profit sit
 * below the lines. Nothing here is stored — the extended figures and the
 * totals are computed wherever they are shown, the change order's rule.
 *
 * ── GROUPS: THE ITEMS THE CLIENT BUYS (ADR 0079) ────────────────────────────
 *
 * Lines may be gathered into groups — "Tile flooring", with the material, the
 * labour and the thinset behind it. A group's price either ROLLS UP from its
 * lines, each riding the overhead-and-profit spread as any line does, or is
 * FIXED: the number the client pays, typed, and **excluded from that spread**,
 * so the number typed is the number printed. A lump the business wants costed
 * and marked up is a line of quantity one; this answers the other question.
 *
 * Every function here takes its groups as a trailing argument that defaults to
 * none, so **an estimate with no groups computes exactly what it computed
 * before ADR 0079** — the change is additive by construction, and the pinned
 * lines prove it.
 */

export interface EstimateLineFigures {
  quantityThousandths: number;
  unitCostCents: number;
  /** This line's markup on cost in ppm, or null for the estimate's default. */
  markupPpm: number | null;
  /** An explicit price per unit, which overrides the markup; null for none. */
  unitPriceCents: number | null;
  /** The client-facing item this line is part of; null or absent makes it loose. */
  groupId?: string | null;
  /**
   * Whether the line is a row on the proposal (ADR 0080); absent means it is.
   * A hidden line's money counts everywhere it counted before — it simply is
   * not printed, and it collapses the item that holds it.
   */
  clientVisible?: boolean;
}

/** A group as the arithmetic reads it: how it is priced, and the price when it is typed. */
export interface EstimateGroupFigures {
  id: string;
  /** "rollup" — its lines sum — or "fixed" — the price is typed. */
  priceMode: string;
  /** The price the client pays, on a fixed group; null on a rollup. */
  fixedPriceCents: number | null;
  /**
   * Whether the client sees what is in it. Absent means yes, which is what
   * every item written before the switch existed did.
   */
  showLines?: boolean;
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

/**
 * A group is priced by hand only when it says so AND carries the number. The
 * CHECK on the table keeps the two together; this keeps the arithmetic honest
 * if a row ever arrives from somewhere that does not.
 */
export function isFixedPrice(group: EstimateGroupFigures): boolean {
  return group.priceMode === "fixed" && group.fixedPriceCents !== null;
}

/**
 * AN ITEM COLLAPSES to a single row at its price, instead of a heading over
 * its lines, when it is **priced by hand** or **hides any of its lines** (ADR
 * 0080). Both are the same statement — that the build-up behind it is not the
 * client's business — so they share one predicate rather than two that have to
 * be kept in step, and the places that would otherwise print a partial build-up
 * that does not add up (the proposal's takeoff, and a schedule written line by
 * line) both ask this and nothing else.
 */
/**
 * **THREE REASONS, AND THE SWITCH IS ONLY ONE OF THEM.** A typed price and a
 * hidden line both collapse an item whatever the switch says, because those
 * are the two cases where printing the build-up would show rows that do not
 * add up to the price above them ([ADR 0080](../../docs/decisions/0080-an-estimate-line-carries-the-clients-words-beside-the-estimators-and-a-line-kept-off-the-proposal-collapses-the-item-that-holds-it.md)).
 * `show_lines` is an extra reason to collapse, never a reason to expand.
 */
export function itemCollapses(
  group: EstimateGroupFigures,
  children: readonly EstimateLineFigures[],
): boolean {
  return (
    isFixedPrice(group) ||
    group.showLines === false ||
    children.some((l) => l.clientVisible === false)
  );
}

/** The fixed groups by id, with the price each was given. */
function fixedPrices(groups: readonly EstimateGroupFigures[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const g of groups) {
    if (isFixedPrice(g)) out.set(g.id, g.fixedPriceCents as number);
  }
  return out;
}

/** A line's price joins the overhead-and-profit base unless a fixed group holds it. */
function isSpreadable(line: EstimateLineFigures, fixed: Map<string, number>): boolean {
  return !(line.groupId != null && fixed.has(line.groupId));
}

export interface EstimateTotals {
  /** Σ extended cost — every line's, grouped or loose, fixed or rolled up. */
  costCents: number;
  /** Σ extended price, before overhead and profit: the spreadable lines plus the fixed groups. */
  subtotalCents: number;
  /** The base overhead and profit are taken on: the subtotal less the fixed groups. */
  spreadableCents: number;
  /** Σ the fixed groups' prices, which carry their own margin and take no overhead or profit. */
  fixedCents: number;
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
 * Overhead on the spreadable subtotal, profit on that plus overhead — the
 * trade's "ten and ten" — each rounded once. A business that marks up the
 * lines and stops leaves both at zero and gets the subtotal back.
 *
 * **A fixed group's price is added after the rates, never through them**: the
 * estimator who typed it has already put their margin in it. When every group
 * is fixed the rates have nothing to spread over and the total is the sum of
 * what was typed — correct, and said out loud on the screen rather than left
 * to be discovered.
 */
export function estimateTotals(
  lines: readonly EstimateLineFigures[],
  terms: EstimateTerms,
  groups: readonly EstimateGroupFigures[] = [],
): EstimateTotals {
  const fixed = fixedPrices(groups);
  const costCents = lines.reduce((sum, l) => sum + lineCostCents(l), 0);
  const spreadableCents = lines.reduce(
    (sum, l) => (isSpreadable(l, fixed) ? sum + linePriceCents(l, terms.markupPpm) : sum),
    0,
  );
  const fixedCents = [...fixed.values()].reduce((sum, c) => sum + c, 0);
  const overheadCents = rateCents(spreadableCents, terms.overheadPpm);
  const profitCents = rateCents(spreadableCents + overheadCents, terms.profitPpm);
  const subtotalCents = spreadableCents + fixedCents;
  const totalCents = subtotalCents + overheadCents + profitCents;
  const marginCents = totalCents - costCents;
  return {
    costCents,
    subtotalCents,
    spreadableCents,
    fixedCents,
    overheadCents,
    profitCents,
    totalCents,
    marginCents,
    marginPpm: totalCents > 0 ? Math.round((marginCents / totalCents) * 1_000_000) : null,
  };
}

/** What a group costs: its lines', always — a typed price never changes the cost. */
export function groupCostCents(children: readonly EstimateLineFigures[]): number {
  return children.reduce((sum, l) => sum + lineCostCents(l), 0);
}

/**
 * What a group sells for before overhead and profit: the typed price, or its
 * lines' prices summed. The group's own margin is this less its cost, which is
 * the number that tells an owner whether a round price was a safe one.
 */
export function groupPriceCents(
  group: EstimateGroupFigures,
  children: readonly EstimateLineFigures[],
  defaultMarkupPpm: number,
): number {
  if (isFixedPrice(group)) return group.fixedPriceCents as number;
  return children.reduce((sum, l) => sum + linePriceCents(l, defaultMarkupPpm), 0);
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

/**
 * A fixed group's price shared across its own lines, in proportion to what
 * those lines would have sold for. **Equal shares when no line in the group
 * has a price**, because a group whose lines are all at zero must not have its
 * money vanish into a row of zeros — the one place `spreadCents`' honest
 * "nothing to share it over" answer would lose a real number.
 */
function fixedSharesByIndex(
  lines: readonly EstimateLineFigures[],
  prices: readonly number[],
  fixed: Map<string, number>,
): Map<number, number> {
  const out = new Map<number, number>();
  for (const [groupId, priceCents] of fixed) {
    const indices = lines.map((l, i) => (l.groupId === groupId ? i : -1)).filter((i) => i >= 0);
    if (indices.length === 0) continue;
    const own = indices.map((i) => prices[i]);
    const weights = own.some((p) => p > 0) ? own : own.map(() => 1);
    const shares = spreadCents(weights, priceCents);
    indices.forEach((i, n) => out.set(i, shares[n]));
  }
  return out;
}

export interface ScheduledEstimateLine {
  scheduledCents: number;
  /** The quantity, on a line that bills by the unit; null on a sum. */
  quantityThousandths: number | null;
  /** The unit price with its share of overhead and profit in it; null on a sum. */
  unitPriceCents: number | null;
}

/**
 * Every line's scheduled figure, in the order given and with no residual
 * correction — the one place the per-line arithmetic lives, so the by-line
 * schedule, the by-group schedule, the proposal and the by-code summary
 * cannot disagree about a cent.
 *
 * A line in a fixed group bills as a sum at its share of that group's price:
 * its own unit price stopped being the client's the moment the group's was
 * typed. Every other line takes its price plus its share of overhead and
 * profit, and a line sold by the unit keeps billing by the quantity with its
 * unit price raised by the same proportion (ADR 0064).
 */
function scheduleLines(
  lines: readonly EstimateLineFigures[],
  terms: EstimateTerms,
  groups: readonly EstimateGroupFigures[],
): ScheduledEstimateLine[] {
  const totals = estimateTotals(lines, terms, groups);
  const fixed = fixedPrices(groups);
  const extra = totals.overheadCents + totals.profitCents;
  const prices = lines.map((l) => linePriceCents(l, terms.markupPpm));
  const shares = spreadCents(
    lines.map((l, i) => (isSpreadable(l, fixed) ? prices[i] : 0)),
    extra,
  );
  const fixedShares = fixedSharesByIndex(lines, prices, fixed);
  const factorPpm =
    totals.spreadableCents > 0 ? Math.round((extra / totals.spreadableCents) * 1_000_000) : 0;
  return lines.map((l, i) => {
    if (!isSpreadable(l, fixed)) {
      return { scheduledCents: fixedShares.get(i) ?? 0, quantityThousandths: null, unitPriceCents: null };
    }
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
}

/**
 * The schedule of values an estimate writes, line by line: every line at its
 * price with overhead and profit SPREAD across the lines in proportion — the
 * trade's practice, and what makes the schedule total the contract sum, which
 * a G703 requires and which every application is measured against. The cents
 * the rounding leaves land on the last line priced as a sum. Only when every
 * line is by the unit can the schedule miss the total, by that rounding.
 */
export function scheduleFromEstimate(
  lines: readonly EstimateLineFigures[],
  terms: EstimateTerms,
  groups: readonly EstimateGroupFigures[] = [],
): ScheduledEstimateLine[] {
  const out = scheduleLines(lines, terms, groups);
  const totals = estimateTotals(lines, terms, groups);
  const lastSum = out.map((o) => o.unitPriceCents === null).lastIndexOf(true);
  if (lastSum >= 0) {
    out[lastSum].scheduledCents += totals.totalCents - out.reduce((sum, o) => sum + o.scheduledCents, 0);
  }
  return out;
}

/** A line as the schedule and the proposal need it: the figures, and the words. */
export interface EstimateScheduleLine extends EstimateLineFigures {
  description: string;
  /** What the client reads instead (ADR 0080); blank or absent uses the description. */
  clientDescription?: string;
  unit: string;
  costCodeId: string | null;
}

/** A group as the schedule and the proposal need it. */
export interface EstimateScheduleGroup extends EstimateGroupFigures {
  name: string;
}

export interface ScheduledRow {
  description: string;
  scheduledCents: number;
  costCodeId: string | null;
  unit: string;
  quantityThousandths: number | null;
  unitPriceCents: number | null;
  /** The group this row is, when it is one; null on a line's row. */
  groupId: string | null;
  /** A group's name over the lines beneath it, carrying no money of its own. */
  heading: boolean;
  /**
   * The quantity the row's own line carries, whatever it bills as — so a
   * proposal can print "320 sf" beside a line sold at a markup, which
   * `quantityThousandths` deliberately does not, being about billing. Null on a
   * group's row and on a heading.
   */
  lineQuantityThousandths: number | null;
}

/**
 * THE SCHEDULE AN ESTIMATE WRITES, in either shape (ADR 0079).
 *
 * **By group** — the default once an estimate has any, and the repair the
 * proposal asked for: one row per group at its price, then one per loose line,
 * so the schedule an owner certifies against reads like the proposal they
 * signed instead of like a two-hundred-line takeoff. A group bills as a sum
 * and takes its lines' single cost code when they agree on one.
 *
 * **By line** — one row per line, as before items existed, except that an item
 * which COLLAPSES (ADR 0080: priced by hand, or hiding any of its lines) is one
 * row at its price. That supersedes ADR 0079's clause about sharing a fixed
 * price across the item's own lines here: a continuation sheet is a document the
 * owner certifies, and publishing a build-up the builder chose not to publish —
 * in synthetic shares, at that — was the wrong answer to the same question the
 * proposal already had a rule for.
 *
 * **Detail** — the proposal's takeoff shape, never a schedule's: a rollup
 * group prints as a heading with its lines beneath, and **a fixed group prints
 * as one row at its price**, because typing a price is itself the statement
 * that the build-up behind it is not the client's business. Without that rule
 * a builder who priced an item by hand would find its breakdown printed on the
 * proposal anyway, which is the one thing the fixed price was for.
 *
 * All three shapes read the same per-line arithmetic, so a group's row is
 * exactly its lines' rows added up, and the residual cents land on the last
 * row priced as a sum whichever shape was asked for.
 */
export function scheduleRows(
  lines: readonly EstimateScheduleLine[],
  terms: EstimateTerms,
  groups: readonly EstimateScheduleGroup[],
  shape: "group" | "line" | "detail",
): ScheduledRow[] {
  const scheduled = scheduleLines(lines, terms, groups);
  const totals = estimateTotals(lines, terms, groups);
  const rowOfLine = (l: EstimateScheduleLine, i: number): ScheduledRow => ({
    // The client's words wherever a LINE's words reach the client — the proposal's
    // rows, and the schedule of values, because a pay application is an invoice the
    // owner receives (ADR 0080). An item needs none; its name is already theirs.
    description: l.clientDescription?.trim() || l.description,
    scheduledCents: scheduled[i].scheduledCents,
    costCodeId: l.costCodeId,
    unit: l.unit,
    quantityThousandths: scheduled[i].quantityThousandths,
    unitPriceCents: scheduled[i].unitPriceCents,
    groupId: null,
    heading: false,
    lineQuantityThousandths: l.quantityThousandths,
  });
  const rowOfGroup = (g: EstimateScheduleGroup, indices: readonly number[]): ScheduledRow => ({
    description: g.name,
    // A fixed group's price, not its lines' shares of it — the two agree to the cent
    // when it has lines, and only the price is right when it has none.
    scheduledCents: isFixedPrice(g)
      ? (g.fixedPriceCents as number)
      : indices.reduce((sum, i) => sum + scheduled[i].scheduledCents, 0),
    costCodeId: null,
    unit: "",
    quantityThousandths: null,
    unitPriceCents: null,
    groupId: g.id,
    heading: false,
    lineQuantityThousandths: null,
  });
  const childrenOf = (g: EstimateScheduleGroup): number[] =>
    lines.map((l, i) => (l.groupId === g.id ? i : -1)).filter((i) => i >= 0);
  const looseIndices = (): number[] => {
    const known = new Set(groups.map((g) => g.id));
    return lines
      .map((l, i) => (l.groupId == null || !known.has(l.groupId) ? i : -1))
      .filter((i) => i >= 0);
  };

  let rows: ScheduledRow[];
  if (shape === "group") {
    rows = [];
    for (const g of groups) {
      const indices = childrenOf(g);
      const codes = new Set(indices.map((i) => lines[i].costCodeId));
      rows.push({
        ...rowOfGroup(g, indices),
        // A group bills against one code only when its lines agree on one.
        costCodeId: codes.size === 1 ? ([...codes][0] ?? null) : null,
      });
    }
    for (const i of looseIndices()) rows.push(rowOfLine(lines[i], i));
  } else {
    // `detail` and `line` differ by one thing: whether an item that does NOT
    // collapse gets a heading over its lines. A collapsed one is a single row in
    // both, which is also how a fixed item with no lines at all keeps its price.
    rows = [];
    for (const g of groups) {
      const indices = childrenOf(g);
      if (itemCollapses(g, indices.map((i) => lines[i]))) {
        rows.push(rowOfGroup(g, indices));
        continue;
      }
      if (shape === "detail") {
        rows.push({ ...rowOfGroup(g, indices), scheduledCents: 0, heading: true });
      }
      for (const i of indices) rows.push(rowOfLine(lines[i], i));
    }
    for (const i of looseIndices()) rows.push(rowOfLine(lines[i], i));
  }

  const lastSum = rows.map((r) => !r.heading && r.unitPriceCents === null).lastIndexOf(true);
  if (lastSum >= 0) {
    rows[lastSum].scheduledCents += totals.totalCents - rows.reduce((sum, r) => sum + r.scheduledCents, 0);
  }
  return rows;
}

/**
 * Cost and price by cost code (null = no code): what the budget and the job
 * cost report take. The COST is the lines', always. The price of a line held
 * by a fixed group is its share of that group's typed price, so the column
 * still adds to the estimate's subtotal instead of reporting a markup the
 * client was never asked for.
 */
export function estimateByCode<T extends EstimateLineFigures & { costCodeId: string | null }>(
  lines: readonly T[],
  defaultMarkupPpm: number,
  groups: readonly EstimateGroupFigures[] = [],
): Map<string | null, { costCents: number; priceCents: number }> {
  const fixed = fixedPrices(groups);
  const prices = lines.map((l) => linePriceCents(l, defaultMarkupPpm));
  const fixedShares = fixedSharesByIndex(lines, prices, fixed);
  const out = new Map<string | null, { costCents: number; priceCents: number }>();
  lines.forEach((l, i) => {
    const row = out.get(l.costCodeId) ?? { costCents: 0, priceCents: 0 };
    row.costCents += lineCostCents(l);
    row.priceCents += isSpreadable(l, fixed) ? prices[i] : (fixedShares.get(i) ?? 0);
    out.set(l.costCodeId, row);
  });
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
