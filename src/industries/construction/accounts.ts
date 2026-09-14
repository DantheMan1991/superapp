import type { CoaTemplate } from "@/modules/accounting/templates/general";

/**
 * The accounts a construction business keeps that the general chart does not.
 *
 * ADDITIVE OVER THE GENERAL CHART, never instead of it — the rule
 * `src/industries/agency/accounts.ts` states and `provisionAccounting` keeps:
 * every code here is one the general chart does not use, every parent it names
 * is a general account, and a code the tenant already has is skipped rather
 * than renamed.
 *
 * SMALL ON PURPOSE, and shaped by the two facts that make contractor books
 * different from a shop's: **money is held back** in both directions
 * (retainage — the owner holds a share of every pay application until the
 * job is done, and the contractor holds the same from its subs), and **billing
 * runs ahead of or behind the work** (over- and under-billings, the two lines a
 * bank and a surety read first on a builder's balance sheet). Nothing posts to
 * the four of them yet — progress billing and WIP are the slices that will —
 * and the accounts existing first is what lets those slices be posting rules
 * rather than chart changes, the way the agency profile's `1220 Work in
 * Progress` was.
 *
 * Subcontractors are the biggest cost on most jobs and are NOT here: the
 * general chart's `5100 Subcontractor Expense` already covers them, and the
 * agency profile leans on the same account for freelancers — which is the
 * reason it stays in the general chart rather than moving here as
 * extension-model.md §8 once proposed.
 */
export const CONSTRUCTION_COA: CoaTemplate = {
  slug: "construction",
  name: "Construction additions",
  accounts: [
    /** Held back by the owner from each pay application until the job is done. */
    { code: "1230", name: "Retainage Receivable", type: "asset", subtype: "other_current_asset" },
    /** Work done and not yet billed — the underbilling on a percent-complete job. */
    { code: "1240", name: "Costs in Excess of Billings", type: "asset", subtype: "other_current_asset" },
    /** The same share, held from subcontractors until their scope is accepted. */
    { code: "2120", name: "Retainage Payable", type: "liability", subtype: "other_current_liability" },
    // Both under the general chart's Unearned Revenue, so a balance sheet that
    // groups by parent still reads as one line of money owed back in work.
    /** Billed ahead of the work — the overbilling. */
    { code: "2420", name: "Billings in Excess of Costs", type: "liability", subtype: "other_current_liability", parentCode: "2400" },
    /** A draw or deposit received before the work it pays for. */
    { code: "2430", name: "Deposits Received", type: "liability", subtype: "other_current_liability", parentCode: "2400" },
    // Income, under the general chart's Sales.
    { code: "4030", name: "Contract Revenue", type: "income", subtype: "operating_revenue", parentCode: "4000" },
    // Direct job costs. A bill line lands in one of these AND on a job and a
    // cost code — the account says what kind of cost, the dimensions say
    // which job and which trade. `5100 Subcontractor Expense` is general.
    { code: "5200", name: "Job Materials", type: "expense", subtype: "cogs" },
    { code: "5250", name: "Job Labor", type: "expense", subtype: "cogs" },
    { code: "5260", name: "Job Equipment", type: "expense", subtype: "cogs" },
    { code: "5270", name: "Permits and Fees", type: "expense", subtype: "cogs" },
    { code: "5280", name: "Other Job Costs", type: "expense", subtype: "cogs" },
  ],
};
