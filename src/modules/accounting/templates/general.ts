import type { AccountTypeValue } from "../core/coa";

/**
 * Chart-of-accounts templates are founder-authored code constants: typed,
 * git-reviewed, deployed with the app. Industry templates (real estate,
 * construction, retail) ship with their packs; the core carries only this
 * industry-agnostic template. Parents always precede children.
 */

export interface TemplateAccount {
  code: string;
  name: string;
  type: AccountTypeValue;
  subtype: string;
  parentCode?: string;
  isSystem?: boolean;
  description?: string;
}

export interface CoaTemplate {
  slug: string;
  name: string;
  accounts: TemplateAccount[];
}

export const GENERAL_COA: CoaTemplate = {
  slug: "general",
  name: "General small business",
  accounts: [
    // Assets
    { code: "1000", name: "Checking Account", type: "asset", subtype: "bank" },
    { code: "1010", name: "Savings Account", type: "asset", subtype: "bank" },
    { code: "1100", name: "Cash on Hand", type: "asset", subtype: "cash" },
    { code: "1200", name: "Accounts Receivable", type: "asset", subtype: "accounts_receivable", isSystem: true },
    { code: "1250", name: "Undeposited Funds", type: "asset", subtype: "undeposited_funds", isSystem: true },
    { code: "1300", name: "Inventory", type: "asset", subtype: "inventory" },
    { code: "1400", name: "Prepaid Expenses", type: "asset", subtype: "other_current_asset" },
    /**
     * The intercompany pair (ADR 0010 slice 2). ONE account each, not one per
     * counterparty: ten LLCs would otherwise mean ninety accounts in a chart
     * every company can see, and who owes whom is a property of the
     * TRANSACTION rather than of the account — it comes from the linked pair at
     * read time, the way invoice status comes from payments.
     *
     * `isSystem`, so they cannot be renumbered into something the resolver
     * stops finding, and looked up BY SUBTYPE like every other system account.
     *
     * A single-company tenant has these and never posts to them, which is the
     * same deal it gets on Undeposited Funds.
     */
    { code: "1500", name: "Due from Affiliates", type: "asset", subtype: "due_from_affiliate", isSystem: true },
    { code: "1600", name: "Equipment", type: "asset", subtype: "fixed_asset" },
    { code: "1650", name: "Vehicles", type: "asset", subtype: "fixed_asset" },
    { code: "1700", name: "Accumulated Depreciation", type: "asset", subtype: "accumulated_depreciation" },
    // Liabilities
    { code: "2000", name: "Accounts Payable", type: "liability", subtype: "accounts_payable", isSystem: true },
    // **Goods received, not yet invoiced.** The account that joins what the
    // business HAS to what it OWES: credited when stock arrives, debited when
    // the bill for it is allocated. A standing credit balance is stock received
    // with no invoice; a debit is an invoice for stock the books never received.
    // Both are month-end questions worth being asked. See ADR 0012.
    { code: "2050", name: "Goods Received Not Invoiced", type: "liability", subtype: "goods_received", isSystem: true },
    { code: "2100", name: "Credit Card", type: "liability", subtype: "credit_card" },
    { code: "2200", name: "Sales Tax Payable", type: "liability", subtype: "sales_tax", isSystem: true },
    { code: "2300", name: "Payroll Liabilities", type: "liability", subtype: "payroll_liability" },
    { code: "2400", name: "Unearned Revenue", type: "liability", subtype: "other_current_liability" },
    { code: "2450", name: "Due to Affiliates", type: "liability", subtype: "due_to_affiliate", isSystem: true },
    { code: "2500", name: "Loans Payable", type: "liability", subtype: "long_term_liability" },
    // Equity
    { code: "3000", name: "Opening Balance Equity", type: "equity", subtype: "opening_balance", isSystem: true },
    { code: "3100", name: "Owner Contributions", type: "equity", subtype: "owner_equity" },
    { code: "3200", name: "Owner Draws", type: "equity", subtype: "owner_equity" },
    { code: "3900", name: "Retained Earnings", type: "equity", subtype: "retained_earnings", isSystem: true },
    // Income
    { code: "4000", name: "Sales", type: "income", subtype: "operating_revenue" },
    { code: "4010", name: "Service Revenue", type: "income", subtype: "operating_revenue", parentCode: "4000" },
    { code: "4020", name: "Product Sales", type: "income", subtype: "operating_revenue", parentCode: "4000" },
    { code: "4100", name: "Discounts Given", type: "income", subtype: "contra_revenue" },
    { code: "4900", name: "Other Income", type: "income", subtype: "other_income" },
    // ONE account for both directions. A disposal either makes money or loses
    // it, and the ledger's signed amounts carry that without a second account:
    // a credit here is a gain, a debit is a loss. Splitting it into separate
    // gain and loss accounts is the other common convention and buys nothing
    // when the report can show a negative.
    { code: "4950", name: "Gain (Loss) on Asset Disposal", type: "income", subtype: "other_income" },
    // Cost of goods sold
    { code: "5000", name: "Cost of Goods Sold", type: "expense", subtype: "cogs" },
    { code: "5100", name: "Subcontractor Expense", type: "expense", subtype: "cogs" },
    // Operating expenses
    { code: "6000", name: "Advertising & Marketing", type: "expense", subtype: "operating_expense" },
    { code: "6050", name: "Bank Fees & Charges", type: "expense", subtype: "operating_expense" },
    { code: "6100", name: "Insurance", type: "expense", subtype: "operating_expense" },
    { code: "6150", name: "Interest Expense", type: "expense", subtype: "operating_expense" },
    { code: "6200", name: "Legal & Professional Fees", type: "expense", subtype: "operating_expense" },
    { code: "6250", name: "Meals & Entertainment", type: "expense", subtype: "operating_expense" },
    { code: "6300", name: "Office Supplies & Software", type: "expense", subtype: "operating_expense" },
    { code: "6350", name: "Rent & Lease", type: "expense", subtype: "operating_expense" },
    { code: "6400", name: "Repairs & Maintenance", type: "expense", subtype: "operating_expense" },
    { code: "6450", name: "Salaries & Wages", type: "expense", subtype: "payroll_expense" },
    { code: "6500", name: "Payroll Taxes", type: "expense", subtype: "payroll_expense" },
    { code: "6550", name: "Taxes & Licenses", type: "expense", subtype: "operating_expense" },
    { code: "6600", name: "Travel", type: "expense", subtype: "operating_expense" },
    { code: "6650", name: "Utilities", type: "expense", subtype: "operating_expense" },
    { code: "6700", name: "Vehicle Expenses", type: "expense", subtype: "operating_expense" },
    { code: "6900", name: "Depreciation Expense", type: "expense", subtype: "operating_expense" },
    { code: "6950", name: "Miscellaneous Expense", type: "expense", subtype: "operating_expense" },
  ],
};

export const COA_TEMPLATES: Record<string, CoaTemplate> = {
  general: GENERAL_COA,
};
