/**
 * The ground INSIDE a set of fences. PURE — no map, no database.
 *
 * **THIS IS THE HALF OF "IT CANT LEACK OUT" THAT IS ACTUALLY HARD** (founder,
 * 2026-08-29: "I want to make sure when we auto generate padocks it stays
 * withing the border of the fence").
 *
 * `subdivide` never leaked. It clips every paddock against the polygon it is
 * handed, so a paddock cannot escape it by construction. The leak was in what
 * was handed over: the choices were the PARCEL — the deed line, from the county
 * — or a zone somebody had already drawn. A fence normally sits inside the deed
 * line, sometimes by a road width, so paddocks laid out on the parcel run right
 * through the fence and out the far side. Correct arithmetic on the wrong
 * outline.
 *
 * So this turns fences into ground. It is what `docs/modules/land.md` deferred
 * as fragile, and the reason it was fragile has since been fixed: "hand-traced
 * fences do not meet, so the ring does not close and a flood fill escapes into
 * the rest of the parcel". Fences meet now — `snap.ts` — and a ring that closes
 * is a ring you can divide.
 *
 * **IT IS OFFERED, NEVER IMPOSED.** Every enclosure found here is a suggestion
 * drawn on the map for somebody to look at before dividing it. Nothing is
 * written, no fence is altered, and a farm whose fences do not form a loop
 * simply gets no suggestions rather than a wrong one.
 */
import {
  boundaryAreaAcres,
  frameAt,
  haversineM,
  toLocal,
  type FeatureGeometry,
  type Polygon,
  type Position,
  type XY,
} from "./geo";
import { SNAP_TOLERANCE_M } from "./snap";

/** A fence, or anything else linear that can bound ground. */
export interface FenceRun {
  id: string;
  name: string;
  geometry: FeatureGeometry;
}

export interface Enclosure {
  /** The ground inside, ready to hand to `subdivide`. */
  ring: Polygon;
  /** Which runs bound it, in the order they are walked. May repeat a run. */
  runIds: string[];
  /** Their names, deduplicated, for a label somebody can recognise. */
  names: string[];
  areaAcres: number;
}

/**
 * How many suggestions are worth showing.
 *
 * A farm with a lot of cross-fencing has a lot of loops, and past a handful the
 * list stops being a choice and starts being a search. The biggest are kept
 * because they are the ones people divide — a two-metre triangle where three
 * fences overlap is a rounding artefact, not a field.
 */
export const MAX_ENCLOSURES = 12;

/**
 * The smallest thing worth calling a field.
 *
 * A tenth of an acre is roughly 20 m square. Below that a "loop" is almost
 * always two fences crossing near a gate, and offering to divide it into
 * paddocks would be absurd.
 */
export const MIN_ENCLOSURE_ACRES = 0.1;

/** One continuous run of coordinates, and the feature it came from. */
interface Path {
  runId: string;
  name: string;
  coordinates: Position[];
}

function pathsOf(runs: readonly FenceRun[]): Path[] {
  const paths: Path[] = [];
  for (const run of runs) {
    const parts: Position[][] =
      run.geometry.type === "LineString"
        ? [run.geometry.coordinates]
        : run.geometry.type === "MultiLineString"
          ? run.geometry.coordinates
          : [];
    for (const coordinates of parts) {
      if (coordinates.length >= 2) {
        paths.push({ runId: run.id, name: run.name, coordinates });
      }
    }
  }
  return paths;
}

/**
 * A ring from an ordered chain of positions, closed and cleaned.
 *
 * Consecutive duplicates are dropped: every joint in a chain contributes the
 * same corner twice, once as the end of one run and once as the start of the
 * next, and a repeated position is a zero-length edge that `subdivide`'s
 * clipper has no direction for.
 */
function ringFrom(chain: Position[], toleranceM: number): Position[] | null {
  const cleaned: Position[] = [];
  for (const position of chain) {
    const last = cleaned[cleaned.length - 1];
    if (last && haversineM(last, position) <= toleranceM) continue;
    cleaned.push([position[0], position[1]]);
  }
  while (
    cleaned.length > 1 &&
    haversineM(cleaned[0], cleaned[cleaned.length - 1]) <= toleranceM
  ) {
    cleaned.pop();
  }
  if (cleaned.length < 3) return null;
  return [...cleaned, [cleaned[0][0], cleaned[0][1]] as Position];
}

/** Shoelace in the local frame, to throw out a loop that encloses nothing. */
function planarAreaSqM(ring: Position[]): number {
  if (ring.length < 4) return 0;
  const frame = frameAt(ring[0]);
  const local: XY[] = ring.slice(0, -1).map((p) => toLocal(frame, p));
  let total = 0;
  for (let i = 0, j = local.length - 1; i < local.length; j = i, i += 1) {
    total += (local[j][0] + local[i][0]) * (local[j][1] - local[i][1]);
  }
  return Math.abs(total / 2);
}

function enclosureOf(
  chain: Position[],
  runIds: string[],
  names: string[],
  toleranceM: number,
): Enclosure | null {
  const ring = ringFrom(chain, toleranceM);
  if (!ring) return null;
  if (planarAreaSqM(ring) <= 0) return null;
  const polygon: Polygon = { type: "Polygon", coordinates: [ring] };
  const areaAcres = boundaryAreaAcres(polygon);
  if (areaAcres < MIN_ENCLOSURE_ACRES) return null;
  return {
    ring: polygon,
    runIds,
    names: Array.from(new Set(names)),
    areaAcres,
  };
}

/**
 * Every fence cut at the points where another fence ARRIVES at it.
 *
 * **WITHOUT THIS, A CROSS FENCE DIVIDES NOTHING** — and a cross fence is how
 * anybody splits a field. Its two ends land in the middle of the west and east
 * runs, not at their corners, so as drawn it shares no endpoint with anything
 * and sits in the graph as an island. The loop that gets found is the outside
 * of the whole field, and the two halves the fence plainly makes are invisible.
 *
 * Cutting the west run in two at the point the cross fence meets it gives that
 * point a degree of three, which is what a junction is.
 *
 * **THE SPLIT USES THE ARRIVING FENCE'S OWN COORDINATE**, not the nearest point
 * computed on the run. They are the same place to within the tolerance, and
 * using one of them for both means the two share a position exactly rather than
 * nearly — so the clustering below has nothing to decide.
 */
function splitAtTouches(paths: readonly Path[], toleranceM: number): Path[] {
  const ends: Position[] = [];
  for (const path of paths) {
    ends.push(path.coordinates[0], path.coordinates[path.coordinates.length - 1]);
  }

  const pieces: Path[] = [];
  for (const path of paths) {
    const frame = frameAt(path.coordinates[0]);
    const local = path.coordinates.map((p) => toLocal(frame, p));
    let current: Position[] = [path.coordinates[0]];

    for (let i = 1; i < path.coordinates.length; i += 1) {
      const a = local[i - 1];
      const b = local[i];
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const lengthSq = dx * dx + dy * dy;

      const touches: { t: number; position: Position }[] = [];
      if (lengthSq > 0) {
        for (const end of ends) {
          const e = toLocal(frame, end);
          const t = ((e[0] - a[0]) * dx + (e[1] - a[1]) * dy) / lengthSq;
          // Strictly INSIDE the segment: an end meeting an end is already a
          // shared node and needs no cut.
          if (!(t > 0 && t < 1)) continue;
          const offset = Math.hypot(
            e[0] - (a[0] + t * dx),
            e[1] - (a[1] + t * dy),
          );
          if (offset > toleranceM) continue;
          touches.push({ t, position: end });
        }
      }
      touches.sort((one, other) => one.t - other.t);

      for (const touch of touches) {
        const tail = current[current.length - 1];
        if (haversineM(tail, touch.position) <= toleranceM) continue;
        current.push(touch.position);
        pieces.push({ ...path, coordinates: current });
        current = [touch.position];
      }
      current.push(path.coordinates[i]);
    }

    pieces.push({ ...path, coordinates: current });
  }
  return pieces.filter((piece) => piece.coordinates.length >= 2);
}

/** An edge of the fence graph: a path between two clustered endpoints. */
interface Edge {
  index: number;
  from: number;
  to: number;
  path: Path;
}

/**
 * Every loop the fences make, largest first.
 *
 * **THE TOLERANCE IS THE SAME ONE SNAPPING USES**, deliberately. A fence drawn
 * with snapping on meets its neighbour exactly, so any tolerance would do; the
 * tolerance is what lets fences drawn BEFORE snapping existed — every fence on
 * the plan today — still form loops, as long as their ends were placed within
 * about a GPS fix of each other. Without it this would find nothing on any farm
 * that already has fences on the map, which is all of them.
 */
export function enclosuresFrom(
  runs: readonly FenceRun[],
  toleranceM: number = SNAP_TOLERANCE_M,
): Enclosure[] {
  const paths = splitAtTouches(pathsOf(runs), toleranceM);
  const found: Enclosure[] = [];

  /**
   * Clustered endpoints. Greedy rather than a proper union-find: a farm has
   * tens of fence ends, not thousands, and the joints that matter are either
   * exact (snapped) or within a metre or two of each other.
   */
  const nodes: Position[] = [];
  const nodeAt = (position: Position): number => {
    for (let i = 0; i < nodes.length; i += 1) {
      if (haversineM(nodes[i], position) <= toleranceM) return i;
    }
    nodes.push([position[0], position[1]]);
    return nodes.length - 1;
  };

  const edges: Edge[] = [];
  for (const path of paths) {
    const first = path.coordinates[0];
    const last = path.coordinates[path.coordinates.length - 1];
    /**
     * A run that comes back to itself is already an enclosure — the four
     * corners walked round a field with "close it" ticked, which is exactly
     * what the founder did in the field on 2026-08-28. It never reaches the
     * graph: a self-loop has no two endpoints to find a path between.
     */
    if (haversineM(first, last) <= toleranceM) {
      const enclosure = enclosureOf(
        path.coordinates,
        [path.runId],
        [path.name],
        toleranceM,
      );
      if (enclosure) found.push(enclosure);
      continue;
    }
    edges.push({
      index: edges.length,
      from: nodeAt(first),
      to: nodeAt(last),
      path,
    });
  }

  const adjacency = new Map<number, Edge[]>();
  for (const edge of edges) {
    for (const node of [edge.from, edge.to]) {
      const list = adjacency.get(node);
      if (list) list.push(edge);
      else adjacency.set(node, [edge]);
    }
  }

  /**
   * One loop per edge: the SHORTEST way back to where it started, without
   * using itself.
   *
   * This finds small loops rather than the outline of everything, which is the
   * right bias — a cross-fenced farm's outer perimeter is not a field anybody
   * divides, and the loops inside it are. Loops found more than once (they will
   * be, once per edge that bounds them) are deduplicated by the set of edges
   * that make them.
   */
  const seen = new Set<string>();
  for (const start of edges) {
    const chain = shortestChain(start, adjacency);
    if (!chain) continue;

    const key = chain
      .map((e) => e.index)
      .sort((a, b) => a - b)
      .join(",");
    if (seen.has(key)) continue;
    seen.add(key);

    const walked = walkChain(chain, start.from);
    if (!walked) continue;
    const enclosure = enclosureOf(
      walked,
      chain.map((e) => e.path.runId),
      chain.map((e) => e.path.name),
      toleranceM,
    );
    if (enclosure) found.push(enclosure);
  }

  return found
    .sort((a, b) => b.areaAcres - a.areaAcres)
    .slice(0, MAX_ENCLOSURES);
}

/**
 * The shortest set of edges closing a loop through `start`, or null.
 *
 * Breadth-first by hop count, over the graph with `start` removed, from one of
 * its ends to the other. Hops rather than metres because the question is which
 * fences bound this field, and a field bounded by two long runs is no less a
 * field than one bounded by six short ones.
 */
function shortestChain(
  start: Edge,
  adjacency: Map<number, Edge[]>,
): Edge[] | null {
  const cameBy = new Map<number, Edge>();
  const visited = new Set<number>([start.from]);
  let frontier = [start.from];

  while (frontier.length > 0) {
    const next: number[] = [];
    for (const node of frontier) {
      for (const edge of adjacency.get(node) ?? []) {
        if (edge.index === start.index) continue;
        const other = edge.from === node ? edge.to : edge.from;
        if (visited.has(other)) continue;
        visited.add(other);
        cameBy.set(other, edge);
        if (other === start.to) {
          const chain: Edge[] = [];
          let at = start.to;
          while (at !== start.from) {
            const by = cameBy.get(at);
            if (!by) return null;
            chain.push(by);
            at = by.from === at ? by.to : by.from;
          }
          /**
           * NOT reversed. The walk above steps back from `start.to` towards
           * `start.from`, which is already the order the loop is traversed in
           * once `start` itself has carried you from one end to the other.
           * Reversing it hands `walkChain` a side that does not touch where it
           * is standing, and every loop comes back null.
           */
          return [start, ...chain];
        }
        next.push(other);
      }
    }
    frontier = next;
  }
  return null;
}

/**
 * The chain's coordinates end to end, each run turned the right way round.
 *
 * A fence drawn north-to-south and its neighbour drawn south-to-north still
 * bound the same field; without reversing one of them the ring would double
 * back on itself and enclose nothing.
 */
function walkChain(chain: readonly Edge[], startNode: number): Position[] | null {
  const positions: Position[] = [];
  let at = startNode;
  for (const edge of chain) {
    if (edge.from !== at && edge.to !== at) return null;
    const forwards = edge.from === at;
    const coordinates = forwards
      ? edge.path.coordinates
      : [...edge.path.coordinates].reverse();
    positions.push(...coordinates);
    at = forwards ? edge.to : edge.from;
  }
  return at === startNode ? positions : null;
}
