import type { PackDefinition } from "./types";
import { AssetsModule } from "./assets/AssetsModule";
import { LandModule } from "./land/LandModule";
import { InventoryModule } from "./inventory/InventoryModule";
import { LivestockModule } from "./livestock/LivestockModule";
import { ProductionModule } from "./production/ProductionModule";
import { RetailModule } from "./retail/RetailModule";

/**
 * Layer 2a registry: slug → how the pack behaves.
 *
 * Deliberately separate from `src/modules/index.ts`. Naming is load-bearing
 * (ADR 0004): a pack sitting next to core drifts into core, which is the leak
 * the extension model exists to stop. Core never imports this file — the merge
 * happens at the shell layer in `src/lib/features.ts`, which is Layer 0 and is
 * allowed to know both exist.
 *
 * `assets`, `land`, `inventory`, `livestock`, `production` and `retail` are
 * built; `crops` alone is DECLARED AND UNBUILT. That is not a placeholder state: a
 * declared pack has a real dependency graph, installs with a profile, and
 * shows as an empty slot in the admin registry — exactly how `scheduling` and
 * `work` were carried before they shipped. Each
 * grows a `src/packs/<slug>/` directory and a `Component` when it is built.
 *
 * The designs these come from live in docs/modules/homestead-farm.md.
 */
export const packRegistry: Record<string, PackDefinition> = {
  // ---- The substrate packs ----

  /**
   * Parcels, zones, geometry, area. Everything spatial references it.
   *
   * Ships parcels, zones and dated zone use (slice 0). Occupancy and rest are
   * slice 1 — `land` owns that table, because rest is computed from it and a
   * pack may not read another pack's tables, but `livestock` and `crops` are
   * what write into it. Geometry is slice 2 (GeoJSON in jsonb, no PostGIS).
   */
  land: {
    slug: "land",
    name: "Land",
    icon: "map",
    // REQUIRES `assets` since 2026-08-15, because an occupancy record can name
    // the STRUCTURE something is in — a pen, a barn, a chicken tractor — and a
    // structure is an asset. Cattle roam a paddock loose; broilers live in a
    // pen that sits on it. A parallel structure table here would be the same
    // asset row a second time, without its depreciation or service schedule.
    requires: ["assets"],
    labels: [
      {
        key: "parcel",
        fallback: "Parcel",
        describes:
          "The legal unit of ground — a deed or a lease. Some call it a property, or a block.",
      },
      {
        key: "zone",
        fallback: "Zone",
        describes:
          "A management area inside a parcel. A grazier calls it a paddock; a market garden calls it a bed.",
      },
    ],
    Component: LandModule,
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
    labels: [
      {
        key: "asset",
        fallback: "Asset",
        describes:
          "Anything owned with a cost and a working life — a tractor, a building, a freezer.",
      },
    ],
    Component: AssetsModule,
  },

  /**
   * Owns the lot spine. Quantity-bearing lots with event-sourced balances and
   * lineage — which is why `livestock` requires it rather than the reverse:
   * market animals ARE inventory, and breeding stock is a capital asset.
   *
   * REQUIRES `assets`, added when slice 0 shipped. A storage location IS an
   * asset — a chest freezer, in a garage, on a parcel — so the movement ledger
   * points at `assets` with a composite FK rather than inventing a parallel
   * location model. Every profile that lists `inventory` already lists
   * `assets`, so this costs nobody anything.
   */
  inventory: {
    slug: "inventory",
    name: "Inventory",
    icon: "boxes",
    requires: ["assets"],
    labels: [
      {
        key: "item",
        fallback: "Item",
        describes: "A kind of thing held in quantity — feed, cartons, ground beef.",
      },
      {
        key: "lot",
        fallback: "Batch",
        describes:
          "A particular batch of an item, with lineage — one delivery, one hatch, one pen.",
      },
    ],
    Component: InventoryModule,
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
    labels: [
      {
        key: "livestockLot",
        fallback: "Lot",
        describes:
          "A group of animals, or one animal. A poultry keeper says flock; a cattle operation says herd.",
      },
      {
        key: "structure",
        fallback: "Pen or barn",
        describes:
          "What animals are kept in while on a zone — a pen, a coop, a chicken tractor. Blank means loose.",
      },
    ],
    Component: LivestockModule,
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
    labels: [
      {
        key: "productionRun",
        fallback: "Run",
        describes:
          "One pass of turning things into other things — a processing day, a bake, a milling. A farm says batch; a shop says job.",
      },
      /**
       * **THE ONE PLACE THIS PACK SAYS SOMETHING INDUSTRY-SHAPED**, and putting
       * it here is what keeps it honest: declaring the word makes it renameable
       * from the admin screen and findable by anybody who wonders why a bake is
       * being asked about carcasses. The stage itself is real for any run that
       * turns a whole thing into parts of it; only this noun is meat's.
       */
      {
        key: "killSheet",
        fallback: "Kill sheet",
        describes:
          "The record of what came off the line between the animal and the box — hanging weights and anything condemned. A meat business says kill sheet; another trade would say grading.",
      },
    ],
    Component: ProductionModule,
  },

  /**
   * Channels, price lists, orders. Sells what inventory holds.
   *
   * Requires `inventory` because a price is a price OF something, and that
   * something is an item. Deliberately NOT `production`: a shop reselling what
   * it bought in is a legitimate composition, and the commitment machinery that
   * genuinely needs a production run is slice 3.
   */
  retail: {
    slug: "retail",
    name: "Retail",
    icon: "store",
    requires: ["inventory"],
    labels: [
      {
        key: "channel",
        fallback: "Channel",
        describes:
          "Somewhere the business sells — a market stall, the farm gate, a shop, a wholesale account.",
      },
      {
        key: "marketDay",
        fallback: "Market day",
        describes:
          "One day of selling at a channel. A grower says market day; a shop says trading day.",
      },
    ],
    Component: RetailModule,
  },
};

export function getPackDefinition(slug: string): PackDefinition | null {
  return packRegistry[slug] ?? null;
}
