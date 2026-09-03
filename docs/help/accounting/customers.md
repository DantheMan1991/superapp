# Customers

> Who you bill: the list, adding and editing a customer, muting reminders for one, and what deactivating does.
> **Route:** /dashboard/m/accounting/sales/customers
> **Order:** 100

## The list

**Sales** in the strip, then the **Customers** pill. The title is **Customers** and the line under it reads `Who [your business] bills.` **Add customer** sits at the right.

Every customer is listed in name order, active or not. Each row shows the name, an `inactive` badge where it applies, the email and phone underneath, and at the right how much they currently owe, `1,240.00 open`, when anything is outstanding.

The dots at the end of a row open a menu:

- **Edit.**
- **Never send reminders** or **Resume reminders.** Whether automatic reminders may ever chase this customer. You see `This customer will not be chased automatically` or `Reminders resumed for this customer`.
- **Deactivate** or **Reactivate.** Takes effect at once, with no confirmation.

Before any exist, the page says **Add your first customer** and `You need somebody to bill before you can raise an invoice.`

There is no search box; the list is alphabetical.

## Adding a customer

Click **Add customer**. The dialog is `Someone you'll invoice.`

- **Name.** Required.
- **Email.** Where invoices and reminders are sent.
- **Phone.**
- **Address.** Printed in the invoice's **BILL TO** block.
- **Notes.**

Click **Add customer**. You see `Customer added`.

Payment terms and tax are set on each invoice, not on the customer.

## Editing

Choose **Edit** from the row's menu. The same fields open. Every field is saved as it stands, so clearing the email box removes the email. Click **Save changes**. You see `Customer updated`. Renaming a customer renames them in CRM as well. If someone else saved the customer while you had it open: `This entry changed since you opened it — reload and try again.`

## Deactivating

A deactivated customer stays on this list marked `inactive`, keeps every invoice and all their history, but cannot be picked on a new invoice, and a draft that names them cannot be saved: `That customer is inactive — reactivate them first.` Customers are never deleted.

## Who can do this

Owners and staff both add, edit and deactivate customers. Accountant access sees the same buttons, and any change answers `Accountant access is read-only — reviews, sign-offs and exports only.`
