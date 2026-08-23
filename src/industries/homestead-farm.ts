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
    /**
     * The carcass stage, in this industry's word for it. The pack's own fallback
     * is the same phrase, which is the one place `production` says something
     * industry-shaped out loud — recorded as such in its dossier. A profile
     * whose runs are bakes rather than kills overrides it here and the pack
     * needs no change.
     */
    killSheet: "Kill sheet",
    /**
     * What this industry calls the outside place. "Processor" is the technical
     * word and the paperwork uses it, but nobody on a farm rings "the
     * processor" — they ring the butcher.
     */
    processor: "Butcher",
  },
  /**
   * A farmer is not reading a ledger all day. "Fed · 85.00" on a card has no
   * column header to say it is money, so this profile asks for the symbol —
   * which accounting's own debit/credit grids still go without.
   */
  display: {
    currencySymbol: "$",
  },
  packConfig: {
    /**
     * Each pack reads its own key. Values are defaults for a new tenant, not
     * constraints — Layer 3 tailoring lives in `tenant_modules.config`.
     */
    livestock: {
      species: ["cattle", "swine", "poultry"],
      /**
       * The divisor in the tape formula — **heart girth² × body length ÷ this**
       * — per species, in inches and pounds.
       *
       * Here rather than in the pack because the number is an animal fact, not
       * a software one: a pig is 400 and a cow is 300 by long convention, and a
       * pack that knew that would know what a pig is. It is also the figure an
       * extension office will argue about, so a tenant can settle the argument
       * in `tenant_modules.config` without a deploy.
       *
       * **Poultry is deliberately absent.** Nobody tapes a chicken — they go on
       * a scale in tens — and a divisor here would offer a measurement method
       * that does not exist for the bird, which the form would then have to
       * explain away.
       */
      tapeDivisors: {
        cattle: 300,
        swine: 400,
      },
    },
    /**
     * What a run on this farm is. The pack has no list of its own on purpose —
     * one that knew what "butchering" was would know what industry it was in,
     * which is the boundary ADR 0004 draws. A tenant with a kind nobody listed
     * types it, and the format check is the only thing that has an opinion.
     */
    production: {
      runKinds: ["butchering", "baking", "milling", "processing"],
      /**
       * What the plants around here will take — NOT what this farm raises.
       *
       * The two lists differ on purpose and the difference is the useful part:
       * `livestock.species` above is cattle, swine and poultry, and this one
       * carries sheep and goats as well, because choosing a butcher because it
       * handles lambs is a normal thing to do in the season before you own any.
       * A plant that only does birds simply has one of these rows.
       */
      processorHandles: ["cattle", "swine", "poultry", "sheep", "goat"],
    },
    /**
     * Where this farm sells. All direct-to-consumer today — one farmers market
     * with more coming, a farm store run both attended and on the honour system,
     * and no wholesale yet. `wholesale` is listed anyway: it costs nothing, and
     * it is the channel whose eligibility guardrail has to be right before the
     * first pallet leaves.
     */
    retail: {
      channelKinds: [
        "farmers_market",
        "farm_store",
        "honour_system",
        "online",
        "wholesale",
      ],
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
