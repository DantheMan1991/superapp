/**
 * WHAT AN ANIMAL IS MADE OF, AND WHO MADE IT — pure, no database, no clock.
 *
 * Two jobs, and they are really one: walk the dam and the sire upward, and fold
 * what is found there into a breed composition. Slice 4a.
 *
 * **THE RULE THIS FILE EXISTS TO KEEP: AN UNKNOWN PARENT IS HALF THE ANIMAL,
 * NOT NOTHING.** A calf out of a purebred Angus dam by a bull nobody recorded is
 * **half Angus and half unknown** — it is not "Angus", and it is not "100%
 * Angus". Renormalising the known half up to a whole is the single most tempting
 * bug in a pedigree fold, it is what makes a herd look purer on paper with every
 * generation, and it is why `unknownParts` is carried in the result type rather
 * than dropped at the end. Same discipline as the withdrawal clock: the absence
 * of a fact is never read as the most convenient value.
 *
 * **PARTS, NOT PERCENTAGES.** Everything here is exact integer arithmetic over a
 * common denominator — see `livestock_breed_parts` for why. Halving stays exact
 * however deep the pedigree goes, so a great-grandsire contributes an eighth
 * rather than 12.5% of something that no longer adds up to a hundred.
 *
 * **NOTHING HERE IS STORED.** A composition is a fold over the pedigree, as the
 * head count is a fold over movements and FCR is a fold over weighings. A stored
 * one stops agreeing with its own inputs the first time somebody corrects a
 * grandparent — which they will, because that correction is exactly what arrives
 * when the papers turn up in a drawer.
 */

/** One stated component of an animal's breeding. */
export type BreedPart = {
  /** Slug, `^[a-z][a-z0-9_]{0,62}$`. The pack names no breeds; profiles do. */
  breed: string;
  /** Out of the sum of its siblings. `1` beside a `1` is a half. */
  parts: number;
};

/** Everything the fold needs to know about one animal. */
export type PedigreeNode = {
  id: string;
  damLotId: string | null;
  sireLotId: string | null;
  /** What somebody TYPED for this animal. Empty means nobody has. */
  stated: BreedPart[];
};

/** Animals by id. Assembled by `ops.pedigreeIndex`, which bounds the load. */
export type PedigreeIndex = Map<string, PedigreeNode>;

/**
 * How the answer was reached, and it belongs beside the answer.
 *
 * Same reasoning as the feed report's measured-versus-allocated badge and the
 * weight's tape-versus-scale one: two figures that look identical on screen and
 * carry different confidence have to say which they are.
 */
export type CompositionSource = "stated" | "computed" | "unknown";

export type Composition = {
  /** Sorted by share, largest first, then by slug so the order is stable. */
  parts: BreedPart[];
  /** The share nothing on file can name. NEVER folded away — see the header. */
  unknownParts: number;
  /** `parts` and `unknownParts` sum to exactly this. */
  denominator: number;
  source: CompositionSource;
  /**
   * The walk stopped at `MAX_GENERATIONS`, at a node the index did not carry,
   * or on a loop — rather than at a genuine gap in the records. The share it
   * could not reach is inside `unknownParts`, and a screen showing an unknown
   * share owes the reader this distinction: "nobody knows" and "we stopped
   * looking" are different sentences.
   */
  truncated: boolean;
};

/**
 * How far up a composition walks before it gives up.
 *
 * Ten is far past anything a homestead has on file — the pilot has two — and it
 * exists so that a pedigree somebody has managed to loop terminates rather than
 * hangs. The write path refuses loops outright (`isAncestor`); this is the
 * backstop that does not depend on that having worked.
 */
export const MAX_GENERATIONS = 10;

const UNKNOWN: Composition = {
  parts: [],
  unknownParts: 1,
  denominator: 1,
  source: "unknown",
  truncated: false,
};

function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y) {
    const next = x % y;
    x = y;
    y = next;
  }
  return x || 1;
}

function lcm(a: number, b: number): number {
  return (a / gcd(a, b)) * b;
}

/** Largest share first, then by slug — a stable order for a screen. */
function sortParts(parts: BreedPart[]): BreedPart[] {
  return [...parts].sort(
    (a, b) => b.parts - a.parts || a.breed.localeCompare(b.breed),
  );
}

/**
 * Reduce a composition to its smallest exact statement: 2:2 becomes 1:1.
 *
 * Every combine reduces, which is what keeps denominators small enough to stay
 * exact in a double however deep the walk goes.
 */
function reduce(
  parts: BreedPart[],
  unknownParts: number,
  denominator: number,
  source: CompositionSource,
  truncated: boolean,
): Composition {
  const kept = parts.filter((p) => p.parts > 0);
  let divisor = denominator;
  for (const p of kept) divisor = gcd(divisor, p.parts);
  if (unknownParts > 0) divisor = gcd(divisor, unknownParts);
  return {
    parts: sortParts(kept.map((p) => ({ ...p, parts: p.parts / divisor }))),
    unknownParts: unknownParts / divisor,
    denominator: denominator / divisor,
    source,
    truncated,
  };
}

/**
 * A typed-in composition, cleaned up: duplicates merged, non-positive dropped,
 * then reduced.
 *
 * Duplicates cannot reach here from the database — there is a unique index on
 * (lot, breed) — but they can reach here from a form, and merging them is the
 * only non-destructive answer.
 */
export function statedComposition(stated: BreedPart[]): Composition | null {
  const merged = new Map<string, number>();
  for (const part of stated) {
    if (!Number.isFinite(part.parts) || part.parts <= 0) continue;
    merged.set(part.breed, (merged.get(part.breed) ?? 0) + part.parts);
  }
  if (merged.size === 0) return null;
  const parts = [...merged].map(([breed, count]) => ({ breed, parts: count }));
  const denominator = parts.reduce((sum, p) => sum + p.parts, 0);
  return reduce(parts, 0, denominator, "stated", false);
}

/**
 * Fold two parents into their offspring: **half from each, always.**
 *
 * The halves are what makes this exact. Each parent is scaled to a common
 * denominator D and the child's denominator is 2D, so the dam contributes D of
 * it and the sire contributes D — whatever either is internally made of, and
 * whether or not either is mostly unknown.
 */
export function combine(dam: Composition, sire: Composition): Composition {
  const common = lcm(dam.denominator, sire.denominator);
  const damScale = common / dam.denominator;
  const sireScale = common / sire.denominator;

  const totals = new Map<string, number>();
  for (const p of dam.parts) {
    totals.set(p.breed, (totals.get(p.breed) ?? 0) + p.parts * damScale);
  }
  for (const p of sire.parts) {
    totals.set(p.breed, (totals.get(p.breed) ?? 0) + p.parts * sireScale);
  }
  const unknown = dam.unknownParts * damScale + sire.unknownParts * sireScale;

  return reduce(
    [...totals].map(([breed, parts]) => ({ breed, parts })),
    unknown,
    common * 2,
    "computed",
    dam.truncated || sire.truncated,
  );
}

/**
 * What this animal is made of.
 *
 * **A STATED COMPOSITION WINS.** Papers in a drawer outrank the app's
 * arithmetic, and somebody who types one is telling it something it did not
 * know — a registered purebred whose great-grandsire is missing from the app is
 * still a purebred. The computed answer is what you get when nobody has said.
 */
export function resolveComposition(
  lotId: string,
  index: PedigreeIndex,
): Composition {
  return resolveWith(lotId, index, 0, new Set());
}

function resolveWith(
  lotId: string,
  index: PedigreeIndex,
  depth: number,
  path: Set<string>,
): Composition {
  const node = index.get(lotId);
  // Missing from the index means the load stopped before reaching it, not that
  // the animal has no breeding — so this is a truncation, and it says so.
  if (!node) return { ...UNKNOWN, truncated: true };

  const stated = statedComposition(node.stated);
  if (stated) return stated;

  if (!node.damLotId && !node.sireLotId) return UNKNOWN;
  // A loop is impossible through the write path, and terminates here anyway.
  if (depth >= MAX_GENERATIONS || path.has(lotId)) {
    return { ...UNKNOWN, truncated: true };
  }

  const walked = new Set(path).add(lotId);
  const dam = node.damLotId
    ? resolveWith(node.damLotId, index, depth + 1, walked)
    : UNKNOWN;
  const sire = node.sireLotId
    ? resolveWith(node.sireLotId, index, depth + 1, walked)
    : UNKNOWN;

  const combined = combine(dam, sire);
  // Half of nothing and half of nothing is still nothing, and calling that
  // "computed" would dress an empty answer up as a worked-out one.
  return combined.parts.length === 0
    ? { ...UNKNOWN, truncated: combined.truncated }
    : combined;
}

/**
 * Is `candidate` an ancestor of `lotId`? **The write-time loop guard.**
 *
 * Setting a cow's dam to her own granddaughter makes a pedigree that cannot be
 * walked, and a CHECK constraint cannot see other rows — so this runs before the
 * write, exactly as `inventory`'s split does for lot lineage.
 */
export function isAncestor(
  candidate: string,
  lotId: string,
  index: PedigreeIndex,
): boolean {
  const seen = new Set<string>();
  const queue = [lotId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (seen.has(current)) continue;
    seen.add(current);
    const node = index.get(current);
    if (!node) continue;
    for (const parent of [node.damLotId, node.sireLotId]) {
      if (!parent) continue;
      if (parent === candidate) return true;
      queue.push(parent);
    }
  }
  return false;
}

/** One animal in a rendered pedigree. A null child means the tree stops. */
export type AncestorNode = {
  id: string;
  dam: AncestorNode | null;
  sire: AncestorNode | null;
};

/**
 * The pedigree as a tree, `generations` deep, for a screen to render.
 *
 * A null child means the tree stops there — either because nothing was recorded
 * or because the depth ran out. A screen showing this must not present those two
 * as the same thing, which is why the depth is the caller's number.
 */
export function ancestorTree(
  lotId: string,
  index: PedigreeIndex,
  generations: number,
): AncestorNode {
  const node = index.get(lotId);
  if (!node || generations <= 0) return { id: lotId, dam: null, sire: null };
  return {
    id: lotId,
    dam: node.damLotId
      ? ancestorTree(node.damLotId, index, generations - 1)
      : null,
    sire: node.sireLotId
      ? ancestorTree(node.sireLotId, index, generations - 1)
      : null,
  };
}

const VULGAR: Record<string, string> = {
  "1/2": "½",
  "1/3": "⅓",
  "2/3": "⅔",
  "1/4": "¼",
  "3/4": "¾",
  "1/8": "⅛",
  "3/8": "⅜",
  "5/8": "⅝",
  "7/8": "⅞",
};

/**
 * One share as a person would write it: `½`, `⅜`, `1/16`, `all`.
 *
 * A fraction rather than a percentage because that is how breeding is spoken and
 * written — "a half Angus heifer" — and because the fractions a pedigree
 * produces are exactly the ones that read badly as decimals: an eighth is 12.5%,
 * a sixteenth is 6.25%, and a column of those does not visibly add up.
 */
export function formatShare(parts: number, denominator: number): string {
  if (parts <= 0) return "0";
  if (parts >= denominator) return "all";
  const divisor = gcd(parts, denominator);
  const key = `${parts / divisor}/${denominator / divisor}`;
  return VULGAR[key] ?? key;
}

/**
 * The whole composition on one line: `½ Angus · ¼ Hereford · ¼ Simmental`.
 *
 * **The unknown share is a component like any other**, and prints as one. A line
 * that quietly omitted it would be the renormalising bug this file's header is
 * about, wearing a different hat.
 */
export function formatComposition(
  composition: Composition,
  label: (breed: string) => string,
): string {
  // A whole animal of one breed is just that breed. "all Angus" is what the
  // arithmetic says and not what anybody calls a cow.
  if (composition.parts.length === 1 && composition.unknownParts === 0) {
    return label(composition.parts[0].breed);
  }
  const shown = composition.parts.map(
    (p) => `${formatShare(p.parts, composition.denominator)} ${label(p.breed)}`,
  );
  if (composition.unknownParts > 0) {
    shown.push(
      `${formatShare(composition.unknownParts, composition.denominator)} unknown`,
    );
  }
  return shown.join(" · ");
}

/** Where the figure came from, for the badge beside it. */
export const COMPOSITION_SOURCE_LABELS: Record<CompositionSource, string> = {
  stated: "Recorded",
  computed: "From the parents",
  unknown: "Not recorded",
};

export const COMPOSITION_SOURCE_NOTES: Record<CompositionSource, string> = {
  stated: "Entered for this animal, which is what a set of papers is.",
  computed: "Worked out from the dam and the sire, half from each.",
  unknown: "Nothing entered here, and no parent on file to work it out from.",
};
