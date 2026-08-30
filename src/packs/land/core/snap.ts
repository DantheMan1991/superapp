/**
 * Making a line MEET the line it is drawn against. PURE — no map, no
 * database, no `navigator`.
 *
 * **WHY THIS EXISTS** (asked for on 2026-08-29, in these words: "we need to
 * create snap so that when i build a lane that goes from one end of a fence to
 * the other it actually connects"). Two lines that look joined on a screen are
 * usually metres apart in the data. That gap is invisible at the zoom somebody
 * draws at and fatal to everything downstream:
 *
 * - **A lane that stops short of the fence** leaves the corridor `subdivide`
 *   clips out ending in mid-field, so the paddock at that end gets a gate onto
 *   nothing.
 * - **Fence runs that do not touch** never form a ring, so there is no
 *   "inside these fences" for `enclosuresFrom` to find, and the ground you can
 *   divide stays the deed line instead of the fence.
 *
 * Snapping is therefore not a drawing nicety. It is the thing that turns a
 * picture of a farm into a graph of one.
 *
 * **IT MOVES A POINT, IT DOES NOT JOIN TWO ROWS.** A snapped endpoint is stored
 * as a coordinate that happens to be identical to one on another feature. There
 * is no shared-vertex table, no cascade when the fence is redrawn, and moving
 * the fence later does not drag the lane with it. That is a deliberate
 * shallowness: the alternative is topology maintenance, which is a CAD suite,
 * which is the thing the site plan is explicitly not.
 */
import {
  frameAt,
  haversineM,
  toLocal,
  type FeatureGeometry,
  type Position,
  type XY,
} from "./geo";

/** Something already on the plan that a new point may land on. */
export interface SnapCandidate {
  id: string;
  name: string;
  geometry: FeatureGeometry;
}

/**
 * What a point landed on.
 *
 * The distinction is worth keeping because it is what the person is told: "the
 * end of West Fence" is a different reassurance from "West Fence", and the
 * second one is the one that ought to make somebody look twice at where they
 * are standing.
 */
export type SnapKind = "vertex" | "edge";

export interface SnapHit {
  /** Where the point should actually go — ON the candidate, exactly. */
  position: Position;
  kind: SnapKind;
  id: string;
  name: string;
  /** How far the point moved, metres. Reported, never hidden. */
  distanceM: number;
}

/**
 * How close is close enough, walking.
 *
 * **FIVE METRES, WHICH IS ABOUT ONE GPS FIX.** A phone in the open is good to
 * roughly that, so a person standing genuinely AT the corner post reads as
 * somewhere within five metres of it and should snap. Much tighter and
 * standing at the post fails to connect, which is the whole complaint. Much
 * looser and a lane deliberately started five paces off the fence gets dragged
 * onto it.
 */
export const SNAP_TOLERANCE_M = 5;

/**
 * How close is close enough, tapping — in SCREEN PIXELS, not metres.
 *
 * A tap tolerance in metres is wrong in both directions: zoomed out, five
 * metres is a fraction of a pixel and nothing ever snaps; zoomed in, it is half
 * the screen and everything does. Fingers and mice are wrong by a roughly
 * constant number of pixels at any zoom, so the tolerance is too. The component
 * converts this to metres against the current view.
 */
export const SNAP_TOLERANCE_PX = 14;

/** Every position in a geometry, flattened. Rings keep their closing repeat. */
function positionsOf(geometry: FeatureGeometry): Position[][] {
  switch (geometry.type) {
    case "Point":
      return [[geometry.coordinates]];
    case "LineString":
      return [geometry.coordinates];
    case "MultiLineString":
      return geometry.coordinates;
    case "Polygon":
      return geometry.coordinates;
    case "MultiPolygon":
      return geometry.coordinates.flat();
  }
}

/**
 * The nearest point ON a segment to a point beside it, in the local frame.
 *
 * Clamped to the segment: past either end the answer is that end, which is what
 * makes a point beyond the top of a fence snap to its corner rather than to an
 * imaginary continuation of the run.
 */
function nearestOnSegment(point: XY, a: XY, b: XY): XY {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return a;
  const t = ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / lengthSq;
  const clamped = Math.max(0, Math.min(1, t));
  return [a[0] + clamped * dx, a[1] + clamped * dy];
}

/**
 * Where a point ought to go, given what is already drawn.
 *
 * Returns null when nothing is within `toleranceM`, and the caller then keeps
 * the position it already had. **NOTHING IS EVER REFUSED FOR NOT SNAPPING** — a
 * fence genuinely ending in the middle of a field is a real fence.
 *
 * **A CORNER OUTRANKS A RUN**, even a nearer one. Somebody bringing a lane up
 * to the top of a fence means the END of it, and for most of that approach the
 * fence's last few metres are closer to them than its endpoint is. Nearest-wins
 * would join the lane a metre short of the corner every time and leave a stub —
 * which is the gap this whole file exists to close.
 *
 * The candidate list is the caller's business: it must not include the feature
 * being drawn (a line would snap to its own last vertex and never advance), and
 * it is worth including points, because a gate is exactly the thing you want a
 * lane to arrive at.
 */
export function snapPosition(
  position: Position,
  candidates: readonly SnapCandidate[],
  toleranceM: number = SNAP_TOLERANCE_M,
): SnapHit | null {
  if (!(toleranceM > 0)) return null;
  /**
   * One frame for the whole search, centred on the point being placed. Every
   * candidate is either within tolerance of it or irrelevant, so the projection
   * error over that distance is nothing.
   */
  const frame = frameAt(position);
  const here = toLocal(frame, position);

  let best: SnapHit | null = null;
  const better = (hit: SnapHit): boolean => {
    if (!best) return true;
    if (hit.kind !== best.kind) return hit.kind === "vertex";
    return hit.distanceM < best.distanceM;
  };

  for (const candidate of candidates) {
    for (const path of positionsOf(candidate.geometry)) {
      if (path.length === 0) continue;
      const local = path.map((p) => toLocal(frame, p));

      for (let i = 0; i < path.length; i += 1) {
        const distanceM = Math.hypot(
          local[i][0] - here[0],
          local[i][1] - here[1],
        );
        if (distanceM > toleranceM) continue;
        const hit: SnapHit = {
          position: [path[i][0], path[i][1]],
          kind: "vertex",
          id: candidate.id,
          name: candidate.name,
          distanceM,
        };
        if (better(hit)) best = hit;
      }

      for (let i = 1; i < path.length; i += 1) {
        const nearest = nearestOnSegment(here, local[i - 1], local[i]);
        const distanceM = Math.hypot(nearest[0] - here[0], nearest[1] - here[1]);
        if (distanceM > toleranceM) continue;
        /**
         * Back to degrees along the SEGMENT rather than through the frame: the
         * frame is only as good as its linearisation, and interpolating between
         * the real coordinates keeps the snapped point exactly on the drawn
         * line even if the frame is a hair off. A point that is ON the line is
         * the entire product here, so it is worth the extra step.
         */
        const a = path[i - 1];
        const b = path[i];
        const segmentM = Math.hypot(
          local[i][0] - local[i - 1][0],
          local[i][1] - local[i - 1][1],
        );
        const t =
          segmentM === 0
            ? 0
            : Math.hypot(
                nearest[0] - local[i - 1][0],
                nearest[1] - local[i - 1][1],
              ) / segmentM;
        const hit: SnapHit = {
          position: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t],
          kind: "edge",
          id: candidate.id,
          name: candidate.name,
          distanceM,
        };
        if (better(hit)) best = hit;
      }
    }
  }

  return best;
}

/**
 * What to tell somebody whose point just moved, or null when nothing snapped.
 *
 * **SNAPPING IS ANNOUNCED, NEVER SILENT.** A point that jumps four metres
 * without explanation reads as the app losing the tap; the same jump labelled
 * "Joined to the end of West Fence" reads as the app doing its job. It is also
 * the only way to notice it joined the WRONG fence, which is something only the
 * person standing there can catch.
 */
export function snapLabel(hit: SnapHit | null): string | null {
  if (!hit) return null;
  return hit.kind === "vertex"
    ? `Joined to the end of ${hit.name}`
    : `Joined to ${hit.name}`;
}

/**
 * How far apart two positions are, for a caller that has one already.
 *
 * Re-exported here rather than reached for from `geo` directly so a component
 * asking "did this move, and how far" has one import alongside the snap it is
 * asking about.
 */
export function movedM(from: Position, to: Position): number {
  return haversineM(from, to);
}
