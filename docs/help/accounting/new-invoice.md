# Write an invoice

> The invoice form: every field, the lines, terms and tax, saved items, and what Save draft does. The same form appears when you edit a draft.
> **Route:** /dashboard/m/accounting/sales/invoices/new
> **Order:** 90
> **Area:** Sales

Open **Sales** in the accounting menu and click {button:New invoice|primary}. The line under the title reads `Saved as a draft — nothing posts to the books until you issue it.` Issuing happens on the invoice's page afterwards. The customer has to exist first: with none yet, the form does not appear and the page says `Add a customer first (Sales → Customers).`

## What you see

- **`Company`.** Only when your books hold more than one company, and only when creating. `Which company is invoicing?` It cannot be changed once the draft is saved.
- **`Customer`.** One of your active customers. Required. There is no way to add a customer from inside the form.
- **`Number`.** Filled in for you with the next number, such as `INV-0009`. You can type your own. A number already used is refused when you save.
- **`Issue date`.** Starts as today. Changing it moves the due date along with it when terms are set.
- **`Terms`.** Shown once your catalogue has payment terms. Picking one, such as `Net 30`, sets the due date from the issue date, and a line under the due date reads `Net 30 — due 2026-09-11 (30 days)`. A new invoice starts on your default terms. The box reads `Custom` when the due date was typed by hand.
- **`Due date (optional)`.** Typing a date here clears the terms, because a date you typed is yours, not the terms'.
- **`Memo`.** `Shown on the printed invoice`.
- **`Sales tax`.** Shown once your catalogue has a tax rate. `No tax`, or a rate such as `Ohio state and county · 7.25%`. Choosing a rate checks the `Tax` box on every line; switching back to `No tax` leaves the boxes as they are.
- **The lines.** One row to begin with. Each has `Description` (`What was provided`), `Qty` (starts as 1, up to two decimals), `Unit price`, a `Disc` check box for a discount that counts against the invoice, a `Tax` check box shown only when a rate is chosen, `Income account`, and `Amount`, worked out from the quantity and the price. {button:Add line|outline|plus} adds a row and {button:Remove line|ghost|trash} at the end of a row removes it. The last row cannot be removed.
- **`Tag`.** Under each line, when your business has {{enterprise|plural|lower}} or other tags set up, {button:Tag|outline} opens a small panel with one list per kind of tag.
- **`Add a saved item…`.** Shown once your catalogue has saved items. Pick one and a new line is added with its description, a quantity of 1, its price and its income account.
- **The totals.** `Subtotal` and a tax row such as `Ohio state and county (7.25%)` when a rate is chosen, and `Total` always. Tax is worked out once on the sum of the taxable lines, so the total matches rate times base to the cent. Then {button:Save draft|primary}, or {button:Save changes|primary} on an existing draft.

## How to write an invoice

1. Pick the `Customer`. Leave `Number` as it is, or type your own.
2. Set `Issue date`, and either pick `Terms` or type a `Due date (optional)`.
3. Pick `Sales tax` if you charge it.
4. On each line, fill in `Description`, `Qty` and `Unit price`, and pick the `Income account`. Or pick `Add a saved item…` and edit the line if the price differs this time. Check `Disc` on a discount and `Tax` on each taxable line. Click {button:Add line|outline|plus} for the next line.
5. Click {button:Save draft|primary}. It stays gray until there is a customer, an issue date and a valid amount on every filled line. Rows with nothing in them are ignored; at least one filled line is needed.
6. You see `Draft saved` and land on the invoice's page, where {button:Issue|outline} posts it to the books. See [An invoice's page](invoice.md).

A draft dated in a closed month saves; the refusal comes when you issue it.

## How to edit a draft

1. On the draft's page, click {button:Edit|outline}. This same form opens on that page. The company cannot be changed. `Terms` reads `Custom` and the saved due date stays until you change it.
2. Click {button:Save changes|primary}. You see `Draft updated`.

## Messages

| Message | What it means |
| --- | --- |
| `That customer is inactive — reactivate them first.` | The customer was deactivated on the Customers page. |
| `That invoice number is already in use.` | Type a different `Number`. |
| `That tax rate is inactive or no longer exists — pick another one.` | The rate was deactivated in the catalogue. |
| `One of the selected accounts is inactive.` | A line's income account was deactivated in the chart. |
| `One of the selected tags is invalid or inactive.` | A tag on a line has been retired. Pick another. |
| `This entry changed since you opened it — reload and try again.` | Someone else saved this draft first. Reload. |
| `Accountant access is read-only — reviews, sign-offs and exports only.` | You have accountant access, which can read but not change. |

## Not on this page

A customer cannot be added from the form. Issuing, sending, recording payments and voiding happen on the invoice's page.

## Who can do what

Owners and staff write and save drafts. Accountants can open the form, and a save answers with the read-only message.
