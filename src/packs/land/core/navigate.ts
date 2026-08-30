/**
 * Walking to a point you drew. PURE — no map, no database, and **no
 * `navigator`**: the geolocation lives in the component, the decisions live
 * here, the same split `survey.ts` uses.
 *
 * **THIS IS THE PAYOFF THE WHOLE OF 2b WAS BUILT FOR** (founder, 2026-08-29,
 * asking for the layout in the first place): *"out in the field, you click on
 * the start of a paddock and using GPS it directs you until you are standing
 * right in the right spot to set the posts and wire for the paddock."* Without
 * it a layout is a picture. With it the plan reaches the ground.
 *
 * **AND IT ONLY WORKS BECAUSE THE TARGET WAS WALKED, NOT TRACED.** A line
 * traced off aerial imagery and a position read from a phone are wrong
 * INDEPENDENTLY, so their errors add — five to ten metres, which is a visible
 * dogleg in a fence run. The same phone walking a line and later navigating
 * back to it is wrong in much the same direction twice, and most of that
 * cancels. Navigating to a TRACED point is still offered, because recording
 * what is already there is what tracing is for, but it is the weaker case and
 * `arrival` below does not pretend otherwise.
 */
import { haversineM, type FeatureGeometry, type Position } from "./geo";

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;
const toDegrees = (radians: number): number => (radians * 180) / Math.PI;

/**
 * The initial great-circle bearing from one point to another, in degrees
 * clockwise from true north.
 *
 * **INITIAL, not constant.** Over a farm the difference is far below the noise;
 * the word is here so nobody later assumes this is a rhumb line and uses it for
 * something long.
 */
export function bearingDegrees(from: Position, to: Position): number {
  const [lon1, lat1] = from;
  const [lon2, lat2] = to;
  const dLon = toRadians(lon2 - lon1);
  const y = Math.sin(dLon) * Math.cos(toRadians(lat2));
  const x =
    Math.cos(toRadians(lat1)) * Math.sin(toRadians(lat2)) -
    Math.sin(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.cos(dLon);
  return (toDegrees(Math.atan2(y, x)) + 360) % 360;
}

const POINTS = [
  "N",
  "NNE",
  "NE",
  "ENE",
  "E",
  "ESE",
  "SE",
  "SSE",
  "S",
  "SSW",
  "SW",
  "WSW",
  "W",
  "WNW",
  "NW",
  "NNW",
] as const;

/**
 * The bearing as somebody would say it out loud.
 *
 * **SIXTEEN POINTS, NOT THIRTY-TWO.** Nobody navigates a field by "north by
 * east"; the compass point is there so a number has a direction attached, and
 * the number is there for anyone who wants it. Finer divisions would imply a
 * precision the person's own sense of where west is does not have.
 */
export function compassPoint(bearing: number): string {
  const normalised = ((bearing % 360) + 360) % 360;
  return POINTS[Math.round(normalised / 22.5) % 16];
}

/**
 * How this is going: nearer than last time, further, or not enough movement to
 * say.
 *
 * **THE DISTANCE COUNTING DOWN IS THE INSTRUMENT, NOT THE BEARING.** A bearing
 * of 271 degrees is only useful if you know which way you are facing, and a
 * phone in a pocket does not reliably know. What always works is walking a few
 * paces and watching the number: it drops, or it climbs and you turned wrong.
 * So this is the feedback loop, and the bearing is support.
 */
export type Progress = "closer" | "further" | "holding";

/**
 * How much change counts as movement rather than the fix wandering.
 *
 * **TWO METRES, WHICH IS UNDER A FIX AND OVER THE JITTER.** A stationary phone
 * reports positions that drift by a metre or so between readings; calling that
 * "further away" would have the arrow flickering while somebody stands still,
 * which reads as the app being broken rather than as the instrument being what
 * it is.
 */
export const PROGRESS_NOISE_M = 2;

export function progressOf(
  previousM: number | null,
  currentM: number,
): Progress {
  if (previousM === null) return "holding";
  const change = previousM - currentM;
  if (Math.abs(change) < PROGRESS_NOISE_M) return "holding";
  return change > 0 ? "closer" : "further";
}

/**
 * Whether you are there — measured against the ACCURACY, not against a fixed
 * distance.
 *
 * **THIS IS THE HONEST LIMIT MADE INTO THE INTERFACE RATHER THAN A FOOTNOTE**
 * (docs/modules/land.md → Navigating to a point): consumer GPS will not
 * reliably close better than about three metres, which is fine for polywire and
 * marginal for a permanent corner post. So "arrived" cannot mean "within some
 * number somebody picked" — it means **the target is inside the circle the
 * phone says it is unsure by.** Standing 4 m away with a +/-6 m fix, the phone
 * genuinely cannot tell you are not on it; standing 4 m away with a +/-2 m fix,
 * it can, and it should.
 *
 * The consequence is deliberate and worth stating: on a bad fix you arrive
 * EARLIER and the screen says so, because the alternative is a countdown that
 * never reaches zero and a person standing in a field being told to keep
 * walking by an instrument that has lost them.
 */
export type Arrival = "arrived" | "close" | "walking";

/**
 * Where "close" starts, as a multiple of the accuracy radius.
 *
 * Two circles: inside one you are there, inside the other you should stop
 * striding and start pacing. A multiple rather than a distance for the same
 * reason as above — under a clean sky it tightens, under a tree line it opens.
 */
export const CLOSE_MULTIPLE = 3;

export function arrival(distanceM: number, accuracyM: number): Arrival {
  // A missing or absurd accuracy is treated as bad rather than as perfect: the
  // failure mode of the other choice is telling somebody they have arrived.
  const radius = Number.isFinite(accuracyM) && accuracyM > 0 ? accuracyM : 50;
  if (distanceM <= radius) return "arrived";
  if (distanceM <= radius * CLOSE_MULTIPLE) return "close";
  return "walking";
}

/**
 * What to say about arriving, in the phone's own terms.
 *
 * **IT NAMES THE UNCERTAINTY RATHER THAN HIDING IT.** "You are here" is a claim
 * the instrument cannot make. "Within 20 ft — as close as the phone can tell
 * today" is one it can, and it is also the sentence that tells somebody whether
 * to drive a corner post or wait for a better sky.
 *
 * **THE RADIUS ARRIVES ALREADY FORMATTED, and that is not fussiness.** The
 * first version wrote the metres in itself, so a farm working in feet read
 * "7 ft" in letters an inch tall and "Within 6 m" underneath it. This file has
 * no business knowing what unit anybody uses — `length.ts` owns that — so the
 * caller passes the words and this passes them on. Caught by driving it.
 */
export function arrivalNote(state: Arrival, radiusLabel: string): string {
  switch (state) {
    case "arrived":
      return `Within ${radiusLabel} — as close as the phone can tell today`;
    case "close":
      return "Close. Slow down and watch the distance";
    case "walking":
      return "Keep going";
  }
}

/**
 * The radius `arrival` judged against, in metres, for the caller to format.
 *
 * The fallback for a missing or absurd accuracy is duplicated from `arrival`
 * deliberately: the note has to describe the circle that was actually used, and
 * two places quietly disagreeing about that is how a screen ends up claiming
 * something the decision underneath it never said.
 */
export function arrivalRadiusM(accuracyM: number): number {
  return Number.isFinite(accuracyM) && accuracyM > 0 ? accuracyM : 50;
}

/** One place you can stand, and what it is part of. */
export interface Target {
  position: Position;
  /** 1-based, in the order the shape was drawn — so "corner 3 of 5" reads. */
  index: number;
  total: number;
}

/**
 * Every point of a shape you could stand on, in the order it was drawn.
 *
 * **THE VERTICES ARE THE POSTS.** That is the whole reason this returns corners
 * rather than a centre or a nearest point: a planned fence's vertices are
 * exactly where somebody has to dig, and walking them in order is how the run
 * gets built. A gate is a single target because a gate is a single post.
 *
 * **A RING'S CLOSING REPEAT IS DROPPED.** GeoJSON requires the last position of
 * a ring to equal the first; walking to it would be telling somebody to go back
 * to the corner they started at, which is both wrong and the kind of thing that
 * makes an app feel like it is not paying attention.
 */
export function targetsOf(geometry: FeatureGeometry): Target[] {
  const positions: Position[] = [];
  const push = (path: Position[], ring: boolean) => {
    const stop = ring && path.length > 1 ? path.length - 1 : path.length;
    for (let i = 0; i < stop; i += 1) positions.push(path[i]);
  };

  switch (geometry.type) {
    case "Point":
      positions.push(geometry.coordinates);
      break;
    case "LineString":
      push(geometry.coordinates, false);
      break;
    case "MultiLineString":
      for (const part of geometry.coordinates) push(part, false);
      break;
    case "Polygon":
      for (const ring of geometry.coordinates) push(ring, true);
      break;
    case "MultiPolygon":
      for (const polygon of geometry.coordinates) {
        for (const ring of polygon) push(ring, true);
      }
      break;
  }

  return positions.map((position, i) => ({
    position,
    index: i + 1,
    total: positions.length,
  }));
}

/**
 * The nearest target to where you are standing, or null for an empty shape.
 *
 * **WHICH CORNER TO OFFER FIRST IS NOT "THE ONE IT WAS DRAWN FIRST".** Somebody
 * opening this is already somewhere, usually at one end of the run, and being
 * sent to the far end because that vertex happens to be index 1 is the app
 * wasting a walk. The order stays available — this only picks where to start.
 */
export function nearestTarget(
  from: Position,
  targets: readonly Target[],
): Target | null {
  let best: Target | null = null;
  let bestM = Infinity;
  for (const target of targets) {
    const distance = haversineM(from, target.position);
    if (distance < bestM) {
      bestM = distance;
      best = target;
    }
  }
  return best;
}
