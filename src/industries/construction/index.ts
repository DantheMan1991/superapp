import type { IndustryProfile } from "../types";
import { CONSTRUCTION_COA } from "./accounts";
import { CONSTRUCTION_COST_CODE_SETS } from "./cost-codes";
import { CONSTRUCTION_ESTIMATE_OUTLINES } from "./estimate-outlines";

/**
 * The platform's third industry profile: construction, in every flavour.
 *
 * ONE PROFILE FOR PRODUCTION, SEMI-CUSTOM, LUXURY CUSTOM AND COMMERCIAL WORK
 * ([ADR 0056](../../../docs/decisions/0056-a-delivery-method-belongs-to-the-project-not-the-tenant.md)).
 * The flavour is a property of the PROJECT — `delivery_method`, suggested
 * below and typed freely — because twelve of the family's eighteen packs are
 * wanted by all four flavours unchanged, and the pilot does three of the four
 * at once. A second construction profile is cheap to add and expensive to
 * retrofit the other way; read the ADR before proposing one.
 *
 * THE PILOT IS AN INSTANCE, NEVER THE SHAPE. Every value here sits beside the
 * range it is one point of, in `docs/modules/construction.md`'s three-column
 * table: the pilot says *client*, keeps one invented cost code list, runs a
 * design → drawings → build ladder of contracts and bills fixed price monthly.
 * A production builder, a commercial GC and a remodeler each do all four
 * differently, and every one of them must fit this manifest without a code
 * change — the founder's standing rule, in his words: *"don't narrow the
 * software to just me."*
 *
 * NOTHING IN IT IS NAMED AFTER THE PILOT, which `tests/packs.test.ts` scans
 * for. Full design, the pack list and the slice order are in
 * docs/modules/construction.md; the pack it lists first is documented in
 * docs/modules/jobs.md.
 */
export const construction: IndustryProfile = {
  slug: "construction",
  name: "Construction",
  description:
    "Jobs with a number, the contracts against them, what each was meant to cost and what has been ordered — for builders, remodelers, general contractors and the trades.",
  /**
   * The three of the family's packs that exist. `assets` is the equipment and
   * the trucks; `inventory` is the yard and the materials on hand; `jobs` is
   * the spine everything else will hang off. Each is wanted by every flavour.
   *
   * NOT LISTED, DELIBERATELY: `production`, although the design says a cabinet
   * shop's orders are a production run against materials inventory — the
   * pack's words (kill sheet, cut sheet, processor) are a meat plant's and
   * nobody has yet driven a shop order through it to say which relabels are
   * right; and `land`, whose fit for a subdivision's lots is an open question
   * in the dossier. A tenant switches either on; listing them here would
   * install words nobody has checked.
   */
  packs: ["assets", "inventory", "jobs"],
  /**
   * Only where the core word is wrong for this industry, per the agency
   * profile's rule. A tenant overrides any of these in its own vocabulary.
   */
  labels: {
    /**
     * The pilot's word, and the custom-home norm. The range is wider — a
     * commercial GC says *owner*, a production builder says *buyer*, a
     * remodeler says *homeowner* — and a company has ONE of them, which is why
     * this is a tenant-wide label and not a per-delivery-method one
     * (construction.md, "Vocabulary is tenant-wide and that is enough").
     */
    customer: "Client",
    /**
     * What a builder's stock is: lumber, fasteners, the pallet of tile that
     * came early. "Item" is the retail word.
     */
    item: "Material",
    /**
     * A line of business inside one company — the pilot's construction,
     * excavation and cabinet-shop divisions. Core's neutral word is
     * "enterprise", which the farm profile keeps and a builder never says.
     */
    enterprise: "Division",
  },
  /**
   * A builder quotes in money and reads a job cost report all day; a figure
   * with no symbol beside it is a figure somebody has to ask about. Same
   * reasoning as the other two profiles.
   */
  display: {
    currencySymbol: "$",
  },
  packConfig: {
    /**
     * What a company's divisions are made of — the `enterprises` subsystem is
     * Layer 0 and reads this key anyway, as the farm profile's comment says.
     * The pilot's three plus the ones the trades market has.
     */
    enterprises: {
      kinds: [
        "construction",
        "remodeling",
        "excavation",
        "cabinetry",
        "service",
        "design",
      ],
    },
    jobs: {
      /**
       * THE FLAVOURS, as suggestions for a project's `delivery_method`. The
       * four ADR 0056 names, plus the shapes the trades market actually
       * carries: a remodel, a tenant fit-out, a multifamily build and the
       * civil sitework a sub bids by the cubic yard. Free text remains; a
       * business with a kind nobody listed types it, and the pack has no
       * opinion beyond the format.
       */
      deliveryMethods: [
        "production_residential",
        "semi_custom",
        "luxury_custom",
        "remodel",
        "commercial",
        "tenant_improvement",
        "multifamily",
        "sitework",
      ],
      /**
       * THE AGREEMENTS A PROJECT CAN CARRY, as suggestions for a contract's
       * `kind`. The pilot's ladder — concept design, construction drawings,
       * new home, with a misc proposal and an AIA form for the rest — sits
       * beside a production builder's purchase agreement, a remodeler's
       * contract, a design-build firm's single agreement, and the subcontract
       * a company receives when it is the sub. A profile that shipped only the
       * pilot's five would have made the pack know one business's process.
       */
      contractKinds: [
        "concept_design",
        "construction_drawings",
        "new_home",
        "remodel",
        "purchase_agreement",
        "design_build",
        "aia",
        "subcontract",
        "misc_proposal",
      ],
    },
  },
  /**
   * What the profile contributes on install: contractor accounts on top of
   * the general chart, folders for the papers a job produces that the
   * platform's starter cabinet does not already hold, and two starter cost
   * code lists into the `jobs` pack — the first seed to land in a pack's own
   * tables, through the applier the pack registers (ADR 0057). Each lands
   * when its module is on, and again when it is switched on later.
   */
  seed: {
    accounts: CONSTRUCTION_COA,
    /**
     * ADDITIONS ONLY. The platform's starter cabinet already carries Jobs,
     * Contracts, Insurance & Bonds, Licenses & Permits, Safety, Equipment and
     * Suppliers — a list extension-model.md §8 notes is trade-shaped and
     * belongs here rather than in core. Until core's list is trimmed (a call
     * for the founder, since every other industry would lose those folders
     * too), the profile adds only what that list lacks; naming one it has
     * would create a second folder beside it.
     */
    folders: [
      "Plans & Drawings",
      "Bids & Proposals",
      "Subcontractors",
      "Change Orders",
      "Pay Applications & Draws",
    ],
    packs: {
      jobs: {
        costCodeSets: CONSTRUCTION_COST_CODE_SETS,
        /**
         * Two starter ways of walking an estimate (ADR 0098) — a new build and
         * a remodel, because they are different walks and not one walk with
         * optional stops. Questions only: the pack asks how wide the footing
         * is and never says.
         */
        estimateOutlines: CONSTRUCTION_ESTIMATE_OUTLINES,
      },
    },
  },
};
