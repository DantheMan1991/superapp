# Sales Tax Summary

> Taxable and non-taxable sales by tax rate for a period, the tax you charged, and how it compares with what the ledger says you owe.
> **Route:** /dashboard/m/accounting/reports/sales-tax
> **Order:** 300

Open **Reports** in the accounting menu and click `Sales Tax Summary`. Set the dates of the return you are filing and click {button:Run|outline}. The line under the title reads, for example, `Hilltop Farm · 2026-07-01 to 2026-09-30 · accrual basis (invoice date)`, naming the company instead when you keep more than one.

## What you see

- **`Preset`, `From`, `To`.** The dates start on this month.
- **`Company`.** Only when you keep more than one: `All companies (combined)` or one company. There is no consolidated view. A return is filed by one company.
- **The report.** One row per tax rate used on invoices issued in the period, and a bold `Total` row. `Rate`, the rate's name with the percentage beside it, such as `7.25%`; invoices with no tax are gathered on one row, `No tax`, at the bottom, and a rate that can no longer be found reads `Unknown rate`. `Invoices`, how many carried the rate, blank on the `Total` row. `Taxable sales`, the lines the rate was charged on, before tax. `Non-taxable sales`, the lines on those invoices that were not taxed. `Tax collected`, the tax charged. Only invoices issued between the dates count.
- **`Against the ledger`.** Shown when your Sales Tax Payable account has a balance. Three rows: `Tax charged in this period`, `From the invoices above.`; `Owed as at 2026-09-30`, `The Sales Tax Payable balance, from the ledger. Ties to the balance sheet.`; and `Difference`, `Normally not zero. Tax charged in earlier periods and not yet remitted sits in the balance, and a payment to the tax authority reduces it without touching any invoice.`
- **The paragraph under it.** `Accrual basis: tax is counted in the period the invoice was issued, not when the customer paid. If you file on a cash basis, this report is not the figure to file — that recognition is not built yet. Tax collected never appears on the profit and loss; it is a liability until you remit it, which you record as a payment or a journal against Sales Tax Payable.`

## How to run it

1. Set the dates of the return, and `Company` if you keep more than one.
2. Click {button:Run|outline}.

## Messages

| Message | What it means |
| --- | --- |
| `No invoices in this period` and `This report covers invoices issued between the two dates. Drafts and voided invoices are excluded — neither charged anybody anything.` | No invoice was issued in the period. |

## Not on this page

There is no export and no print button. Tax on bills, a default rate or a tax-exempt flag on a customer, filing or paying the return from here, a cash-basis figure, and splitting a combined rate into its state and county parts are not built. Ask us if your return needs any of them.

## Who can do what

Everyone can run this report.
