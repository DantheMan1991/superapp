/**
 * Dividing ground into paddocks along a lane. PURE — no imports but `geo`, no
 * database, no `server-only`.
 *
 * **"DIVIDE A POLYGON INTO n EFFICIENT PIECES" IS BADLY POSED** — efficient by
 * area, by fence length, or by shape? Those fight each other, and an answer to
 * one is a bad answer to the others. What makes the problem well posed is the
 * lane: **every paddock has to touch it**, because that is how the cows get to
 * water. That single constraint collapses the search to parallel strips cut
 * across the lane — one direction, n−1 cuts, equal area each.
 *
 * EQUAL AREA, settled with the founder. Equal grazing DAYS is what rotational
 * grazing actually wants and it depends on forage, which is the plate-meter
 * treadmill docs/modules/land.md refuses. Equal area is the honest
 * approximation and the drag handle is the escape.
 *
 * **THE CUTS ARE ALL PARALLEL, AND THAT IS A SIMPLIFICATION OF THE DESIGN.**
 * The 2026-08-29 design said to cut perpendicular to the lane's LOCAL direction
 * at each cut point, and to detect the case where two cuts cross on the inside
 * of a bend. Cutting perpendicular to the lane's OVERALL direction instead
 * makes crossing impossible — parallel lines do not cross — so the fiddly case
 * is dissolved rather than detected. What is given up is that on a strongly
 * bent lane a fence meets it at an angle rather than square. That is visible,
 * draggable, and much better than a wedge that is not a paddock.
 *
 * What replaces the crossing check is a REACHABILITY check: every strip is
 * tested for whether the lane actually runs through it, because a bent lane can
 * leave a strip stranded, and a paddock the cows cannot walk to is the one
 * failure this whole layout exists to prevent.
 */
import {
  boundaryAreaAcres,
  fromLocal,
  frameAt,
  geometryLengthM,
  toLocal,
  type Boundary,
  type FeatureGeometry,
  type Frame,
  type Polygon,
  type Position,
  type XY,
} from "./geo";

/** Shoelace. Sign is ignored everywhere here, as `ringAreaSqM` ignores winding. */
function planarArea(ring: XY[]): number {
  let total = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    total += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
  }
  return Math.abs(total / 2);
}

/**
 * Sutherland–Hodgman against a halfplane: keep everything with `dot(p, axis)`
 * on the wanted side of `offset`.
 *
 * A halfplane is convex, which is the condition this algorithm needs of its
 * CLIP region — the subject polygon may be concave. A concave subject can come
 * back with a zero-width bridge where the clip splits it in two; that is a
 * valid ring of the right area and it renders as the two lobes it is. A paddock
 * shaped like that is unusual enough not to be worth a general polygon clipper.
 */
function clipHalfplane(
  ring: XY[],
  axis: XY,
  offset: number,
  keepBelow: boolean,
): XY[] {
  const side = (p: XY) => {
    const t = p[0] * axis[0] + p[1] * axis[1];
    return keepBelow ? offset - t : t - offset;
  };
  const out: XY[] = [];
  for (let i = 0; i < ring.length; i += 1) {
    const current = ring[i];
    const previous = ring[(i - 1 + ring.length) % ring.length];
    const dCurrent = side(current);
    const dPrevious = side(previous);
    if (dCurrent >= 0) {
      if (dPrevious < 0) out.push(crossing(previous, current, dPrevious, dCurrent));
      out.push(current);
    } else if (dPrevious >= 0) {
      out.push(crossing(previous, current, dPrevious, dCurrent));
    }
  }
  return out;
}

/**
 * Where a segment crosses the clip line, from the signed distance at each end.
 *
 * Only ever called when the two distances have opposite signs, so `dFrom -
 * dTo` cannot be zero and the fraction is inside [0, 1].
 */
function crossing(from: XY, to: XY, dFrom: number, dTo: number): XY {
  const t = dFrom / (dFrom - dTo);
  return [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t];
}

/**
 * **THE LANE IS A CORRIDOR, NOT A LINE**, and getting that wrong is the bug
 * this replaced. The first version used the lane only for its DIRECTION, so
 * every dividing fence was drawn straight across it — three fences built
 * through the walkway the cows are supposed to use to reach water. It also
 * recorded a strip that spanned the lane as ONE paddock when it is physically
 * two, with a gate dropped in the middle of it opening onto nothing.
 *
 * So the lane's own ground is clipped OUT first, in every layout. What is left
 * is one side of it or two, and that is the whole of the difference between the
 * two placements below.
 */
export type LanePlacement = "edge" | "split";

export const LANE_PLACEMENTS: readonly LanePlacement[] = ["edge", "split"];

/** A lane wide enough to turn a tractor down, and the default nobody has to think about. */
export const DEFAULT_LANE_WIDTH_M = 5;

export interface Paddock {
  /** 1-based, in order along the lane; the far side continues the numbering. */
  index: number;
  geometry: Polygon;
  /** Spherical, from `boundaryAreaAcres`, so it agrees with every other acreage. */
  areaAcres: number;
  /**
   * Where this paddock meets the lane. **Null means the cows cannot get to
   * it**, which is a warning rather than a refusal — the shape is still a
   * shape, and a drag handle can fix what an algorithm should not guess at.
   */
  gate: Position | null;
}

export interface SubdivideResult {
  placement: LanePlacement;
  paddocks: Paddock[];
  /** The dividing fences, in order. */
  cuts: { type: "LineString"; coordinates: Position[] }[];
  /**
   * The alley's own sides — **fence that did not exist before and has to be
   * built.** One for an edge lane, whose outer side is the perimeter that is
   * already there; two for a lane with ground on both sides.
   */
  laneFences: { type: "LineString"; coordinates: Position[] }[];
  /** Things a person should see before committing. Never fatal. */
  warnings: string[];
}

export type SubdivideOutcome =
  | { ok: true; result: SubdivideResult }
  | { ok: false; error: string };

export const MAX_PADDOCKS = 60;

export interface SubdivideOptions {
  placement: LanePlacement;
  laneWidthM?: number;
}

/**
 * Divide `area` into about `count` equal-area paddocks along `lane`.
 *
 * `edge` puts paddocks on ONE side of the lane — the larger side — and leaves
 * the other out of the rotation. `split` puts them on both, which is why it
 * yields roughly twice as many for one extra run of lane fence.
 *
 * Refusals are written for a person, the way `parseBoundary`'s are: this is
 * driven from a form, and "that ground is in two pieces" is a fixable
 * instruction where a thrown error is not.
 */
export function subdivide(
  area: Boundary,
  lane: FeatureGeometry,
  count: number,
  options: SubdivideOptions = { placement: "split" },
): SubdivideOutcome {
  if (!Number.isInteger(count) || count < 2) {
    return { ok: false, error: "Two or more paddocks." };
  }
  if (count > MAX_PADDOCKS) {
    return { ok: false, error: `That is more than ${MAX_PADDOCKS} paddocks.` };
  }
  if (area.type !== "Polygon") {
    return {
      ok: false,
      error: "That ground is in more than one piece. Divide each piece on its own.",
    };
  }
  if (area.coordinates.length > 1) {
    return {
      ok: false,
      error: "That ground has a hole in it, which this cannot divide yet.",
    };
  }
  const outer = area.coordinates[0];
  if (!outer || outer.length < 4) {
    return { ok: false, error: "That ground has no usable outline." };
  }

  const lanePositions = laneLine(lane);
  if (!lanePositions) {
    return { ok: false, error: "Pick a lane to divide along." };
  }

  const frame = frameAt(outer[0]);
  // The ring WITHOUT its closing repeat: the clipper walks edges by wrapping,
  // and a duplicated last vertex would give it a zero-length edge to cross.
  const ring: XY[] = outer.slice(0, -1).map((p) => toLocal(frame, p));
  const laneXY: XY[] = lanePositions.map((p) => toLocal(frame, p));

  const axis = laneAxis(laneXY);
  if (!axis) {
    return { ok: false, error: "That lane is too short to divide along." };
  }
  /** Perpendicular to the lane: the direction the corridor has width in. */
  const across: XY = [-axis[1], axis[0]];
  const half = Math.max(0.5, (options.laneWidthM ?? DEFAULT_LANE_WIDTH_M) / 2);

  /**
   * Where the lane sits, measured across itself.
   *
   * The MEAN of its points, consistent with taking the overall direction: a
   * bent lane has no single offset, and averaging keeps the corridor centred
   * on the run rather than on whichever end happened to be first.
   */
  const laneOffset =
    laneXY.reduce((sum, p) => sum + p[0] * across[0] + p[1] * across[1], 0) /
    laneXY.length;

  /**
   * How far the lane actually RUNS, measured along itself.
   *
   * **THE CORRIDOR IS CLIPPED WITH AN INFINITE LINE, SO THIS IS THE ONLY THING
   * THAT KNOWS THE LANE ENDS.** Without it a lane covering the bottom fifth of
   * a field would hand every paddock a gate onto a stretch of "lane fence"
   * with no lane behind it — which is exactly the paddock-you-cannot-reach
   * that the warning exists for.
   */
  const laneTs = laneXY.map((p) => p[0] * axis[0] + p[1] * axis[1]);
  const laneRange: [number, number] = [
    Math.min(...laneTs),
    Math.max(...laneTs),
  ];

  // The ground either side of the corridor. Either may come back empty, which
  // is what an edge lane looks like from here.
  const sides: { ring: XY[]; area: number; sign: 1 | -1 }[] = [];
  for (const sign of [-1, 1] as const) {
    const clipped =
      sign === -1
        ? clipHalfplane(ring, across, laneOffset - half, true)
        : clipHalfplane(ring, across, laneOffset + half, false);
    if (clipped.length >= 3) {
      const size = planarArea(clipped);
      if (size > 0) sides.push({ ring: clipped, area: size, sign });
    }
  }
  if (sides.length === 0) {
    return {
      ok: false,
      error: "That lane covers the whole of that ground. Check the lane width.",
    };
  }

  sides.sort((a, b) => b.area - a.area);
  const used = options.placement === "edge" ? sides.slice(0, 1) : sides;

  // `split` divides each side, so the count asked for is shared between them.
  const perSide =
    used.length > 1 ? Math.max(1, Math.round(count / used.length)) : count;
  if (perSide < 1) return { ok: false, error: "Two or more paddocks." };

  const paddocks: Paddock[] = [];
  const cuts: SubdivideResult["cuts"] = [];
  const warnings: string[] = [];

  for (const side of used) {
    const outcome = stripsOf(side.ring, axis, across, perSide, frame, {
      laneAt: laneOffset + side.sign * half,
      laneRange,
      startIndex: paddocks.length + 1,
    });
    if (!outcome.ok) return outcome;
    paddocks.push(...outcome.paddocks);
    cuts.push(...outcome.cuts);
    warnings.push(...outcome.warnings);
  }

  /**
   * The alley's sides. **Only for ground that is actually being used**: an edge
   * lane needs the one fence between it and the paddocks, because its far side
   * is the perimeter that is already there.
   */
  const laneFences: SubdivideResult["laneFences"] = [];
  for (const side of used) {
    const line = cutLine(ring, across, laneOffset + side.sign * half, frame);
    if (line) laneFences.push({ type: "LineString", coordinates: line });
  }

  if (options.placement === "edge" && sides.length > 1) {
    const left = sides[1];
    warnings.push(
      `The ground on the far side of the lane (about ${
        Math.round((left.area / 4046.8564224) * 10) / 10
      } acres) is not in these paddocks.`,
    );
  }

  return {
    ok: true,
    result: { placement: options.placement, paddocks, cuts, laneFences, warnings },
  };
}

/** Equal-area strips of one side of the lane, cut across it. */
function stripsOf(
  ring: XY[],
  axis: XY,
  across: XY,
  count: number,
  frame: Frame,
  context: { laneAt: number; laneRange: [number, number]; startIndex: number },
):
  | { ok: true; paddocks: Paddock[]; cuts: SubdivideResult["cuts"]; warnings: string[] }
  | { ok: false; error: string } {
  const ts = ring.map((p) => p[0] * axis[0] + p[1] * axis[1]);
  const tMin = Math.min(...ts);
  const tMax = Math.max(...ts);
  const total = planarArea(ring);
  if (!(total > 0) || !(tMax > tMin)) {
    return { ok: false, error: "That ground has no area to divide." };
  }

  const offsets: number[] = [];
  for (let i = 1; i < count; i += 1) {
    offsets.push(solveOffset(ring, axis, tMin, tMax, (total * i) / count));
  }
  const bounds = [tMin, ...offsets, tMax];

  const paddocks: Paddock[] = [];
  const cuts: SubdivideResult["cuts"] = [];
  const warnings: string[] = [];

  for (let i = 0; i < count; i += 1) {
    let strip = clipHalfplane(ring, axis, bounds[i], false);
    strip = clipHalfplane(strip, axis, bounds[i + 1], true);
    if (strip.length < 3) {
      return {
        ok: false,
        error:
          "That came out with an empty paddock. Try fewer, or a lane that crosses the ground.",
      };
    }
    const positions = strip.map((p) => fromLocal(frame, p));
    const geometry: Polygon = {
      type: "Polygon",
      coordinates: [closeRing(positions)],
    };

    /**
     * The gate goes ON THE LANE FENCE, at the middle of this paddock's
     * frontage — not somewhere in its interior, which is what the previous
     * version produced when a strip spanned the lane.
     */
    const midT = (bounds[i] + bounds[i + 1]) / 2;
    const onFence: XY = [
      axis[0] * midT + across[0] * context.laneAt,
      axis[1] * midT + across[1] * context.laneAt,
    ];
    const gatePosition = fromLocal(frame, onFence);
    const index = context.startIndex + i;
    /**
     * Reachable means BOTH: the gate sits on this paddock's own frontage, and
     * the lane actually runs past that point. The first is generous by a metre
     * because a gate a hair outside the ring is still the right spot; the
     * second is what catches a lane that stops short.
     */
    const withinLane =
      midT >= context.laneRange[0] && midT <= context.laneRange[1];
    const reachable = withinLane && nearRing(onFence, strip, 1);
    if (!reachable) {
      warnings.push(
        `Paddock ${index} does not touch the lane — the cows cannot get to it.`,
      );
    }

    paddocks.push({
      index,
      geometry,
      areaAcres: boundaryAreaAcres(geometry),
      gate: reachable ? gatePosition : null,
    });
  }

  for (const offset of offsets) {
    const line = cutLine(ring, axis, offset, frame);
    if (line) cuts.push({ type: "LineString", coordinates: line });
  }

  return { ok: true, paddocks, cuts, warnings };
}

/** Inside the ring, or within `slack` metres of its edge. */
function nearRing(point: XY, ring: XY[], slack: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (
      yi > point[1] !== yj > point[1] &&
      point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi) + xi
    ) {
      inside = !inside;
    }
  }
  if (inside) return true;
  for (let i = 0; i < ring.length; i += 1) {
    if (segmentDistance(point, ring[i], ring[(i + 1) % ring.length]) <= slack) {
      return true;
    }
  }
  return false;
}

function segmentDistance(point: XY, a: XY, b: XY): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return Math.hypot(point[0] - a[0], point[1] - a[1]);
  let t = ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / lengthSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(point[0] - (a[0] + t * dx), point[1] - (a[1] + t * dy));
}

/**
 * What each placement would cost, so a person can choose rather than be told.
 *
 * **BOTH LAYOUTS GIVE THE PADDOCK COUNT YOU ASKED FOR**, which is what makes
 * them comparable at all: the difference is how much GROUND those paddocks
 * cover and how much fence it takes. An edge lane off the middle of a field
 * leaves the far side out of the rotation entirely; a split lane puts paddocks
 * on both sides, so each one is about twice the size.
 *
 * **THE NUMBER THAT DECIDES IT IS FENCE PER ACRE.** Total fence always
 * favours whichever layout does less, and acres always favour whichever does
 * more; the ratio is the only one of the three that says which is the better
 * deal — and it is usually `split`, because the second run of lane fence buys
 * a whole extra side of the field.
 */
export interface LayoutOption {
  placement: LanePlacement;
  paddockCount: number;
  /** New fence to build: dividers plus the alley's own sides. */
  fenceM: number;
  acresInPaddocks: number;
  acresPerPaddock: number;
  fencePerAcreM: number;
  warnings: string[];
}

export function compareLayouts(
  area: Boundary,
  lane: FeatureGeometry,
  count: number,
  laneWidthM: number = DEFAULT_LANE_WIDTH_M,
): LayoutOption[] {
  const options: LayoutOption[] = [];
  for (const placement of LANE_PLACEMENTS) {
    const outcome = subdivide(area, lane, count, { placement, laneWidthM });
    if (!outcome.ok) continue;
    const { paddocks, cuts, laneFences, warnings } = outcome.result;
    const fenceM = [...cuts, ...laneFences].reduce(
      (sum, line) => sum + geometryLengthM(line),
      0,
    );
    const acres = paddocks.reduce((sum, p) => sum + p.areaAcres, 0);
    options.push({
      placement,
      paddockCount: paddocks.length,
      fenceM,
      acresInPaddocks: Math.round(acres * 10_000) / 10_000,
      acresPerPaddock:
        paddocks.length > 0 ? Math.round((acres / paddocks.length) * 100) / 100 : 0,
      fencePerAcreM: acres > 0 ? fenceM / acres : 0,
      warnings,
    });
  }
  return options;
}


/** The lane's positions, whatever line-ish geometry it arrived as. */
function laneLine(lane: FeatureGeometry): Position[] | null {
  if (lane.type === "LineString") return lane.coordinates;
  if (lane.type === "MultiLineString") {
    // The longest run, by vertex count — a lane recorded in two stretches is
    // still one lane, and its overall direction is what this needs.
    const longest = [...lane.coordinates].sort((a, b) => b.length - a.length)[0];
    return longest ?? null;
  }
  return null;
}

/**
 * The direction to cut ACROSS, from the lane's overall run.
 *
 * First point to last, not a fitted line: a lane that bends still goes
 * somewhere, and where it ends up is what "across" means to the person who
 * walked it.
 */
function laneAxis(lane: XY[]): XY | null {
  const from = lane[0];
  const to = lane[lane.length - 1];
  if (!from || !to) return null;
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const length = Math.hypot(dx, dy);
  if (length < 1) return null;
  return [dx / length, dy / length];
}

/**
 * Binary search the offset where the ground behind the cut is `target`.
 *
 * Area behind a sweeping line is monotonic in the offset, so bisection cannot
 * get stuck; sixty steps is far past the precision of anything that placed
 * these coordinates.
 */
function solveOffset(
  ring: XY[],
  axis: XY,
  low: number,
  high: number,
  target: number,
): number {
  let lo = low;
  let hi = high;
  for (let step = 0; step < 60; step += 1) {
    const mid = (lo + hi) / 2;
    const behind = planarArea(clipHalfplane(ring, axis, mid, true));
    if (behind < target) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** The dividing fence: where the cut line crosses the outline. */
function cutLine(
  ring: XY[],
  axis: XY,
  offset: number,
  frame: Frame,
): Position[] | null {
  const hits: XY[] = [];
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const da = a[0] * axis[0] + a[1] * axis[1] - offset;
    const db = b[0] * axis[0] + b[1] * axis[1] - offset;
    if (da === 0) hits.push(a);
    else if (da * db < 0) {
      const t = da / (da - db);
      hits.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  if (hits.length < 2) return null;
  // The two furthest apart ALONG THE CUT, so a concave outline crossed four
  // times still yields the full span rather than one lobe of it.
  const across: XY = [-axis[1], axis[0]];
  const sorted = [...hits].sort(
    (p, q) => p[0] * across[0] + p[1] * across[1] - (q[0] * across[0] + q[1] * across[1]),
  );
  return [
    fromLocal(frame, sorted[0]),
    fromLocal(frame, sorted[sorted.length - 1]),
  ];
}

function closeRing(positions: Position[]): Position[] {
  if (positions.length === 0) return positions;
  const first = positions[0];
  const last = positions[positions.length - 1];
  if (first[0] === last[0] && first[1] === last[1]) return positions;
  return [...positions, [first[0], first[1]] as Position];
}
