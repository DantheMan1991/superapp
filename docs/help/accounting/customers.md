# Customers

> Who you bill: the list, adding and editing a customer, muting reminders for one, and what deactivating does.
> **Route:** /dashboard/m/accounting/sales/customers
> **Order:** 100

Open **Sales** in the accounting menu and click the `Customers` pill. The line under the title reads `Who [your business] bills.` To add one, click {button:Add customer|primary}. You need a customer before you can write an invoice.

## What you see

- **The list.** Every customer, active or not, in name order. Each row shows the name, {badge:inactive|outline} where it applies, the email and phone under it, and at the right how much they currently owe, `1,240.00 open`, when anything is outstanding. There is no search box.
- **The menu on each row.** The dots at the end open `Edit`, `Never send reminders` or `Resume reminders`, and `Deactivate` or `Reactivate`.

## How to add a customer

1. Click {button:Add customer|primary}. The dialog reads `Someone you'll invoice.`
2. Fill in `Name`. Required. Add `Email`, where invoices and reminders are sent, `Phone`, `Address`, printed in the invoice's `BILL TO` block, and `Notes` if you want them.
3. Click {button:Add customer|primary}. You see `Customer added`.

Payment terms and tax are set on each invoice, not on the customer.

## How to edit a customer

1. Open the row's menu and choose `Edit`. The same fields open.
2. Change them. Every field is saved as it stands, so clearing the email box removes the email.
3. Click {button:Save changes|primary}. You see `Customer updated`. Renaming a customer renames them in CRM as well.

## How to stop reminders for a customer

1. Open the row's menu and choose `Never send reminders`. You see `This customer will not be chased automatically`. No invoice of theirs is chased while this is set.
2. Choose `Resume reminders` to start again. You see `Reminders resumed for this customer`.

## How to deactivate a customer

1. Open the row's menu and choose `Deactivate`. It takes effect at once, with no confirmation, and the row shows {badge:inactive|outline}. Choose `Reactivate` to bring them back.

A deactivated customer keeps every invoice and all their history, but cannot be picked on a new invoice, and a draft that names them cannot be saved. Customers are never deleted.

## Messages

| Message | What it means |
| --- | --- |
| `Add your first customer` and `You need somebody to bill before you can raise an invoice.` | The list is empty. Click {button:Add customer|primary}. |
| `That customer is inactive — reactivate them first.` | An invoice names a deactivated customer. Reactivate them here. |
| `This entry changed since you opened it — reload and try again.` | Someone else saved the customer while you had it open. |

## Not on this page

There is no search box and no customer page. A customer cannot be deleted, only deactivated. Terms and tax live on each invoice.

## Who can do what

Owners and staff add, edit, mute and deactivate customers. Accountants see the same buttons, and any change answers `Accountant access is read-only — reviews, sign-offs and exports only.`
