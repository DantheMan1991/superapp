# The catalogue

> What you sell, your payment terms, your payment methods and your sales tax rates, all on one page, and how each one reaches an invoice or a payment.
> **Route:** /dashboard/m/accounting/sales/catalogue
> **Order:** 110

The title is **Catalogue** and the line under it reads `What you sell, when you expect to be paid, how the money arrives, and what tax you charge. Deactivating keeps history intact — nothing here is ever deleted.`

Owners add, edit, deactivate and set defaults. Staff and accountants see the four lists and cannot change them.

## Saved items

The things you invoice for again and again. Each row shows the name, then the price, the income account and the description underneath.

**Add item** opens **Add a saved item**:

- **Name.** Required.
- **Description on the invoice.** `Defaults to the name`.
- **Default price.**
- **Income account.**

Click **Add item**. You see `Saved item added`. A name already in the list is refused.

On an invoice, **Add a saved item…** adds a line with the item's description, a quantity of 1, its price and its account. Saved items are for invoices only.

There is no edit for a saved item. To change one, **Deactivate** it and add it again. Before any exist: **Nothing saved yet** and `Save the things you invoice for repeatedly, so the tenth invoice does not need the description and price typed again.`

## Payment terms

How long a customer has to pay. Each row shows the name, a `default` badge on the one new invoices start with, and `Due 30 days after the issue date` or `Due the day it is issued`.

**Add term** opens **Add a payment term**: **Name**, for example `Net 45`, and **Days until due**, a whole number from 0 to 365. Click **Add term**. You see `Term added`.

**Make default** on a row makes it the terms every new invoice starts with: `Default terms updated`. Deactivating the default leaves no default until you choose another.

If the list is empty, **Add the standard set** adds `Due on receipt`, `Net 15`, `Net 30` and `Net 60`, with Net 30 as the default. It only adds names you do not already have.

A term cannot be edited. Deactivate it and add a new one; invoices already written keep their dates.

## Payment methods

How money arrives. Each row shows the name and, in small type, the code it is recorded under.

**Add method** opens **Add a payment method**: one field, **Name**, for example `Zelle`. Under it: `Recorded on payments from now on. Existing payments keep whatever they were saved with.` Click **Add method**. You see `Payment method added`.

If the list is empty, **Add the standard set** adds `Check`, `Bank transfer`, `Card`, `Cash` and `Other`. The list needs at least one method, because recording a payment asks for one.

## Sales tax rates

Add a rate only if you charge sales tax. Each row shows the name, a `default` badge, and `7.25% · charged on the lines you mark taxable`.

**Add tax rate** opens **Add a sales tax rate**: **Name**, for example `Ohio state and county`, and **Rate %**, for example `7.25`, up to four decimals. The help reads `Combine state, county and city into one rate if you remit them together. Up to four decimal places.` Click **Add tax rate**. You see `Tax rate added`.

The first rate you add becomes the default; later ones do not. **Make default** changes that: `Default tax rate updated`.

**Edit** on a row opens the same fields with the note `Changing the rate applies to invoices written from now on. Invoices already issued keep the rate they charged.` Click **Save rate**.

An invoice copies the rate it was written with and keeps it, so a rate can be corrected without re-pricing anything already sent. At the foot of the section: `Tax you charge is money held for the tax authority, so it lands in Sales Tax Payable rather than in income — it never appears on your profit and loss. What you have collected and not yet remitted is on the Reports → Sales tax summary page.`

Before any exist: **No sales tax rates yet** and `Add a rate only if you charge sales tax. There is no standard set to restore here — the right rate depends on where you are and what you sell, so nothing is filled in for you.`
