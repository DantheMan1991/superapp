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
    /**
     * **THE FARM WORD FOR A LINE OF BUSINESS.** Core calls it that because a
     * core tool speaks no industry; on a farm it is an ENTERPRISE, which is
     * the standard farm-management term — the beef enterprise and the dairy
     * enterprise are the two halves of a herd. Outside agriculture the word
     * reads as "a company", which is why it cannot be the neutral default.
     */
    enterprise: "Enterprise",
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
    /**
     * The instruction handed over with the animals. The pack's neutral fallback
     * is "Order" because a bakery hands a co-packer a spec rather than a cut
     * sheet — but on a farm this is the cut sheet, it is what the customer fills
     * in on a half-beef sale, and calling it anything else on that screen would
     * be the app using a word the farm does not.
     */
    cutSheet: "Cut sheet",
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
    /**
     * **`enterprises` IS LAYER 0 AND NOT A PACK**, and it reads this key anyway
     * — the namespace is where a profile's defaults live, not an assertion that
     * a pack exists. Doing it any other way would mean a second resolver for
     * one list.
     *
     * What a farm's lines of business are made of. The subsystem has no list of
     * its own, for the reason `runKinds` below has none: one that knew what
     * "livestock" was would know what industry it was in.
     */
    enterprises: {
      kinds: ["livestock", "crop"],
    },
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
      /**
       * **WIDENED 2026-08-23 AFTER A REAL RATE SHEET WOULD NOT FIT IN IT.**
       *
       * It was `cattle, swine, poultry, sheep, goat`. Pleasant Valley Poultry's
       * 2026 price list — a genuine USDA poultry plant — prices **chickens,
       * turkeys, ducks, geese and quail separately**, and $2.75 a quail against
       * $11.55 a goose is not a rounding difference. With one `poultry` bucket
       * all five collapsed onto one row and four of the prices were lost.
       *
       * `livestock.species` above deliberately still says `poultry`: a farm
       * counts birds in a pen as birds. This list is what a PLANT quotes for,
       * which is a finer question, and the two being separate lists is exactly
       * what let one move without disturbing the other.
       */
      processorHandles: [
        "cattle",
        "swine",
        "sheep",
        "goat",
        "poultry",
        "chicken",
        "turkey",
        "duck",
        "goose",
        "quail",
      ],
      /**
       * HOW MANY MAY BE PROCESSED ON THIS FARM IN A YEAR WITHOUT INSPECTION.
       *
       * **A THOUSAND BIRDS, and the pilot sits at exactly that** — the design
       * notes it is "already managed to a line", which is why the number is
       * worth counting rather than merely mentioning. It is the federal poultry
       * producer/grower exemption's figure; states layer their own rules on top
       * and some are stricter, so a farm elsewhere edits
       * `tenant_modules.config` and nothing is deployed.
       *
       * **ONLY POULTRY IS LISTED, deliberately.** There is no equivalent
       * head-count exemption for beef or pork — custom-exempt slaughter has no
       * annual number, it has a rule about who may eat it — so listing them
       * with a cap would invent a limit that does not exist. An empty list is
       * the correct answer for a species this does not apply to.
       */
      exemptions: [{ kind: "poultry", annualHead: 1000 }],
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
