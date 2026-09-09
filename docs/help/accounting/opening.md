# Opening position

> The day the books begin, the invoices and bills that were still open on it, and where the books stand on that day, with Opening Balance Equity named as the plug.
> **Route:** /dashboard/m/accounting/opening
> **Order:** 315
> **Area:** Opening

Open **Accounting** and click the `Opening` tab, beside `Close`. The line under the title reads `What was open on the day the books began, and where they stand on that day.` This is the screen for moving a business into Yosher: say when the books begin, record what people owed you and what you owed on that day, and read the balances the books start from. Everything on it is as of one day, for one company.

## What you see

- **The company pills.** Only when your books hold more than one company: one pill per company under the accounting menu, reading its name and `begins 2026-01-01` or `no start day`. Click one to work on that company's opening position. Each company has its own day and its own opening documents.
- **`Books begin on`.** The same card as on the Close page. Once set it reads `2026-01-01. Everything below is as of this day. Nothing may be dated before it, and an imported statement drops the earlier lines.` Before that it reads `Not set. Say when the books begin first — an open invoice or bill is dated on that day, and so is every balance below.` Owners see {button:Set the date|outline}, or {button:Change|outline} once it is set. See [Close](close.md) for the dialog.
- **`Owed to you on that day`.** Invoices you had sent before the books began and had not been paid by then. The line under the title says what they are: each is a real invoice that ages, can be paid and appears on statements; on that day it counts as Opening Balance Equity rather than this year's sales, and when it is paid the cash basis counts it as income under the account you picked. Owners see {button:Add an open invoice|outline|plus}, grayed until the day is set. The list has `Number`, which opens the invoice, `Customer`, `Issued`, `Due`, `Amount` and `Status`: {badge:open|outline}, {badge:part paid|outline}, {badge:paid|secondary} or {badge:void|outline}. With nothing recorded it reads `Nothing recorded. If nobody owed you anything on that day, there is nothing to do here.` On a phone the issued and due dates are left out of the list; open the invoice for them.
- **`You owed on that day`.** The same for bills you had received before the books began and had not paid by then, with {button:Add an open bill|outline|plus} and the columns `Number`, `Vendor`, `Billed`, `Due`, `Amount` and `Status`. Empty, it reads `Nothing recorded. If you owed nobody anything on that day, there is nothing to do here.`
- **`Where the books stand on that day`.** Every account with a balance as of the day, on the accrual basis, with `Debit` and `Credit` columns and a `Total` row that agrees. The `Opening Balance Equity` row is shaded and carries {badge:the plug|secondary}: its balance is what has been entered so far, taken together. The line under the title reads `Every balance as of 2026-01-01, before anything of this year moves. Opening Balance Equity is the plug: what has been entered so far, taken together. When every balance is in, your accountant moves it to retained earnings with one entry, and Export books on the Close page gives them all of it.` {button:Trial balance that day|outline} opens the full trial balance as of the day. With nothing posted yet it reads `Nothing posted as of that day yet. A register's opening balance, an open invoice or bill, or a journal entry dated on it will appear here.` Before the day is set, the card reads `Set the day first. The balances below are read as of it.` and has no table.
- **The last line.** `Equipment owned before the books began, and the depreciation already taken on it, is entered on each asset's own page under Assets.` Open the thing under Assets and use `Put it on the books` at the foot of its Depreciation panel; see [One asset](../assets/asset.md). Its cost and what had been written off by that day both land here, in the standing below.

## How to say when your books begin

The control is the one on the Close page and works the same way; see [Close](close.md). Set it here first: until the day exists, both {button:Add an open invoice|outline|plus} and {button:Add an open bill|outline|plus} stay gray, and the standing card has nothing to read.

## How to record an invoice open when the books began

1. Click {button:Add an open invoice|outline|plus}. `An invoice open when the books began` opens and reads `An invoice you had sent before 2026-01-01 and had not been paid by then. It becomes a real invoice that ages and can be paid. On 2026-01-01 it counts as Opening Balance Equity, not this year's sales; when it is paid, the cash basis counts it as income under the account you pick.`
2. Pick the `Customer`. The list holds your active customers; with none it reads `No customers yet. Add them on the Customers page first.`
3. Type the `Number` as printed on the invoice, or leave it blank for the next number in your sequence. Type the `Amount still owed`, what was unpaid on the day, not the invoice's original total if part had been paid.
4. Pick `Issued on`, the invoice's own date. It must be before the day the books begin, and the line under it says `Before 2026-01-01.` Pick `Due on (optional)`; the invoice ages by it, so an old one shows as overdue at once.
5. Pick the `Income account`. The line under it reads `Where the cash basis counts it when the money moves. On the day the books begin it is Opening Balance Equity either way.`
6. Add a `Memo (optional)`.
7. Click {button:Record the invoice|primary}. It stays gray until there is a customer, a date before the day, an amount above zero and an account. It reads `Recording…`, then you see `Recorded INV-2025-118, open from 2025-11-15`, the dialog closes and the invoice appears in the list, {badge:open|outline}.

The invoice is issued at once: there is no draft to edit. Open it from the list to record a payment, send it, or void it, the way you would any invoice; see [An invoice's page](invoice.md). It carries one line, no tax and no {{enterprise|lower}}, and its entry in the journal is dated on the day the books begin with the words `open when the books began`.

## How to record a bill open when the books began

1. Click {button:Add an open bill|outline|plus}. `A bill open when the books began` opens and reads `A bill you had received before 2026-01-01 and had not paid by then. It becomes a real bill that ages and can be paid. On 2026-01-01 it counts as Opening Balance Equity, not this year's expense; when it is paid, the cash basis counts it under the account you pick.`
2. Pick the `Vendor`. With none, the line reads `No vendors yet. Add them on the Vendors page first.`
3. Type the `Number`, the vendor's invoice number, and the `Amount still owed`.
4. Pick `Billed on`, before the day, and `Due on (optional)`.
5. Pick the `Expense account`, or an asset account for something bought and not yet paid for.
6. Click {button:Record the bill|primary}. You see `Recorded the bill from Tractor Supply, open from 2025-12-01`, and the bill appears in the list. It is approved at once; open it to pay it. See [A bill's page](bill.md).

## Messages

| Message | What it means |
| --- | --- |
| `Recorded INV-2025-118, open from 2025-11-15` and `Recorded the bill from Tractor Supply, open from 2025-12-01` | The document is in, issued or approved, and dated on the day the books begin. |
| `Say when your books begin first. An opening balance is dated on that day, and there is no day yet.` | The day was cleared between opening the dialog and recording. Set it and try again. |
| `An open invoice or bill is one dated before the books began. This one is not — record it as an ordinary invoice or bill instead.` | The `Issued on` or `Billed on` date is on or after the day the books begin. |
| `Not a real calendar date` | A date that does not exist. |
| `Pick or create a customer.` and `That vendor is inactive — reactivate them first.` | The usual refusals from the invoice and bill forms, which this dialog shares. |
| `Accountant access is read-only — reviews, sign-offs and exports only.` | You have accountant access, which can read but not change. |

## Not on this page

A register's opening balance is entered when the account is added, under Banking. Equipment owned before the books began, and the depreciation already taken on it, is recorded on the asset's own page under Assets. Payments against an open invoice or bill are recorded on that document's page. The export for your accountant is {button:Export books|outline} on the Close page.

## Who can do what

Only an owner sets the day and records open invoices and bills. Owners, staff and accountants all see the page, the lists and the standing.
