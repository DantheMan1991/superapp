# Customers

> Who you bill: the list, adding and editing a customer, muting reminders for one, and what deactivating does.
> **Route:** /dashboard/m/accounting/sales/customers
> **Order:** 110
> **Area:** Sales

Open **Sales** in the accounting menu and click the `Customers` pill. The line under the title reads `Who [your business] bills.` To add one, click {button:Add customer|primary}. To add many at once, click {button:Paste a list|outline|sparkles}. You need a customer before you can write an invoice.

## What you see

- **{button:Paste a list|outline|sparkles}.** Opens the dialog that reads a pasted list, or a photo of one, and proposes a row per customer for you to check before anything is added. See how to paste a list, below. Not shown to an accountant.
- **The list.** Every customer, active or not, in name order. Each row shows the name, {badge:inactive|outline} where it applies, the email and phone under it, then `Net 45 terms` when the customer has payment terms of their own, and at the right how much they currently owe, `1,240.00 open`, when anything is outstanding. Fifty to a page.
- **The menu on each row.** The dots at the end open `Statement`, the customer's statement for a period (see [A customer's statement](statement.md)), `Edit`, `Never send reminders` or `Resume reminders`, and `Deactivate` or `Reactivate`.
- **Search.** The box beside the pills. Type part of a name, an email or a phone number and the list narrows as you type; press Enter to search at once. A phone number matches with or without its spaces and brackets. Clear the box to see everyone again.
- **Pages.** When there are more than fifty customers, `Showing 1–50 of 120 customers` sits under the list with {button:Previous|outline} and {button:Next|outline}. A search starts again from its first page.

## How to add a customer

1. Click {button:Add customer|primary}. The dialog reads `Someone you'll invoice.`
2. Fill in `Name`. Required. Add `Email`, where invoices and reminders are sent, `Phone`, and `Address`, printed in the invoice's `BILL TO` block, if you have them.
3. Pick `Payment terms`, shown once your catalogue has terms: `Business default (Net 30)`, or one of your terms for a customer with a special arrangement. The line under the box reads `A new invoice for this customer starts on these terms.` Add `Notes` if you want them.
4. Click {button:Add customer|primary}. You see `Customer added`.

A customer is also created on the spot when you type a new name on an invoice. Those get a name only, on the business default terms. Come here to add the rest.

`Business default` means whatever the default is on the Catalogue page, now and later: change the default there and every customer on it moves with it. A customer's own terms are applied the moment you pick them on an invoice, and the due date follows. Sales tax is set on each invoice.

## How to edit a customer

1. Open the row's menu and choose `Edit`. The same fields open.
2. Change them. Every field is saved as it stands, so clearing the email box removes the email, and setting `Payment terms` back to `Business default` ends a special arrangement. A term that was deactivated in the catalogue still shows here, marked `(inactive)`, until you pick another.
3. Click {button:Save changes|primary}. You see `Customer updated`. Renaming a customer renames them in CRM as well.

## How to stop reminders for a customer

1. Open the row's menu and choose `Never send reminders`. You see `This customer will not be chased automatically`. No invoice of theirs is chased while this is set.
2. Choose `Resume reminders` to start again. You see `Reminders resumed for this customer`.

## How to deactivate a customer

1. Open the row's menu and choose `Deactivate`. It takes effect at once, with no confirmation, and the row shows {badge:inactive|outline}. Choose `Reactivate` to bring them back.

A deactivated customer keeps every invoice and all their history, but cannot be picked on a new invoice, and a draft that names them cannot be saved. Customers are never deleted.

## How to paste a list of customers

1. Click {button:Paste a list|outline|sparkles}. `Paste a list of customers` opens and reads `Paste a list, columns from a spreadsheet, or add a photo of one. You'll see every row it found and can change anything before it saves.`
2. Paste into `The list`, or click `Or a photo of it` and choose a photo or a PDF of up to 4 MB. The counter under the box reads `0 / 20,000` and counts up. Only what you paste or attach is sent, and nothing else about your business.
3. Click {button:Read it|primary}. Its label turns to `Reading…` while it works. The line under the title then reads `8 customers found. Untick what you don't want, fix what's wrong, then add them.`
4. Check the rows. Each has `Name`, `Email`, `Phone`, `Address` and `Notes`, every one a box you can retype; `Name` is the one that must be filled. On a wide screen it is a table, on a phone one card per row with its fields named. A row that names a customer you already have comes back unticked and reads `Already here as “Maple Street Market”. Unticked — tick it to add another.` Untick anything else you do not want.
5. Click {button:Add 8 customers|primary}. It reads `Adding…`, then you see `Added 8 customers`, the dialog closes and the list refreshes. Nothing is saved until you click it. If any ticked row is refused, nothing is saved at all, and the message names the row.

{button:Start over|ghost} clears the rows and the list you pasted. Closing the dialog does the same. Leave ten seconds between readings. At most 200 rows come back from one reading, so paste a longer list in pieces. A customer added this way is on your default terms and has whatever else the list gave; edit them afterwards for terms of their own.

## Messages

| Message | What it means |
| --- | --- |
| `Nothing to add from that.` | The reading found no customers in what you pasted or attached. |
| `Row 3: Name is missing.` | The third ticked row has no name. Type one, or untick the row. The button stays gray until every ticked row is complete. |
| `Row 3 (Maple Street Market): …` | The third row was refused for the reason given after the colon. Nothing was added. Fix the row and add again. |
| `Give it a few seconds, then try again.` | Two readings inside ten seconds. |
| `That file is too large. 4 MB at most.` and `A photo (JPEG, PNG, WebP or GIF) or a PDF.` | The photo is too big, or not a kind it can read. |
| `It could not read that. Try a cleaner copy, or fewer rows at a time.` | The reading came back in a shape it could not use. |
| `Paste something, or add a photo.` | The box and the file were both empty. |
| `Add your first customer` and `You need somebody to bill before you can raise an invoice.` | The list is empty. Click {button:Add customer|primary}. |
| `Nothing matches “…”` and `Try fewer words, or add them now.` | No customer's name, email or phone contains what you typed. {button:Add customer|primary} is right there, so a customer you looked for and did not find is one click from existing. |
| `That customer is inactive — reactivate them first.` | An invoice names a deactivated customer. Reactivate them here. |
| `This entry changed since you opened it — reload and try again.` | Someone else saved the customer while you had it open. |
| `That payment term no longer exists.` | The term you picked was deactivated in the catalogue while the dialog was open. Pick another. |

## Not on this page

There is no customer page beyond the statement. A customer cannot be deleted, only deactivated. Sales tax lives on each invoice.

## Who can do what

Owners and staff add, edit, mute and deactivate customers. Accountants see the same buttons, and any change answers `Accountant access is read-only — reviews, sign-offs and exports only.`
