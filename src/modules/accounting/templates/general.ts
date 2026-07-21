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
    { code: "1600", name: "Equipment", type: "asset", subtype: "fixed_asset" },
    { code: "1650", name: "Vehicles", type: "asset", subtype: "fixed_asset" },
    { code: "1700", name: "Accumulated Depreciation", type: "asset", subtype: "accumulated_depreciation" },
    // Liabilities
    { code: "2000", name: "Accounts Payable", type: "liability", subtype: "accounts_payable", isSystem: true },
    { code: "2100", name: "Credit Card", type: "liability", subtype: "credit_card" },
    { code: "2200", name: "Sales Tax Payable", type: "liability", subtype: "sales_tax", isSystem: true },
    { code: "2300", name: "Payroll Liabilities", type: "liability", subtype: "payroll_liability" },
    { code: "2400", name: "Unearned Revenue", type: "liability", subtype: "other_current_liability" },
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
