/**
 * The carcass stage. PURE — one type import from `yield.ts`, no database.
 *
 * **THIS FILE SPLITS ONE HONEST NUMBER INTO THE TWO A BUTCHER ARGUES ABOUT.**
 * Slice 0 could say packaged over live and deliberately said no more, because
 * telling **dressing percentage** (live → hanging) from **cutting yield**
 * (hanging → packaged) needs the carcass recorded as a stage of its own. The
 * kill sheet is that stage, and these are its ratios.
 *
 * **AND IT IS WHERE A CONDEMNATION FINALLY HAS SOMEWHERE HONEST TO GO.** The
 * reason slice 0 refused to model one is worth restating, because it is the
 * whole argument for the shape of this file: a condemned-head COUNT would make
 * the head reconcile while leaving the condemned animal's live weight sitting in
 * the denominator, and taking it out with an average is the unauditable fudge
 * this pack refuses everywhere else. So the adjustment happens exactly one way
 * — by summing only the animals that PASSED, on both sides of the ratio — and
 * that is possible only when the plant weighed them. When it did not, the
 * denominator keeps the condemned animals in it, the ratio reads low, and
 * `includesCondemned` makes the screen say so rather than let a low number look
 * like a bad kill.
 *
 * **EVERY REFUSAL HERE IS THE SAME RULE `yield.ts` ESTABLISHED**: a ratio over
 * part of the animals is not approximately right, it is confidently wrong in a
 * stated direction. The new one worth knowing is `SHEET_INCOMPLETE` — sixty
 * birds transcribed off a sheet of a hundred gives a cutting yield well over
 * 100%, because the boxes are all there and the carcasses are not.
 */
import type { WeighedRow } from "./yield";

/**
 * One line of the kill sheet.
 *
 * A LINE IS NOT ALWAYS AN ANIMAL. `headCount` is 1 for a beef, where the sheet
 * really is per animal with a tag on it, and 70 for a pen of broilers, where no
 * plant weighs birds one at a time. Weights are TOTALS for the line either way.
 */
export interface CarcassLine {
  key: string;
  /** Which run input these came out of. Every line has one. */
  inputKey: string;
  headCount: number;
  /** Total live weight off the PLANT's scale, or null. Not the farm's. */
  liveLb: number | null;
  /** Total hanging weight, or null. Always null on a condemned line. */
  hangingLb: number | null;
  condemned: boolean;
  /** The plant's stated cause. Empty when the sheet did not give one. */
  reason: string;
}

/**
 * What one input put into the run, for reconciling the sheet against it.
 *
 * `headIn` is null when the input is not COUNTED — a hundred pounds of flour has
 * no head to account for, so no reconciliation is claimed for it. That is a
 * different thing from zero, which would mean a counted input that put nothing
 * in.
 */
export interface SheetInput {
  key: string;
  headIn: number | null;
  /** The FARM's live weight for this input — what left on the trailer. */
  liveLb: number | null;
}

export type StageRefusal =
  | "NO_SHEET"
  | "SHEET_INCOMPLETE"
  | "SHEET_OVER_ACCOUNTED"
  | "ALL_CONDEMNED"
  | "NO_LIVE_WEIGHTS"
  | "NO_HANGING_WEIGHTS"
  | "PARTIAL_HANGING_WEIGHTS"
  | "NO_OUTPUTS"
  | "NO_OUTPUT_WEIGHTS"
  | "PARTIAL_OUTPUT_WEIGHTS";

/**
 * What the screen says instead of a percentage. Sentences, because this is the
 * copy somebody reads when they expected a number — and for a first season the
 * reason is the useful half.
 */
export const STAGE_REFUSALS: Record<StageRefusal, string> = {
  NO_SHEET:
    "No kill sheet has been entered, so there is no carcass between the animal and the box to measure against.",
  SHEET_INCOMPLETE:
    "The kill sheet accounts for fewer head than went in. A ratio over some of the carcasses against all of the boxes reads far better than the run had, so none is given — finish the sheet and it becomes answerable.",
  SHEET_OVER_ACCOUNTED:
    "The kill sheet accounts for more head than went in. One of the two is wrong, and guessing which would put a made-up number where a real one should be.",
  ALL_CONDEMNED:
    "Every carcass on this sheet was condemned. There is no yield to state: the whole of what went in is a loss, which is the number that matters here.",
  NO_LIVE_WEIGHTS:
    "Nothing was weighed live — not on the farm and not at the plant. Dressing percentage is hanging weight over live weight, and head is not a weight.",
  NO_HANGING_WEIGHTS:
    "No carcass has a hanging weight yet. That is the number the plant writes on the sheet, and both ratios need it.",
  PARTIAL_HANGING_WEIGHTS:
    "Some carcasses have no hanging weight. A ratio over part of them would read as a disastrous kill, so none is given.",
  NO_OUTPUTS: "Nothing has come out yet.",
  NO_OUTPUT_WEIGHTS:
    "Nothing that came out was weighed. Anything counted rather than weighed needs its pounds entered, or there is no ratio to state.",
  PARTIAL_OUTPUT_WEIGHTS:
    "Some of what came out was not weighed. A ratio over part of the boxes would read as a disastrous kill, so none is given.",
};

/** Which scale a live weight came off. They disagree, and for a real reason. */
export type LiveSource = "plant" | "farm";

export const LIVE_SOURCE_NOTES: Record<LiveSource, string> = {
  plant:
    "Weighed at the plant, carcass by carcass — so anything condemned is out of both sides of this ratio.",
  farm:
    "Weighed on the farm, because the plant did not weigh them live. Animals lose 3–5% on a trailer, so this reads slightly low against a plant scale.",
};

export interface StageYield {
  /** Pounds on the bottom of the ratio. */
  fromLb: number;
  /** Pounds on the top. */
  toLb: number;
  ratio: number;
}

export interface Dressing extends StageYield {
  liveSource: LiveSource;
  /**
   * TRUE WHEN CONDEMNED ANIMALS ARE STILL IN THE DENOMINATOR. Only ever true on
   * the farm's own weight, which covers everything that left the yard and cannot
   * be split. The ratio is genuinely low and the screen has to say why, or a
   * real condemnation reads as a bad kill forever.
   */
  includesCondemned: boolean;
}

/**
 * A ratio or a reason, and never neither — the same discriminated shape
 * `YieldResult` uses, so that a caller which handles the answer is forced to
 * have handled the refusal too.
 */
export type DressingResult =
  | { dressing: Dressing; refusedBecause?: undefined }
  | { dressing?: undefined; refusedBecause: StageRefusal };

export type CuttingResult =
  | { cutting: StageYield; refusedBecause?: undefined }
  | { cutting?: undefined; refusedBecause: StageRefusal };

/** Condemned head under one cause. `reason` is empty when the sheet was silent. */
export interface CondemnGroup {
  reason: string;
  head: number;
}

export interface CarcassTally {
  lines: number;
  /** Head the sheet accounts for, passed and condemned together. */
  headOnSheet: number;
  /**
   * Head that went in, over the COUNTED inputs only. Null when no input on the
   * run is counted, in which case nothing can be reconciled and nothing claims
   * to have been.
   */
  headIn: number | null;
  headPassed: number;
  headCondemned: number;
  /**
   * Head in minus head on the sheet. Positive means the sheet is unfinished,
   * negative means it accounts for animals that never went in. Null when there
   * is nothing to reconcile against.
   */
  headUnaccounted: number | null;
  /** Condemned head by cause, largest first. Leads the screen — see below. */
  byReason: CondemnGroup[];
  /** Condemned head the sheet gave no cause for. Counted, never invented. */
  headCondemnedUnstated: number;
  /** Condemned head over head on the sheet, or null when the sheet is empty. */
  condemnRate: number | null;
}

function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function sum(values: Array<number | null>): number {
  return round(values.reduce<number>((total, v) => total + (v ?? 0), 0));
}

/**
 * Count the sheet up.
 *
 * **THE GROUPING BY CAUSE IS THE POINT, NOT A GARNISH.** `inventory` learned
 * this on its adjustment screen and it is truer here: three birds condemned is a
 * number, and three birds condemned for airsacculitis two batches running is
 * something to do something about. The cause is a diagnostic, and it is the
 * reason this returns groups rather than a total.
 */
export function tallyCarcasses(
  lines: CarcassLine[],
  inputs: SheetInput[],
): CarcassTally {
  const counted = inputs.filter((i) => i.headIn !== null);
  const headIn =
    counted.length === 0 ? null : sum(counted.map((i) => i.headIn));

  let headPassed = 0;
  let headCondemned = 0;
  let headCondemnedUnstated = 0;
  const byReason = new Map<string, number>();

  for (const line of lines) {
    if (line.condemned) {
      headCondemned += line.headCount;
      const reason = line.reason.trim();
      if (reason === "") headCondemnedUnstated += line.headCount;
      // The unstated ones group together under an empty key rather than being
      // dropped. A cause nobody wrote down is still a condemnation, and hiding
      // it from the grouping would make the causes add up to less than the
      // count beside them.
      byReason.set(reason, (byReason.get(reason) ?? 0) + line.headCount);
    } else {
      headPassed += line.headCount;
    }
  }

  const headOnSheet = headPassed + headCondemned;

  return {
    lines: lines.length,
    headOnSheet,
    headIn,
    headPassed,
    headCondemned,
    headUnaccounted: headIn === null ? null : round(headIn - headOnSheet),
    byReason: [...byReason.entries()]
      .map(([reason, head]) => ({ reason, head }))
      // Largest first; an unstated cause never outranks a named one at the same
      // count, because a name is the actionable half. Fully ordered rather than
      // left to the sort's tie-breaking, so the same sheet always reads the same
      // way round.
      .sort((a, b) => {
        if (b.head !== a.head) return b.head - a.head;
        const aUnstated = a.reason === "";
        const bUnstated = b.reason === "";
        if (aUnstated !== bUnstated) return aUnstated ? 1 : -1;
        return a.reason.localeCompare(b.reason);
      }),
    headCondemnedUnstated,
    condemnRate: headOnSheet === 0 ? null : headCondemned / headOnSheet,
  };
}

/**
 * Everything that stops EITHER ratio being stated, checked in the order a person
 * would hit it. Shared, because a sheet that does not reconcile breaks both and
 * saying so twice in two places is how the two answers drift apart.
 */
function sheetRefusal(
  lines: CarcassLine[],
  tally: CarcassTally,
): StageRefusal | null {
  if (lines.length === 0) return "NO_SHEET";
  if (tally.headUnaccounted !== null) {
    if (tally.headUnaccounted > 0) return "SHEET_INCOMPLETE";
    if (tally.headUnaccounted < 0) return "SHEET_OVER_ACCOUNTED";
  }
  if (tally.headPassed === 0) return "ALL_CONDEMNED";
  return null;
}

/** Hanging pounds, and whether every passed carcass has one. */
function hangingOf(lines: CarcassLine[]): {
  lb: number;
  refusedBecause: StageRefusal | null;
} {
  const passed = lines.filter((l) => !l.condemned);
  const weighed = passed.filter((l) => l.hangingLb !== null);
  if (weighed.length === 0) return { lb: 0, refusedBecause: "NO_HANGING_WEIGHTS" };
  if (weighed.length < passed.length) {
    return { lb: 0, refusedBecause: "PARTIAL_HANGING_WEIGHTS" };
  }
  return { lb: sum(weighed.map((l) => l.hangingLb)), refusedBecause: null };
}

/**
 * DRESSING PERCENTAGE — hanging over live, and the ratio the condemnation
 * question actually turns on.
 *
 * **THE DENOMINATOR IS CHOSEN, NOT COMBINED.** The plant's scale and the farm's
 * are two measurements of the same animals taken hours apart, and shrink makes
 * them differ by a few percent for a real reason — so they are never added and
 * never averaged. The plant's wins when it covers every carcass that passed,
 * because then and only then can the condemned animals be left out of both
 * sides. Otherwise the farm's stands, with everything that left the yard in it.
 *
 * That is the same call `land` made about a declared acreage against a measured
 * one: report both, prefer the one that answers the question, never overwrite.
 */
export function dressingPercentage(
  lines: CarcassLine[],
  inputs: SheetInput[],
  tally: CarcassTally,
): DressingResult {
  const blocked = sheetRefusal(lines, tally);
  if (blocked) return { refusedBecause: blocked };

  const hanging = hangingOf(lines);
  if (hanging.refusedBecause) return { refusedBecause: hanging.refusedBecause };

  const passed = lines.filter((l) => !l.condemned);
  const plantWeighed = passed.every((l) => l.liveLb !== null);

  let liveLb: number;
  let liveSource: LiveSource;
  let includesCondemned: boolean;

  if (plantWeighed) {
    liveLb = sum(passed.map((l) => l.liveLb));
    liveSource = "plant";
    includesCondemned = false;
  } else {
    // Only the inputs this sheet actually covers. A run whose second pen has no
    // carcass lines at all is already refused above as an incomplete sheet, so
    // by here the covered set is the whole set.
    const covered = new Set(lines.map((l) => l.inputKey));
    const farmRows = inputs.filter(
      (i) => covered.has(i.key) && i.liveLb !== null,
    );
    if (farmRows.length === 0) return { refusedBecause: "NO_LIVE_WEIGHTS" };
    liveLb = sum(farmRows.map((i) => i.liveLb));
    liveSource = "farm";
    // The farm's ticket weighed everything that left, condemned animals
    // included, and no per-animal weight exists to take them back out.
    includesCondemned = tally.headCondemned > 0;
  }

  if (liveLb <= 0) return { refusedBecause: "NO_LIVE_WEIGHTS" };

  return {
    dressing: {
      fromLb: liveLb,
      toLb: hanging.lb,
      ratio: hanging.lb / liveLb,
      liveSource,
      includesCondemned,
    },
  };
}

/**
 * CUTTING YIELD — packaged over hanging. What the cutting room did with the
 * carcass, with the animal's own conformation taken out of it.
 *
 * No condemnation caveat is needed on this one and that is not an oversight: a
 * condemned carcass never hangs, so it is absent from the denominator by
 * construction rather than by adjustment. The sheet still has to reconcile,
 * though — sixty birds' carcasses under a hundred birds' boxes reads as a yield
 * over 100%, which is the loudest possible way to be wrong.
 */
export function cuttingYield(
  lines: CarcassLine[],
  outputs: WeighedRow[],
  tally: CarcassTally,
): CuttingResult {
  const blocked = sheetRefusal(lines, tally);
  if (blocked) return { refusedBecause: blocked };

  const hanging = hangingOf(lines);
  if (hanging.refusedBecause) return { refusedBecause: hanging.refusedBecause };
  if (hanging.lb <= 0) return { refusedBecause: "NO_HANGING_WEIGHTS" };

  if (outputs.length === 0) return { refusedBecause: "NO_OUTPUTS" };
  const weighed = outputs.filter((r) => r.lb !== null);
  if (weighed.length === 0) return { refusedBecause: "NO_OUTPUT_WEIGHTS" };
  if (weighed.length < outputs.length) {
    return { refusedBecause: "PARTIAL_OUTPUT_WEIGHTS" };
  }

  const outLb = sum(weighed.map((r) => r.lb));
  return {
    cutting: { fromLb: hanging.lb, toLb: outLb, ratio: outLb / hanging.lb },
  };
}

/** "3 of 100 head (3.0%)". The condemnation line, written once. */
export function formatCondemned(tally: CarcassTally): string {
  if (tally.headCondemned === 0) return "None condemned";
  const rate =
    tally.condemnRate === null ? "" : ` (${(tally.condemnRate * 100).toFixed(1)}%)`;
  return `${tally.headCondemned} of ${tally.headOnSheet} head condemned${rate}`;
}

/** A cause, or the honest word for not having one. Never "Unknown" as a cause. */
export function reasonLabel(reason: string): string {
  return reason.trim() === "" ? "No cause given on the sheet" : reason;
}
