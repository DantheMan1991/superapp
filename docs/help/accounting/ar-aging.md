# A/R Aging

> Who owes you and how overdue it is: every open invoice balance on a date, bucketed by days past due, customer by customer.
> **Route:** /dashboard/m/accounting/reports/ar-aging
> **Order:** 280

## The page

**A/R Aging** from the Reports page. The line under the title reads, for example, `Hilltop Farm · open balances as of 2026-08-31 by days past due. Voided invoices are excluded.`, naming the company instead when you keep more than one. A badge at the top right reads `1,250.00 overdue` in red when anything is past due, or `Nothing overdue` in green.

This report has no export and no print button. The customer list and each invoice's page hold the detail.

## The controls

- **As of.** The date. Today to begin with. The report shows what was open on that day: invoices issued on or before it, less payments received on or before it.
- **Company.** Only when you keep more than one: `All companies (combined)` or one company. There is no consolidated view, because money one of your companies owes another is not a receivable.

Click **Run**.

## The report

One row per customer with a balance outstanding, under the column headed **Account**, and a bold `Total` row. The other columns are the buckets:

- **Current.** Not yet due, or with no due date.
- **1–30**, **31–60**, **61–90** and **90+.** Days past the due date on the as-of date.
- **Total.** Everything the customer owes.

Everything outside `Current` is the overdue figure in the badge. Only invoices with something still to pay appear. Drafts and voided invoices are never counted.

When nothing is outstanding: `Nothing outstanding` and `No open invoices as of this date.`

Everyone can run this report.
