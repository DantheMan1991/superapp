import type { IndustryProfile } from "./types";

/**
 * The platform's first industry profile.
 *
 * A homestead is roughly eight micro-businesses sharing one set of books, which
 * makes it the hardest possible first industry and therefore the best test of
 * whether the pack model holds. Four of its seven packs — `assets`,
 * `inventory`, `land`, `production` — are neutral enough that a trades profile
 * will list them unchanged.
 *
 * Full design, including a slice order per pack, is in
 * docs/modules/homestead-farm.md.
 */
export const homesteadFarm: IndustryProfile = {
  slug: "homestead-farm",
  name: "Homestead Farm",
  description:
    "Land, animals, gardens, processing and direct sales, on one set of books.",
  packs: [
    "land",
    "assets",
    "inventory",
    "livestock",
    "crops",
    "production",
    "retail",
  ],
  /**
   * Deliberately small. Vocabulary is the cheapest way to express an industry
   * difference and should be reached for before anything else — but only where
   * the core word is genuinely wrong, not to rename things for flavour.
   */
  labels: {
    zone: "Paddock",
    lot: "Lot",
    productionRun: "Batch",
  },
  packConfig: {
    /**
     * Each pack reads its own key. Values are defaults for a new tenant, not
     * constraints — Layer 3 tailoring lives in `tenant_modules.config`.
     */
    livestock: {
      species: ["cattle", "swine", "poultry"],
    },
    land: {
      areaUnit: "acre",
      /**
       * On top of Land's neutral default of building + infrastructure. A
       * chicken tractor and a hoop house are equipment by any accountant's
       * reckoning and a home to something by any farmer's, which is the whole
       * reason the list is config and not a constant.
       */
      structureKinds: [
        "building",
        "infrastructure",
        "chicken_tractor",
        "hoop_house",
        "coop",
        "barn",
      ],
    },
  },
};
