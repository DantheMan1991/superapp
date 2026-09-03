# Invoices

> What customers owe you: the four money tiles, the status filter, the list, and what each status word means.
> **Route:** /dashboard/m/accounting/sales/invoices, /dashboard/m/accounting/sales
> **Order:** 70

## The title line

**Sales** in the strip brings you here. The title is **Invoices** and the line under it reads, for example, `12,480.00 outstanding`, adding `· 2,140.00 overdue` in red when anything is late. Figures on accounting pages carry no currency symbol, and a negative one is shown in brackets.

**New invoice** at the right opens the invoice form. See the guide **Write an invoice**.

Under the strip, four pills switch between **Invoices**, **Customers**, **Reminders** and **Catalogue**.

## The four money tiles

All four tiles are always there, even at zero.

- **Overdue.** Invoices with money still owed whose due date has passed. The figure turns red only when it is above zero.
- **Not due yet.** Invoices with money still owed that are due today or later, or have no due date.
- **Not deposited.** Payments you have recorded into Undeposited Funds and not yet banked, from any time.
- **Deposited.** Payments recorded into a bank account in the last 30 days.

The first two count what is still owed; the last two count what has arrived. One invoice can sit in two tiles, so the counts do not add up to the number of invoices. Each tile shows an amount and a count, `3 invoices`. Click a tile and the list shows only those invoices, with `Filtered to Overdue · show all` underneath. The tiles count every invoice, not only the ones the list can show.

## The status filter

Four pills at the right, above the list: **Open**, **Drafts**, **Paid** and **All**. **Open** is the starting view: issued invoices, paid or not, that still have a balance. Choosing a tile switches this to **All**; choosing a pill clears the tile.

If your books hold more than one company, a **Company** picker sits beside the pills: `All companies`, or one company. It keeps the tile and pill you have chosen.

## The list

Newest first, up to 200. The columns:

- **Number.** The invoice number. Click it to open the invoice.
- **Customer.**
- **Company.** Only when you keep more than one.
- **Issued** and **Due.** The due date is shown in red once it has passed.
- **Status.** A badge, explained below.
- **Total** and **Balance.** A void invoice's balance is zero.

## What the status words mean

The badge is worked out from the money and the dates, and it changes as the days pass.

- **Void.** Cancelled.
- **Draft.** Written but not issued. It is not in your books yet.
- **Paid.** Nothing left owing.
- **Open.** Still owed, with no due date.
- **Overdue 1 day**, **Overdue 60 days.** Still owed and past due.
- **Due today.**
- **Due tomorrow**, **Due in 5 days.** Still owed and not yet due. Within a week it is highlighted; further out it is muted.

On the invoice's own page you see its stage instead: `draft`, `issued`, `partial`, `paid` or `void`.

## When the list is empty

With no filter, the page says **Bill your first customer** and `Raise an invoice and the receivable posts to the ledger for you.`, with a **New invoice** button. With a pill that matches nothing, it says **Nothing under Open**, or Drafts, or Paid, and `The other filters may have what you are looking for.` An empty tile shows the first message too, because a tile sets the filter to All.

## What this page does not have

There is no search box and no date filter, no sorting by column, and nothing to do to several invoices at once. Open an invoice to act on it.
