# Chart of accounts

> The categories every dollar flows through: how the chart is laid out, adding and editing an account, what deactivating does, and the accounts Yosher keeps for itself.
> **Route:** /dashboard/m/accounting/accounts
> **Order:** 180

## The chart

**Chart of Accounts** in the strip. The line under the title reads `The categories every dollar in [your business] flows through.`

Accounts are grouped under **Assets**, **Liabilities**, **Equity**, **Income** and **Expenses**, in code order, with sub-accounts indented under their parent. Each row shows the code, the name, a `system` badge on the accounts Yosher manages, an `inactive` badge on a deactivated account, and its kind at the right, such as `operating expense` or `accounts receivable`.

Balances are not shown here. For balances, open Trial Balance.

Your books start with a standard chart: bank and cash accounts, receivables and payables, inventory, equipment, owner's equity, sales and other income, cost of goods sold, and the usual expense accounts from advertising to utilities.

## Adding an account

Owners click **Add account**: `A new category in the chart of accounts.`

- **Code.** A number such as `6800`. Required, and must not be in use.
- **Name.** For example `Equipment Rental`. Required.
- **Type.** `Asset`, `Liability`, `Equity`, `Income` or `Expense`.
- **Parent account.** `None (top level)`, or an existing account of the same type to sit under. The chart goes three levels deep at most.
- **Description (optional).**

Click **Add account**. You see `Account added`.

## Editing

The dots at the end of a row open **Edit** and **Deactivate** or **Reactivate**. The edit dialog reads `Changes apply everywhere this account is used.` The type cannot be changed once an account exists. Click **Save changes**.

A system account, such as Accounts Receivable or Sales Tax Payable, can be renamed but not recoded, moved or deactivated: `System account — the code, type, and position are fixed.`

## Deactivating

Deactivating hides an account from every picker: bank categories, quick add, rules, journal lines and the assistant's suggestions. Anything already posted to it stays, and the account still shows here and on the trial balance while it has a balance. Posting something new to it, including a draft journal that names it, is refused: `One of the selected accounts is inactive.` Nothing is ever deleted from the chart.

## Accounts you cannot pick by hand

A few accounts appear in the chart but are set only by Yosher: each bank account's own ledger account, Opening Balance Equity, Goods Received Not Invoiced, Inventory, Services Received Not Invoiced, the Due from and Due to Affiliates accounts, and Accounts Receivable and Payable. A bill or invoice line cannot be coded to them. A journal entry may name any active account.

Opening balances are entered when a bank account is added on the Banking page, not here.
