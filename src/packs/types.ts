import type { ModuleDefinition } from "@/modules/types";

/**
 * Layer 2a — a capability pack.
 *
 * A pack is a row in `modules` with `category = 'pack'`
 * ([ADR 0009](../../docs/decisions/0009-packs-are-modules-profiles-install-them.md)),
 * so enablement, nav, routing, `requireModuleEnabled` and billing all work
 * through machinery that already exists. This code-side definition adds the two
 * things a core module does not need: what the pack depends on, and the fact
 * that it may be declared before it is built.
 *
 * THE RULE THAT MAKES THE LAYER WORK: a pack must never know which industry it
 * is running in. No `if (industry === …)`, not once. Industry differences are
 * configuration, a declared extension point, or a separate pack — never a fork.
 * See docs/extension-model.md §2.
 */
export interface PackDefinition {
  /** Must match modules.id in the DB. */
  slug: string;
  name: string;
  /** lucide icon name used in nav (kept as string to stay serializable). */
  icon: string;
  layout?: ModuleDefinition["layout"];
  /**
   * Packs that must be enabled first, by slug.
   *
   * Enforced when a pack is switched ON, never at runtime — a request that has
   * already reached a pack's page is too late to discover its dependency is
   * missing, and a runtime check there would be a crash dressed as a guard.
   *
   * Declared in code rather than a table on purpose: the graph is part of the
   * pack's definition, not tenant data, and Layer 2 needs no new tables.
   */
  requires: string[];
  /**
   * Absent until the pack is actually built.
   *
   * A declared-but-unbuilt pack is not a placeholder — it participates fully in
   * dependency resolution and profile installs, and only its *rendering* is
   * missing. This mirrors how `scheduling` and `work` were registered before
   * they shipped, and it is what lets a profile describe a whole industry
   * before any of it exists.
   */
  Component?: ModuleDefinition["Component"];
}

/** Anything the dashboard shell can be asked about: a core module or a pack. */
export type FeatureDefinition = ModuleDefinition | PackDefinition;

/** A feature that can actually render — i.e. its `Component` exists. */
export type RenderableFeature = FeatureDefinition & {
  Component: ModuleDefinition["Component"];
};
