# Sales Tax Summary

> Taxable and non-taxable sales by tax rate for a period, the tax you charged, and how it compares with what the ledger says you owe.
> **Route:** /dashboard/m/accounting/reports/sales-tax
> **Order:** 300

## The page

**Sales Tax Summary** from the Reports page. The line under the title reads, for example, `Hilltop Farm · 2026-07-01 to 2026-09-30 · accrual basis (invoice date)`, naming the company instead when you keep more than one. There is no export and no print button.

## The controls

- **Preset**, **From**, **To.** The dates start on this month. Use the dates of the return you are filing.
- **Company.** Only when you keep more than one: `All companies (combined)` or one company. There is no consolidated view. A return is filed by one company.

Click **Run**.

## The report

One row per tax rate used on invoices issued in the period, and a bold `Total` row:

- **Rate.** The rate's name, with the percentage beside it, for example `7.25%`. Invoices with no tax are gathered on one row, `No tax`, at the bottom. A rate that can no longer be found reads `Unknown rate`.
- **Invoices.** How many invoices carried the rate. Blank on the Total row.
- **Taxable sales.** The lines the rate was charged on, before tax.
- **Non-taxable sales.** The lines on those invoices that were not taxed.
- **Tax collected.** The tax charged.

Only invoices issued between the dates count. When there are none: `No invoices in this period` and `This report covers invoices issued between the two dates. Drafts and voided invoices are excluded — neither charged anybody anything.`

## Against the ledger

When your Sales Tax Payable account has a balance, a second panel, `Against the ledger`, sets the invoices against the books:

- `Tax charged in this period`. `From the invoices above.`
- `Owed as at 2026-09-30`. `The Sales Tax Payable balance, from the ledger. Ties to the balance sheet.`
- `Difference`. `Normally not zero. Tax charged in earlier periods and not yet remitted sits in the balance, and a payment to the tax authority reduces it without touching any invoice.`

The paragraph under it reads: `Accrual basis: tax is counted in the period the invoice was issued, not when the customer paid. If you file on a cash basis, this report is not the figure to file — that recognition is not built yet. Tax collected never appears on the profit and loss; it is a liability until you remit it, which you record as a payment or a journal against Sales Tax Payable.`

## What it does not do

Tax on bills, a default rate or a tax-exempt flag on a customer, filing or paying the return from here, a cash-basis figure, and splitting a combined rate into its state and county parts are not built. Ask us if your return needs any of them.

Everyone can run this report.
