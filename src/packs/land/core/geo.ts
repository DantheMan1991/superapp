/**
 * Boundaries: GeoJSON in, acres and containment out. PURE — no imports, no
 * database, no `server-only`.
 *
 * **GeoJSON IN JSONB, MATH IN JS. NO PostGIS.** Settled in the Land category
 * design and worth restating here because it looks like an omission until you
 * count: containment is ray casting, which is trivial for a few hundred
 * polygons, and 10x this farm is still a few hundred. PostGIS would buy
 * indexes nothing here needs and cost a database extension every environment
 * has to carry.
 *
 * Ranked by what the geometry actually buys, from the design:
 *
 *   1. **Point-in-polygon on mobile** — standing in a field, the app knows the
 *      zone and pre-fills it. The largest data-entry win in the pack, and the
 *      least obvious item on the list. `pointInBoundary` is here for it; the
 *      screens that use it are slice 2a.2.
 *   2. **The map** — how a farmer checks the data matches reality (2a.1).
 *   3. **Computed acreage** — modest, because the county already told you. It
 *      is in this slice because it is the only part that needs no map, and
 *      because "you said 10 acres, the boundary says 8.6" is a real finding.
 *   4. **Adjacency** for rotation planning — later, and possibly never.
 *
 * COORDINATES ARE [longitude, latitude], in that order, because that is what
 * GeoJSON says and every tool that will ever paste into this app emits it.
 * It reads backwards to anyone used to saying "lat/long" out loud, which is
 * exactly why it is written here in capitals rather than assumed.
 */

/** `[longitude, latitude]`. Altitude, if a source supplies it, is dropped. */
export type Position = [number, number];
export type LinearRing = Position[];

export interface Polygon {
  type: "Polygon";
  /** Outer ring first; any rings after it are holes. */
  coordinates: LinearRing[];
}

export interface MultiPolygon {
  type: "MultiPolygon";
  coordinates: LinearRing[][];
}

/** What a parcel or a zone stores. Lines and points are slice 2b. */
export type Boundary = Polygon | MultiPolygon;

/** Exact, by definition: 1 international acre = 4046.8564224 m². */
const SQ_M_PER_ACRE = 4046.8564224;

/**
 * WGS84 equatorial radius, in metres — the same figure the GeoJSON tooling
 * ecosystem uses, so a boundary drawn in one tool and measured here agrees with
 * the acreage that tool showed.
 */
const EARTH_RADIUS_M = 6_378_137;

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

// -------------------------------------------------------------- parsing ---

/**
 * A boundary out of whatever somebody pasted.
 *
 * **IT ACCEPTS A FEATURE AND A FEATURECOLLECTION, not just a bare geometry**,
 * because that is what every source actually hands you: geojson.io exports a
 * FeatureCollection, a county GIS download is a FeatureCollection, and telling
 * a farmer to unwrap it by hand is telling him not to bother. A collection with
 * exactly one polygon feature is unambiguous; one with several is refused
 * rather than guessed at.
 *
 * Returns a REASON rather than throwing. The only caller is a paste box, and
 * "that file has 12 shapes in it — paste the one you want" is a fixable
 * instruction where a stack trace is not.
 */
export type ParseResult =
  | { ok: true; boundary: Boundary }
  | { ok: false; error: string };

export function parseBoundary(input: unknown): ParseResult {
  let value = input;
  if (typeof value === "string") {
    const text = value.trim();
    if (!text) return { ok: false, error: "Nothing pasted." };
    try {
      value = JSON.parse(text);
    } catch {
      return { ok: false, error: "That is not valid JSON." };
    }
  }
  if (!value || typeof value !== "object") {
    return { ok: false, error: "That is not GeoJSON." };
  }

  const node = value as Record<string, unknown>;
  if (node.type === "FeatureCollection") {
    const features = Array.isArray(node.features) ? node.features : [];
    const shapes = features.filter(
      (f): f is Record<string, unknown> =>
        Boolean(f) && typeof f === "object" && "geometry" in f,
    );
    if (shapes.length === 0) return { ok: false, error: "That file has no shapes in it." };
    if (shapes.length > 1) {
      return {
        ok: false,
        error: `That file has ${shapes.length} shapes in it. Paste just the one for this boundary.`,
      };
    }
    return parseBoundary(shapes[0].geometry);
  }
  if (node.type === "Feature") return parseBoundary(node.geometry);

  if (node.type === "Polygon" || node.type === "MultiPolygon") {
    return validateBoundary(node);
  }
  if (typeof node.type === "string") {
    // Points and lines are real land features — troughs, fences, lanes — and
    // they are slice 2b. Refusing them by name beats "invalid GeoJSON".
    return {
      ok: false,
      error: `A boundary has to be a Polygon or MultiPolygon. That is a ${node.type}.`,
    };
  }
  return { ok: false, error: "That is not GeoJSON." };
}

function validRing(ring: unknown): ring is LinearRing {
  if (!Array.isArray(ring) || ring.length < 4) return false;
  for (const position of ring) {
    if (!Array.isArray(position) || position.length < 2) return false;
    const [lon, lat] = position;
    if (typeof lon !== "number" || !Number.isFinite(lon)) return false;
    if (typeof lat !== "number" || !Number.isFinite(lat)) return false;
    if (lon < -180 || lon > 180 || lat < -90 || lat > 90) return false;
  }
  const first = ring[0] as number[];
  const last = ring[ring.length - 1] as number[];
  // A ring that does not close is not a ring. Every exporter closes them, so an
  // open one means something was truncated on the way here.
  return first[0] === last[0] && first[1] === last[1];
}

/** Drop altitude and anything after it: `[lon, lat, elevation]` → `[lon, lat]`. */
function toRing(ring: LinearRing): LinearRing {
  return ring.map((p) => [p[0], p[1]] as Position);
}

export function validateBoundary(input: unknown): ParseResult {
  if (!input || typeof input !== "object") {
    return { ok: false, error: "That is not GeoJSON." };
  }
  const node = input as Record<string, unknown>;

  if (node.type === "Polygon") {
    const rings = node.coordinates;
    if (!Array.isArray(rings) || rings.length === 0) {
      return { ok: false, error: "That polygon has no outline." };
    }
    if (!rings.every(validRing)) {
      return {
        ok: false,
        error:
          "That outline is not usable — a boundary needs at least three corners, has to close, and its coordinates have to be longitude then latitude.",
      };
    }
    return {
      ok: true,
      boundary: { type: "Polygon", coordinates: rings.map(toRing) },
    };
  }

  if (node.type === "MultiPolygon") {
    const polygons = node.coordinates;
    if (!Array.isArray(polygons) || polygons.length === 0) {
      return { ok: false, error: "That shape has no outline." };
    }
    const cleaned: LinearRing[][] = [];
    for (const rings of polygons) {
      if (!Array.isArray(rings) || rings.length === 0 || !rings.every(validRing)) {
        return {
          ok: false,
          error:
            "One of those outlines is not usable — each needs at least three corners and has to close.",
        };
      }
      cleaned.push(rings.map(toRing));
    }
    return { ok: true, boundary: { type: "MultiPolygon", coordinates: cleaned } };
  }

  return { ok: false, error: "A boundary has to be a Polygon or MultiPolygon." };
}

/**
 * Is this stored jsonb a boundary this code can read?
 *
 * The column is jsonb with no shape constraint, and rows written by an earlier
 * version of this file — or by hand — must degrade to "no boundary" rather than
 * crashing a page. Same discipline `areaUnitFrom` follows for config.
 */
export function asBoundary(value: unknown): Boundary | null {
  if (value === null || value === undefined) return null;
  const result = validateBoundary(value);
  return result.ok ? result.boundary : null;
}

// ----------------------------------------------------------------- area ---

/**
 * Signed area of one ring, in square metres, by spherical excess.
 *
 * Spherical rather than planar because a planar formula on degrees is wrong by
 * the cosine of the latitude — about 23% at 40°N, which on a 10-acre paddock is
 * over two acres. That is the difference between a computed acreage that
 * corrects the county's figure and one that quietly libels it.
 */
function ringAreaSqM(ring: LinearRing): number {
  if (ring.length < 4) return 0;
  let total = 0;
  for (let i = 0; i < ring.length - 1; i += 1) {
    const [lon1, lat1] = ring[i];
    const [lon2, lat2] = ring[i + 1];
    total +=
      toRadians(lon2 - lon1) *
      (2 + Math.sin(toRadians(lat1)) + Math.sin(toRadians(lat2)));
  }
  return (total * EARTH_RADIUS_M * EARTH_RADIUS_M) / 2;
}

/**
 * Area in square metres. Holes are subtracted.
 *
 * Winding order is IGNORED — the outer ring's magnitude is taken and every
 * later ring in the same polygon is treated as a hole. GeoJSON specifies
 * counter-clockwise outer rings and plenty of real files disagree, so trusting
 * the winding would make a valid boundary measure negative.
 */
export function boundaryAreaSqM(boundary: Boundary): number {
  const polygons =
    boundary.type === "Polygon" ? [boundary.coordinates] : boundary.coordinates;
  let total = 0;
  for (const rings of polygons) {
    if (rings.length === 0) continue;
    let area = Math.abs(ringAreaSqM(rings[0]));
    for (let i = 1; i < rings.length; i += 1) {
      area -= Math.abs(ringAreaSqM(rings[i]));
    }
    total += Math.max(area, 0);
  }
  return total;
}

/** Area in acres, rounded to the column's scale of 4. */
export function boundaryAreaAcres(boundary: Boundary): number {
  return Math.round((boundaryAreaSqM(boundary) / SQ_M_PER_ACRE) * 10_000) / 10_000;
}

// ----------------------------------------------------------- containment ---

/**
 * Ray casting against one ring. Half-open on purpose, so a point on a shared
 * edge belongs to exactly one of two touching paddocks rather than both.
 */
function pointInRing(point: Position, ring: LinearRing): boolean {
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * Is this point inside the boundary? Holes count as outside.
 *
 * **THE 10x FEATURE, AND IT IS THIS SMALL.** Standing in a paddock with a phone
 * that knows where it is, the round and the move dialog can fill the zone in
 * for you. Every other data-entry saving in the pack is a bulk form; this one
 * is the field asking which field it is.
 */
export function pointInBoundary(point: Position, boundary: Boundary): boolean {
  const polygons =
    boundary.type === "Polygon" ? [boundary.coordinates] : boundary.coordinates;
  for (const rings of polygons) {
    if (rings.length === 0) continue;
    if (!pointInRing(point, rings[0])) continue;
    const inHole = rings
      .slice(1)
      .some((hole) => pointInRing(point, hole));
    if (!inHole) return true;
  }
  return false;
}

/** `[west, south, east, north]` — the GeoJSON bbox order, and the map's. */
export type BoundingBox = [number, number, number, number];

export function boundingBox(boundary: Boundary): BoundingBox {
  const polygons =
    boundary.type === "Polygon" ? [boundary.coordinates] : boundary.coordinates;
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const rings of polygons) {
    for (const ring of rings) {
      for (const [lon, lat] of ring) {
        if (lon < west) west = lon;
        if (lon > east) east = lon;
        if (lat < south) south = lat;
        if (lat > north) north = lat;
      }
    }
  }
  return [west, south, east, north];
}

/**
 * A representative point, for a weather lookup.
 *
 * Area-weighted and computed planar, which at farm scale is within metres of
 * the spherical answer. **It can fall OUTSIDE a concave boundary** — a
 * horseshoe-shaped paddock is the classic case — and that is acceptable for its
 * only intended consumer, Open-Meteo's by-lat/long history, where a few hundred
 * metres is far below the resolution of the data. Anything that needs a point
 * genuinely inside the ground must test it with `pointInBoundary`.
 */
export function centroid(boundary: Boundary): Position {
  const polygons =
    boundary.type === "Polygon" ? [boundary.coordinates] : boundary.coordinates;
  let twiceArea = 0;
  let x = 0;
  let y = 0;
  for (const rings of polygons) {
    const ring = rings[0];
    if (!ring || ring.length < 4) continue;
    for (let i = 0; i < ring.length - 1; i += 1) {
      const [x1, y1] = ring[i];
      const [x2, y2] = ring[i + 1];
      const cross = x1 * y2 - x2 * y1;
      twiceArea += cross;
      x += (x1 + x2) * cross;
      y += (y1 + y2) * cross;
    }
  }
  if (twiceArea === 0) {
    // A degenerate or zero-area ring still has to answer. The bounding box
    // centre is the honest fallback rather than NaN.
    const [west, south, east, north] = boundingBox(boundary);
    return [(west + east) / 2, (south + north) / 2];
  }
  return [x / (3 * twiceArea), y / (3 * twiceArea)];
}

// ------------------------------------------------------------ reporting ---

/**
 * The computed acreage against the one somebody typed in.
 *
 * **IT REPORTS, IT NEVER CORRECTS.** The declared figure usually comes from a
 * deed or a county record and is the number the rent and the tax are based on;
 * the drawn one is what the fence actually encloses. They disagree for real
 * reasons — a road easement, a creek, a boundary drawn casually — and deciding
 * which is right is the farmer's call, not this function's. Land's standing
 * rule: report the difference, never enforce it.
 *
 * `null` for either side means there is nothing to compare, which is not the
 * same as agreement.
 */
export interface AreaComparison {
  declaredAcres: number | null;
  computedAcres: number | null;
  /** Computed minus declared. Null unless both are known. */
  differenceAcres: number | null;
  /** |difference| ÷ declared. Null unless both are known and declared is non-zero. */
  differenceFraction: number | null;
}

export function compareArea(
  declaredAcres: number | null,
  boundary: Boundary | null,
): AreaComparison {
  const computedAcres = boundary ? boundaryAreaAcres(boundary) : null;
  if (declaredAcres === null || computedAcres === null) {
    return {
      declaredAcres,
      computedAcres,
      differenceAcres: null,
      differenceFraction: null,
    };
  }
  const differenceAcres =
    Math.round((computedAcres - declaredAcres) * 10_000) / 10_000;
  return {
    declaredAcres,
    computedAcres,
    differenceAcres,
    differenceFraction:
      declaredAcres === 0 ? null : Math.abs(differenceAcres) / declaredAcres,
  };
}

/**
 * How far apart the two figures have to be before it is worth a word on screen.
 *
 * 5% is deliberately loose. A boundary traced off aerial imagery by hand is
 * good to a few percent at best, and a screen that nags about every 2% would
 * teach people to ignore it — which is the same failure the daily round's
 * streak was shaped to avoid.
 */
export const AREA_DISAGREEMENT_THRESHOLD = 0.05;

export function areaDisagrees(comparison: AreaComparison): boolean {
  return (
    comparison.differenceFraction !== null &&
    comparison.differenceFraction > AREA_DISAGREEMENT_THRESHOLD
  );
}
