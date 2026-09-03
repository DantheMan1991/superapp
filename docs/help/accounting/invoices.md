# Invoices

> What customers owe you: the four money tiles, the status filter, the list, and what each status badge means. Write a new invoice from here.
> **Route:** /dashboard/m/accounting/sales/invoices, /dashboard/m/accounting/sales
> **Order:** 70

Open **Sales** in the accounting menu. This page lists every invoice, with what is owed at the top. To write a new one, click {button:New invoice|primary} at the top right. See [Write an invoice](new-invoice.md).

## What you see

- **The total you are owed.** Under the title, for example `12,480.00 outstanding`, with `· 2,140.00 overdue` in red when anything is late. Accounting pages show no currency symbol. A negative amount is in brackets.
- **`Invoices`, `Customers`, `Reminders` and `Catalogue`.** Four pills under the accounting menu that switch between the Sales pages.
- **Four money tiles.** Always shown, even at zero. Each shows an amount and a count, such as `3 invoices`. Click a tile to show only those invoices. `Filtered to Overdue · show all` appears under the tiles, and `show all` clears it.
  - `Overdue`. Invoices still owed whose due date has passed. The amount turns red when it is above zero.
  - `Not due yet`. Invoices still owed that are due today or later, or have no due date.
  - `Not deposited`. Payments you have recorded into Undeposited Funds and not yet banked, from any time.
  - `Deposited`. Payments recorded into a bank account in the last 30 days.
  The first two count what is still owed; the last two count what has arrived. One invoice can sit in two tiles, so the counts do not add up to the number of invoices.
- **Status pills.** Above the list, at the right: `Open`, `Drafts`, `Paid` and `All`. `Open` is the starting view: issued invoices, paid or not, that still have a balance. Clicking a tile sets the pills to `All`, and clicking a pill clears the tile.
- **`Company`.** Only when you keep more than one company. Pick one company or `All companies`. Your tile and pill stay as they are.
- **The list.** Newest first, up to 200. `Number`, which opens the invoice. `Customer`. `Company`, only when you keep more than one. `Issued` and `Due`, with the due date in red once it has passed. `Status`, a badge, explained next. `Total` and `Balance`. A void invoice's balance is zero.

## What the status badges mean

The badge is worked out from the money and the dates, so it changes as days pass.

- {badge:Draft|secondary} Written but not issued. It is not in your books yet.
- {badge:Open|secondary} Issued and still owed, with no due date.
- {badge:Due in 5 days|primary} Still owed and due within a week. Beyond a week the badge is gray, such as {badge:Due in 12 days|secondary}. `Due today` and `Due tomorrow` are spelled out.
- {badge:Overdue 12 days|destructive} Still owed and past its due date.
- {badge:Paid|outline} Nothing left owing.
- {badge:Void|outline} Canceled. It has no effect on the books.

The invoice's own page shows its stage instead: `draft`, `issued`, `partial`, `paid` or `void`. See [An invoice's page](invoice.md).

## How to find an invoice

1. Click a status pill, or `All` to see everything.
2. If you keep more than one company, pick it in `Company`.
3. Click the number in the `Number` column. The invoice opens.

There is no search box on this page. If you have the customer's name but not the invoice, open `Customers` and look at what they owe.

## How to see what is overdue

1. Click the `Overdue` tile. The list shows only invoices past their due date, and `Filtered to Overdue · show all` appears under the tiles.
2. Click an invoice to open it and record a payment, or send it again.
3. Click `show all` to see every invoice again.

## Messages

| Message | What it means |
| --- | --- |
| `Bill your first customer` and `Raise an invoice and the receivable posts to the ledger for you.` | You have no invoices yet. Click {button:New invoice|primary}. An empty tile shows this too, because a tile sets the filter to `All`. |
| `Nothing under Open` (or `Drafts`, or `Paid`) and `The other filters may have what you are looking for.` | No invoice matches the pill you chose. Click `All`. |

## Not on this page

There is no search box, no date filter, no sorting by column, and nothing you can do to several invoices at once. Open an invoice to act on it. Ask us if you need one of these.

## Who can do what

Owners, staff and accountants all see the same page, tiles and list. What each person can do with an invoice is on the invoice's own page.
