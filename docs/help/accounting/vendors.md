# Vendors

> Who you buy from: the list, adding and editing a vendor, the default expense account, and what deactivating one does.
> **Route:** /dashboard/m/accounting/purchases/vendors
> **Order:** 170
> **Area:** Purchases

Open **Purchases** in the accounting menu and click the `Vendors` pill. The line under the title reads `Who [your business] buys from. A default expense account prefills new bill lines.` To add one, click {button:New vendor|primary|plus}. To add many at once, click {button:Paste a list|outline|sparkles}.

## What you see

- **{button:Paste a list|outline|sparkles}.** Opens the dialog that reads a pasted list, or a photo of one, and proposes a row per vendor for you to check before anything is added. See how to paste a list, below. Not shown to an accountant.
- **The list.** Every vendor, active or not, in name order, fifty to a page. `Name`. `Contact`, the email and phone, or a dash. `Default account`, the account new bill lines for this vendor start on, or a dash. `Terms`, the payment terms this vendor gives you, or a dash. `Status`, `active` or `inactive`. A {icon:pencil} at the end of the row opens the vendor for editing.
- **No vendor page.** A vendor's name is not a link. Everything about a vendor is in the edit dialog, and their bills are in the Bills list.
- **Search.** The box beside the pills. Type part of a name, an email or a phone number and the list narrows as you type; press Enter to search at once. A phone number matches with or without its spaces and brackets. Clear the box to see everyone again.
- **Pages.** When there are more than fifty vendors, `Showing 1–50 of 120 vendors` sits under the list with {button:Previous|outline} and {button:Next|outline}. A search starts again from its first page.

## How to add a vendor

1. Click {button:New vendor|primary|plus}.
2. Fill in `Name`. Required. Add `Email`, the address their invoices come from, `Phone`, and `Address`, one line, if you have them.
3. Pick `Default expense account (optional)`: `None`, or one of your expense or asset accounts. When a bill is created from a document for this vendor, every line starts on this account. Set it for any vendor you buy the same kind of thing from every time.
4. Pick `Payment terms (optional)`, shown once your catalogue has terms: `None`, or the terms this vendor gives you. The line under the box reads `A new bill from this vendor gets its due date from these terms.` The due date is worked out from the bill date on the bill form, on a bill created from the Inbox, and on one drafted from an email thread. `None` means you type the due date, as before.
5. Click {button:Save|primary}. You see `Vendor created.`

Two vendors may have the same name. Nothing stops it, so check the list first. A vendor is also created on the spot when you type a new name on a bill, or when {button:Create bill|primary} in the Inbox finds no match. Those get a name only. Come here to add the rest.

## How to edit a vendor

1. Click the {icon:pencil} on the row. The dialog is `Edit vendor`.
2. Change the fields. Every field is saved as it stands, so clearing the email box removes the email.
3. Click {button:Save|primary}. You see `Vendor updated.`

## How to deactivate a vendor

1. Click the {icon:pencil} on the row.
2. Click {button:Deactivate|ghost} at the bottom left of the dialog. It takes effect at once, with no confirmation. You see `Vendor deactivated.` {button:Reactivate|ghost} switches them back on: `Vendor reactivated.`

A deactivated vendor disappears from the vendor list on the bill form and from the vendor match in {button:Create bill|primary}, cannot have a new bill recorded, an existing draft saved, or a draft approved, and stays on this list marked `inactive` and on every bill they already have. Vendors are never deleted. Deactivating says you no longer buy from them. It does not touch a customer record for the same business.

## How to paste a list of vendors

1. Click {button:Paste a list|outline|sparkles}. `Paste a list of vendors` opens and reads `Paste a list, columns from a spreadsheet, or add a photo of one. You'll see every row it found and can change anything before it saves.`
2. Paste into `The list`, or click `Or a photo of it` and choose a photo or a PDF of up to 4 MB. The counter under the box reads `0 / 20,000` and counts up. Only what you paste or attach is sent, and nothing else about your business.
3. Click {button:Read it|primary}. Its label turns to `Reading…` while it works. The line under the title then reads `12 vendors found. Untick what you don't want, fix what's wrong, then add them.`
4. Check the rows. Each has `Name`, `Email`, `Phone`, `Address` and `Notes`, every one a box you can retype; `Name` is the one that must be filled. On a wide screen it is a table, on a phone one card per row with its fields named. A row that names a vendor you already have comes back unticked and reads `Already here as “Tractor Supply”. Unticked — tick it to add another.` Untick anything else you do not want.
5. Click {button:Add 12 vendors|primary}. It reads `Adding…`, then you see `Added 12 vendors`, the dialog closes and the list refreshes. Nothing is saved until you click it. If any ticked row is refused, nothing is saved at all, and the message names the row.

{button:Start over|ghost} clears the rows and the list you pasted. Closing the dialog does the same. Leave ten seconds between readings. At most 200 rows come back from one reading, so paste a longer list in pieces. A vendor added this way has a name and whatever else the list gave; set their terms and default account by editing them afterwards.

## Messages

| Message | What it means |
| --- | --- |
| `Nothing to add from that.` | The reading found no vendors in what you pasted or attached. |
| `Row 3: Name is missing.` | The third ticked row has no name. Type one, or untick the row. The button stays gray until every ticked row is complete. |
| `Row 3 (Tractor Supply): …` | The third row was refused for the reason given after the colon. Nothing was added. Fix the row and add again. |
| `Give it a few seconds, then try again.` | Two readings inside ten seconds. |
| `That file is too large. 4 MB at most.` and `A photo (JPEG, PNG, WebP or GIF) or a PDF.` | The photo is too big, or not a kind it can read. |
| `It could not read that. Try a cleaner copy, or fewer rows at a time.` | The reading came back in a shape it could not use. |
| `Paste something, or add a photo.` | The box and the file were both empty. |
| `No vendors yet` and `They are created for you when a bill comes in from an emailed document, or you can add one now.` | The list is empty. |
| `Nothing matches “…”` and `Try fewer words, or add them now.` | No vendor's name, email or phone contains what you typed. {button:New vendor|primary|plus} is right there. Check the spelling before adding one, because two vendors may share a name. |
| `That vendor is inactive — reactivate them first.` | A bill names a deactivated vendor. Reactivate them here. |
| `This entry changed since you opened it — reload and try again.` | Someone else saved the vendor while you had it open. |
| `That payment term no longer exists.` | The term you picked was deactivated in the catalogue while the dialog was open. Pick another. |

## Not on this page

There is no vendor page. A vendor cannot be deleted, only deactivated.

## Who can do what

Owners and staff add, edit and deactivate vendors. Accountants can read the list, and any change answers `Accountant access is read-only — reviews, sign-offs and exports only.`
