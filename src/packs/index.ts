import type { PackDefinition } from "./types";
import { AssetsModule } from "./assets/AssetsModule";

/**
 * Layer 2a registry: slug → how the pack behaves.
 *
 * Deliberately separate from `src/modules/index.ts`. Naming is load-bearing
 * (ADR 0004): a pack sitting next to core drifts into core, which is the leak
 * the extension model exists to stop. Core never imports this file — the merge
 * happens at the shell layer in `src/lib/features.ts`, which is Layer 0 and is
 * allowed to know both exist.
 *
 * EVERY PACK BELOW IS DECLARED AND UNBUILT. That is not a placeholder state:
 * a declared pack has a real dependency graph, installs with a profile, and
 * shows as an empty slot in the admin registry — exactly how `scheduling` and
 * `work` were carried before they shipped. Each grows a `src/packs/<slug>/`
 * directory and a `Component` when it is built.
 *
 * The designs these come from live in docs/modules/homestead-farm.md.
 */
export const packRegistry: Record<string, PackDefinition> = {
  // ---- No dependencies: the substrate packs ----

  /** Parcels, zones, geometry, area. Everything spatial references it. */
  land: {
    slug: "land",
    name: "Land",
    icon: "map",
    requires: [],
  },

  /**
   * Anything owned with a cost, a life, a location and a service schedule.
   * `kind` is an open taxonomy — buildings, equipment and vehicles are values
   * a profile supplies, not separate packs.
   *
   * THE FIRST PACK TO SHIP A RENDERER. It has no dependencies, which is why it
   * went first: the machinery is proved by something using it, without a
   * second pack having to exist at the same time.
   */
  assets: {
    slug: "assets",
    name: "Assets",
    icon: "wrench",
    requires: [],
    Component: AssetsModule,
  },

  /**
   * Owns the lot spine. Quantity-bearing lots with event-sourced balances and
   * lineage — which is why `livestock` requires it rather than the reverse:
   * market animals ARE inventory, and breeding stock is a capital asset.
   */
  inventory: {
    slug: "inventory",
    name: "Inventory",
    icon: "boxes",
    requires: [],
  },

  // ---- Dependent packs ----

  /**
   * Requires `inventory` for the lot spine and `land` for grazing occupancy —
   * the record that carries cost allocation in both directions.
   */
  livestock: {
    slug: "livestock",
    name: "Livestock",
    icon: "beef",
    requires: ["inventory", "land"],
  },

  /** Beds are land zones; harvests feed inventory. */
  crops: {
    slug: "crops",
    name: "Crops",
    icon: "sprout",
    requires: ["land", "inventory"],
  },

  /**
   * Inputs + labour → outputs at a yield, with cost rolled through. Requires
   * `inventory` because that is where outputs land — and deliberately NOT
   * `livestock`, because a bakery running production over purchased flour is a
   * legitimate composition and a pack must not assume its neighbours.
   */
  production: {
    slug: "production",
    name: "Production",
    icon: "factory",
    requires: ["inventory"],
  },

  /** Channels, price lists, orders. Sells what inventory holds. */
  retail: {
    slug: "retail",
    name: "Retail",
    icon: "store",
    requires: ["inventory"],
  },
};

export function getPackDefinition(slug: string): PackDefinition | null {
  return packRegistry[slug] ?? null;
}
