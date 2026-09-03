import { parseHeader, stripComments } from "./markdown-meta";

/**
 * Tenant guides — the pure half. Everything here runs anywhere: the API route,
 * the pages, the tests, and (types only) the client-side help button.
 *
 * A guide is a markdown file under `docs/help/<folder>/<topic>.md` whose header
 * says WHERE it belongs (`**Route:**`) and where it lists (`**Order:**`). The
 * grammar those two lines follow is documented for authors in
 * `docs/help/_TEMPLATE.md`; this file is the implementation of it.
 */

export const GUIDES_HREF = "/dashboard/guides";

/**
 * Folders that are not a feature. `workspace` is the shell itself (`/dashboard`,
 * `/dashboard/today`), `business` is hours and team, `settings` is the pages
 * only an owner sees — the same groups the sidebar uses, minus the modules.
 */
export interface FixedSection {
  key: string;
  label: string;
  /** An `icon-registry.ts` name. */
  icon: string;
  ownerOnly?: boolean;
}

export const FIXED_SECTIONS: readonly FixedSection[] = [
  { key: "workspace", label: "Workspace", icon: "dashboard" },
  { key: "business", label: "Business", icon: "clock" },
  { key: "settings", label: "Settings", icon: "settings", ownerOnly: true },
];

export function fixedSection(key: string): FixedSection | null {
  return FIXED_SECTIONS.find((section) => section.key === key) ?? null;
}

// ---- Routes ----

export interface RouteCondition {
  key: string;
  /** Absent means "the parameter is present, whatever its value". */
  value?: string;
}

/**
 * One `**Route:**` entry. `segments` are the path pieces after the leading
 * slash: a literal, `*` (exactly one segment) or `**` (the route itself and
 * everything beneath it — last segment only).
 */
export interface RoutePattern {
  raw: string;
  segments: string[];
  conditions: RouteCondition[];
}

function decode(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/**
 * Exact by default: a guide for `/dashboard/m/accounting` does NOT answer for
 * `/dashboard/m/accounting/bills`, because a wrong guide is worse than "no
 * guide yet". A subtree has to ask for it with `**`.
 */
export function parseRoutePattern(raw: string): RoutePattern | null {
  const text = raw.replace(/`/g, "").trim();
  if (!text) return null;
  const cut = text.indexOf("?");
  let pathname = cut === -1 ? text : text.slice(0, cut);
  const query = cut === -1 ? "" : text.slice(cut + 1);
  if (pathname.length > 1 && pathname.endsWith("/")) pathname = pathname.slice(0, -1);
  if (pathname !== "/dashboard" && !pathname.startsWith("/dashboard/")) return null;

  const segments = pathname.split("/").filter(Boolean);
  const last = segments.length - 1;
  if (segments.some((segment, i) => segment === "**" && i !== last)) return null;

  const conditions: RouteCondition[] = [];
  for (const part of query.split("&")) {
    if (!part) continue;
    const eq = part.indexOf("=");
    const key = decode(eq === -1 ? part : part.slice(0, eq)).trim();
    if (!key) return null;
    conditions.push(eq === -1 ? { key } : { key, value: decode(part.slice(eq + 1)) });
  }
  return { raw: text, segments, conditions };
}

/** A `**Route:**` value: several patterns, comma-separated. An invalid one is dropped. */
export function parseRoutes(value: string | undefined): RoutePattern[] {
  if (!value) return [];
  return value
    .split(",")
    .map(parseRoutePattern)
    .filter((pattern): pattern is RoutePattern => pattern !== null);
}

export function matchRoute(
  pattern: RoutePattern,
  pathname: string,
  params: URLSearchParams,
): boolean {
  let path = pathname;
  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
  const actual = path.split("/").filter(Boolean);
  const subtree = pattern.segments[pattern.segments.length - 1] === "**";
  const fixed = subtree ? pattern.segments.slice(0, -1) : pattern.segments;
  if (subtree ? actual.length < fixed.length : actual.length !== fixed.length) {
    return false;
  }
  for (const [i, segment] of fixed.entries()) {
    if (segment !== "*" && segment !== actual[i]) return false;
  }
  return pattern.conditions.every(
    (condition) =>
      params.has(condition.key) &&
      (condition.value === undefined || params.get(condition.key) === condition.value),
  );
}

type Specificity = [
  literals: number,
  exact: number,
  wildcards: number,
  conditions: number,
];

/**
 * Compared lexicographically: literal segments first; then whether the pattern
 * is exact rather than a `**` subtree; then single wildcards; then query
 * conditions. The exactness term is what lets a module's `overview.md`
 * (`/dashboard/m/land/**`) sit beside a guide for the list screen itself
 * (`/dashboard/m/land`) — without it the two tie on three literals and the
 * alphabetically earlier slug wins, which is how `/dashboard/m/land` once
 * opened the overview instead of the list's own guide.
 */
export function specificity(pattern: RoutePattern): Specificity {
  let literals = 0;
  let wildcards = 0;
  let subtree = 0;
  for (const segment of pattern.segments) {
    if (segment === "*") wildcards += 1;
    else if (segment === "**") subtree = 1;
    else literals += 1;
  }
  return [literals, 1 - subtree, wildcards, pattern.conditions.length];
}

function compareSpecificity(a: Specificity, b: Specificity): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2] || a[3] - b[3];
}

/**
 * The guide for a screen: the most specific matching route wins; a tie goes to
 * the alphabetically earlier slug, so the answer never depends on file order.
 */
export function matchGuide<T extends GuideMeta>(
  guides: readonly T[],
  pathname: string,
  search: string,
): T | null {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  let best: { guide: T; score: Specificity } | null = null;
  for (const guide of guides) {
    for (const route of guide.routes) {
      if (!matchRoute(route, pathname, params)) continue;
      const score = specificity(route);
      const order = best ? compareSpecificity(score, best.score) : 1;
      if (order > 0 || (order === 0 && best && guide.slug < best.guide.slug)) {
        best = { guide, score };
      }
    }
  }
  return best?.guide ?? null;
}

/**
 * Where "Open this screen" goes: the literal prefix of a pattern, up to its
 * first wildcard, plus any `key=value` conditions. A presence-only condition
 * has no value to send, so it is dropped.
 */
export function openHref(pattern: RoutePattern): string {
  const literal: string[] = [];
  for (const segment of pattern.segments) {
    if (segment === "*" || segment === "**") break;
    literal.push(segment);
  }
  const query = pattern.conditions
    .filter((condition) => condition.value !== undefined)
    .map(
      (condition) =>
        `${encodeURIComponent(condition.key)}=${encodeURIComponent(condition.value ?? "")}`,
    )
    .join("&");
  return `/${literal.join("/")}${query ? `?${query}` : ""}`;
}

// ---- Guides ----

export interface GuideMeta {
  /** `land/overview` — the path under `docs/help/` minus `.md`. */
  slug: string;
  /** The folder: a feature slug or a fixed section key. */
  feature: string;
  /** The file name: `overview`, `record-a-bill`. */
  topic: string;
  title: string;
  summary: string;
  order: number;
  routes: RoutePattern[];
}

export interface Guide extends GuideMeta {
  /** The body, without the header the page renders separately. */
  content: string;
}

/** What the help panel is sent. No file path: the wire carries nothing about the disk. */
export interface GuideView {
  slug: string;
  feature: string;
  title: string;
  summary: string;
  content: string;
  openHref: string | null;
}

export interface HelpPayload {
  guide: GuideView | null;
}

export const DEFAULT_ORDER = 100;

/**
 * The body is what follows the header: the `# Title` line and the leading
 * blockquote are rendered by the page as a `PageHeader`, so leaving them in
 * would print the title twice and show the reader a `**Route:**` line.
 */
function bodyAfterHeader(raw: string): string {
  const lines = raw.split("\n");
  let i = 0;
  while (i < lines.length && !lines[i].trim()) i += 1;
  if (i < lines.length && /^# /.test(lines[i])) i += 1;
  while (i < lines.length && !lines[i].trim()) i += 1;
  while (i < lines.length && lines[i].startsWith(">")) i += 1;
  return stripComments(lines.slice(i).join("\n")).trim();
}

export function parseGuide(slug: string, raw: string): Guide {
  const header = parseHeader(raw);
  const [feature, ...rest] = slug.split("/");
  const orderText = header.fields.get("order")?.trim();
  return {
    slug,
    feature: rest.length ? feature : "",
    topic: rest.length ? rest.join("/") : slug,
    title: header.title ?? slug,
    summary: header.summary,
    order: orderText && /^\d+$/.test(orderText) ? Number(orderText) : DEFAULT_ORDER,
    routes: parseRoutes(header.fields.get("route")),
    content: bodyAfterHeader(raw),
  };
}

/** Overview first, then `Order`, then title — within a feature; features in slug order. */
export function sortGuides<T extends GuideMeta>(guides: readonly T[]): T[] {
  const rank = (guide: GuideMeta) => (guide.topic === "overview" ? -1 : guide.order);
  return [...guides].sort(
    (a, b) =>
      a.feature.localeCompare(b.feature) ||
      rank(a) - rank(b) ||
      a.title.localeCompare(b.title),
  );
}

// ---- Vocabulary ----

/** A renameable word as the guides need it: the declared fallback and, where one exists, its plural. */
export interface LabelWord {
  key: string;
  fallback: string;
  plural?: string;
}

export type Vocabulary = Record<string, { singular: string; plural: string }>;

/**
 * The same rule the sidebar uses for its one renameable word: a word nobody
 * renamed keeps its declared plural ("Lines of business"); a renamed one takes
 * an `s`, because a tenant's own word has no declared plural to fall back on.
 */
export function buildVocabulary(
  definitions: readonly LabelWord[],
  labels: Record<string, string>,
): Vocabulary {
  const vocabulary: Vocabulary = {};
  for (const definition of definitions) {
    const singular = labels[definition.key] ?? definition.fallback;
    const plural =
      singular === definition.fallback && definition.plural
        ? definition.plural
        : `${singular}s`;
    vocabulary[definition.key] = { singular, plural };
  }
  return vocabulary;
}

const PLACEHOLDER = /\{\{\s*([A-Za-z][A-Za-z0-9_]*)((?:\s*\|\s*[a-z]+)*)\s*\}\}/g;
export const MODIFIERS: readonly string[] = ["plural", "lower"];

export interface Placeholder {
  key: string;
  modifiers: string[];
}

function splitModifiers(raw: string): string[] {
  return raw
    .split("|")
    .map((piece) => piece.trim())
    .filter(Boolean);
}

/** Every `{{key|modifier}}` in a text, for the test that checks they are all declared. */
export function placeholders(text: string): Placeholder[] {
  return [...text.matchAll(PLACEHOLDER)].map((match) => ({
    key: match[1],
    modifiers: splitModifiers(match[2]),
  }));
}

/**
 * `{{zone}}` → the tenant's word; `{{zone|plural}}`, `{{zone|lower}}` and
 * `{{zone|plural|lower}}` for the other forms. An unknown key or modifier is
 * left exactly as written — visibly wrong on the page, and a test failure —
 * rather than silently dropped.
 */
export function applyLabels(text: string, vocabulary: Vocabulary): string {
  return text.replace(PLACEHOLDER, (whole: string, key: string, rawModifiers: string) => {
    const entry = vocabulary[key];
    if (!entry) return whole;
    const modifiers = splitModifiers(rawModifiers);
    if (modifiers.some((modifier) => !MODIFIERS.includes(modifier))) return whole;
    const word = modifiers.includes("plural") ? entry.plural : entry.singular;
    return modifiers.includes("lower") ? word.toLowerCase() : word;
  });
}

// ---- The index ----

export interface IndexFeature {
  slug: string;
  name: string;
  /** `modules.category`: "core" | "system" | "pack". */
  category: string;
  icon: string;
}

export interface GuideGroup<T extends GuideMeta = GuideMeta> {
  slug: string;
  name: string;
  icon: string;
  guides: T[];
}

export interface GuideSection<T extends GuideMeta = GuideMeta> {
  key: string;
  label: string;
  groups: GuideGroup<T>[];
}

/**
 * The Guides page, in sidebar order: Workspace, the core modules, the packs
 * under the installed profile's name, Business, and Settings for owners. A
 * switched-on feature with no guide yet is still listed — the gap is the
 * information. A guide whose folder is neither fixed nor switched on is not.
 */
export function guideIndexFor<T extends GuideMeta>(
  guides: readonly T[],
  features: readonly IndexFeature[],
  options: { profileName: string | null; isOwner: boolean },
): GuideSection<T>[] {
  const byFeature = new Map<string, T[]>();
  for (const guide of guides) {
    byFeature.set(guide.feature, [...(byFeature.get(guide.feature) ?? []), guide]);
  }
  const fixed = (key: string): GuideSection<T> => {
    const section = fixedSection(key);
    if (!section) throw new Error(`Not a fixed section: ${key}`);
    return {
      key,
      label: section.label,
      groups: [
        { slug: key, name: section.label, icon: section.icon, guides: byFeature.get(key) ?? [] },
      ],
    };
  };
  const groupsFor = (list: readonly IndexFeature[]): GuideGroup<T>[] =>
    list.map((feature) => ({
      slug: feature.slug,
      name: feature.name,
      icon: feature.icon,
      guides: byFeature.get(feature.slug) ?? [],
    }));

  const core = features.filter((feature) => feature.category !== "pack");
  const packs = features.filter((feature) => feature.category === "pack");
  const sections: GuideSection<T>[] = [fixed("workspace")];
  if (core.length) sections.push({ key: "modules", label: "Modules", groups: groupsFor(core) });
  if (packs.length) {
    sections.push({
      key: "packs",
      label: options.profileName ?? "Add-ons",
      groups: groupsFor(packs),
    });
  }
  sections.push(fixed("business"));
  if (options.isOwner) sections.push(fixed("settings"));
  return sections;
}
