# Vendors

> Who you buy from: the list, adding and editing a vendor, the default expense account, and what deactivating one does.
> **Route:** /dashboard/m/accounting/purchases/vendors
> **Order:** 40

## The list

**Purchases** in the strip, then the **Vendors** pill. The title is **Vendors** and the line under it reads `Who [your business] buys from. A default expense account prefills new bill lines.`

Every vendor is listed, active or not, in name order:

- **Name.**
- **Contact.** Email and phone, or a dash.
- **Default account.** The account new bill lines for this vendor start on, or a dash.
- **Status.** `active` or `inactive`.
- A pencil at the end of the row opens the vendor for editing.

A vendor's name is not a link. There is no vendor page; everything about a vendor is in the edit dialog, and their bills are in the Bills list.

Before any exist, the page says **No vendors yet** and `They are created for you when a bill comes in from an emailed document, or you can add one now.`

## Adding a vendor

Click **New vendor**.

- **Name.** Required.
- **Email.** The address their invoices come from.
- **Phone.**
- **Address.** One line.
- **Default expense account (optional).** `None`, or one of your expense or asset accounts. When a bill is created from a document for this vendor, every line starts on this account. Set it for any vendor you buy the same kind of thing from every time.

Click **Save**. You see `Vendor created.` Two vendors may have the same name; nothing stops it, so check the list first.

A vendor is also created on the spot when you type a new name on a bill, or when **Create bill** in the Inbox finds no match. Those get a name only. Come here to add the rest.

## Editing

Click the pencil. The same dialog opens with **Edit vendor** as its title. Every field is saved as it stands, so clearing the email box removes the email. Click **Save**. You see `Vendor updated.` If someone else saved the vendor while you had it open: `This entry changed since you opened it — reload and try again.`

## Deactivating

In the edit dialog, **Deactivate** at the bottom left switches the vendor off at once, with no confirmation, and **Reactivate** switches them back on. You see `Vendor deactivated.` or `Vendor reactivated.`

A deactivated vendor:

- Disappears from the vendor list on the bill form and from the vendor match in **Create bill**.
- Cannot have a new bill recorded, an existing draft saved, or a draft approved. Each of those answers `That vendor is inactive — reactivate them first.` A draft bill that names them cannot be posted until they are reactivated.
- Stays on this list marked `inactive`, and on every bill they already have.

Vendors are never deleted. Deactivating says you no longer buy from them; it does not touch a customer record for the same business.

## Who can do this

Owners and staff both add, edit and deactivate vendors. Accountant access can read the list, and any change answers `Accountant access is read-only — reviews, sign-offs and exports only.`
