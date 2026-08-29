/**
 * Feature vocabulary and symbology. PURE — no imports except types, no
 * database, no `server-only`.
 *
 * **SYMBOLOGY IS THE SUBSTANCE OF THE SITE PLAN, NOT ITS POLISH.** With the
 * aerial switched off, a plan is only as readable as the difference between one
 * line and another: a tree line has to look like a tree line, a buried service
 * has to look buried, a proposal has to look like a proposal. That is this
 * file, and it is the whole reason the "site plan" is a view of the same
 * objects rather than a second drawing — see docs/modules/land.md.
 *
 * **NOTHING HERE NAMES AN INDUSTRY (ADR 0004).** Every kind below is a feature
 * of PROPERTY: a fence, a gate, a building, a track, a waterline, a buried
 * cable. `trough` and `energizer` are deliberately absent even though the farm
 * this pack was built for wants both — they are agricultural words, and the
 * escape is the same one `DEFAULT_STRUCTURE_KINDS` uses: the kind column is an
 * open taxonomy, and `featureKindsFrom` reads a tenant's own additions out of
 * `packConfig.land.featureKinds`. A kind this file has never heard of renders
 * with the fallback style for its shape and is never refused.
 *
 * COLOURS ARE LITERAL HEX AND NOT DESIGN TOKENS, which looks like a violation
 * and is not: MapLibre paint properties are evaluated inside the map's own
 * renderer and cannot read a CSS custom property. The palette below is picked
 * to sit beside the app's, and the CASING is what makes it work on both
 * backgrounds — see `FeatureStyle.casing`.
 */
import type { GeometryShape } from "./geo";

/**
 * The three states a feature can be in, and the only place status is defined.
 *
 * `planned` and `built` are the split the whole slice turns on: a proposal and
 * a fact are the same shape, and the difference has to survive into every read.
 * `removed` is what a pulled fence becomes, on the same reasoning that makes a
 * sold parcel `retired` rather than deleted.
 */
export const FEATURE_STATUSES = ["planned", "built", "removed"] as const;
export type FeatureStatus = (typeof FEATURE_STATUSES)[number];

export const FEATURE_STATUS_LABELS: Record<FeatureStatus, string> = {
  planned: "Planned",
  built: "Built",
  removed: "Removed",
};

export function isFeatureStatus(value: unknown): value is FeatureStatus {
  return (
    typeof value === "string" &&
    (FEATURE_STATUSES as readonly string[]).includes(value)
  );
}

/** Same format rule as `land_zone_uses.use` and `assets.kind`. Format only, never values. */
export const FEATURE_KIND_FORMAT = /^[a-z][a-z0-9_]{0,62}$/;

export function isValidFeatureKind(kind: string): boolean {
  return FEATURE_KIND_FORMAT.test(kind);
}

/**
 * How a kind is drawn.
 *
 * `casing` is the cartographer's answer to a problem this map genuinely has:
 * **the same line has to read on dark aerial imagery AND on a white plan.** A
 * dark stroke vanishes on the photo, a light one vanishes on the plan, and
 * asking the tenant to pick is asking them to solve it twice. A casing is a
 * wider, contrasting line drawn UNDER the coloured one, so every feature
 * carries its own contrast with it and reads on either background.
 */
export interface FeatureStyle {
  /** The line, the circle, or the fill's outline. */
  color: string;
  /** Drawn under `color` at a greater width. */
  casing: string;
  /** Line width in pixels, before the status modifier. */
  width: number;
  /**
   * `[dash, gap]` in line-widths, or null for solid.
   *
   * DASHING MEANS SOMETHING HERE and is not decoration: a dashed line is one
   * you cannot see standing on the ground. Buried services and the boundaries
   * of a zone are dashed; a fence you can walk up to is solid.
   */
  dash: [number, number] | null;
  /** Fill opacity for an area feature. Zero leaves an outline only. */
  fill: number;
}

export interface FeatureKind {
  kind: string;
  label: string;
  /** What the draw tool offers first. A kind is a HINT, never a constraint — see `shapeFor`. */
  shape: GeometryShape;
  style: FeatureStyle;
}

/**
 * The palette. Named by role rather than by hue so a later change is one edit.
 *
 * **MID-TONE INK WITH A LIGHT HALO, AND THE ORDER MATTERS.** The first version
 * of this file had it the other way round — near-white lines over a dark casing
 * — which read beautifully on the aerial and almost vanished on the plan, where
 * a white line sits on white paper. Found by switching the toggle. A halo is
 * only ever an aid to contrast, so it goes on the side that CAN disappear
 * harmlessly: on the photo the pale halo separates the line from a busy
 * background, and on paper it is invisible and the line carries itself.
 *
 * Every colour below is therefore dark enough to read on paper and saturated
 * enough to read on a green-and-brown photograph.
 */
const HALO = "#ffffff";

const COLORS = {
  built: "#334155",
  structure: "#b45309",
  water: "#0284c7",
  power: "#be123c",
  vegetation: "#15803d",
  access: "#64748b",
} as const;

const line = (
  color: string,
  width: number,
  dash: [number, number] | null = null,
): FeatureStyle => ({ color, casing: HALO, width, dash, fill: 0 });

const area = (color: string, fill = 0.25): FeatureStyle => ({
  color,
  casing: HALO,
  width: 2,
  dash: null,
  fill,
});

const marker = (color: string): FeatureStyle => ({
  color,
  casing: HALO,
  width: 6,
  dash: null,
  fill: 1,
});

/**
 * SUGGESTIONS, NOT A CONSTRAINT — the same arrangement `SUGGESTED_ZONE_USES`
 * has. The database checks the FORMAT of `kind` and never its values.
 *
 * The list is short on purpose. Every entry here is a thing the pack can draw
 * meaningfully and measure; a longer list of words with no distinct symbology
 * would be a picker that makes the plan look the same however carefully it is
 * filled in.
 */
export const SUGGESTED_FEATURE_KINDS: readonly FeatureKind[] = [
  {
    kind: "fence",
    label: "Fence",
    shape: "line",
    style: line(COLORS.built, 2.5),
  },
  {
    kind: "gate",
    label: "Gate",
    shape: "point",
    style: marker(COLORS.built),
  },
  {
    kind: "building",
    label: "Building",
    shape: "area",
    style: area(COLORS.structure, 0.35),
  },
  {
    kind: "lane",
    label: "Lane or drive",
    shape: "line",
    style: line(COLORS.access, 3.5),
  },
  {
    kind: "waterline",
    label: "Waterline",
    // Buried, so dashed — you cannot see it standing on it.
    shape: "line",
    style: line(COLORS.water, 2, [3, 2]),
  },
  {
    kind: "buried_electric",
    label: "Buried electric",
    shape: "line",
    style: line(COLORS.power, 2, [3, 2]),
  },
  {
    kind: "overhead_electric",
    label: "Overhead electric",
    shape: "line",
    style: line(COLORS.power, 2, [6, 3]),
  },
  {
    kind: "tree_line",
    label: "Tree line",
    shape: "line",
    style: line(COLORS.vegetation, 4, [1, 1]),
  },
  {
    kind: "well",
    label: "Well",
    shape: "point",
    style: marker(COLORS.water),
  },
  {
    kind: "hydrant",
    label: "Hydrant",
    shape: "point",
    style: marker(COLORS.water),
  },
  {
    kind: "tank",
    label: "Tank",
    shape: "point",
    style: marker(COLORS.water),
  },
  {
    kind: "culvert",
    label: "Culvert",
    shape: "point",
    style: marker(COLORS.access),
  },
  {
    kind: "pond",
    label: "Pond",
    shape: "area",
    style: area(COLORS.water, 0.4),
  },
  {
    kind: "marker",
    label: "Marker",
    shape: "point",
    style: marker(COLORS.built),
  },
];

/**
 * What an unrecognised kind looks like.
 *
 * **IT HAS TO EXIST AND IT HAS TO BE NEUTRAL.** `kind` is an open taxonomy, so
 * a tenant's own word — or a profile's — arrives here with no entry, and the
 * only wrong answers are throwing and drawing nothing. Same total-by-
 * construction rule `asBoundary` and `areaUnitFrom` follow.
 */
export const FALLBACK_STYLES: Record<GeometryShape, FeatureStyle> = {
  point: marker(COLORS.built),
  line: line(COLORS.built, 2),
  area: area(COLORS.built, 0.15),
};

const BY_KIND = new Map(SUGGESTED_FEATURE_KINDS.map((k) => [k.kind, k]));

export function featureKind(kind: string): FeatureKind | null {
  return BY_KIND.get(kind) ?? null;
}

/** "Buried electric" for a known kind, "Buried electric" for `buried_electric` otherwise. */
export function featureKindLabel(kind: string): string {
  const known = BY_KIND.get(kind);
  if (known) return known.label;
  const words = kind.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * The style for a kind drawn as a given shape.
 *
 * **THE SHAPE ARGUMENT WINS OVER THE KIND'S OWN.** A kind's `shape` is what the
 * draw tool offers first, not a promise: somebody will draw a building as a
 * point because they only know roughly where it is, and a fence as an area
 * because they traced the paddock it encloses. Styling by the kind's declared
 * shape would then ask a fill layer for a line style and render nothing at all.
 */
export function featureStyle(kind: string, shape: GeometryShape): FeatureStyle {
  const known = BY_KIND.get(kind);
  if (!known) return FALLBACK_STYLES[shape];
  // A known kind drawn as something else keeps its colour and borrows the
  // fallback's geometry-appropriate width and fill.
  const base = FALLBACK_STYLES[shape];
  return known.shape === shape
    ? known.style
    : { ...base, color: known.style.color, dash: known.style.dash };
}

/**
 * How status changes the drawing, and it is the one rule the map must never get
 * wrong.
 *
 * A PROPOSAL MUST NEVER LOOK LIKE A FACT. The founder's own use of this is
 * standing in a field being told what is under him; a planned waterline drawn
 * like a built one is the map lying about the ground. So `planned` is drawn
 * dashed and translucent whatever its kind says, and the kind's own dash is
 * overridden rather than combined — two dash patterns multiplied together read
 * as neither.
 *
 * `removed` is dimmed rather than hidden. Hiding it here would mean the map and
 * the list disagree about what exists; the LIST is where a removed feature is
 * filtered out by default, because that is a query, not a paint property.
 */
export interface StatusStyle {
  opacity: number;
  dash: [number, number] | null;
  /** Whether the kind's own dash still applies. False when status forces its own. */
  keepKindDash: boolean;
}

export const STATUS_STYLES: Record<FeatureStatus, StatusStyle> = {
  built: { opacity: 1, dash: null, keepKindDash: true },
  // **A FINE DOT AT ROUGHLY HALF STRENGTH, AND BOTH NUMBERS WERE EARNED.** The
  // first version used [2, 2] at 0.75, which is unmistakable against a solid
  // fence and nearly invisible against a BURIED service — whose kind dash is
  // already [3, 2]. Drawing a proposed buried electric line beside a built one
  // showed two dashed red lines a quarter-opacity apart, which is exactly the
  // confusion the status column exists to prevent, in the one place it matters
  // most. Opacity is the only lever left once colour carries the kind, so it
  // has to be wide enough to survive a dashed kind: half strength, fine dots.
  planned: { opacity: 0.55, dash: [1, 2], keepKindDash: false },
  removed: { opacity: 0.25, dash: [1, 4], keepKindDash: false },
};

/**
 * Feature kinds a tenant has added, from `packConfig.land.featureKinds`.
 *
 * TOTAL BY CONSTRUCTION, like `structureKindsFrom` and `areaUnitFrom`. This is
 * the P5 escape hatch in its config-shaped form: a farm profile contributes
 * `trough` and `energizer` here rather than this pack learning either word.
 *
 * A tenant entry may name a `shape` so the draw tool opens the right tool, and
 * may not restyle anything — colour and dash stay the pack's, because a plan
 * where every tenant's fence is a different colour cannot be read by anyone who
 * moves between two of them. An entry that overrides a pack kind is ignored for
 * the same reason.
 */
export interface TenantFeatureKind {
  kind: string;
  label: string;
  shape: GeometryShape;
}

const SHAPES: readonly GeometryShape[] = ["point", "line", "area"];

export function featureKindsFrom(config: unknown): TenantFeatureKind[] {
  if (!config || typeof config !== "object" || Array.isArray(config)) return [];
  const value = (config as Record<string, unknown>).featureKinds;
  if (!Array.isArray(value)) return [];

  const out: TenantFeatureKind[] = [];
  const seen = new Set(BY_KIND.keys());
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const row = entry as Record<string, unknown>;
    const kind = row.kind;
    if (typeof kind !== "string" || !isValidFeatureKind(kind)) continue;
    if (seen.has(kind)) continue;
    seen.add(kind);
    const shape = SHAPES.includes(row.shape as GeometryShape)
      ? (row.shape as GeometryShape)
      : "point";
    const label =
      typeof row.label === "string" && row.label.trim() !== ""
        ? row.label.trim()
        : featureKindLabel(kind);
    out.push({ kind, label, shape });
  }
  return out;
}

/**
 * Everything the picker offers: the pack's kinds, then the tenant's.
 *
 * The pack's come first because they are the ones with real symbology, and a
 * picker that buries `fence` under six tenant words makes the common case the
 * slow one.
 */
export function availableFeatureKinds(config: unknown): TenantFeatureKind[] {
  return [
    ...SUGGESTED_FEATURE_KINDS.map(({ kind, label, shape }) => ({
      kind,
      label,
      shape,
    })),
    ...featureKindsFrom(config),
  ];
}

/**
 * The attribute bag out of jsonb, for rendering.
 *
 * TOTAL BY CONSTRUCTION, the rule every reader in this pack follows. `ops.ts`
 * validates on the way IN — flat, scalar, snake-case keys — but the column has
 * no shape constraint, so a row written by hand, by a script, or by an earlier
 * version can hold anything at all. A screen must show what it can understand
 * and drop the rest rather than throw while rendering a fence.
 */
export function readAttributes(
  value: unknown,
): Record<string, string | number | boolean> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, string | number | boolean> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (
      typeof entry === "string" ||
      typeof entry === "boolean" ||
      (typeof entry === "number" && Number.isFinite(entry))
    ) {
      out[key] = entry;
    }
  }
  return out;
}

/** The shape the draw tool should open for a kind. Unknown kinds draw a point. */
export function shapeFor(kind: string, config: unknown = null): GeometryShape {
  return (
    availableFeatureKinds(config).find((k) => k.kind === kind)?.shape ?? "point"
  );
}
