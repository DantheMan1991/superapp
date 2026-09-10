import type { IndustryProfile } from "../types";
import { AGENCY_COA } from "./accounts";

/**
 * The platform's second industry profile, and the first whose pilot is the
 * business that runs the platform (ADR 0041).
 *
 * NOTHING IN IT IS NAMED AFTER THAT BUSINESS. Clients, engagements, retainers,
 * discovery and onboarding are what a bookkeeping firm, a law practice, a
 * design studio and a consultancy also have — which is the neutrality test
 * (docs/extension-model.md §3) passed in the other direction. The operator
 * tenant is this profile's pilot the way the founder's farm is the homestead
 * profile's, and the profile is expected to be wrong in the ways only running
 * an agency on it will show.
 *
 * Full design, and the slice order for the pack it lists, is in
 * docs/modules/agency.md.
 */
export const agency: IndustryProfile = {
  slug: "agency",
  name: "Agency",
  description:
    "Clients on retainer or by the project — engagements, the hours against them, and the books of a services business.",
  packs: ["professional-services"],
  /**
   * Empty on purpose. The pack's own fallbacks are this profile's words —
   * an agency says client and engagement — and a profile renames a word only
   * where the built-in one is wrong for its industry. A law practice's
   * profile would put `engagement: "Matter"` here; this one has nothing to
   * correct.
   */
  labels: {},
  /**
   * What the profile contributes on install (back-office slice 7a): the
   * accounts a services business keeps beyond the general chart, and the two
   * folders every engagement produces papers for. Applied when the module
   * each belongs to is on, and again when it is switched on later — a seed
   * is not lost by installing the profile first.
   */
  seed: {
    accounts: AGENCY_COA,
    folders: ["Clients", "Proposals"],
  },
  /**
   * A services business quotes in money, not units: a card reading
   * "Retainer · 2500.00" with no column header to say it is money needs the
   * symbol, the same reason the homestead profile asks for it.
   */
  display: {
    currencySymbol: "$",
  },
};
