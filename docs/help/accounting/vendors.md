# Vendors

> Who you buy from: the list, adding and editing a vendor, the default expense account, and what deactivating one does.
> **Route:** /dashboard/m/accounting/purchases/vendors
> **Order:** 40

Open **Purchases** in the accounting menu and click the `Vendors` pill. The line under the title reads `Who [your business] buys from. A default expense account prefills new bill lines.` To add one, click {button:New vendor|primary|plus}.

## What you see

- **The list.** Every vendor, active or not, in name order. `Name`. `Contact`, the email and phone, or a dash. `Default account`, the account new bill lines for this vendor start on, or a dash. `Status`, `active` or `inactive`. A {icon:pencil} at the end of the row opens the vendor for editing.
- **No vendor page.** A vendor's name is not a link. Everything about a vendor is in the edit dialog, and their bills are in the Bills list.

## How to add a vendor

1. Click {button:New vendor|primary|plus}.
2. Fill in `Name`. Required. Add `Email`, the address their invoices come from, `Phone`, and `Address`, one line, if you have them.
3. Pick `Default expense account (optional)`: `None`, or one of your expense or asset accounts. When a bill is created from a document for this vendor, every line starts on this account. Set it for any vendor you buy the same kind of thing from every time.
4. Click {button:Save|primary}. You see `Vendor created.`

Two vendors may have the same name. Nothing stops it, so check the list first. A vendor is also created on the spot when you type a new name on a bill, or when {button:Create bill|primary} in the Inbox finds no match. Those get a name only. Come here to add the rest.

## How to edit a vendor

1. Click the {icon:pencil} on the row. The dialog is `Edit vendor`.
2. Change the fields. Every field is saved as it stands, so clearing the email box removes the email.
3. Click {button:Save|primary}. You see `Vendor updated.`

## How to deactivate a vendor

1. Click the {icon:pencil} on the row.
2. Click {button:Deactivate|ghost} at the bottom left of the dialog. It takes effect at once, with no confirmation. You see `Vendor deactivated.` {button:Reactivate|ghost} switches them back on: `Vendor reactivated.`

A deactivated vendor disappears from the vendor list on the bill form and from the vendor match in {button:Create bill|primary}, cannot have a new bill recorded, an existing draft saved, or a draft approved, and stays on this list marked `inactive` and on every bill they already have. Vendors are never deleted. Deactivating says you no longer buy from them. It does not touch a customer record for the same business.

## Messages

| Message | What it means |
| --- | --- |
| `No vendors yet` and `They are created for you when a bill comes in from an emailed document, or you can add one now.` | The list is empty. |
| `That vendor is inactive — reactivate them first.` | A bill names a deactivated vendor. Reactivate them here. |
| `This entry changed since you opened it — reload and try again.` | Someone else saved the vendor while you had it open. |

## Not on this page

There is no vendor page and no search. A vendor cannot be deleted, only deactivated.

## Who can do what

Owners and staff add, edit and deactivate vendors. Accountants can read the list, and any change answers `Accountant access is read-only — reviews, sign-offs and exports only.`
