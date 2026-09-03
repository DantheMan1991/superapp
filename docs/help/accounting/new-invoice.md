# Write an invoice

> The invoice form: every field, the lines, terms and tax, saved items, and what Save draft does. The same form appears when you edit a draft.
> **Route:** /dashboard/m/accounting/sales/invoices/new
> **Order:** 80

## Before you start

The customer has to exist. If you have none yet the form does not appear; the page says `Add a customer first (Sales → Customers).` There is no way to add a customer from inside the form.

The title is **New invoice** and the line under it reads `Saved as a draft — nothing posts to the books until you issue it.` Issuing happens on the invoice's page afterwards.

## The top fields

- **Company.** Only when your books hold more than one company, and only when creating. `Which company is invoicing?` It cannot be changed once the draft is saved.
- **Customer.** One of your active customers. Required.
- **Number.** Filled in for you with the next number, for example `INV-0009`. You can type your own. A number already used is refused when you save.
- **Issue date.** Starts as today. Changing it moves the due date along with it when terms are set.
- **Terms.** Shown once your catalogue has payment terms. Picking one, for example `Net 30`, sets the due date from the issue date, and a line under the due date reads `Net 30 — due 2026-09-11 (30 days)`. A new invoice starts on your default terms. The box reads `Custom` when the due date was typed by hand.
- **Due date (optional).** Typing a date here clears the terms, because a date you typed is yours, not the terms'.
- **Memo.** `Shown on the printed invoice`.
- **Sales tax.** Shown once your catalogue has a tax rate. `No tax`, or a rate such as `Ohio state and county · 7.25%`. Choosing a rate ticks the Tax box on every line; switching back to `No tax` leaves the boxes as they are.

## The lines

One row is there to begin with. **Add line** adds another, and the bin icon at the end of a row removes it. The last row cannot be removed.

- **Description.** `What was provided`.
- **Qty.** Starts as 1. Up to two decimals.
- **Unit price.**
- **Disc.** Tick it for a discount, and the line counts against the invoice instead of adding to it.
- **Tax.** Only shown when a rate is chosen. Tick the lines the tax applies to.
- **Income account.** Which income account the line is earned to. The list offers your income accounts.
- **Amount.** Worked out from the quantity and the price.
- **Tag.** Under each line, when your business has lines of business or other tags set up, a **Tag** button opens a small panel with one list per kind of tag.

**Add a saved item…** appears once your catalogue has saved items. Pick one and a new line is added with its description, a quantity of 1, its price and its income account. Edit the line afterwards if the price differs this time.

## The totals

At the foot of the form, **Subtotal** and a tax row such as `Ohio state and county (7.25%)` appear when a rate is chosen, and **Total** always. Tax is worked out once on the sum of the taxable lines, so the total matches rate times base to the cent.

## Saving

Click **Save draft** on a new invoice, or **Save changes** on an existing draft. The button stays greyed out until there is a customer, an issue date and a valid amount on every filled line. Rows with nothing in them are ignored; at least one filled line is needed.

When it saves you see `Draft saved` and land on the invoice's page, where **Issue** posts it to the books.

## Messages you may see

- `That customer is inactive — reactivate them first.`
- `That invoice number is already in use.`
- `That tax rate is inactive or no longer exists — pick another one.`
- `One of the selected accounts is inactive.`
- `One of the selected tags is invalid or inactive.`
- `This entry changed since you opened it — reload and try again.` Someone else saved this draft first.
- `Accountant access is read-only — reviews, sign-offs and exports only.` You have accountant access, which can read but not change.

A draft dated in a closed month saves; the refusal comes when you issue it.

## Editing a draft

**Edit** on a draft's page opens this same form on that page. The company cannot be changed. The terms box reads `Custom` and the saved due date stays until you change it. The button reads **Save changes** and you see `Draft updated`.
