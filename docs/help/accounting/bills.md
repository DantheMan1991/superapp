# Bills

> What you owe vendors: the four money tiles, the status filter, the list, and what each status word means.
> **Route:** /dashboard/m/accounting/purchases/bills, /dashboard/m/accounting/purchases
> **Order:** 10

## The title line

**Purchases** in the strip brings you here. The title is **Bills** and the line under it reads `What [your business] owes vendors — 12,480.00 outstanding.` When anything is late it adds `· 2,140.00 overdue` in red. Figures on accounting pages carry no currency symbol, and a negative one is shown in brackets.

**New bill** at the right opens the bill form. See the guide **Record a bill**.

Under the strip, two pills switch between **Bills** and **Vendors**.

## The four money tiles

Four tiles sit above the list, and all four are always there, even at zero, so the page keeps its shape.

- **Overdue.** Bills with money still owed whose due date has passed. The figure turns red only when it is above zero.
- **Not due yet.** Bills with money still owed that are due today or later, or have no due date.
- **Awaiting approval.** Bills that have been submitted and are waiting for an owner. They are not on the ledger yet, so they sit here rather than in either date tile.
- **Paid recently.** Payments made in the last 30 days.

Each tile shows the amount and a count, `3 bills`. Click a tile and the list shows only those bills, with a line underneath, `Filtered to Overdue · show all`. The tiles count every bill you have, not only the ones the list can show.

## The status filter

Six pills at the right, above the list: **All**, **Drafts**, **Awaiting approval**, **Open**, **Paid** and **Void**. **Open** means approved bills, paid or not, that still have a balance. Choosing a tile switches this back to **All**; choosing a pill clears the tile.

If your books hold more than one company, a **Company** picker sits beside the pills: `All companies`, or one company. It keeps the tile and pill you have chosen.

## The list

Newest bills first, up to 200. The columns:

- **Vendor.** The vendor's name. Click it to open the bill. Nothing else in the row is a link.
- **Company.** Only when you keep more than one.
- **Invoice #.** The vendor's own invoice number, or a dash.
- **Bill date** and **Due.**
- **Total.**
- **Balance.** What is still owed. A draft or a bill awaiting approval shows its full total, because nothing has been paid against it yet. A void bill shows a dash.
- **Status.** A badge, explained below.

## What the status words mean

The badge is worked out from the money and the dates, not from a stored label, and it changes as the days pass.

- **Void.** Cancelled.
- **Draft.** Not yet submitted or approved.
- **Awaiting approval.** Submitted and waiting for an owner. It has no date to be late against, so it shows this whatever the due date.
- **Paid.** Nothing left owing. The money is the fact, whatever else was recorded.
- **Open.** Still owed, with no due date.
- **Overdue 1 day**, **Overdue 60 days.** Still owed and past due.
- **Due today.**
- **Due tomorrow**, **Due in 5 days.** Still owed and not yet due. Within a week it is highlighted; further out it is muted.

On the bill's own page you see its stage instead, such as `approved` or `partial`.

## When the list is empty

With no filter, the page says **Record your first bill** and `Add one directly, or open the Inbox and use “Create bill” on an emailed one.`, with a **New bill** button. With a filter that matches nothing, it says **Nothing here** and `Another status filter may have what you are after.`

## What this page does not have

There is no search box, no vendor or date filter, no sorting by column, and nothing to tick or do to several bills at once. Open a bill to act on it.
