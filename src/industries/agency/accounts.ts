import type { CoaTemplate } from "@/modules/accounting/templates/general";

/**
 * The accounts a services business keeps that the general chart does not.
 *
 * ADDITIVE OVER THE GENERAL CHART, never instead of it. Accounting is switched
 * on with `general` (the platform's neutral template) and this lands on top —
 * at install when the module is already on, or when it is switched on later
 * (`src/app/admin/profile-seed.ts`). So every code here is one the general
 * chart does not use, every parent it names is a general account, and a code
 * the tenant already has is skipped rather than renamed: their chart outranks
 * the manifest, the way `provisionAccounting` has always treated it.
 *
 * Small on purpose. A chart is where a business's own accountant has
 * opinions, and a profile that ships forty accounts ships thirty the tenant
 * deletes. These are the lines every retainer-and-project business has and
 * a general chart leaves it to invent.
 */
export const AGENCY_COA: CoaTemplate = {
  slug: "agency",
  name: "Agency additions",
  accounts: [
    /**
     * Time worked and not yet billed. A services firm's stock: it is what the
     * month-end question "what have we done that we have not invoiced" is
     * asked of. Nothing posts here yet — the pack's engagements will
     * (back-office slice 7b) — and the account existing first is what lets
     * that slice be a posting rule rather than a chart change.
     */
    { code: "1220", name: "Work in Progress", type: "asset", subtype: "other_current_asset" },
    /**
     * Money a client paid ahead of the work — a retainer billed in advance, a
     * deposit on a project. Under the general chart's Unearned Revenue, so a
     * balance sheet that groups by parent still reads as one line.
     */
    { code: "2410", name: "Client Retainers Held", type: "liability", subtype: "other_current_liability", parentCode: "2400" },
    // Income, under the general chart's Sales. `4010 Service Revenue` stays
    // the catch-all; these are the shapes a services business bills in.
    { code: "4030", name: "Retainer Revenue", type: "income", subtype: "operating_revenue", parentCode: "4000" },
    { code: "4040", name: "Project Revenue", type: "income", subtype: "operating_revenue", parentCode: "4000" },
    { code: "4050", name: "Hourly Billing", type: "income", subtype: "operating_revenue", parentCode: "4000" },
    { code: "4060", name: "Reimbursed Expenses", type: "income", subtype: "operating_revenue", parentCode: "4000" },
    { code: "4070", name: "Software & Licensing Revenue", type: "income", subtype: "operating_revenue", parentCode: "4000" },
    // Direct costs of delivering an engagement. The general chart's
    // `5100 Subcontractor Expense` already covers freelancers.
    { code: "5300", name: "Client Software & Tools", type: "expense", subtype: "cogs" },
    { code: "5400", name: "Reimbursable Client Expenses", type: "expense", subtype: "cogs" },
    // Operating expenses a services business feels more than most.
    { code: "6060", name: "Payment Processing Fees", type: "expense", subtype: "operating_expense", parentCode: "6050" },
    { code: "6310", name: "Software Subscriptions", type: "expense", subtype: "operating_expense", parentCode: "6300" },
    { code: "6320", name: "Professional Development", type: "expense", subtype: "operating_expense" },
  ],
};
