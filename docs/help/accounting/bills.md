# Bills

> Every bill your vendors have sent you, what you still owe, and what is overdue. Record a new bill from here.
> **Route:** /dashboard/m/accounting/purchases/bills, /dashboard/m/accounting/purchases
> **Order:** 10

Open **Purchases** in the accounting menu. This page lists every bill, with the money you owe at the top. To record a new one, click {button:New bill|primary} at the top right. See [Record a bill](new-bill.md).

## What you see

- **The total you owe.** Under the title: `What [your business] owes vendors — 12,480.00 outstanding.` When anything is late, the overdue amount follows in red. Accounting pages show no currency symbol. A negative amount is in brackets.
- **`Bills` and `Vendors`.** Two pills under the accounting menu. `Vendors` opens your vendor list.
- **Four money tiles.** Always shown, even at zero. Each one shows an amount and a count, such as `3 bills`. Click a tile to show only those bills. The line `Filtered to Overdue · show all` appears under the tiles, and `show all` clears it.
  - `Overdue`. Bills still owed whose due date has passed. The amount turns red when it is above zero.
  - `Not due yet`. Bills still owed that are due today or later, or have no due date.
  - `Awaiting approval`. Bills a staff member has submitted for an owner to approve. They are not in the books yet.
  - `Paid recently`. Payments made in the last 30 days.
- **Status pills.** Above the list, at the right: `All`, `Drafts`, `Awaiting approval`, `Open`, `Paid` and `Void`. `Open` means approved bills with a balance, paid in part or not at all. Clicking a pill clears the tile you chose, and clicking a tile sets the pills back to `All`.
- **`Company`.** Only when you keep more than one company. Pick one company or `All companies`. Your tile and pill stay as they are.
- **The list.** Newest bills first, up to 200.
  - `Vendor`. Click the name to open the bill. Nothing else in the row is a link.
  - `Company`. Only when you keep more than one.
  - `Invoice #`. The vendor's own invoice number, or a dash.
  - `Bill date` and `Due`.
  - `Total`.
  - `Balance`. What is still owed. A draft or a bill awaiting approval shows its full total, because nothing has been paid against it. A void bill shows a dash.
  - `Status`. A badge, explained next.

## What the status badges mean

The badge is worked out from the money and the dates, so it changes as days pass.

- {badge:Draft|secondary} Not yet submitted or approved.
- {badge:Awaiting approval|secondary} Submitted and waiting for an owner. It never shows as overdue, whatever its due date.
- {badge:Open|secondary} Approved and still owed, with no due date.
- {badge:Due in 5 days|primary} Still owed and due within a week. Beyond a week the badge is gray, such as {badge:Due in 12 days|secondary}. `Due today` and `Due tomorrow` are spelled out.
- {badge:Overdue 12 days|destructive} Still owed and past its due date.
- {badge:Paid|outline} Nothing left owing.
- {badge:Void|outline} Canceled. It has no effect on the books.

The bill's own page shows its stage instead, such as `approved` or `partial`. See [A bill](bill.md).

## How to find a bill

1. Click a status pill, or `All` to see everything.
2. If you keep more than one company, pick it in `Company`.
3. Click the vendor's name in the `Vendor` column. The bill opens.

There is no search box on this page. If you have the vendor's name but not the bill, open `Vendors` and pick the vendor.

## How to see what is overdue

1. Click the `Overdue` tile. The list shows only bills past their due date, and `Filtered to Overdue · show all` appears under the tiles.
2. Click a vendor's name to open a bill and record a payment.
3. Click `show all` to see every bill again.

## Messages

| Message | What it means |
| --- | --- |
| `Record your first bill` and `Add one directly, or open the Inbox and use “Create bill” on an emailed one.` | You have no bills yet. Click {button:New bill|primary} here, or open a bill a vendor emailed you from the Inbox. |
| `Nothing here` and `Another status filter may have what you are after.` | No bill matches the pill or tile you chose. Click `All`. |

## Not on this page

There is no search, no filter by vendor or date, no sorting by column, and nothing you can do to several bills at once. Open a bill to act on it. Ask us if you need one of these.

## Who can do what

Owners, staff and accountants all see the same page, tiles and list, and everyone can click {button:New bill|primary}. What each person can do with a bill is on the bill's own page.
