/**
 * Walking a shape onto the map. PURE — no imports except types, no database,
 * no `server-only`, and **no `navigator`**: this file must be testable without
 * a browser, which is the whole reason the geolocation lives in the component
 * and the decisions live here.
 *
 * **WHY THIS EXISTS AT ALL** (docs/modules/land.md → The paddock layout): a
 * line traced off aerial imagery and a position read from a phone are wrong
 * INDEPENDENTLY, so their errors add — five to ten metres, which is a visible
 * dogleg in a fence run. A line WALKED with the phone and later navigated back
 * to with the same phone is wrong in much the same direction twice, so most of
 * that cancels. Tracing stays right for recording what is already there;
 * walking is for anything you intend to BUILD.
 *
 * CORNERS, NOT A TRACK. A recorded track eats battery, captures every wobble in
 * a walk and has to be simplified afterwards anyway. A fence has corners, and
 * the person walking it knows where they are.
 */
import { haversineM } from "./geo";
import type { FeatureGeometry, GeometryShape, Position } from "./geo";

/**
 * One point somebody stood on, with how well the phone knew where that was.
 *
 * **THE ACCURACY IS STORED WITH THE POINT, NOT SHOWN AND FORGOTTEN.** It is
 * what decides whether a vertex is worth keeping, and a point dropped under a
 * tree line at ±20 m is a different fact from one dropped in the open at ±3 m.
 * The geometry column has nowhere to put it, so it lives only as long as the
 * walk — but for that time every decision below can see it.
 */
export interface WalkPoint {
  position: Position;
  /** Metres, as `GeolocationCoordinates.accuracy` reports it: a 95% radius. */
  accuracyM: number;
}

/**
 * How good is good enough.
 *
 * **BANDS, NOT A THRESHOLD, BECAUSE NOTHING HERE IS EVER REFUSED FOR BEING
 * INACCURATE.** Under a tree line ±15 m may be the best the phone will ever
 * give, and an app that refuses the point leaves the fence unrecorded rather
 * than recorded imprecisely. So this reports and colours; the person decides.
 * The same rule `compareArea` follows for a disagreeing acreage.
 *
 * The boundaries are the honest ones for consumer hardware: about 5 m is what a
 * phone gives in the open, 10 m is a usable but visible error on a fence line,
 * and past 20 m you are placing a post in the wrong paddock.
 */
export type AccuracyBand = "good" | "fair" | "poor";

export const ACCURACY_GOOD_M = 5;
export const ACCURACY_FAIR_M = 20;

export function accuracyBand(accuracyM: number): AccuracyBand {
  if (!Number.isFinite(accuracyM) || accuracyM > ACCURACY_FAIR_M) return "poor";
  return accuracyM <= ACCURACY_GOOD_M ? "good" : "fair";
}

/**
 * The distance below which a second tap is a MIS-TAP rather than a corner.
 *
 * A fence corner is metres from the last one. Two points a few centimetres
 * apart are a double tap, or somebody shifting their weight — and they produce
 * a zero-length segment that measures nothing and renders as a kink.
 *
 * **ONE METRE, WHICH IS DELIBERATELY BELOW THE ACCURACY OF THE INSTRUMENT.**
 * A larger guard would start refusing real corners on a tight jog around a
 * gatepost; the point here is only to catch the tap that was never meant.
 */
export const MIN_POINT_SPACING_M = 1;

/**
 * Would this be a second tap on the corner just placed?
 *
 * Only ever checked against the LAST point, never the whole set: walking a
 * dogleg back past an earlier corner is a real thing a fence does, and a
 * nearest-of-all check would refuse it.
 */
export function tooCloseToLast(
  points: readonly WalkPoint[],
  position: Position,
): boolean {
  const last = points[points.length - 1];
  if (!last) return false;
  return haversineM(last.position, position) < MIN_POINT_SPACING_M;
}

/**
 * How many points a shape needs before it can be saved.
 *
 * A ring needs THREE distinct corners — the fourth position in the stored
 * geometry is the closing repeat, which `closeRing` adds rather than asking
 * somebody to walk back to where they started and tap again.
 */
export const MIN_POINTS: Record<GeometryShape, number> = {
  point: 1,
  line: 2,
  area: 3,
};

export function hasEnoughPoints(
  points: readonly WalkPoint[],
  shape: GeometryShape,
): boolean {
  return points.length >= MIN_POINTS[shape];
}

/** What still has to happen before Save does anything. */
export function pointsNeeded(
  points: readonly WalkPoint[],
  shape: GeometryShape,
): number {
  return Math.max(0, MIN_POINTS[shape] - points.length);
}

/**
 * A ring that closes, from corners that do not.
 *
 * GeoJSON requires the first and last position of a ring to be identical, and
 * `validateFeatureGeometry` enforces it. Nobody walks back to their starting
 * corner to tap it a second time, so the repeat is added here.
 */
function closeRing(positions: Position[]): Position[] {
  if (positions.length === 0) return positions;
  const first = positions[0];
  const last = positions[positions.length - 1];
  if (first[0] === last[0] && first[1] === last[1]) return positions;
  return [...positions, [first[0], first[1]] as Position];
}

/**
 * Can this walk be closed into a loop?
 *
 * **ONLY A LINE, AND ONLY WITH THREE CORNERS.** An area closes itself already.
 * A two-corner line "closed" is A→B→A: a fence walked out and back along its
 * own length, which is not a loop and would double every figure counted off it.
 */
export function canClose(
  points: readonly WalkPoint[],
  shape: GeometryShape,
): boolean {
  return shape === "line" && points.length >= 3;
}

/**
 * The walked corners as geometry the rest of the pack already understands.
 *
 * **THE SAME SHAPES THE MAP DRAWS**, so everything downstream — the length
 * readout, `validateFeatureGeometry`, the save action, the symbology — is
 * reached by exactly one path whichever way the points were placed. Walk mode
 * is an INPUT MODE, not a second kind of feature, and this function is the
 * whole of what makes that true.
 *
 * Returns null rather than a half-built shape when there are not enough
 * corners: a one-point "line" is the thing `validateFeatureGeometry` refuses,
 * and producing it here just to have it rejected later would put the error
 * message a long way from the person who could fix it.
 */
export function walkToGeometry(
  points: readonly WalkPoint[],
  shape: GeometryShape,
  closed = false,
): FeatureGeometry | null {
  if (!hasEnoughPoints(points, shape)) return null;
  const positions = points.map((p) => [p.position[0], p.position[1]] as Position);

  if (shape === "point") {
    return { type: "Point", coordinates: positions[0] };
  }
  if (shape === "line") {
    /**
     * **FOUR CORNERS ARE THREE SIDES UNLESS YOU SAY OTHERWISE**, which is what
     * a fence walked round a field found the hard way. The closing side is the
     * one you cannot walk: you would have to arrive back at a corner you have
     * already left, and no two GPS readings of the same spot agree. So it is
     * added from the FIRST point rather than measured — a closed fence meets
     * itself exactly, and pretending otherwise would leave a metre-wide gap in
     * the drawing and in the wire count.
     *
     * It stays a LineString. A ring of fence is a line that happens to come
     * back; making it a Polygon would give it an area nobody asked for and
     * would take its length away from `geometryLengthM`, which is the figure
     * the takeoff buys wire against.
     */
    return {
      type: "LineString",
      coordinates:
        closed && canClose(points, shape) ? closeRing(positions) : positions,
    };
  }
  return { type: "Polygon", coordinates: [closeRing(positions)] };
}

/**
 * The worst accuracy in the set, which is the one that describes the shape.
 *
 * **A SHAPE IS ONLY AS WELL PLACED AS ITS WORST CORNER**, so averaging would
 * flatter a run where three corners were clean and the fourth was taken under
 * a tree. Null for an empty walk, never zero — the `formatArea` rule, because
 * a zero here would read as perfect.
 */
export function worstAccuracyM(points: readonly WalkPoint[]): number | null {
  if (points.length === 0) return null;
  return points.reduce((worst, p) => Math.max(worst, p.accuracyM), 0);
}
