# The Inbox

> Where bills and receipts arrive: uploading, the email-in address, what Yosher reads off each document, and the buttons that turn a document into a bill, an expense or an attachment.
> **Route:** /dashboard/m/accounting/receipts
> **Order:** 60
> **Area:** Inbox

Open **Inbox** in the accounting menu. The line under the title reads `Everything arrives here — bills and receipts, uploaded or emailed, read automatically and routed to your books.` Two ways in: click {button:Upload|primary|upload}, or forward an email to your business's email-in address. Either way the document is read as soon as it lands, so it usually appears with its vendor, date and total already filled in.

## What you see

- **`Email-in`.** Owners only. Once it is on, the card shows a private address of the form `receipts-[code]@…` and `Forward bills and receipts to this address — attachments land in the inbox automatically.`, with {button:Copy|outline|copy}, {button:Regenerate|outline} and {button:Disable|outline}. Before it is on, the card reads `Turn on a private forwarding address for this business.` with {button:Enable email-in|outline}.
- **The three tabs.** `To file`, documents waiting for you, which is the count on the Overview's `Inbox` card. `Filed`, documents already attached to a bill, an expense or another record. `Trash`. Each tab carries its count. Only documents that arrived through the Inbox are here; files in the Documents module are not.
- **Each row.** A thumbnail, the vendor's name as it was read or the file name, and a line saying how it arrived: `Email · [sender] · [date]` or `Upload · [date]`. Click the name to open the document. Badges say what was read: the total, such as {badge:$42.18|secondary}, and the document's date, {badge:2026-08-14|outline}; {badge:Not read yet|outline} when reading has not finished or has not been tried; {badge:Couldn't read|destructive} when it could not be read automatically. It can still be filed by hand.
- **The buttons on a row.** {button:Read|outline}, shown when the document has not been read or could not be. {button:Create bill|primary}, filled in when the document looks like a bill or an invoice, otherwise {button:Create bill|outline}. {button:Attach|outline|paperclip}. {button:Record expense|primary}, owners only, filled in when the document looks like a receipt rather than a bill, otherwise {button:Record expense|outline}. A {icon:trash} that moves the document to `Trash`. In `Trash`, each row has one button, {button:Restore|outline}. The same buttons appear on the document's own page. See [A document in the Inbox](document.md).

## How to upload a document

1. Click {button:Upload|primary|upload} and choose one or more files. JPEG, PNG, WebP, GIF and PDF are accepted, up to 20 MB each. Photos from a phone are fine. Take them straight on and in good light so the text can be read.
2. Files go up one at a time, and each shows `[file name] uploaded.` A document you already have is accepted with a warning: `[file name] uploaded — looks like a duplicate of a receipt you already have.`

## How to set up email-in

1. Click {button:Enable email-in|outline}. The card shows your private address.
2. Click {button:Copy|outline|copy} and forward bills and receipts to it from any of your own addresses. Copy the vendor in if you like; the attachments are what count. Up to 100 emails an hour are accepted.
3. To change the address, click {button:Regenerate|outline}. It asks `Generate a new address? The old one stops working immediately.` To turn it off, click {button:Disable|outline}, after `Disable email-in? The address stops working.`

## How to turn a document into a bill

1. Click {button:Create bill|primary} on the row. The dialog reads `[vendor] · $42.18 — the draft is prefilled from what was read; the document attaches automatically.`
2. Check the vendor. If Yosher found matches among your active vendors, `Existing vendor` lists them, and a single match is chosen for you. If it found none: `No existing vendor matches — a new one will be created.`, and `New vendor name` is filled with the name as it was read. Edit it or leave it.
3. Click {button:Create bill|primary}. You see `Bill created from the document.` and land on the new draft. It carries the vendor's invoice number and date, the email's subject as its memo, and the lines as they were read when they add up to the total, otherwise one line for the whole amount. Every line starts on the vendor's default expense account, if they have one, and the assistant suggests accounts for the rest. The document is attached and moves to `Filed`.

## How to attach a document to something in the books

1. Click {button:Attach|outline|paperclip}. The dialog is `Attach document`.
2. Under `Matching bank transactions`, up to five unreviewed bank transactions for the same amount, or a refund of it, within a week of the document's date. Click one and the document is attached to it and Banking opens on that transaction, ready to categorize.
3. Or, under `Or attach to a record`, pick one of the twenty most recent journal entries or the twenty most recent invoices. You see `Document attached.` and the document is filed. Bills are attached from the bill's own page instead.

## How to record a receipt as an expense

Owners only. Use it for a receipt paid from petty cash or a card that has no bank feed.

1. Click {button:Record expense|primary}. The dialog reads `Posts a journal entry from this document and attaches it — for cash or out-of-feed purchases.`
2. Check `Amount`, `Date` and `Memo`, filled from what was read. Pick `Paid from`, a bank, cash or card account, and `Category`, the expense account, or an income account for a refund.
3. Click {button:Record|primary}. You see `Expense recorded and receipt attached.` The entry is posted at once, in the company that owns the paid-from account.

## Messages

| Message | What it means |
| --- | --- |
| `[file name]: that file type or size isn't supported — JPEG, PNG, WebP, GIF or PDF up to 20MB.` | The file was refused. Convert or shrink it. |
| `Document read.` | {button:Read|outline} finished. |
| `This document already has a bill — opening it.` | A bill was already created from this document. |
| `Bill created — looks like a possible duplicate.` | The new bill resembles one you already have. Check before approving. |
| `Read the receipt first to get match suggestions.` | The document has not been read, so no bank matches are offered yet. |
| `No unreviewed bank transactions match this amount and date.` | Nothing in the bank feed matches. Attach to a record instead, or wait for the feed. |
| `That file is already attached there.` | The document is already on that record. |
| `That date falls in a closed period. Use a reversal, or reopen the period first.` | The expense date is in a closed month. |
| `Moved to trash.` and `Restored to inbox.` | The document was trashed, or brought back. Nothing is ever deleted for good. |
| `Nothing waiting` and `Upload a bill or receipt — or forward one to your email-in address — and it will land here, read and ready to file.` | `To file` is empty. |
| `Nothing filed yet` and `Documents attached to transactions show up here.` | `Filed` is empty. |
| `Trash is empty` and `Trashed documents can be restored any time — nothing is ever permanently deleted.` | `Trash` is empty. |

## Not on this page

The Inbox is shared across your companies. A document has no company until it becomes a bill or an expense, so there is no `Company` picker here.

## Who can do what

Owners and staff upload, read, create bills, attach and trash. Only owners see `Email-in` and {button:Record expense|primary}. Accountants can read the Inbox, and any change answers `Accountant access is read-only — reviews, sign-offs and exports only.`
