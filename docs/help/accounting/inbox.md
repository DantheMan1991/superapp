# The Inbox

> Where bills and receipts arrive: uploading, the email-in address, what Yosher reads off each document, and the buttons that turn a document into a bill, an expense or an attachment.
> **Route:** /dashboard/m/accounting/receipts
> **Order:** 50

## What arrives here

**Inbox** in the strip. The line under the title reads `Everything arrives here — bills and receipts, uploaded or emailed, read automatically and routed to your books.`

Two ways in: upload a file, or forward an email to your business's email-in address. Either way, the document is read as soon as it lands, so it usually appears with its vendor, date and total already filled in.

## Upload

Click **Upload** and choose one or more files. JPEG, PNG, WebP, GIF and PDF are accepted, up to 20 MB each. Files go up one at a time and each shows `[file name] uploaded.` A file of the wrong kind or size is refused with `[file name]: that file type or size isn't supported — JPEG, PNG, WebP, GIF or PDF up to 20MB.`

If you upload a document you already have, it is accepted with a warning: `[file name] uploaded — looks like a duplicate of a receipt you already have.`

Photos from a phone are fine. Take them straight on and in good light so the text can be read.

## Email-in

Owners see an **Email-in** card. Once it is on, it shows a private address of the form `receipts-[code]@...` and `Forward bills and receipts to this address — attachments land in the inbox automatically.`

- **Copy** copies the address.
- **Regenerate** makes a new one. It asks first: `Generate a new address? The old one stops working immediately.`
- **Disable** turns it off, after `Disable email-in? The address stops working.`

Before it is on, the card offers **Enable email-in**. Forward from any of your own addresses, and copy the vendor in if you like; the attachments are what count. Up to 100 emails an hour are accepted.

## The three tabs

- **To file.** Documents waiting for you. This is the count on the Overview's Inbox card.
- **Filed.** Documents already attached to a bill, an expense or another record.
- **Trash.**

Each tab carries its count. Only documents that arrived through the Inbox are here; files in the Documents module are not.

## Each row

A thumbnail, the vendor's name as it was read, or the file name, and a line saying how it arrived: `Email · [sender] · [date]` or `Upload · [date]`. Click the name to open the document.

Badges on the row say what was read:

- The total, for example `$42.18`, and the document's date.
- **Not read yet.** Reading has not finished, or has not been tried.
- **Couldn't read.** The document could not be read automatically. It can still be filed by hand.

## The buttons on a row

The same buttons appear on the document's own page.

- **Read.** Shown when the document has not been read, or could not be. Tries again: `Document read.`
- **Create bill.** Turns the document into a bill draft. It is the filled-in button when the document looks like a bill or an invoice.
- **Attach.** Attaches the document to a bank transaction, a journal entry or an invoice.
- **Record expense.** Owners only. Posts the document straight to the books as an expense paid from a bank, cash or card account. It is the filled-in button when the document looks like a receipt rather than a bill.
- **The bin.** Moves the document to Trash: `Moved to trash.`

In Trash, each row has one button, **Restore**: `Restored to inbox.` Nothing is ever deleted for good.

## Create bill

The dialog is titled **Create bill** and reads `[vendor] · $42.18 — the draft is prefilled from what was read; the document attaches automatically.`

Yosher looks for the vendor among your active vendors. If it finds matches, **Existing vendor** lists them, and a single match is chosen for you. If it finds none: `No existing vendor matches — a new one will be created.` The box underneath, **New vendor name**, is filled with the name as it was read; edit it or leave it.

Click **Create bill**. You see `Bill created from the document.` and land on the new draft. It carries the vendor's invoice number and date, the email's subject as its memo, and the lines as they were read when they add up to the total, otherwise one line for the whole amount. Every line starts on the vendor's default expense account, if they have one, and the assistant suggests accounts for the rest. The document is attached and moves to **Filed**.

If the document already has a bill: `This document already has a bill — opening it.` If the bill looks like one you already have: `Bill created — looks like a possible duplicate.`

## Attach

The dialog is titled **Attach document**.

**Matching bank transactions** lists up to five unreviewed bank transactions for the same amount, or a refund of it, within a week of the document's date. Click one and the document is attached to it and Banking opens on that transaction, ready to categorise. If the document has not been read yet: `Read the receipt first to get match suggestions.` If nothing matches: `No unreviewed bank transactions match this amount and date.`

**Or attach to a record** offers the twenty most recent journal entries and the twenty most recent invoices. Bills are attached from the bill's own page instead.

Attaching shows `Document attached.` and files the document. A document already attached to that record answers `That file is already attached there.`

## Record expense

Owners only. The dialog is titled **Record expense**: `Posts a journal entry from this document and attaches it — for cash or out-of-feed purchases.` Use it for a receipt paid from petty cash or a card that has no bank feed.

- **Amount**, **Date** and **Memo** are filled from what was read.
- **Paid from.** A bank, cash or card account.
- **Category.** The expense account, or an income account for a refund.

Click **Record**. You see `Expense recorded and receipt attached.` The entry is posted at once, in the company that owns the paid-from account. A date in a closed month is refused: `That date falls in a closed period. Use a reversal, or reopen the period first.`

## When a tab is empty

- **To file:** **Nothing waiting** and `Upload a bill or receipt — or forward one to your email-in address — and it will land here, read and ready to file.`
- **Filed:** **Nothing filed yet** and `Documents attached to transactions show up here.`
- **Trash:** **Trash is empty** and `Trashed documents can be restored any time — nothing is ever permanently deleted.`

## Companies

The Inbox is shared across your companies. A document has no company until it becomes a bill or an expense, so there is no company picker here.
