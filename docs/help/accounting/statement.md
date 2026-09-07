# A customer's statement

> What one customer owed coming into a period, every invoice and payment inside it with a running balance, what they owe going out, and the invoices that make up that figure.
> **Route:** /dashboard/m/accounting/sales/customers/*/statement
> **Order:** 115
> **Area:** Sales

Open **Sales** in the accounting menu, click the `Customers` pill, open a customer's menu and choose `Statement`. Or click the customer's name at the top of any of their invoices. This is the page you send a customer at month end, or read before you phone them.

## What you see

- **The top of the page.** The title is `Statement`. The line under it reads `[customer] · 2026-08-01 to 2026-08-31 · 1,240.00 owed at the end`. {button:Customers|outline} goes back to the list, and {button:Print|outline|printer} prints the page with a header carrying your business name, `Statement`, the customer's name and address, and the period.
- **`Preset`, `From`, `To`.** The dates start on this month. Pick a preset or type the dates and click {button:Run|outline}. Everything before `From` is folded into the balance forward, so a statement for one month is complete on its own.
- **The statement.** `Date`, `Detail`, `Company` when you keep more than one, `Charges`, `Payments` and `Balance`. The first row is `Balance forward`, what the customer owed the day before the period. Then each invoice issued in the period, `INV-0009 Invoice · due 2026-10-01`, under `Charges`, and each payment, `INV-0009 Payment · check`, with its memo, under `Payments`, in date order with the balance after each line. The number is a link to the invoice. The last row is `Closing balance`: the charges and payments of the period added up, and what is owed at the end.
- **`Open invoices as of [date]`.** The invoices that make up the closing balance, oldest due first: `Number`, `Issued`, `Due`, with {badge:overdue|destructive} on one whose due date has passed, `Company` when you keep more than one, `Total` and `Balance`. Their balances add up to the closing balance. Not shown when nothing is owed.

Drafts are not on a statement, because a draft is not yet a claim, and a void invoice never was. A payment that was unapplied is gone from it, and a deposit changes nothing here: the customer paid on the day the payment was recorded, wherever the money went afterwards.

## How to send a statement

1. Set the period, usually the month just ended, and click {button:Run|outline}.
2. Click {button:Print|outline|printer}. Your browser's print dialog can save the page as a PDF; attach that to an email from Mail, or hand it over.

## Messages

| Message | What it means |
| --- | --- |
| `Nothing owed, nothing happened` and `No invoice was issued and no payment arrived in this period, and the customer owed nothing coming into it.` | The period is empty and the balance forward is zero. Widen the dates to see earlier activity. |

## Not on this page

There is no button that emails the statement, and no statement for every customer at once; ask us if you need either. Reminders for overdue invoices go out on their own from the Reminders page, and do not use this page.

## Who can do what

Everyone can open and print a statement.
