# A/P Aging

> What you owe your vendors and how overdue it is: every open bill balance on a date, bucketed by days past due, vendor by vendor.
> **Route:** /dashboard/m/accounting/reports/ap-aging
> **Order:** 290

## The page

**A/P Aging** from the Reports page. The line under the title reads, for example, `Hilltop Farm · open bills as of 2026-08-31 by days past due. Voided bills are excluded.`, naming the company instead when you keep more than one. A badge at the top right reads `830.00 overdue` in red when anything is past due, or `Nothing overdue` in green.

This report has no export and no print button. The bills list and each bill's page hold the detail.

## The controls

- **As of.** The date. Today to begin with. The report shows what was open on that day: bills dated on or before it, less payments made on or before it.
- **Company.** Only when you keep more than one: `All companies (combined)` or one company. There is no consolidated view, because money one of your companies owes another is a transfer between them, not a bill.

Click **Run**.

## The report

One row per vendor with a balance outstanding, under the column headed **Account**, and a bold `Total` row. The other columns are the buckets:

- **Current.** Not yet due, or with no due date.
- **1–30**, **31–60**, **61–90** and **90+.** Days past the due date on the as-of date.
- **Total.** Everything you owe the vendor.

Everything outside `Current` is the overdue figure in the badge. Only bills with something still to pay appear. Drafts and voided bills are never counted.

When nothing is outstanding: `Nothing outstanding` and `No open bills as of this date.`

Everyone can run this report.
