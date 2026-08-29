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
  pointInBoundary,
  type Boundary,
  type FeatureGeometry,
  type LinearRing,
  type Polygon,
  type Position,
} from "./geo";

/** WGS84 equatorial radius, matching `geo.ts` so areas agree between them. */
const EARTH_RADIUS_M = 6_378_137;
const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

/** Metres east and north of an origin. */
type XY = [number, number];

/**
 * A local flat frame, so the whole algorithm can be plane geometry.
 *
 * **CLIPPING AND AREA-SPLITTING IN DEGREES WOULD BE WRONG BY THE COSINE OF THE
 * LATITUDE** — about 24% at 40°N — so a "square" paddock would come out a
 * quarter wider than it is tall and the equal-area search would divide the
 * wrong quantity. Equirectangular about the shape's own centre is accurate to
 * millimetres across a farm, which is far inside the error of the GPS that
 * placed the corners.
 *
 * The REPORTED acreage still comes from `boundaryAreaAcres`, the spherical one
 * the rest of the pack uses, so a paddock cut here and measured anywhere else
 * agree.
 */
interface Frame {
  lon0: number;
  lat0: number;
  mPerLon: number;
  mPerLat: number;
}

function frameAt(origin: Position): Frame {
  const [lon0, lat0] = origin;
  return {
    lon0,
    lat0,
    mPerLon: (Math.PI / 180) * EARTH_RADIUS_M * Math.cos(toRadians(lat0)),
    mPerLat: (Math.PI / 180) * EARTH_RADIUS_M,
  };
}

function toLocal(frame: Frame, position: Position): XY {
  return [
    (position[0] - frame.lon0) * frame.mPerLon,
    (position[1] - frame.lat0) * frame.mPerLat,
  ];
}

function fromLocal(frame: Frame, point: XY): Position {
  return [
    frame.lon0 + point[0] / frame.mPerLon,
    frame.lat0 + point[1] / frame.mPerLat,
  ];
}

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

export interface Paddock {
  /** 1-based, in order along the lane. */
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
  paddocks: Paddock[];
  /** The dividing lines, in order. `count - 1` of them. */
  cuts: { type: "LineString"; coordinates: Position[] }[];
  /** Things a person should see before committing. Never fatal. */
  warnings: string[];
}

export type SubdivideOutcome =
  | { ok: true; result: SubdivideResult }
  | { ok: false; error: string };

export const MAX_PADDOCKS = 60;

/**
 * Divide `area` into `count` equal-area paddocks, cut across `lane`.
 *
 * Refusals are written for a person, the way `parseBoundary`'s are: this is
 * driven from a form, and "that ground is in two pieces" is a fixable
 * instruction where a thrown error is not.
 */
export function subdivide(
  area: Boundary,
  lane: FeatureGeometry,
  count: number,
): SubdivideOutcome {
  if (!Number.isInteger(count) || count < 2) {
    return { ok: false, error: "Two or more paddocks." };
  }
  if (count > MAX_PADDOCKS) {
    return { ok: false, error: `That is more than ${MAX_PADDOCKS} paddocks.` };
  }
  if (area.type !== "Polygon") {
    // Ground split by a road is two pieces of ground, and equal strips across
    // both of them is not a thing anybody wants.
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

  const project = (p: XY) => p[0] * axis[0] + p[1] * axis[1];
  const ts = ring.map(project);
  const tMin = Math.min(...ts);
  const tMax = Math.max(...ts);
  const total = planarArea(ring);
  if (!(total > 0) || !(tMax > tMin)) {
    return { ok: false, error: "That ground has no area to divide." };
  }

  // n−1 offsets, each placed so the ground behind it is i/n of the whole.
  const offsets: number[] = [];
  for (let i = 1; i < count; i += 1) {
    offsets.push(
      solveOffset(ring, axis, tMin, tMax, (total * i) / count),
    );
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

    const gate = gateFor(laneXY, frame, strip, (bounds[i] + bounds[i + 1]) / 2, axis);
    if (!gate) {
      warnings.push(
        `Paddock ${i + 1} does not touch the lane — the cows cannot get to it.`,
      );
    }
    paddocks.push({
      index: i + 1,
      geometry,
      areaAcres: boundaryAreaAcres(geometry),
      gate,
    });
  }

  for (const offset of offsets) {
    const line = cutLine(ring, axis, offset, frame);
    if (line) cuts.push({ type: "LineString", coordinates: line });
  }

  return { ok: true, result: { paddocks, cuts, warnings } };
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

/**
 * Where this paddock meets the lane, or null if it does not.
 *
 * **THIS IS THE CHECK THAT REPLACED THE CROSSING CHECK.** Parallel cuts cannot
 * cross, but a lane that bends away can still leave a strip with no frontage —
 * and a paddock the cows cannot walk to is the failure this layout exists to
 * prevent. Reported, never corrected: the shape is real and a drag handle is a
 * better answer than a guess.
 */
function gateFor(
  lane: XY[],
  frame: Frame,
  strip: XY[],
  targetT: number,
  axis: XY,
): Position | null {
  const stripRing: LinearRing = closeRing(strip.map((p) => fromLocal(frame, p)));
  const asPolygon: Boundary = { type: "Polygon", coordinates: [stripRing] };

  // Walk the lane for the point nearest the middle of this strip, measured
  // along the cutting axis, and take it only if it is actually inside.
  let best: { point: XY; delta: number } | null = null;
  for (let i = 0; i < lane.length - 1; i += 1) {
    const a = lane[i];
    const b = lane[i + 1];
    for (let s = 0; s <= 10; s += 1) {
      const point: XY = [
        a[0] + (b[0] - a[0]) * (s / 10),
        a[1] + (b[1] - a[1]) * (s / 10),
      ];
      const delta = Math.abs(point[0] * axis[0] + point[1] * axis[1] - targetT);
      if (!best || delta < best.delta) best = { point, delta };
    }
  }
  if (!best) return null;
  const position = fromLocal(frame, best.point);
  return pointInBoundary(position, asPolygon) ? position : null;
}

function closeRing(positions: Position[]): Position[] {
  if (positions.length === 0) return positions;
  const first = positions[0];
  const last = positions[positions.length - 1];
  if (first[0] === last[0] && first[1] === last[1]) return positions;
  return [...positions, [first[0], first[1]] as Position];
}
