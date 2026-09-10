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
   * What an engagement is shaped like here. The pack has no list of its own
   * on purpose — one that knew what "retainer" meant to an agency rather
   * than to a law firm would know what industry it was in — so the kinds a
   * profile expects are its own, and a tenant types one nobody listed.
   */
  packConfig: {
    "professional-services": {
      kinds: ["retainer", "project", "hourly"],
      /**
       * WHAT A NEW ENGAGEMENT SETS IN MOTION (back-office slice 7c).
       *
       * Here rather than in the pack for the reason `livestock.species` is:
       * a pack that knew a new client needs an engagement letter would know
       * what industry it was in. These are an agency's; a bookkeeping firm's
       * profile would name a chart of accounts review, and a law practice's
       * a conflicts check.
       *
       * They become ordinary work items linked to the engagement, so they
       * are ticked off in the same row as anything else and reach the digest
       * and *What needs you* without this pack knowing either exists.
       *
       * `dueInDays` counts from the LATER of the engagement's start and the
       * day the list is raised — a late start should not arrive already
       * overdue. A step with none is simply undated.
       */
      onboarding: [
        {
          name: "New client",
          /**
           * Not `hourly`: a block of ad-hoc advice does not need a kickoff
           * call and a folder of its own, and a list that fires on every
           * small piece of work is a list people learn to ignore.
           */
          appliesTo: ["retainer", "project"],
          steps: [
            {
              title: "Signed agreement on file",
              notes: "Countersigned, in Documents, before any work starts.",
            },
            { title: "Kickoff call booked", dueInDays: 3 },
            {
              title: "Access and logins collected",
              notes: "Whatever we need to do the work, and who to ask when it stops working.",
              dueInDays: 5,
            },
            { title: "Main contact confirmed", dueInDays: 5 },
            {
              title: "First invoice raised",
              notes: "Bill the first period, so the arrangement is real on both sides.",
              dueInDays: 7,
            },
            { title: "Two-week check-in", dueInDays: 14 },
          ],
        },
      ],
    },
  },
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
