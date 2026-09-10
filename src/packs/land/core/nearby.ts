/**
 * What is around you, and how far away it is. PURE — no `navigator`, no
 * database, so every decision in it is testable without a browser.
 *
 * **THIS IS THE SCREEN THE 2b DESIGN RANKED HIGHEST AND NEVER BUILT.** The
 * founder's words were *"it auto displays relevant information to whatever is
 * at your location"*, and the design answered it with one line: *"What is near
 * me is the length function above against a fixed radius (100 ft, not a
 * setting). What it shows is the attribute bag: three strands hot, buried
 * electric here, this trough is on the north line."* Everything it needs has
 * been in `geo.ts` since 2b.0; nothing ever asked.
 *
 * **THE FRAME DOES THE GEOMETRY AND HAVERSINE DOES THE ANSWER.** `geo.ts` is
 * explicit that reported figures never come out of the local frame — so the
 * nearest point on a fence is found in the frame, where plane geometry is
 * valid, and then measured back on the sphere. A distance shown on this screen
 * is the same kind of number as a fence's length.
 */

import {
  frameAt,
  fromLocal,
  haversineM,
  nearestOnSegment,
  pointInBoundary,
  toLocal,
  type FeatureGeometry,
  type Position,
} from "./geo";

/**
 * How far "here" reaches: 100 feet, and NOT a setting.
 *
 * The design said so and gave the reason a fixed radius is right — this answers
 * *what am I standing next to*, and a number somebody can turn up until the
 * screen is full stops answering it. It is stored in metres because metres are
 * what the geometry speaks; `formatLength` renders it as `100 ft` or `30 m`
 * according to the tenant's unit, and both describe the same circle.
 */
export const NEARBY_RADIUS_M = 30.48;

export interface Nearby<T> {
  feature: T;
  /** Metres from the fix to the nearest part of it. Zero means you are on it. */
  metres: number;
}

/** Every ring or path in a geometry, as a list of positions to walk. */
function pathsOf(geometry: FeatureGeometry): Position[][] {
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
 * How far a point is from a geometry, in metres.
 *
 * **STANDING INSIDE A BUILDING IS ZERO METRES FROM IT**, not the distance to
 * its nearest wall. An area you are in is a thing you are ON, and reporting
 * "the barn, 4 m" while you are inside the barn is the screen being precise
 * about the wrong question. Lines and points have no inside, so they measure
 * as they read.
 */
export function distanceToGeometryM(
  from: Position,
  geometry: FeatureGeometry,
): number {
  if (geometry.type === "Point") {
    return haversineM(from, geometry.coordinates);
  }
  if (
    (geometry.type === "Polygon" || geometry.type === "MultiPolygon") &&
    pointInBoundary(from, geometry)
  ) {
    return 0;
  }

  // The frame is anchored at the FIX rather than at the shape, so the point we
  // are measuring from is exactly the origin and its own error is not scaled
  // by anything.
  const frame = frameAt(from);
  const here = toLocal(frame, from);
  let best = Infinity;

  for (const path of pathsOf(geometry)) {
    if (path.length === 0) continue;
    if (path.length === 1) {
      best = Math.min(best, haversineM(from, path[0]));
      continue;
    }
    const local = path.map((position) => toLocal(frame, position));
    for (let i = 1; i < local.length; i += 1) {
      const nearest = nearestOnSegment(here, local[i - 1], local[i]);
      // Back to the sphere before measuring. The frame found WHERE; haversine
      // says HOW FAR, which is the number that reaches the screen.
      const metres = haversineM(from, fromLocal(frame, nearest));
      if (metres < best) best = metres;
    }
  }
  return best === Infinity ? Infinity : best;
}

/**
 * What is within `radiusM` of a fix, nearest first.
 *
 * **A FEATURE WITH NO GEOMETRY IS NOT NEAR YOU.** A fence somebody listed and
 * never traced has no position at all, and putting it on this screen would be
 * the app claiming to know where something is because it knows the thing
 * exists.
 *
 * The caller decides which features are eligible; this only measures. That
 * matters for status — a proposal is not on the ground and must never appear
 * here — and keeping the judgement out of this file is what stops it drifting
 * from the reason behind it. See `featuresNear`.
 */
export function nearbyFeatures<T extends { geometry: FeatureGeometry | null }>(
  from: Position,
  features: readonly T[],
  radiusM: number = NEARBY_RADIUS_M,
): Nearby<T>[] {
  const out: Nearby<T>[] = [];
  for (const feature of features) {
    if (!feature.geometry) continue;
    const metres = distanceToGeometryM(from, feature.geometry);
    if (metres <= radiusM) out.push({ feature, metres });
  }
  return out.sort((a, b) => a.metres - b.metres);
}

/**
 * Could anything inside this box be within `radiusM` of the fix?
 *
 * A cheap first pass so the reads that follow are only over ground you could
 * plausibly be standing on. **It is deliberately generous** — a box padded by
 * the radius in both axes over-selects near the corners, and over-selecting
 * costs a distance calculation while under-selecting loses a fence.
 */
export function boxReaches(
  from: Position,
  box: [number, number, number, number],
  radiusM: number = NEARBY_RADIUS_M,
): boolean {
  const [minLon, minLat, maxLon, maxLat] = box;
  const frame = frameAt(from);
  const padLon = radiusM / frame.mPerLon;
  const padLat = radiusM / frame.mPerLat;
  return (
    from[0] >= minLon - padLon &&
    from[0] <= maxLon + padLon &&
    from[1] >= minLat - padLat &&
    from[1] <= maxLat + padLat
  );
}
