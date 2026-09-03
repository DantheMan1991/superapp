# The catalogue

> What you sell, your payment terms, your payment methods and your sales tax rates, all on one page, and how each one reaches an invoice or a payment.
> **Route:** /dashboard/m/accounting/sales/catalogue
> **Order:** 110

Open **Sales** in the accounting menu and click the `Catalogue` pill. The line under the title reads `What you sell, when you expect to be paid, how the money arrives, and what tax you charge. Deactivating keeps history intact — nothing here is ever deleted.` Four lists, each with its own add button. Owners change them; staff and accountants read them.

## What you see

- **`Saved items`.** The things you invoice for again and again. Each row shows the name, {badge:inactive|outline} when deactivated, and the price, the income account and the description under it. {button:Add item|primary|plus} at the right. On an invoice, `Add a saved item…` adds a line with the item's description, a quantity of 1, its price and its account.
- **`Payment terms`.** How long a customer has to pay. Each row shows the name, {badge:default|outline} on the one new invoices start with, and `Due 30 days after the issue date` or `Due the day it is issued`. {button:Add term|outline|plus} at the right, and {button:Make default|ghost} on each row.
- **`Payment methods`.** How money arrives. Each row shows the name and, in small type, the code it is recorded under. {button:Add method|outline|plus} at the right, and {button:Deactivate|ghost} or {button:Reactivate|ghost} on each row. The list needs at least one method, because recording a payment asks for one.
- **`Sales tax rates`.** Each row shows the name, {badge:default|outline}, and `7.25% · charged on the lines you mark taxable`. {button:Add tax rate|outline|plus} at the right, and {button:Make default|ghost} and {button:Edit|ghost} on each row. Under the list: `Tax you charge is money held for the tax authority, so it lands in Sales Tax Payable rather than in income — it never appears on your profit and loss. What you have collected and not yet remitted is on the Reports → Sales tax summary page.`

## How to add a saved item

1. Click {button:Add item|primary|plus}. The dialog is `Add a saved item`.
2. Fill in `Name`. Required. Add `Description on the invoice` (`Defaults to the name`), `Default price` and `Income account`.
3. Click {button:Add item|primary}. You see `Saved item added`. A name already in the list is refused.

There is no edit for a saved item. To change one, {button:Deactivate|ghost} it and add it again.

## How to set your payment terms

1. Click {button:Add term|outline|plus}. The dialog is `Add a payment term`. Fill in `Name`, such as `Net 45`, and `Days until due`, a whole number from 0 to 365. Click {button:Add term|primary}. You see `Term added`.
2. Click {button:Make default|ghost} on the terms every new invoice should start with. You see `Default terms updated`. Deactivating the default leaves no default until you choose another.
3. If the list is empty, click {button:Add the standard set|outline} instead. It adds `Due on receipt`, `Net 15`, `Net 30` and `Net 60`, with Net 30 as the default, and only adds names you do not already have.

A term cannot be edited. Deactivate it and add a new one. Invoices already written keep their dates.

## How to add a payment method

1. Click {button:Add method|outline|plus}. The dialog is `Add a payment method`, with one field, `Name`, such as `Zelle`. Under it: `Recorded on payments from now on. Existing payments keep whatever they were saved with.`
2. Click {button:Add method|primary}. You see `Payment method added`.
3. If the list is empty, click {button:Add the standard set|outline} instead. It adds `Check`, `Bank transfer`, `Card`, `Cash` and `Other`.

## How to add or change a sales tax rate

Add a rate only if you charge sales tax.

1. Click {button:Add tax rate|outline|plus}. The dialog is `Add a sales tax rate`. Fill in `Name`, such as `Ohio state and county`, and `Rate %`, such as `7.25`, up to four decimals. The help reads `Combine state, county and city into one rate if you remit them together. Up to four decimal places.`
2. Click {button:Add tax rate|primary}. You see `Tax rate added`. The first rate you add becomes the default; later ones do not. {button:Make default|ghost} changes that: `Default tax rate updated`.
3. To change a rate, click {button:Edit|ghost}. The note reads `Changing the rate applies to invoices written from now on. Invoices already issued keep the rate they charged.` Click {button:Save rate|primary}. You see `Tax rate updated`.

An invoice copies the rate it was written with and keeps it, so a rate can be corrected without re-pricing anything already sent.

## Messages

| Message | What it means |
| --- | --- |
| `Nothing saved yet` and `Save the things you invoice for repeatedly, so the tenth invoice does not need the description and price typed again.` | No saved items yet. |
| `No payment methods yet` and `How the money arrived — cheque, card, bank transfer. Recording a payment asks for one, so this list needs at least a row in it.` | No methods yet. Add one, or the standard set. |
| `No sales tax rates yet` and `Add a rate only if you charge sales tax. There is no standard set to restore here — the right rate depends on where you are and what you sell, so nothing is filled in for you.` | No rates yet. |
| `Enter a percentage from 0 to 100, up to four decimals` | The rate you typed is out of range. |

## Not on this page

A saved item and a payment term cannot be edited, only deactivated and added again. Nothing here is ever deleted.

## Who can do what

Owners add, edit, deactivate and set defaults. Staff and accountants see the four lists and cannot change them.
