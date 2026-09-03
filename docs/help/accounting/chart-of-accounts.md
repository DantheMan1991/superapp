# Chart of accounts

> The categories every dollar flows through: how the chart is laid out, adding and editing an account, what deactivating does, and the accounts Yosher keeps for itself.
> **Route:** /dashboard/m/accounting/accounts
> **Order:** 180

Open **Chart of Accounts** in the accounting menu. The line under the title reads `The categories every dollar in [your business] flows through.` Your books start with a standard chart: bank and cash accounts, receivables and payables, inventory, equipment, owner's equity, sales and other income, cost of goods sold, and the usual expense accounts from advertising to utilities. To add one, owners click {button:Add account|primary|plus}.

## What you see

- **The groups.** `Assets`, `Liabilities`, `Equity`, `Income` and `Expenses`, in code order, with sub-accounts indented under their parent.
- **Each row.** The code, the name, {badge:system|secondary} on the accounts Yosher manages, {badge:inactive|outline} on a deactivated account, and its kind at the right, such as `operating expense` or `accounts receivable`. The dots at the end open `Edit` and `Deactivate` or `Reactivate`.
- **No balances.** For balances, open Trial Balance.

## How to add an account

1. Click {button:Add account|primary|plus}. The dialog reads `A new category in the chart of accounts.`
2. Fill in `Code`, a number such as `6800` that is not in use, and `Name`, such as `Equipment Rental`. Both are required.
3. Pick `Type`: `Asset`, `Liability`, `Equity`, `Income` or `Expense`. Pick `Parent account`: `None (top level)`, or an existing account of the same type to sit under. The chart goes three levels deep at most. Add `Description (optional)` if you like.
4. Click {button:Add account|primary}. You see `Account added`.

## How to edit an account

1. Open the row's menu and choose `Edit`. The dialog reads `Changes apply everywhere this account is used.` The type cannot be changed once an account exists.
2. Click {button:Save changes|primary}.

A system account, such as Accounts Receivable or Sales Tax Payable, can be renamed but not recoded, moved or deactivated.

## How to deactivate an account

1. Open the row's menu and choose `Deactivate`. The account disappears from every picker: bank categories, quick add, rules, journal lines and the assistant's suggestions.
2. Anything already posted to it stays, and the account still shows here and on the trial balance while it has a balance. Choose `Reactivate` to bring it back.

Nothing is ever deleted from the chart.

## Messages

| Message | What it means |
| --- | --- |
| `System account — the code, type, and position are fixed.` | You tried to recode, move or deactivate an account Yosher manages. Renaming is allowed. |
| `One of the selected accounts is inactive.` | Something new was posted to a deactivated account, including a draft journal that names it. Reactivate it, or pick another. |

## Not on this page

A few accounts appear in the chart but are set only by Yosher: each bank account's own ledger account, Opening Balance Equity, Goods Received Not Invoiced, Inventory, Services Received Not Invoiced, the Due from and Due to Affiliates accounts, and Accounts Receivable and Payable. A bill or invoice line cannot be coded to them. A journal entry may name any active account. Opening balances are entered when a bank account is added on the Banking page, not here.

## Who can do what

Owners add, edit and deactivate. Staff and accountants read the chart.
