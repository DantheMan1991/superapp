/**
 * Feed, and what it cost each pen. PURE — no imports, no database.
 *
 * **THERE ARE TWO WAYS A PEN'S FEED COST IS KNOWN, AND THEY ARE NOT THE SAME
 * KIND OF FACT.**
 *
 *   - **Measured.** A bag went to a named pen. `inventory` stamped the cost at
 *     the average when the issue happened, and nothing in this file touches it —
 *     it is read back exactly as it was recorded.
 *   - **Allocated.** A ton went into a bin serving fifteen pens, and no one will
 *     ever know which bird ate which pound. The cost is spread by **head × days
 *     on feed**, which is an estimate produced here at read time.
 *
 * The design's rule, and it is the reason this file exists rather than a column:
 * *every derived cost should carry its provenance. Same report, different
 * confidence — and at 10× the bagged number becomes an allocated one, so the
 * distinction is permanent, not transitional.* A single "feed cost" column would
 * have thrown that away on the first bulk delivery.
 *
 * **NOTHING HERE IS FEED CONVERSION RATIO.** FCR is feed per pound of GAIN, gain
 * needs weights, and weights are slice 5. Feed per head and feed cost per head
 * are both answerable today and neither of them is FCR; the screens say so in
 * those words rather than dividing by something plausible. See
 * `FCR_NEEDS_WEIGHTS`.
 *
 * Money is integer cents, the house convention. Quantities are in the item's
 * stocking unit and are NEVER added across units — see `mergeQuantities`.
 */

/** `YYYY-MM-DD` → days since the epoch. Exact: UTC has no DST. */
function toEpochDay(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 86_400_000;
}

function fromEpochDay(day: number): string {
  return new Date(day * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Why there is no FCR on any screen in this pack.
 *
 * Kept as one string in one place because it is said on the feed report and on
 * the lot page, and the two must not drift into implying different things about
 * what the app knows.
 */
export const FCR_NEEDS_WEIGHTS =
  "Feed conversion needs weights, and nothing has been weighed yet. Feed per head is below; feed per pound of gain is not a number this farm can produce until weights are recorded.";

// ------------------------------------------------------- head, day by day ---

export interface DatedQuantity {
  occurredOn: string;
  /** Signed, in head. */
  quantity: number;
}

/**
 * Head standing at the END of each day from `from` to `to`, inclusive.
 *
 * **THE HEAD COUNT IS ALREADY RECORDED, SO IT IS NEVER RE-ENTERED FOR FEED.**
 * The allocation basis is head × days, and head on any given day is a running
 * balance of the same ledger the count on the lot page comes from. A "birds on
 * feed" field would be a second number that had to agree with it forever, which
 * is the duplication land's rule and this pack's whole design refuse.
 *
 * Negative balances are clamped to zero. Inventory allows a negative on purpose
 * — Tuesday's issue entered before Monday's delivery — but a negative head-count
 * as an allocation WEIGHT would hand a pen a negative share of the feed bill,
 * which is not a temporarily wrong number, it is a wrong sign.
 */
export function headOnDays(
  movements: DatedQuantity[],
  from: string,
  to: string,
): number[] {
  const start = toEpochDay(from);
  const end = toEpochDay(to);
  if (end < start) return [];

  const byDay = new Map<number, number>();
  let opening = 0;
  for (const m of movements) {
    const day = toEpochDay(m.occurredOn);
    if (day < start) {
      opening += m.quantity;
      continue;
    }
    if (day > end) continue;
    byDay.set(day, (byDay.get(day) ?? 0) + m.quantity);
  }

  const out: number[] = [];
  let running = opening;
  for (let day = start; day <= end; day++) {
    running += byDay.get(day) ?? 0;
    out.push(running > 0 ? running : 0);
  }
  return out;
}

export interface MembershipSpan {
  startedOn: string;
  /** Inclusive last day. Null means still on the feeder. */
  endedOn: string | null;
}

/**
 * Head-days: the allocation basis, and the only thing the split depends on.
 *
 * A pen contributes its head count for every day it was BOTH on the feeder and
 * had animals in it. Both halves matter: a pen with 200 birds that only joined
 * the bin last week must not be charged for the month, and a membership left
 * open on an empty pen must not dilute everyone else's share with zeros that
 * look like presence.
 */
export function headDays(
  movements: DatedQuantity[],
  spans: MembershipSpan[],
  from: string,
  to: string,
): number {
  const start = toEpochDay(from);
  const end = toEpochDay(to);
  if (end < start || spans.length === 0) return 0;

  const head = headOnDays(movements, from, to);
  let total = 0;
  for (let i = 0; i < head.length; i++) {
    const day = start + i;
    const onFeed = spans.some(
      (span) =>
        toEpochDay(span.startedOn) <= day &&
        (span.endedOn === null || toEpochDay(span.endedOn) >= day),
    );
    if (onFeed) total += head[i];
  }
  return round4(total);
}

/** The days a set of spans actually covers inside a window — "days on feed". */
export function daysOnFeed(
  spans: MembershipSpan[],
  from: string,
  to: string,
): number {
  const start = toEpochDay(from);
  const end = toEpochDay(to);
  if (end < start) return 0;
  let days = 0;
  for (let day = start; day <= end; day++) {
    const onFeed = spans.some(
      (span) =>
        toEpochDay(span.startedOn) <= day &&
        (span.endedOn === null || toEpochDay(span.endedOn) >= day),
    );
    if (onFeed) days++;
  }
  return days;
}

/** The first day any of these spans covers, or null when there are none. */
export function earliestSpanStart(spans: MembershipSpan[]): string | null {
  let earliest: number | null = null;
  for (const span of spans) {
    const day = toEpochDay(span.startedOn);
    if (earliest === null || day < earliest) earliest = day;
  }
  return earliest === null ? null : fromEpochDay(earliest);
}

// ------------------------------------------------------------- allocation ---

export interface AllocationShare {
  key: string;
  /** Head-days, or any other non-negative weight. */
  basis: number;
}

/**
 * Split a pot of CENTS across shares, largest remainder.
 *
 * **THE PIECES SUM EXACTLY TO THE POT**, and that is not fussiness. An allocated
 * feed bill that does not add back up to the delivery is a number a person
 * checks once, finds wrong by three cents, and stops trusting — and unlike
 * `issueCostCents`, where the remainder is a real consequence of stamping each
 * issue at the average as it happened, here the whole pot is being divided in
 * one act and there is nothing for a remainder to be a fact about.
 *
 * Returns an empty map when nothing has any basis. **The caller must then report
 * the pot as UNALLOCATED rather than dropping it** — feed drawn for a bin that
 * no pen was on is a real cost the farm paid, and silently losing it would make
 * the report add up while being wrong.
 */
export function allocateCents(
  potCents: number,
  shares: AllocationShare[],
): Map<string, number> {
  const out = new Map<string, number>();
  const usable = shares.filter((s) => s.basis > 0);
  const total = usable.reduce((sum, s) => sum + s.basis, 0);
  if (total <= 0 || potCents === 0) return out;

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
  // The remainder goes to whoever was closest to another whole cent, biggest
  // fractional part first. Deterministic on ties by key, so two runs of the
  // same report never disagree.
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

/**
 * Split a QUANTITY across the same shares.
 *
 * Rounded to four places, matching `numeric(18,4)` on the ledger. No
 * largest-remainder here: a quantity is a real number rather than a count of
 * indivisible cents, so the pieces may differ from the whole in the fourth
 * decimal and nobody is owed the difference.
 */
export function allocateQuantity(
  total: number,
  shares: AllocationShare[],
): Map<string, number> {
  const out = new Map<string, number>();
  const usable = shares.filter((s) => s.basis > 0);
  const basis = usable.reduce((sum, s) => sum + s.basis, 0);
  if (basis <= 0 || total === 0) return out;
  for (const share of usable) {
    out.set(share.key, round4((total * share.basis) / basis));
  }
  return out;
}

// ------------------------------------------------------------- quantities ---

/** How much of one thing, in the unit it is stocked in. */
export interface FeedQuantity {
  unit: string;
  quantity: number;
}

/**
 * Add quantities, KEEPING THE UNITS APART.
 *
 * Pounds of grower and gallons of surplus milk are both feed and there is no
 * factor between them that does not depend on what is in the bucket —
 * `inventory`'s own rule about conversions across dimensions. So the total is a
 * list rather than a number, and a screen shows "1,400 lb · 60 gal" instead of
 * a confident 1,460 of nothing.
 */
export function mergeQuantities(parts: FeedQuantity[]): FeedQuantity[] {
  const byUnit = new Map<string, number>();
  for (const part of parts) {
    if (part.quantity === 0) continue;
    byUnit.set(part.unit, round4((byUnit.get(part.unit) ?? 0) + part.quantity));
  }
  return [...byUnit.entries()]
    .map(([unit, quantity]) => ({ unit, quantity }))
    .filter((q) => q.quantity !== 0)
    .sort((a, b) => (a.unit < b.unit ? -1 : 1));
}

/**
 * "1,400 lb · 60 gal", or an em dash when nothing was fed.
 *
 * Two decimal places, not four. The ledger stores four because a quantity may
 * genuinely be 0.0625 of something, but an ALLOCATED quantity is a share of a
 * pot and carries the full precision of the division — the screen showed
 * "521.569 lb" of feed, which claims to know a pen's intake to the gram.
 */
export function formatQuantities(parts: FeedQuantity[]): string {
  if (parts.length === 0) return "—";
  return parts
    .map(
      (p) =>
        `${p.quantity.toLocaleString("en-US", { maximumFractionDigits: 2 })} ${p.unit}`,
    )
    .join(" · ");
}

// ------------------------------------------------------------- provenance ---

/**
 * How a feed figure was arrived at. **PERMANENT, not a migration state.**
 *
 * `measured` is a bag issued to a named pen; `allocated` is a share of a bin;
 * `mixed` is the ordinary case for a batch brooded on bagged starter and
 * finished on bulk grower, and it must read as its own answer rather than as
 * either of the other two.
 */
export type FeedProvenance = "none" | "measured" | "allocated" | "mixed";

export function provenanceOf(
  measuredCents: number,
  allocatedCents: number,
): FeedProvenance {
  if (measuredCents > 0 && allocatedCents > 0) return "mixed";
  if (measuredCents > 0) return "measured";
  if (allocatedCents > 0) return "allocated";
  return "none";
}

export const PROVENANCE_LABELS: Record<FeedProvenance, string> = {
  none: "—",
  measured: "Measured",
  allocated: "Allocated",
  mixed: "Both",
};

/** One line saying what the badge means, because "allocated" is a claim about confidence. */
export const PROVENANCE_NOTES: Record<FeedProvenance, string> = {
  none: "Nothing fed to this lot on record.",
  measured: "Every pound was issued to this lot by name.",
  allocated:
    "A share of a shared feeder, spread by head × days. An estimate, and the right one — nobody knows which bird ate which pound.",
  mixed:
    "Part issued to this lot by name, part a share of a shared feeder spread by head × days.",
};

// ------------------------------------------------------------ the report ---

export interface FeedLotInput {
  lotId: string;
  code: string;
  species: string;
  ageDays: number | null;
  /** Standing now — the denominator of "per head at today's count". */
  head: number;
  /** Everything that ever arrived — the denominator of "per head placed". */
  intake: number;
  /** The day this batch started, for ordering one batch against the last. */
  startedOn: string | null;
  measuredCents: number;
  measuredQuantities: FeedQuantity[];
  allocatedCents: number;
  allocatedQuantities: FeedQuantity[];
  /** Issues into this lot that carried no price at all — see `unpricedNote`. */
  unpricedMovements: number;
}

export interface FeedLotRow extends FeedLotInput {
  totalCents: number;
  quantities: FeedQuantity[];
  provenance: FeedProvenance;
  /** Null rather than zero when there is nothing to divide by. */
  centsPerHead: number | null;
  centsPerHeadPlaced: number | null;
  /**
   * Difference in cost per head placed against the previous batch of the SAME
   * species. Null when there is no previous batch to compare with — which is
   * every batch on a farm in its first season, and is the cold start the design
   * warns about rather than a fault.
   */
  vsPreviousCents: number | null;
  previousCode: string | null;
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

/**
 * Cost per head, or null.
 *
 * **NULL WHEN NOTHING HAS BEEN FED, NOT ZERO**, and this was found by looking at
 * the screen rather than by a test. A pen with 50 birds and no feed on record
 * rendered "$0.00 a head", which reads as *feeding this batch cost nothing* —
 * the same lie `mortalityRate` refuses when it returns null instead of 0% for a
 * pen no chick has been placed in. "Not known yet" and "free" are different
 * facts and only one of them is ever true here.
 *
 * Feed with no PRICE (spent grain, an invoice not yet in) also lands at zero
 * cents, and that is the same answer for the same reason: nothing on record has
 * a cost, so no cost per head can be stated. `unpricedNote` says what happened.
 */
function perUnit(cents: number, units: number): number | null {
  if (units <= 0 || cents <= 0) return null;
  return Math.round(cents / units);
}

/**
 * The report the broiler enterprise is judged on.
 *
 * **BATCH AGAINST BATCH IS THE POINT, and the comparison is per head PLACED.**
 * Cost per head at today's count moves as birds die, which makes a bad batch
 * look cheaper the worse it goes; cost per head placed is what was spent to
 * attempt each bird, and it is the figure that answers "was this batch better
 * than the last one". Both are on the row, and the comparison uses the second.
 *
 * Batches are compared within a species and in date order, because comparing a
 * pen of broilers against a steer is arithmetic rather than information.
 */
export function feedReportRows(lots: FeedLotInput[]): FeedLotRow[] {
  const rows: FeedLotRow[] = lots.map((lot) => {
    const totalCents = lot.measuredCents + lot.allocatedCents;
    return {
      ...lot,
      totalCents,
      quantities: mergeQuantities([
        ...lot.measuredQuantities,
        ...lot.allocatedQuantities,
      ]),
      provenance: provenanceOf(lot.measuredCents, lot.allocatedCents),
      centsPerHead: perUnit(totalCents, lot.head),
      centsPerHeadPlaced: perUnit(totalCents, lot.intake),
      vsPreviousCents: null,
      previousCode: null,
    };
  });

  const bySpecies = new Map<string, FeedLotRow[]>();
  for (const row of rows) {
    const list = bySpecies.get(row.species);
    if (list) list.push(row);
    else bySpecies.set(row.species, [row]);
  }
  for (const list of bySpecies.values()) {
    // Oldest first, so "previous" means the batch before this one. A lot with no
    // start date sorts out entirely and is never anybody's previous batch — an
    // unknown date cannot establish an order, and guessing one would make the
    // delta a comparison against an arbitrary row.
    const ordered = [...list]
      .filter((row) => row.startedOn !== null)
      .sort((a, b) =>
        a.startedOn === b.startedOn
          ? a.code < b.code
            ? -1
            : 1
          : a.startedOn! < b.startedOn!
            ? -1
            : 1,
      );
    for (let i = 0; i < ordered.length; i++) {
      const current = ordered[i];
      if (current.centsPerHeadPlaced === null) continue;
      /**
       * **THE PREVIOUS BATCH HAS TO BE PREVIOUS, AND IT HAS TO HAVE BEEN FED.**
       * Both halves came from driving this screen, where two pens started on the
       * same day and one of them had no feed recorded: the other was handed a
       * "+$1.00 vs last batch" that compared it against nothing at all.
       *
       * So: strictly earlier, because two batches placed the same day are
       * contemporaries rather than a sequence; and with a cost per head of its
       * own, because a batch nobody has recorded feed for is not a baseline.
       */
      for (let j = i - 1; j >= 0; j--) {
        const candidate = ordered[j];
        if (candidate.startedOn === current.startedOn) continue;
        if (candidate.centsPerHeadPlaced === null) continue;
        current.vsPreviousCents =
          current.centsPerHeadPlaced - candidate.centsPerHeadPlaced;
        current.previousCode = candidate.code;
        break;
      }
    }
  }

  // Newest batch first: the one being fed right now is the one being asked
  // about. Undated lots keep their position at the end.
  return [...rows].sort((a, b) => {
    if (a.startedOn === null && b.startedOn === null) return 0;
    if (a.startedOn === null) return 1;
    if (b.startedOn === null) return -1;
    return a.startedOn < b.startedOn ? 1 : -1;
  });
}

/**
 * What to say about feed that arrived with no price on it.
 *
 * **WASTE STREAMS ARE REAL FEED.** Spent grain from a brewery, surplus milk,
 * garden culls, expired bakery bread — near-zero or odd cost basis, and the
 * design is explicit that *a model that insists every input has a purchase price
 * will be lied to*. So an unpriced issue is carried through the report at zero
 * cents and COUNTED, rather than refused at entry or quietly treated as free.
 *
 * The distinction the ledger already makes and this preserves: a cost of ZERO
 * means somebody said it was free, and NULL means nobody has said. Both feed the
 * animals; only one of them is a fact about money.
 */
export function unpricedNote(count: number): string | null {
  if (count <= 0) return null;
  return count === 1
    ? "1 entry carried no price — spent grain, surplus milk and windfalls are real feed with no invoice, so they count as fed and not as spent."
    : `${count} entries carried no price — spent grain, surplus milk and windfalls are real feed with no invoice, so they count as fed and not as spent.`;
}
