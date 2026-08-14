import { moduleRegistry } from "@/modules";
import { packRegistry } from "@/packs";
import type {
  FeatureDefinition,
  RenderableFeature,
} from "@/packs/types";
import type { DependencyGraph } from "@/lib/packs/resolve";

/**
 * Where Layer 1 and Layer 2a meet.
 *
 * Core modules and capability packs live in separate source trees on purpose —
 * naming is load-bearing, and a pack sitting next to core drifts into core
 * (ADR 0004). But there is exactly ONE registry at runtime, because nav,
 * routing and `requireModuleEnabled` must not fork: a pack is switched on by
 * the same toggle that switches on Accounting.
 *
 * The merge happens HERE, in Layer 0, which is allowed to know both exist.
 * Neither `src/modules/index.ts` nor `src/packs/index.ts` imports the other.
 */

const collisions = Object.keys(packRegistry).filter((slug) => slug in moduleRegistry);
if (collisions.length > 0) {
  // A slug in both registries would silently shadow one of them, and which one
  // won would depend on merge order — the kind of bug that only shows up as a
  // module rendering the wrong thing. Fail loudly and immediately instead.
  throw new Error(
    `Feature slug registered as both a core module and a pack: ${collisions.join(", ")}`,
  );
}

/** Every feature the shell can be asked about, core and pack alike. */
export const featureRegistry: Record<string, FeatureDefinition> = {
  ...moduleRegistry,
  ...packRegistry,
};

export function getFeature(slug: string): FeatureDefinition | null {
  return featureRegistry[slug] ?? null;
}

/**
 * The feature IF it can render.
 *
 * A declared-but-unbuilt pack is registered, resolves dependencies and installs
 * with a profile — but has no `Component`, so it must never reach nav or a
 * route. This is the one predicate the shell should use; `getFeature` is for
 * metadata and dependency questions.
 */
export function getRenderableFeature(slug: string): RenderableFeature | null {
  const feature = featureRegistry[slug];
  if (!feature || typeof feature.Component !== "function") return null;
  return feature as RenderableFeature;
}

export function isRenderable(slug: string): boolean {
  return getRenderableFeature(slug) !== null;
}

/**
 * The dependency graph across both registries.
 *
 * Core modules contribute an empty requirement list rather than being absent,
 * so a pack may depend on a core module without the resolver needing a special
 * case for "not a pack".
 */
export function dependencyGraph(): DependencyGraph {
  const graph: DependencyGraph = {};
  for (const slug of Object.keys(moduleRegistry)) graph[slug] = [];
  for (const [slug, pack] of Object.entries(packRegistry)) {
    graph[slug] = pack.requires;
  }
  return graph;
}
