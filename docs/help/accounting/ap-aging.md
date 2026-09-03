# A/P Aging

> What you owe your vendors and how overdue it is: every open bill balance on a date, bucketed by days past due, vendor by vendor.
> **Route:** /dashboard/m/accounting/reports/ap-aging
> **Order:** 290

Open **Reports** in the accounting menu and click `A/P Aging`. Set the date and click {button:Run|outline}. The line under the title reads, for example, `Hilltop Farm · open bills as of 2026-08-31 by days past due. Voided bills are excluded.`, naming the company instead when you keep more than one.

## What you see

- **The badge at the top right.** {badge:830.00 overdue|destructive} when anything is past due, or {badge:Nothing overdue|success}.
- **`As of`.** The date. Today to begin with. The report shows what was open on that day: bills dated on or before it, less payments made on or before it.
- **`Company`.** Only when you keep more than one: `All companies (combined)` or one company. There is no consolidated view, because money one of your companies owes another is a transfer between them, not a bill.
- **The report.** One row per vendor with a balance outstanding, under the column headed `Account`, and a bold `Total` row. The other columns are the buckets: `Current`, not yet due, or with no due date; `1–30`, `31–60`, `61–90` and `90+`, days past the due date on the as-of date; and `Total`, everything you owe the vendor. Everything outside `Current` is the overdue figure in the badge. Only bills with something still to pay appear. Drafts and voided bills are never counted.

## How to run it

1. Set `As of`, and `Company` if you keep more than one.
2. Click {button:Run|outline}.

## Messages

| Message | What it means |
| --- | --- |
| `Nothing outstanding` and `No open bills as of this date.` | You owed nothing on that day. |

## Not on this page

This report has no export and no print button. The bills list and each bill's page hold the detail.

## Who can do what

Everyone can run this report.
